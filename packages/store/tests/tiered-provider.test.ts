import { describe, it, expect, vi } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { createTieredProvider, isUnreachable } from '../src/tiered-provider.js';
import type { ResidencyRecord } from '../src/tiered-provider.js';
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

function setup(seed: Song[], opts: Partial<Parameters<typeof createTieredProvider<Song>>[0]> = {}) {
  const cold = createInMemoryProvider<Song>(seed);
  const hot = createInMemoryProvider<Song>([]);
  let t = 0;
  const tier = createTieredProvider<Song>({ cold, hot, now: () => ++t, ...opts });
  return { cold, hot, tier };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function failing<T>(p: DataProvider<T>, error: unknown = new TypeError('Failed to fetch')): DataProvider<T> {
  const fail = () => Promise.reject(error);
  return { ...p, getList: fail, getOne: fail, create: fail, update: fail };
}

const songs = (n: number): Song[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }));

const ids = (xs: Song[]) => xs.map((s) => s.id);

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
    expect(ids(await tier.cached())).toEqual(['s2', 's0']);
  });

  it('keeps concurrent reads in LRU order', async () => {
    const { tier } = setup(songs(4), { maxItems: 2 });
    await tier.getOne('s1');
    await Promise.all([tier.getOne('s3'), tier.getOne('s2')]);
    expect(ids(await tier.cached()).sort()).toEqual(['s2', 's3']);
  });

  it('ranks items with no residency record (a reload) older, the later stored the newer', async () => {
    const hot = createInMemoryProvider<Song>(songs(3)); // persisted from a past session
    const cold = createInMemoryProvider<Song>(songs(6));
    const tier = createTieredProvider<Song>({ cold, hot, maxItems: 3 });
    await tier.getOne('s5');
    expect(ids(await tier.cached())).toEqual(['s5', 's2', 's1']);
  });

  it('applies a lowered budget before the first read', async () => {
    const hot = createInMemoryProvider<Song>(songs(3));
    const tier = createTieredProvider<Song>({ cold: createInMemoryProvider(songs(3)), hot, maxItems: 0 });
    expect(await tier.cached()).toEqual([]);
  });

  it('does not cache list results by default; the admit policy can', async () => {
    const { tier } = setup(songs(5));
    await tier.getList({});
    expect(await tier.cached()).toEqual([]);
    const listing = setup(songs(5), { admit: () => true, maxItems: 3 }).tier;
    await listing.getList({});
    expect((await listing.cached()).length).toBe(3);
  });

  it('answers from the hot tier when the cold tier is unreachable, and says so', async () => {
    const cold = createInMemoryProvider<Song>(songs(3));
    const hot = createInMemoryProvider<Song>([]);
    await createTieredProvider({ cold, hot }).getOne('s2');
    const onFallback = vi.fn();
    const off = createTieredProvider({ cold: failing(cold), hot, onFallback, isFresh: () => false });
    expect(ids((await off.getList({})).data)).toEqual(['s2']);
    expect((await off.getOne('s2')).title).toBe('Song 2');
    await expect(off.getOne('s0')).rejects.toThrow('Failed to fetch');
    expect(onFallback.mock.calls.map(([info]) => info.op)).toEqual(['getList', 'getOne']);
  });

  it('does not hide a 4xx behind the cache; a 404 drops the copy', async () => {
    const cold = createInMemoryProvider<Song>(songs(2));
    const hot = createInMemoryProvider<Song>([]);
    await createTieredProvider({ cold, hot, isFresh: () => false }).getOne('s1');
    const unauthorized = createTieredProvider({ cold: failing(cold, httpError(401)), hot });
    await expect(unauthorized.getList({})).rejects.toThrow('401');
    const gone = createTieredProvider({ cold: failing(cold, httpError(404)), hot, isFresh: () => false });
    await expect(gone.getOne('s1')).rejects.toThrow('404');
    await expect(hot.getOne('s1')).rejects.toThrow();
    expect(isUnreachable(httpError(503))).toBe(true);
  });

  it('a failing cache never fails an operation the cold tier completed', async () => {
    const cold = createInMemoryProvider<Song>([]);
    const full = createInMemoryProvider<Song>([]);
    const quota = () => Promise.reject(new Error('QuotaExceededError'));
    const hot = { ...full, create: quota, upsert: quota } as DataProvider<Song>;
    const onCacheError = vi.fn();
    const tier = createTieredProvider({ cold, hot, onCacheError });
    const created = await tier.create({ id: 'n', title: 'New' });
    expect(await cold.getOne('n')).toEqual(created);
    expect(onCacheError).toHaveBeenCalled();
  });

  it('writes through: created items are cached only after the cold tier accepts them', async () => {
    const { cold, hot, tier } = setup([]);
    const created = await tier.create({ id: 'n', title: 'New' });
    expect(await hot.getOne('n')).toEqual(created);
    const refused = createTieredProvider({ cold: failing(cold), hot });
    await expect(refused.create({ id: 'x', title: 'X' })).rejects.toThrow();
    await expect(hot.getOne('x')).rejects.toThrow();
  });

  it('update refreshes a cached copy and does not cache others', async () => {
    const { hot, tier } = setup(songs(2));
    await tier.getOne('s0');
    await tier.update('s0', { title: 'new 0' });
    await tier.update('s1', { title: 'new 1' });
    expect((await hot.getOne('s0')).title).toBe('new 0');
    await expect(hot.getOne('s1')).rejects.toThrow();
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

  it('a touch merges into the residency record and keeps its other fields', async () => {
    const residency = createInMemoryProvider<ResidencyRecord>([{ id: 's1', at: 0, pinned: true }]);
    const tier = createTieredProvider<Song>({
      cold: createInMemoryProvider(songs(2)),
      hot: createInMemoryProvider([]),
      residency,
      now: () => 7,
    });
    await tier.getOne('s1');
    expect(await residency.getOne('s1')).toEqual({ id: 's1', at: 7, pinned: true });
  });

  it('reports mismatched id fields instead of silently collapsing items', async () => {
    type Keyed = { songId: string; title: string };
    const onCacheError = vi.fn();
    const tier = createTieredProvider<Keyed>({
      cold: createInMemoryProvider<Keyed>([{ songId: 'a', title: 'A' }], { idField: 'songId' }),
      hot: createInMemoryProvider<Keyed>([]),
      idField: 'songId',
      onCacheError,
    });
    await tier.getOne('a');
    expect(String(onCacheError.mock.calls[0]?.[0])).toMatch(/same idField/);
  });

  it('applies remote events in order', async () => {
    let emit: (e: any) => void = () => {};
    const base = createInMemoryProvider<Song>(songs(1));
    const cold = { ...base, subscribe: (cb: any) => ((emit = cb), () => {}) } as DataProvider<Song>;
    const hot = createInMemoryProvider<Song>([]);
    const tier = createTieredProvider({ cold, hot });
    await tier.getOne('s0');
    const seen: string[] = [];
    tier.subscribe!((e) => seen.push(e.type));
    emit({ type: 'updated', id: 's0', item: { id: 's0', title: 'x' } });
    emit({ type: 'deleted', id: 's0' });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['updated', 'deleted']);
    await expect(hot.getOne('s0')).rejects.toThrow();
  });
});
