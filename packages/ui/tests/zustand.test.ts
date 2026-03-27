import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import { createZustandStoreSlice } from '../src/state/zustand.js';

const TestSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'inactive']),
  priority: z.number(),
});

type TestItem = z.infer<typeof TestSchema>;

const sampleData: TestItem[] = [
  { id: '1', name: 'Alpha', status: 'active', priority: 3 },
  { id: '2', name: 'Beta', status: 'inactive', priority: 1 },
  { id: '3', name: 'Gamma', status: 'active', priority: 5 },
];

/** Minimal Zustand-like mock for testing the slice pattern */
function createMockStore<T>(initializer: (set: any, get: any) => T): { getState: () => T } {
  let state: T;
  const set = (fn: (s: T) => T) => { state = fn(state); };
  const get = () => state;
  state = initializer(set, get);
  return { getState: () => state };
}

describe('createZustandStoreSlice', () => {
  it('returns a function (StateCreator pattern)', () => {
    const collection = defineCollection(TestSchema);
    const slice = createZustandStoreSlice(collection);
    expect(typeof slice).toBe('function');
  });

  it('initializer produces state with bound actions', () => {
    const collection = defineCollection(TestSchema);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection));
    const state = store.getState();

    expect(state.items).toEqual([]);
    expect(state.totalCount).toBe(0);
    expect(typeof state.setItems).toBe('function');
    expect(typeof state.setSorting).toBe('function');
    expect(typeof state.clearSelection).toBe('function');
  });

  it('bound actions mutate state', () => {
    const collection = defineCollection(TestSchema);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection));

    store.getState().setItems(sampleData, 3);
    expect(store.getState().items).toHaveLength(3);
    expect(store.getState().totalCount).toBe(3);

    store.getState().setSorting([{ id: 'name', desc: false }]);
    expect(store.getState().sorting).toEqual([{ id: 'name', desc: false }]);

    store.getState().setGlobalFilter('alpha');
    expect(store.getState().globalFilter).toBe('alpha');
    expect(store.getState().pagination.pageIndex).toBe(0); // reset on filter

    store.getState().setRowSelection({ '0': true, '2': true });
    expect(store.getState().rowSelection).toEqual({ '0': true, '2': true });

    store.getState().clearSelection();
    expect(store.getState().rowSelection).toEqual({});
  });

  it('selectAll selects all current items', () => {
    const collection = defineCollection(TestSchema);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection));

    store.getState().setItems(sampleData, 3);
    store.getState().selectAll();
    expect(store.getState().rowSelection).toEqual({ '0': true, '1': true, '2': true });
  });

  it('reset preserves items but clears UI state', () => {
    const collection = defineCollection(TestSchema);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection));

    store.getState().setItems(sampleData, 3);
    store.getState().setSorting([{ id: 'name', desc: true }]);
    store.getState().setGlobalFilter('test');
    store.getState().setRowSelection({ '0': true });

    store.getState().reset();
    expect(store.getState().items).toHaveLength(3); // preserved
    expect(store.getState().sorting).toEqual([]); // reset
    expect(store.getState().globalFilter).toBe(''); // reset
    expect(store.getState().rowSelection).toEqual({}); // reset
  });

  it('fetchData is available when provider is supplied', () => {
    const collection = defineCollection(TestSchema);
    const provider = createInMemoryProvider(sampleData);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection, provider));

    expect(typeof store.getState().fetchData).toBe('function');
  });

  it('fetchData is absent when no provider', () => {
    const collection = defineCollection(TestSchema);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection));

    expect(store.getState().fetchData).toBeUndefined();
  });

  it('fetchData loads data from provider', async () => {
    const collection = defineCollection(TestSchema);
    const provider = createInMemoryProvider(sampleData);
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection, provider));

    await store.getState().fetchData!();

    expect(store.getState().items).toHaveLength(3);
    expect(store.getState().totalCount).toBe(3);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it('fetchData handles errors', async () => {
    const collection = defineCollection(TestSchema);
    const badProvider = {
      async getList() { throw new Error('Network error'); },
      async getOne() { throw new Error(''); },
      async create() { throw new Error(''); },
      async update() { throw new Error(''); },
      async updateMany() { throw new Error(''); },
      async delete() { throw new Error(''); },
      async deleteMany() { throw new Error(''); },
    } as any;
    const store = createMockStore(createZustandStoreSlice<TestItem>(collection, badProvider));

    await store.getState().fetchData!();

    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBe('Network error');
  });
});
