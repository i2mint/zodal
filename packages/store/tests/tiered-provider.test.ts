import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { createTieredProvider } from '../src/tiered-provider.js';
import { providerContract } from '../src/testing.js';
import type { DataProvider } from '../src/data-provider.js';

type Song = { id: string; title: string; status?: string };

// The tier must satisfy the DataProvider contract like any provider.
const cases = await providerContract({
  make: (seed) =>
    createTieredProvider({ cold: createInMemoryProvider(seed), hot: createInMemoryProvider([]) }),
});
describe('tiered provider: DataProvider contract', () => {
  for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
});

function setup(seed: Song[], opts: { maxItems?: number; isFresh?: (s: Song) => boolean } = {}) {
  const cold = createInMemoryProvider<Song>(seed);
  const hot = createInMemoryProvider<Song>([]);
  let t = 0;
  const tier = createTieredProvider({ cold, hot, now: () => ++t, ...opts });
  return { cold, hot, tier };
}

function offline<T>(p: DataProvider<T>): DataProvider<T> {
  const fail = () => Promise.reject(new Error('offline'));
  return { ...p, getList: fail, getOne: fail, create: fail, update: fail };
}

const songs = (n: number): Song[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }));

describe('createTieredProvider', () => {
  it('caches what is read one by one, and serves it from the hot tier', async () => {
    const { cold, hot, tier } = setup(songs(3));
    expect(await tier.getOne('s1')).toEqual({ id: 's1', title: 'Song 1' });
    expect(await hot.getOne('s1')).toEqual({ id: 's1', title: 'Song 1' });
    await cold.update('s1', { title: 'changed remotely' });
    expect((await tier.getOne('s1')).title).toBe('Song 1'); // fresh by default
  });

  it('re-reads items that are not fresh yet', async () => {
    const { cold, tier } = setup([{ id: 'a', title: 'A', status: 'pending' }], {
      isFresh: (s) => s.status === 'complete',
    });
    await tier.getOne('a');
    await cold.update('a', { status: 'complete' });
    expect((await tier.getOne('a')).status).toBe('complete');
  });

  it('evicts the least recently used beyond maxItems', async () => {
    const { tier } = setup(songs(4), { maxItems: 2 });
    await tier.getOne('s0');
    await tier.getOne('s1');
    await tier.getOne('s0'); // s0 used again: s1 is now the oldest
    await tier.getOne('s2');
    expect((await tier.cached()).map((s) => s.id)).toEqual(['s2', 's0']);
  });

  it('does not cache list results unless asked', async () => {
    const { tier } = setup(songs(5));
    await tier.getList({});
    expect(await tier.cached()).toEqual([]);
  });

  it('answers lists and reads from the hot tier when the cold tier is unreachable', async () => {
    const cold = createInMemoryProvider<Song>(songs(3));
    const hot = createInMemoryProvider<Song>([]);
    const online = createTieredProvider({ cold, hot });
    await online.getOne('s2');
    const off = createTieredProvider({ cold: offline(cold), hot });
    expect((await off.getList({})).data.map((s) => s.id)).toEqual(['s2']);
    expect((await off.getOne('s2')).title).toBe('Song 2');
    await expect(off.getOne('s0')).rejects.toThrow('offline');
  });

  it('writes through: created items are cached only after the cold tier accepts them', async () => {
    const { cold, hot, tier } = setup([]);
    const created = await tier.create({ id: 'n', title: 'New' });
    expect(await cold.getOne('n')).toEqual(created);
    expect(await hot.getOne('n')).toEqual(created);
    const failing = createTieredProvider({ cold: offline(cold), hot });
    await expect(failing.create({ id: 'x', title: 'X' })).rejects.toThrow();
    await expect(hot.getOne('x')).rejects.toThrow();
  });

  it('delete removes the item from both tiers; evict only from the hot one', async () => {
    const { cold, hot, tier } = setup(songs(2));
    await tier.getOne('s0');
    await tier.getOne('s1');
    await tier.delete('s0');
    await expect(cold.getOne('s0')).rejects.toThrow();
    await expect(hot.getOne('s0')).rejects.toThrow();
    await tier.evict();
    expect(await tier.cached()).toEqual([]);
    expect(await cold.getOne('s1')).toBeTruthy();
  });

  it('keeps recency in a provided access log', async () => {
    const accessLog = createInMemoryProvider<{ id: string; at: number }>([]);
    const cold = createInMemoryProvider<Song>(songs(2));
    const tier = createTieredProvider({ cold, hot: createInMemoryProvider([]), accessLog, now: () => 7 });
    await tier.getOne('s1');
    expect(await accessLog.getOne('s1')).toEqual({ id: 's1', at: 7 });
  });
});
