/**
 * State Slice Factories.
 *
 * Individual, composable slices for collection UI state.
 * Each slice manages an independent subset of state.
 * Use createCollectionStore() for the composed version.
 */

import type { CollectionDefinition, PaginationConfig, SortingState, ColumnFilter, PaginationState } from '@zodal/core';

// ============================================================================
// Sorting Slice
// ============================================================================

export interface SortingSliceState {
  sorting: SortingState[];
}

export interface SortingSliceActions {
  setSorting(state: SortingSliceState, sorting: SortingState[]): SortingSliceState;
  clearSorting(state: SortingSliceState): SortingSliceState;
}

export interface SortingSlice {
  initialState: SortingSliceState;
  actions: SortingSliceActions;
}

export function createSortingSlice(collection: CollectionDefinition<any>): SortingSlice {
  const defaultSort = (collection.affordances as any).defaultSort;
  return {
    initialState: {
      sorting: defaultSort
        ? [{ id: defaultSort.field, desc: defaultSort.direction === 'desc' }]
        : [],
    },
    actions: {
      setSorting(state, sorting) {
        return { ...state, sorting };
      },
      clearSorting(state) {
        return { ...state, sorting: [] };
      },
    },
  };
}

// ============================================================================
// Filter Slice
// ============================================================================

export interface FilterSliceState {
  columnFilters: ColumnFilter[];
  globalFilter: string;
}

export interface FilterSliceActions {
  setColumnFilters(state: FilterSliceState, filters: ColumnFilter[]): FilterSliceState;
  setGlobalFilter(state: FilterSliceState, filter: string): FilterSliceState;
  clearFilters(state: FilterSliceState): FilterSliceState;
}

export interface FilterSlice {
  initialState: FilterSliceState;
  actions: FilterSliceActions;
}

export function createFilterSlice(_collection: CollectionDefinition<any>): FilterSlice {
  return {
    initialState: {
      columnFilters: [],
      globalFilter: '',
    },
    actions: {
      setColumnFilters(state, filters) {
        return { ...state, columnFilters: filters };
      },
      setGlobalFilter(state, filter) {
        return { ...state, globalFilter: filter };
      },
      clearFilters(state) {
        return { ...state, columnFilters: [], globalFilter: '' };
      },
    },
  };
}

// ============================================================================
// Pagination Slice
// ============================================================================

export interface PaginationSliceState {
  pagination: PaginationState;
}

export interface PaginationSliceActions {
  setPagination(state: PaginationSliceState, pagination: PaginationState): PaginationSliceState;
  setPageIndex(state: PaginationSliceState, pageIndex: number): PaginationSliceState;
  setPageSize(state: PaginationSliceState, pageSize: number): PaginationSliceState;
  resetPage(state: PaginationSliceState): PaginationSliceState;
}

export interface PaginationSlice {
  initialState: PaginationSliceState;
  actions: PaginationSliceActions;
}

export function createPaginationSlice(collection: CollectionDefinition<any>): PaginationSlice {
  const paginationConfig = collection.affordances.pagination;
  const defaultPageSize =
    paginationConfig && typeof paginationConfig === 'object'
      ? (paginationConfig as PaginationConfig).defaultPageSize ?? 25
      : 25;

  return {
    initialState: {
      pagination: { pageIndex: 0, pageSize: defaultPageSize },
    },
    actions: {
      setPagination(state, pagination) {
        return { ...state, pagination };
      },
      setPageIndex(state, pageIndex) {
        return { ...state, pagination: { ...state.pagination, pageIndex } };
      },
      setPageSize(state, pageSize) {
        return { ...state, pagination: { ...state.pagination, pageSize, pageIndex: 0 } };
      },
      resetPage(state) {
        return { ...state, pagination: { ...state.pagination, pageIndex: 0 } };
      },
    },
  };
}

// ============================================================================
// Selection Slice
// ============================================================================

export interface SelectionSliceState {
  rowSelection: Record<string, boolean>;
}

export interface SelectionSliceActions {
  setRowSelection(state: SelectionSliceState, selection: Record<string, boolean>): SelectionSliceState;
  clearSelection(state: SelectionSliceState): SelectionSliceState;
  toggleRow(state: SelectionSliceState, rowIndex: string): SelectionSliceState;
}

export interface SelectionSlice {
  initialState: SelectionSliceState;
  actions: SelectionSliceActions;
}

export function createSelectionSlice(_collection: CollectionDefinition<any>): SelectionSlice {
  return {
    initialState: {
      rowSelection: {},
    },
    actions: {
      setRowSelection(state, selection) {
        return { ...state, rowSelection: selection };
      },
      clearSelection(state) {
        return { ...state, rowSelection: {} };
      },
      toggleRow(state, rowIndex) {
        const current = state.rowSelection[rowIndex] ?? false;
        return {
          ...state,
          rowSelection: { ...state.rowSelection, [rowIndex]: !current },
        };
      },
    },
  };
}

// ============================================================================
// Column Slice
// ============================================================================

export interface ColumnSliceState {
  columnVisibility: Record<string, boolean>;
  columnOrder: string[];
}

export interface ColumnSliceActions {
  setColumnVisibility(state: ColumnSliceState, visibility: Record<string, boolean>): ColumnSliceState;
  setColumnOrder(state: ColumnSliceState, order: string[]): ColumnSliceState;
  toggleColumnVisibility(state: ColumnSliceState, columnId: string): ColumnSliceState;
}

export interface ColumnSlice {
  initialState: ColumnSliceState;
  actions: ColumnSliceActions;
}

export function createColumnSlice(collection: CollectionDefinition<any>): ColumnSlice {
  const visibility: Record<string, boolean> = {};
  for (const [key, fa] of Object.entries(collection.fieldAffordances)) {
    if (fa.visible === false || (fa as any).hidden) {
      visibility[key] = false;
    }
  }

  const columnOrder = Object.entries(collection.fieldAffordances)
    .sort(([, a], [, b]) => ((a as any).order ?? 999) - ((b as any).order ?? 999))
    .map(([key]) => key);

  return {
    initialState: { columnVisibility: visibility, columnOrder },
    actions: {
      setColumnVisibility(state, vis) {
        return { ...state, columnVisibility: vis };
      },
      setColumnOrder(state, order) {
        return { ...state, columnOrder: order };
      },
      toggleColumnVisibility(state, columnId) {
        const current = state.columnVisibility[columnId] ?? true;
        return {
          ...state,
          columnVisibility: { ...state.columnVisibility, [columnId]: !current },
        };
      },
    },
  };
}
