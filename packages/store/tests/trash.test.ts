import { describe, it, expect } from 'vitest';
import { selectMatching, resolveView } from '@zodal/core';
import { createInMemoryProvider, withTrash, TRASH_FIELD } from '../src/index.js';
import { providerContract } from '../src/testing.js';
import type { DataProvider } from '../src/data-provider.js';

type Song = { id: string; title: string; genre: string; deletedAt?: string | number | null };
const seed = (): Song[] => [
  { id: 's1', title: 'Alpha', genre: 'jazz' },
  { id: 's2', title: 'Beta', genre: 'rock' },
  { id: 's3', title: 'Gamma', genre: 'jazz' },
  { id: 's4', title: 'Delta', genre: 'jazz' },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
const jazz = { filter: { field: 'genre', operator: 'eq' as const, value: 'jazz' } };

function make(options: Parameters<typeof withTrash<Song>>[1] = {}) {
  const base = createInMemoryProvider<Song>(seed());
  let t = 0;
  const songs = withTrash(base, { stamp: () => new Date(Date.UTC(2026, 0, 1) + ++t * 1000).toISOString(), ...options });
  return { base, songs };
}

// The wrapper is a DataProvider: it passes the whole contract (delete means "gone from the live
// collection": getOne rejects, getList leaves it out).
const cases = await providerContract({ make: (rows) => withTrash(createInMemoryProvider(rows)) as DataProvider<any> });
describe('withTrash: DataProvider contract', () => {
  for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
});

describe('withTrash', () => {
  it('delete marks instead of deleting; lists and getOne hide it; the Trash shows it', async () => {
    const { base, songs } = make();
    await songs.delete('s1');
    expect(ids((await songs.getList({})).data)).toEqual(['s2', 's3', 's4']);
    await expect(songs.getOne('s1')).rejects.toThrow(/Trash/);
    expect((await base.getOne('s1')).deletedAt).toBe('2026-01-01T00:00:01.000Z');
    expect(ids((await songs.trashed.getList({})).data)).toEqual(['s1']);
    expect((await songs.trashed.getOne('s1')).id).toBe('s1');
    await expect(songs.delete('s1')).rejects.toThrow(); // already gone from the live collection
  });

  it('keeps a caller filter, and the totals count only live items', async () => {
    const { songs } = make();
    await songs.deleteMany(['s1', 's3']);
    const r = await songs.getList({ filter: jazz.filter });
    expect(ids(r.data)).toEqual(['s4']);
    expect(r.total).toBe(1);
  });

  it('moves a selection to the Trash in one call, and Undo is one restore of what it returns', async () => {
    const { songs } = make();
    const moved = await songs.moveToTrash({ kind: 'query', query: jazz, exclude: ['s4'] });
    expect(moved.sort()).toEqual(['s1', 's3']);
    expect(ids((await songs.getList({})).data)).toEqual(['s2', 's4']);
    expect((await songs.restore(moved)).sort()).toEqual(['s1', 's3']);
    expect(ids((await songs.getList({})).data)).toEqual(['s1', 's2', 's3', 's4']);
    expect((await songs.trashed.getList({})).total).toBe(0);
  });

  it('does not re-stamp an item already in the Trash', async () => {
    const { base, songs } = make();
    await songs.moveToTrash(['s1']);
    const first = (await base.getOne('s1')).deletedAt;
    expect(await songs.moveToTrash(['s1', 's2'])).toEqual(['s2']);
    expect((await base.getOne('s1')).deletedAt).toBe(first);
  });

  it('restores and purges a selection resolved in the Trash', async () => {
    const { base, songs } = make();
    await songs.deleteMany(['s1', 's2', 's3']);
    expect(await songs.restore(selectMatching({ search: 'gam' }))).toEqual(['s3']);
    expect((await songs.purge(selectMatching(jazz))).sort()).toEqual(['s1']);
    await expect(base.getOne('s1')).rejects.toThrow();
    expect(ids((await songs.trashed.getList({})).data)).toEqual(['s2']);
  });

  it('empties the Trash for real, leaving live items', async () => {
    const { base, songs } = make();
    await songs.deleteMany(['s1', 's2']);
    expect(await songs.emptyTrash()).toBe(2);
    expect(ids((await base.getList({})).data)).toEqual(['s3', 's4']);
    expect(await songs.emptyTrash()).toBe(0);
  });

  it('the Trash view deletes permanently', async () => {
    const { base, songs } = make();
    await songs.delete('s2');
    await songs.trashed.delete('s2');
    await expect(base.getOne('s2')).rejects.toThrow();
  });

  it('purges what has been in the Trash past the retention, and nothing without one', async () => {
    let clock = Date.UTC(2026, 0, 1);
    const base = createInMemoryProvider<Song>(seed());
    const songs = withTrash(base, { retentionDays: 30, stamp: () => clock, now: () => clock });
    await songs.delete('s1');
    clock += 20 * 86_400_000;
    await songs.delete('s2');
    clock += 15 * 86_400_000; // s1: 35 days, s2: 15 days
    expect(await songs.purgeExpired()).toBe(1);
    await expect(base.getOne('s1')).rejects.toThrow();
    expect(ids((await songs.trashed.getList({})).data)).toEqual(['s2']);
    expect(await make().songs.purgeExpired()).toBe(0);
  });

  it('declares softDelete, and the Trash view matches the trashed items', async () => {
    const { base, songs } = make();
    expect(songs.getCapabilities!().softDelete).toBe(true);
    expect(songs.trashed.getCapabilities!().softDelete).toBe(false);
    expect(songs.trashField).toBe(TRASH_FIELD);
    await songs.delete('s3');
    const all = (await base.getList({})).data;
    expect(ids(resolveView(songs.trashView, all))).toEqual(['s3']);
    expect(songs.trashView).toMatchObject({ id: 'trash', scope: 'system', name: 'Trash' });
  });

  it('takes another mark field', async () => {
    const base = createInMemoryProvider<Song & { trashedAt?: number }>(seed());
    const songs = withTrash(base, { field: 'trashedAt', stamp: () => 1 });
    await songs.delete('s1');
    expect((await base.getOne('s1')).trashedAt).toBe(1);
    expect((await songs.getList({})).total).toBe(3);
  });

  it('a versioned delete moves to the Trash under the version check', async () => {
    const calls: unknown[] = [];
    const base = createInMemoryProvider<Song>(seed());
    const versioned = {
      ...base,
      async updateIfVersion(id: string, data: Partial<Song>, expected: string | number) {
        calls.push([id, data, expected]);
        return { item: await base.update(id, data), version: 2 };
      },
      async deleteIfVersion() { throw new Error('hard delete must not be reached'); },
    } as DataProvider<Song>;
    const songs = withTrash(versioned, { stamp: () => 7 });
    await songs.deleteIfVersion!('s1', 1);
    expect(calls).toEqual([['s1', { deletedAt: 7 }, 1]]);
    expect(withTrash({ ...base, updateIfVersion: undefined } as DataProvider<Song>).deleteIfVersion).toBeUndefined();
  });
});
