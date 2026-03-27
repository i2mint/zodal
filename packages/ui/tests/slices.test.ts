import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import {
  createSortingSlice,
  createFilterSlice,
  createPaginationSlice,
  createSelectionSlice,
  createColumnSlice,
} from '../src/state/slices.js';

const TestSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'inactive']),
  priority: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

describe('createSortingSlice', () => {
  it('initial state is empty when no defaultSort', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSortingSlice(collection);
    expect(slice.initialState.sorting).toEqual([]);
  });

  it('initial state uses defaultSort from collection', () => {
    const collection = defineCollection(TestSchema, {
      affordances: { defaultSort: { field: 'createdAt', direction: 'desc' } },
    });
    const slice = createSortingSlice(collection);
    expect(slice.initialState.sorting).toEqual([{ id: 'createdAt', desc: true }]);
  });

  it('setSorting replaces sorting', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSortingSlice(collection);
    const state = slice.actions.setSorting(slice.initialState, [{ id: 'name', desc: false }]);
    expect(state.sorting).toEqual([{ id: 'name', desc: false }]);
  });

  it('clearSorting empties sorting', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSortingSlice(collection);
    let state = slice.actions.setSorting(slice.initialState, [{ id: 'name', desc: false }]);
    state = slice.actions.clearSorting(state);
    expect(state.sorting).toEqual([]);
  });
});

describe('createFilterSlice', () => {
  it('initial state has empty filters', () => {
    const collection = defineCollection(TestSchema);
    const slice = createFilterSlice(collection);
    expect(slice.initialState.columnFilters).toEqual([]);
    expect(slice.initialState.globalFilter).toBe('');
  });

  it('setColumnFilters updates filters', () => {
    const collection = defineCollection(TestSchema);
    const slice = createFilterSlice(collection);
    const state = slice.actions.setColumnFilters(slice.initialState, [{ id: 'status', value: 'active' }]);
    expect(state.columnFilters).toEqual([{ id: 'status', value: 'active' }]);
  });

  it('setGlobalFilter updates global filter', () => {
    const collection = defineCollection(TestSchema);
    const slice = createFilterSlice(collection);
    const state = slice.actions.setGlobalFilter(slice.initialState, 'search term');
    expect(state.globalFilter).toBe('search term');
  });

  it('clearFilters resets both', () => {
    const collection = defineCollection(TestSchema);
    const slice = createFilterSlice(collection);
    let state = slice.actions.setColumnFilters(slice.initialState, [{ id: 'x', value: 1 }]);
    state = slice.actions.setGlobalFilter(state, 'test');
    state = slice.actions.clearFilters(state);
    expect(state.columnFilters).toEqual([]);
    expect(state.globalFilter).toBe('');
  });
});

describe('createPaginationSlice', () => {
  it('uses default page size from collection', () => {
    const collection = defineCollection(TestSchema, {
      affordances: { pagination: { defaultPageSize: 50 } },
    });
    const slice = createPaginationSlice(collection);
    expect(slice.initialState.pagination.pageSize).toBe(50);
    expect(slice.initialState.pagination.pageIndex).toBe(0);
  });

  it('setPageIndex updates page', () => {
    const collection = defineCollection(TestSchema);
    const slice = createPaginationSlice(collection);
    const state = slice.actions.setPageIndex(slice.initialState, 3);
    expect(state.pagination.pageIndex).toBe(3);
    expect(state.pagination.pageSize).toBe(25);
  });

  it('setPageSize resets to page 0', () => {
    const collection = defineCollection(TestSchema);
    const slice = createPaginationSlice(collection);
    let state = slice.actions.setPageIndex(slice.initialState, 5);
    state = slice.actions.setPageSize(state, 100);
    expect(state.pagination.pageSize).toBe(100);
    expect(state.pagination.pageIndex).toBe(0);
  });

  it('resetPage goes to page 0', () => {
    const collection = defineCollection(TestSchema);
    const slice = createPaginationSlice(collection);
    let state = slice.actions.setPageIndex(slice.initialState, 5);
    state = slice.actions.resetPage(state);
    expect(state.pagination.pageIndex).toBe(0);
  });
});

describe('createSelectionSlice', () => {
  it('initial state has empty selection', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSelectionSlice(collection);
    expect(slice.initialState.rowSelection).toEqual({});
  });

  it('toggleRow toggles a row', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSelectionSlice(collection);
    let state = slice.actions.toggleRow(slice.initialState, '0');
    expect(state.rowSelection['0']).toBe(true);
    state = slice.actions.toggleRow(state, '0');
    expect(state.rowSelection['0']).toBe(false);
  });

  it('clearSelection empties selection', () => {
    const collection = defineCollection(TestSchema);
    const slice = createSelectionSlice(collection);
    let state = slice.actions.setRowSelection(slice.initialState, { '0': true, '1': true });
    state = slice.actions.clearSelection(state);
    expect(state.rowSelection).toEqual({});
  });
});

describe('createColumnSlice', () => {
  it('initial visibility hides id and updatedAt', () => {
    const collection = defineCollection(TestSchema);
    const slice = createColumnSlice(collection);
    expect(slice.initialState.columnVisibility.id).toBe(false);
    expect(slice.initialState.columnVisibility.updatedAt).toBe(false);
  });

  it('initial order includes all fields', () => {
    const collection = defineCollection(TestSchema);
    const slice = createColumnSlice(collection);
    expect(slice.initialState.columnOrder).toContain('name');
    expect(slice.initialState.columnOrder).toContain('status');
  });

  it('toggleColumnVisibility toggles a column', () => {
    const collection = defineCollection(TestSchema);
    const slice = createColumnSlice(collection);
    let state = slice.actions.toggleColumnVisibility(slice.initialState, 'name');
    expect(state.columnVisibility.name).toBe(false);
    state = slice.actions.toggleColumnVisibility(state, 'name');
    expect(state.columnVisibility.name).toBe(true);
  });
});
