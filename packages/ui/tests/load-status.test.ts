import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import { createCollectionStore, createZustandStoreSlice, getLoadFeedback } from '../src/index.js';

const collection = defineCollection(z.object({ id: z.string(), name: z.string() }));

describe('loadStatus (zodal#111)', () => {
  it('first load, ready, refresh, empty and error', () => {
    const { initialState: s0, actions: a } = createCollectionStore<{ id: string; name: string }>(collection);
    expect(s0.loadStatus).toBe('idle');
    let s = a.setLoading(s0, true);
    expect(s.loadStatus).toBe('first-load');
    expect(getLoadFeedback(s)).toBe('skeleton');
    s = a.setLoading(a.setItems(s, [{ id: '1', name: 'a' }]), false);
    expect(s.loadStatus).toBe('ready');
    s = a.setLoading(s, true);
    expect(s.loadStatus).toBe('refreshing');
    expect(getLoadFeedback(s)).toBe('stale');
    expect(s.loading).toBe(true); // the boolean hosts read still works
    s = a.setError(a.setLoading(s, false), 'boom');
    expect(s.loadStatus).toBe('error');
    s = a.setError(a.setLoading(a.setItems(s, []), false), null);
    expect(s.loadStatus).toBe('empty');
    expect(getLoadFeedback(s)).toBe('none');
  });
  it('a fast load shows nothing', () => {
    const { initialState, actions } = createCollectionStore(collection);
    const s = actions.setLoading(initialState, true);
    expect(getLoadFeedback(s, { elapsedMs: 120 })).toBe('none');
    expect(getLoadFeedback(s, { elapsedMs: 500 })).toBe('skeleton');
  });
  it('fetchData moves through first-load to ready, then refreshing', async () => {
    let state: any;
    const set = (fn: (s: any) => any) => (state = { ...state, ...fn(state) });
    const get = () => state;
    const provider = createInMemoryProvider([{ id: '1', name: 'a' }]);
    state = createZustandStoreSlice(collection, provider)(set, get);
    const seen: string[] = [];
    const p = state.fetchData();
    seen.push(state.loadStatus);
    await p;
    seen.push(state.loadStatus);
    const q = state.fetchData();
    seen.push(state.loadStatus);
    await q;
    expect(seen).toEqual(['first-load', 'ready', 'refreshing']);
    expect(state.loadStatus).toBe('ready');
  });
});
