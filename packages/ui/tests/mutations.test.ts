/** Mutation modes (zodal#110), as the issue's acceptance states them. */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import type { DataProvider } from '@zodal/store';
import { createZustandStoreSlice, createMutations } from '../src/index.js';
import type { MutationFeedback } from '../src/index.js';

type Row = { id: string; name: string };
const collection = defineCollection(z.object({ id: z.string(), name: z.string() }));

function harness(provider: DataProvider<Row>, opts: Parameters<typeof createZustandStoreSlice>[2] = {}) {
  let state: any;
  const set = (fn: (s: any) => any) => (state = { ...state, ...fn(state) });
  const get = () => state;
  state = createZustandStoreSlice<Row>(collection, provider, opts)(set, get);
  return { get state() { return state; } };
}

const gate = () => {
  let release!: () => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<void>((r, j) => ((release = r), (fail = j)));
  return { promise, release, fail };
};

describe('optimistic', () => {
  it('shows an update at once, pending, then the provider answer', async () => {
    const inner = createInMemoryProvider<Row>([{ id: '1', name: 'old' }]);
    const g = gate();
    const provider = { ...inner, update: async (id: string, d: Partial<Row>) => (await g.promise, inner.update(id, d)) };
    const h = harness(provider, { mode: 'optimistic' });
    await h.state.fetchData();
    const done = h.state.updateItem('1', { name: 'new' });
    expect(h.state.items[0].name).toBe('new');
    expect(Object.values(h.state.pending)).toMatchObject([{ kind: 'update', itemId: '1', status: 'pending' }]);
    g.release();
    await done;
    expect(h.state.pending).toEqual({});
  });
  it('a failure restores the item, marks it failed and offers a working retry', async () => {
    const inner = createInMemoryProvider<Row>([{ id: '1', name: 'old' }, { id: '2', name: 'other' }]);
    let fails = 1;
    const provider = { ...inner, update: (id: string, d: Partial<Row>) => (fails-- > 0 ? Promise.reject(new Error('503')) : inner.update(id, d)) };
    const seen: MutationFeedback[] = [];
    const h = harness(provider, { mode: 'optimistic', onFeedback: (f) => seen.push(f) });
    await h.state.fetchData();
    await expect(h.state.updateItem('1', { name: 'new' })).rejects.toThrow('503');
    expect(h.state.items.map((r: Row) => r.name)).toEqual(['old', 'other']);
    const failed = Object.values(h.state.pending) as any[];
    expect(failed[0]).toMatchObject({ status: 'failed' });
    const rolled = seen.find((f) => f.kind === 'rolledBack') as Extract<MutationFeedback, { kind: 'rolledBack' }>;
    await rolled.retry();
    expect(h.state.items[0].name).toBe('new');
    expect((await inner.getOne('1')).name).toBe('new');
    expect(h.state.pending).toEqual({});
  });
  it('a created item keeps its client id, and a failed delete puts the item back in place', async () => {
    const inner = createInMemoryProvider<Row>([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
    const provider = { ...inner, delete: () => Promise.reject(new Error('nope')) };
    const h = harness(provider, { mode: 'optimistic', newId: () => 'client-1' });
    await h.state.fetchData();
    const created = await h.state.createItem({ name: 'D' });
    expect(created.id).toBe('client-1');
    expect((await inner.getOne('client-1')).name).toBe('D');
    await expect(h.state.deleteItem('b')).rejects.toThrow('nope');
    expect(h.state.items.map((r: Row) => r.id)).toEqual(['a', 'b', 'c', 'client-1']);
  });
});

describe('undoable', () => {
  it('sends nothing within the Undo window; Undo restores; the window ending sends', async () => {
    vi.useFakeTimers();
    try {
      const inner = createInMemoryProvider<Row>([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
      const del = vi.fn((id: string) => inner.delete(id));
      const seen: MutationFeedback[] = [];
      const h = harness({ ...inner, delete: del }, { mode: 'undoable', undoSeconds: 5, onFeedback: (f) => seen.push(f) });
      await h.state.fetchData();
      const first = h.state.deleteItem('1').catch((e: Error) => e.name);
      expect(h.state.items.map((r: Row) => r.id)).toEqual(['2']);
      vi.advanceTimersByTime(4000);
      expect(del).not.toHaveBeenCalled();
      (seen.find((f) => f.kind === 'scheduled') as any).undo();
      expect(await first).toBe('MutationUndone');
      expect(h.state.items.map((r: Row) => r.id)).toEqual(['1', '2']);
      const second = h.state.deleteItem('2');
      vi.advanceTimersByTime(5000);
      await second;
      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith('2');
    } finally {
      vi.useRealTimers();
    }
  });
  it('flush sends what is waiting', async () => {
    const inner = createInMemoryProvider<Row>([{ id: '1', name: 'A' }]);
    const h = harness(inner, { mode: 'undoable', undoSeconds: 60 });
    await h.state.fetchData();
    const p = h.state.updateItem('1', { name: 'Z' });
    await h.state.flushMutations();
    await p;
    expect((await inner.getOne('1')).name).toBe('Z');
  });
});

describe('pessimistic (default)', () => {
  it('shows nothing until the provider answers, as before', async () => {
    const inner = createInMemoryProvider<Row>([{ id: '1', name: 'old' }]);
    const g = gate();
    const h = harness({ ...inner, update: async (id: string, d: Partial<Row>) => (await g.promise, inner.update(id, d)) });
    await h.state.fetchData();
    const done = h.state.updateItem('1', { name: 'new' });
    expect(h.state.items[0].name).toBe('old');
    g.release();
    await done;
    expect(h.state.items[0].name).toBe('new');
  });
  it('a per-call mode overrides the slice mode, and mutations of one item go in order', async () => {
    const inner = createInMemoryProvider<Row>([{ id: '1', name: 'a' }]);
    const order: string[] = [];
    const provider = { ...inner, update: async (id: string, d: Partial<Row>) => (order.push(String(d.name)), inner.update(id, d)) };
    let state: any;
    const set = (fn: (s: any) => any) => (state = { ...state, ...fn(state) });
    state = { items: [{ id: '1', name: 'a' }], totalCount: 1 };
    const m = createMutations<Row>(provider, () => state, set);
    await Promise.all([m.update('1', { name: 'b' }, { mode: 'optimistic' }), m.update('1', { name: 'c' }, { mode: 'optimistic' })]);
    expect(order).toEqual(['b', 'c']);
    expect(state.items[0].name).toBe('c');
  });
});
