import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createCollectionStore } from '../src/state/store.js';
import type { CollectionState } from '../src/state/store.js';

// ============================================================================
// Test Schema
// ============================================================================

const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  status: z.enum(['draft', 'active', 'archived']),
  priority: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Project = z.infer<typeof ProjectSchema>;

const sampleProjects: Project[] = [
  { id: '1', name: 'Alpha', status: 'active', priority: 3, tags: ['web'], createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-06-01') },
  { id: '2', name: 'Beta', status: 'draft', priority: 1, tags: ['api'], createdAt: new Date('2024-02-01'), updatedAt: new Date('2024-06-15') },
  { id: '3', name: 'Gamma', status: 'archived', priority: 5, tags: ['web', 'api'], createdAt: new Date('2024-03-01'), updatedAt: new Date('2024-07-01') },
];

// ============================================================================
// createCollectionStore
// ============================================================================

describe('createCollectionStore', () => {
  it('creates a store from a collection definition', () => {
    const collection = defineCollection(ProjectSchema);
    const store = createCollectionStore<Project>(collection);
    expect(store).toBeDefined();
    expect(store.initialState).toBeDefined();
    expect(store.actions).toBeDefined();
    expect(store.selectors).toBeDefined();
  });

  it('initial state has empty items', () => {
    const collection = defineCollection(ProjectSchema);
    const store = createCollectionStore<Project>(collection);
    expect(store.initialState.items).toEqual([]);
    expect(store.initialState.totalCount).toBe(0);
    expect(store.initialState.loading).toBe(false);
    expect(store.initialState.error).toBeNull();
  });

  it('initial state uses default pagination from collection', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { pagination: { defaultPageSize: 50 } },
    });
    const store = createCollectionStore<Project>(collection);
    expect(store.initialState.pagination.pageSize).toBe(50);
    expect(store.initialState.pagination.pageIndex).toBe(0);
  });

  it('initial state uses default sort from collection', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { defaultSort: { field: 'createdAt', direction: 'desc' } },
    });
    const store = createCollectionStore<Project>(collection);
    expect(store.initialState.sorting).toEqual([{ id: 'createdAt', desc: true }]);
  });

  it('initial state hides fields that should be hidden', () => {
    const collection = defineCollection(ProjectSchema);
    const store = createCollectionStore<Project>(collection);
    // 'id' is detected as hidden (UUID → id pattern)
    expect(store.initialState.columnVisibility.id).toBe(false);
    // 'updatedAt' is detected as hidden
    expect(store.initialState.columnVisibility.updatedAt).toBe(false);
    // visible fields should not be false
    expect(store.initialState.columnVisibility.name).toBeUndefined();
  });

  it('initial state includes column order', () => {
    const collection = defineCollection(ProjectSchema);
    const store = createCollectionStore<Project>(collection);
    expect(store.initialState.columnOrder).toContain('name');
    expect(store.initialState.columnOrder).toContain('status');
    expect(store.initialState.columnOrder).toContain('id');
  });
});

// ============================================================================
// Actions (pure state transitions)
// ============================================================================

describe('store actions', () => {
  const collection = defineCollection(ProjectSchema);
  const store = createCollectionStore<Project>(collection);

  it('setItems replaces items and updates total', () => {
    const state = store.actions.setItems(store.initialState, sampleProjects, 100);
    expect(state.items).toEqual(sampleProjects);
    expect(state.totalCount).toBe(100);
  });

  it('setItems defaults total to items.length', () => {
    const state = store.actions.setItems(store.initialState, sampleProjects);
    expect(state.totalCount).toBe(3);
  });

  it('setSorting updates sorting state', () => {
    const state = store.actions.setSorting(store.initialState, [{ id: 'name', desc: false }]);
    expect(state.sorting).toEqual([{ id: 'name', desc: false }]);
  });

  it('setColumnFilters updates filters and resets page', () => {
    let state = store.actions.setPagination(store.initialState, { pageIndex: 3, pageSize: 25 });
    state = store.actions.setColumnFilters(state, [{ id: 'status', value: 'active' }]);
    expect(state.columnFilters).toEqual([{ id: 'status', value: 'active' }]);
    expect(state.pagination.pageIndex).toBe(0); // reset to first page
  });

  it('setGlobalFilter updates filter and resets page', () => {
    let state = store.actions.setPagination(store.initialState, { pageIndex: 5, pageSize: 25 });
    state = store.actions.setGlobalFilter(state, 'alpha');
    expect(state.globalFilter).toBe('alpha');
    expect(state.pagination.pageIndex).toBe(0); // reset to first page
  });

  it('setPagination updates pagination', () => {
    const state = store.actions.setPagination(store.initialState, { pageIndex: 2, pageSize: 50 });
    expect(state.pagination).toEqual({ pageIndex: 2, pageSize: 50 });
  });

  it('setRowSelection updates selection', () => {
    const state = store.actions.setRowSelection(store.initialState, { '0': true, '2': true });
    expect(state.rowSelection).toEqual({ '0': true, '2': true });
  });

  it('setColumnVisibility updates visibility', () => {
    const state = store.actions.setColumnVisibility(store.initialState, { tags: false });
    expect(state.columnVisibility.tags).toBe(false);
  });

  it('setLoading updates loading state', () => {
    const state = store.actions.setLoading(store.initialState, true);
    expect(state.loading).toBe(true);
  });

  it('setError updates error state', () => {
    const state = store.actions.setError(store.initialState, 'Network error');
    expect(state.error).toBe('Network error');
  });

  it('clearSelection clears row selection', () => {
    let state = store.actions.setRowSelection(store.initialState, { '0': true, '1': true });
    state = store.actions.clearSelection(state);
    expect(state.rowSelection).toEqual({});
  });

  it('selectAll selects all items', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects);
    state = store.actions.selectAll(state);
    expect(state.rowSelection).toEqual({ '0': true, '1': true, '2': true });
  });

  it('reset restores initial sort/filter/selection but preserves pageSize', () => {
    let state = store.initialState;
    state = store.actions.setItems(state, sampleProjects);
    state = store.actions.setSorting(state, [{ id: 'name', desc: true }]);
    state = store.actions.setGlobalFilter(state, 'test');
    state = store.actions.setRowSelection(state, { '0': true });
    state = store.actions.setPagination(state, { pageIndex: 3, pageSize: 50 });

    state = store.actions.reset(state);
    expect(state.sorting).toEqual(store.initialState.sorting);
    expect(state.globalFilter).toBe('');
    expect(state.columnFilters).toEqual([]);
    expect(state.rowSelection).toEqual({});
    expect(state.pagination.pageIndex).toBe(0);
    expect(state.pagination.pageSize).toBe(50); // preserved
    expect(state.items).toEqual(sampleProjects); // items preserved
  });

  it('actions produce new state objects (immutability)', () => {
    const state1 = store.initialState;
    const state2 = store.actions.setLoading(state1, true);
    expect(state1).not.toBe(state2);
    expect(state1.loading).toBe(false);
    expect(state2.loading).toBe(true);
  });
});

// ============================================================================
// Selectors
// ============================================================================

describe('store selectors', () => {
  const collection = defineCollection(ProjectSchema);
  const store = createCollectionStore<Project>(collection);

  it('getSelectedItems returns selected items', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects);
    state = store.actions.setRowSelection(state, { '0': true, '2': true });
    const selected = store.selectors.getSelectedItems(state);
    expect(selected).toEqual([sampleProjects[0], sampleProjects[2]]);
  });

  it('getSelectedCount returns number of selected items', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects);
    state = store.actions.setRowSelection(state, { '0': true, '2': true });
    expect(store.selectors.getSelectedCount(state)).toBe(2);
  });

  it('getSelectedCount returns 0 when nothing selected', () => {
    expect(store.selectors.getSelectedCount(store.initialState)).toBe(0);
  });

  it('getPageCount computes page count from total and pageSize', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects, 100);
    expect(store.selectors.getPageCount(state)).toBe(4); // 100 / 25 = 4
  });

  it('getPageCount handles uneven division', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects, 101);
    expect(store.selectors.getPageCount(state)).toBe(5); // ceil(101 / 25) = 5
  });

  it('isAllSelected returns true when all items selected', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects);
    state = store.actions.selectAll(state);
    expect(store.selectors.isAllSelected(state)).toBe(true);
  });

  it('isAllSelected returns false when no items', () => {
    expect(store.selectors.isAllSelected(store.initialState)).toBe(false);
  });

  it('isAllSelected returns false when partially selected', () => {
    let state = store.actions.setItems(store.initialState, sampleProjects);
    state = store.actions.setRowSelection(state, { '0': true });
    expect(store.selectors.isAllSelected(state)).toBe(false);
  });

  it('hasSelection returns true when items are selected', () => {
    let state = store.actions.setRowSelection(store.initialState, { '0': true });
    expect(store.selectors.hasSelection(state)).toBe(true);
  });

  it('hasSelection returns false when nothing selected', () => {
    expect(store.selectors.hasSelection(store.initialState)).toBe(false);
  });

  it('getVisibleItems slices items for current page', () => {
    // Create 10 items, page size 3
    const items = Array.from({ length: 10 }, (_, i) => ({
      ...sampleProjects[0],
      id: String(i),
      name: `Item ${i}`,
    }));
    let state = store.actions.setItems(store.initialState, items);
    state = store.actions.setPagination(state, { pageIndex: 1, pageSize: 3 });
    const visible = store.selectors.getVisibleItems(state);
    expect(visible).toHaveLength(3);
    expect(visible[0].name).toBe('Item 3');
    expect(visible[2].name).toBe('Item 5');
  });

  it('getVisibleItems handles last page with fewer items', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      ...sampleProjects[0],
      id: String(i),
      name: `Item ${i}`,
    }));
    let state = store.actions.setItems(store.initialState, items);
    state = store.actions.setPagination(state, { pageIndex: 3, pageSize: 3 });
    const visible = store.selectors.getVisibleItems(state);
    expect(visible).toHaveLength(1); // Only item 9
    expect(visible[0].name).toBe('Item 9');
  });
});
