import { describe, it, expect } from 'vitest';
import { createFieldHistory } from '../src/field-history.js';
import type { HistoryEntry } from '../src/field-history.js';
import { createInMemoryProvider } from '../src/in-memory.js';

function setup(opts: { max?: number } = {}) {
  let t = 0;
  const provider = createInMemoryProvider<HistoryEntry>([]);
  const history = createFieldHistory({ provider, now: () => ++t, ...opts });
  const values = async (scope: string) => (await history.list(scope)).map((e) => e.value);
  return { provider, history, values };
}

describe('createFieldHistory: record and list', () => {
  it('works with no options (in memory)', async () => {
    const history = createFieldHistory();
    await history.record('lyrics', 'la la');
    expect((await history.list('lyrics')).map((e) => e.value)).toEqual(['la la']);
  });

  it('lists most recent first', async () => {
    const { history, values } = setup();
    await history.record('s', 'a');
    await history.record('s', 'b');
    await history.record('s', 'c');
    expect(await values('s')).toEqual(['c', 'b', 'a']);
  });

  it('trims, and ignores empty values', async () => {
    const { history, values } = setup();
    await history.record('s', '  padded \n');
    await history.record('s', '   ');
    await history.record('s', '');
    expect(await values('s')).toEqual(['padded']);
  });

  it('keeps internal whitespace and case', async () => {
    const { history, values } = setup();
    await history.record('s', 'Line one\n\nline  two');
    await history.record('s', 'line one\n\nline  two');
    expect(await values('s')).toEqual(['line one\n\nline  two', 'Line one\n\nline  two']);
  });

  it('dedupes by moving an equal value to the top and counting its uses', async () => {
    const { history } = setup();
    await history.record('s', 'a');
    await history.record('s', 'b');
    await history.record('s', ' a ', { reason: 'pick' });
    const entries = await history.list('s');
    expect(entries.map((e) => [e.value, e.uses])).toEqual([['a', 2], ['b', 1]]);
    expect(entries[0].at).toBeGreaterThan(entries[1].at);
  });

  it('keeps scopes apart', async () => {
    const { history, values } = setup();
    await history.record('title', 'x');
    await history.record('lyrics', 'x');
    await history.record('lyrics', 'y');
    expect(await values('title')).toEqual(['x']);
    expect(await values('lyrics')).toEqual(['y', 'x']);
  });

  it('filters by query, ignoring case, and limits', async () => {
    const { history, values } = setup();
    for (const v of ['Dark synthwave', 'bright pop', 'darker ambient']) await history.record('style', v);
    expect((await history.list('style', { query: 'DARK' })).map((e) => e.value)).toEqual(['darker ambient', 'Dark synthwave']);
    expect((await history.list('style', { limit: 1 })).map((e) => e.value)).toEqual(['darker ambient']);
    expect(await values('style')).toHaveLength(3);
  });

  it('records concurrent calls of one value once', async () => {
    const { history } = setup();
    await Promise.all([history.record('s', 'same'), history.record('s', 'same'), history.record('s', 'same')]);
    const entries = await history.list('s');
    expect(entries).toHaveLength(1);
    expect(entries[0].uses).toBe(3);
  });
});

describe('createFieldHistory: cap', () => {
  it('evicts the least recent beyond the cap, per scope', async () => {
    const { history, values } = setup({ max: 2 });
    await history.record('s', 'a');
    await history.record('s', 'b');
    await history.record('other', 'z');
    await history.record('s', 'c');
    expect(await values('s')).toEqual(['c', 'b']);
    expect(await values('other')).toEqual(['z']);
  });

  it('takes a per-call cap', async () => {
    const { history, values } = setup();
    for (const v of ['a', 'b', 'c', 'd']) await history.record('s', v, { max: 3 });
    expect(await values('s')).toEqual(['d', 'c', 'b']);
  });

  it('never evicts pinned entries, nor counts them', async () => {
    const { history, values } = setup({ max: 2 });
    await history.record('s', 'keep');
    const [keep] = await history.list('s');
    await history.pin(keep.id);
    for (const v of ['a', 'b', 'c']) await history.record('s', v);
    expect(await values('s')).toEqual(['keep', 'c', 'b']);
  });

  it('refuses a cap that is not a positive integer', async () => {
    expect(() => createFieldHistory({ max: 0 })).toThrow(RangeError);
    const { history } = setup();
    await expect(history.record('s', 'a', { max: 2.5 })).rejects.toThrow(RangeError);
  });
});

describe('createFieldHistory: pin, remove, clear, restore', () => {
  it('lists pinned first, and unpins', async () => {
    const { history, values } = setup();
    await history.record('s', 'old');
    await history.record('s', 'new');
    const old = (await history.list('s')).find((e) => e.value === 'old')!;
    await history.pin(old.id);
    expect(await values('s')).toEqual(['old', 'new']);
    await history.pin(old.id, false);
    expect(await values('s')).toEqual(['new', 'old']);
  });

  it('removes one entry, and restore puts it back', async () => {
    const { history, values } = setup();
    await history.record('s', 'a');
    await history.record('s', 'b');
    const [b] = await history.list('s');
    await history.remove(b.id);
    expect(await values('s')).toEqual(['a']);
    await history.restore([b]);
    expect(await values('s')).toEqual(['b', 'a']);
  });

  it('clears one scope and returns what it removed', async () => {
    const { history, values } = setup();
    await history.record('s', 'a');
    await history.record('t', 'x');
    const removed = await history.clear('s');
    expect(removed.map((e) => e.value)).toEqual(['a']);
    expect(await values('s')).toEqual([]);
    expect(await values('t')).toEqual(['x']);
  });

  it('clears every scope', async () => {
    const { history, values } = setup();
    await history.record('s', 'a');
    await history.record('t', 'x');
    expect((await history.clear()).map((e) => e.value).sort()).toEqual(['a', 'x']);
    expect(await values('s')).toEqual([]);
    expect(await values('t')).toEqual([]);
  });

  it('restore undoes a clear exactly (ids, times, pins, uses)', async () => {
    const { history } = setup();
    await history.record('s', 'a');
    await history.record('s', 'b');
    await history.record('s', 'a');
    const [a] = await history.list('s');
    await history.pin(a.id);
    const before = await history.list('s');
    const removed = await history.clear('s');
    await history.restore(removed);
    expect(await history.list('s')).toEqual(before);
  });

  it('restore merges with a value recorded again since the clear', async () => {
    const { history } = setup();
    await history.record('s', 'a');
    const removed = await history.clear('s');
    await history.record('s', 'a');
    await history.restore(removed);
    const entries = await history.list('s');
    expect(entries).toHaveLength(1);
    expect(entries[0].uses).toBe(2);
  });

  it('restore skips entries that were never removed', async () => {
    const { history } = setup();
    await history.record('s', 'a');
    const entries = await history.list('s');
    await history.restore(entries);
    expect(await history.list('s')).toEqual(entries);
  });
});
