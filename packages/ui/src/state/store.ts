/**
 * Collection Store: Framework-agnostic state factory.
 *
 * Creates a state object + action functions for managing collection UI state.
 * This is headless — it doesn't depend on React, Zustand, or any framework.
 */

import type {
  CollectionDefinition,
  PaginationConfig,
  SortingState,
  ColumnFilter,
  PaginationState,
} from '@zodal/core';

// ============================================================================
// State Types
// ============================================================================

/**
 * The full state shape for a collection UI.
 * Compatible with TanStack Table's state model.
 */
export interface CollectionState<T> {
  // Data
  items: T[];
  totalCount: number;
  loading: boolean;
  error: string | null;

  // TanStack Table-compatible state
  sorting: SortingState[];
  columnFilters: ColumnFilter[];
  globalFilter: string;
  pagination: PaginationState;
  rowSelection: Record<string, boolean>;
  columnVisibility: Record<string, boolean>;
  columnOrder: string[];
  grouping: string[];

  /** Per-item, per-field content loading status. For bifurcated providers. */
  contentLoading: Record<string, Record<string, boolean>>;
}

/**
 * Actions that modify collection state.
 * Each action takes the current state and returns a new state (pure functions).
 */
export interface CollectionActions<T> {
  setItems(state: CollectionState<T>, items: T[], total?: number): CollectionState<T>;
  setSorting(state: CollectionState<T>, sorting: SortingState[]): CollectionState<T>;
  setColumnFilters(state: CollectionState<T>, filters: ColumnFilter[]): CollectionState<T>;
  setGlobalFilter(state: CollectionState<T>, filter: string): CollectionState<T>;
  setPagination(state: CollectionState<T>, pagination: PaginationState): CollectionState<T>;
  setRowSelection(state: CollectionState<T>, selection: Record<string, boolean>): CollectionState<T>;
  setColumnVisibility(state: CollectionState<T>, visibility: Record<string, boolean>): CollectionState<T>;
  setColumnOrder(state: CollectionState<T>, order: string[]): CollectionState<T>;
  setGrouping(state: CollectionState<T>, grouping: string[]): CollectionState<T>;
  setLoading(state: CollectionState<T>, loading: boolean): CollectionState<T>;
  setError(state: CollectionState<T>, error: string | null): CollectionState<T>;
  clearSelection(state: CollectionState<T>): CollectionState<T>;
  selectAll(state: CollectionState<T>): CollectionState<T>;
  reset(state: CollectionState<T>): CollectionState<T>;
  setContentLoading(state: CollectionState<T>, itemId: string, field: string, loading: boolean): CollectionState<T>;
}

/**
 * A collection store: initial state + pure action functions + derived selectors.
 */
export interface CollectionStore<T> {
  /** The initial state, derived from the collection definition. */
  initialState: CollectionState<T>;
  /** Pure functions that produce new state from old state + args. */
  actions: CollectionActions<T>;
  /** Derived data selectors (computed from state). */
  selectors: {
    getSelectedItems(state: CollectionState<T>): T[];
    getSelectedCount(state: CollectionState<T>): number;
    getPageCount(state: CollectionState<T>): number;
    isAllSelected(state: CollectionState<T>): boolean;
    hasSelection(state: CollectionState<T>): boolean;
    getVisibleItems(state: CollectionState<T>): T[];
  };
}

// ============================================================================
// createCollectionStore
// ============================================================================

/**
 * Create a collection store from a CollectionDefinition.
 *
 * Returns initial state, pure action functions, and derived selectors.
 * Framework-agnostic: use with Zustand, Redux, useReducer, or plain objects.
 */
export function createCollectionStore<T>(
  collection: CollectionDefinition<any>,
): CollectionStore<T> {
  // Build initial state from collection affordances
  const paginationConfig = collection.affordances.pagination;
  const defaultPageSize =
    paginationConfig && typeof paginationConfig === 'object'
      ? (paginationConfig as PaginationConfig).defaultPageSize ?? 25
      : 25;

  const defaultSort = (collection.affordances as any).defaultSort;

  const initialState: CollectionState<T> = {
    items: [],
    totalCount: 0,
    loading: false,
    error: null,

    sorting: defaultSort
      ? [{ id: defaultSort.field, desc: defaultSort.direction === 'desc' }]
      : [],
    columnFilters: [],
    globalFilter: '',
    pagination: {
      pageIndex: 0,
      pageSize: defaultPageSize,
    },
    rowSelection: {},
    columnVisibility: buildInitialVisibility(collection),
    columnOrder: buildInitialOrder(collection),
    grouping: [],
    contentLoading: {},
  };

  // Pure action functions (state, args) → newState
  const actions: CollectionActions<T> = {
    setItems(state, items, total) {
      return { ...state, items, totalCount: total ?? items.length };
    },
    setSorting(state, sorting) {
      return { ...state, sorting };
    },
    setColumnFilters(state, filters) {
      return { ...state, columnFilters: filters, pagination: { ...state.pagination, pageIndex: 0 } };
    },
    setGlobalFilter(state, filter) {
      return { ...state, globalFilter: filter, pagination: { ...state.pagination, pageIndex: 0 } };
    },
    setPagination(state, pagination) {
      return { ...state, pagination };
    },
    setRowSelection(state, selection) {
      return { ...state, rowSelection: selection };
    },
    setColumnVisibility(state, visibility) {
      return { ...state, columnVisibility: visibility };
    },
    setColumnOrder(state, order) {
      return { ...state, columnOrder: order };
    },
    setGrouping(state, grouping) {
      return { ...state, grouping };
    },
    setLoading(state, loading) {
      return { ...state, loading };
    },
    setError(state, error) {
      return { ...state, error };
    },
    clearSelection(state) {
      return { ...state, rowSelection: {} };
    },
    selectAll(state) {
      const selection: Record<string, boolean> = {};
      for (let i = 0; i < state.items.length; i++) {
        selection[String(i)] = true;
      }
      return { ...state, rowSelection: selection };
    },
    reset(state) {
      return {
        ...state,
        sorting: initialState.sorting,
        columnFilters: [],
        globalFilter: '',
        pagination: { pageIndex: 0, pageSize: state.pagination.pageSize },
        rowSelection: {},
        grouping: [],
        contentLoading: {},
      };
    },
    setContentLoading(state, itemId, field, loading) {
      const itemLoading = { ...state.contentLoading[itemId], [field]: loading };
      return {
        ...state,
        contentLoading: { ...state.contentLoading, [itemId]: itemLoading },
      };
    },
  };

  // Derived selectors
  const selectors = {
    getSelectedItems(state: CollectionState<T>): T[] {
      return Object.entries(state.rowSelection)
        .filter(([_, selected]) => selected)
        .map(([idx]) => state.items[parseInt(idx)])
        .filter(Boolean);
    },
    getSelectedCount(state: CollectionState<T>): number {
      return Object.values(state.rowSelection).filter(Boolean).length;
    },
    getPageCount(state: CollectionState<T>): number {
      if (state.pagination.pageSize === 0) return 0;
      return Math.ceil(state.totalCount / state.pagination.pageSize);
    },
    isAllSelected(state: CollectionState<T>): boolean {
      if (state.items.length === 0) return false;
      return Object.values(state.rowSelection).filter(Boolean).length === state.items.length;
    },
    hasSelection(state: CollectionState<T>): boolean {
      return Object.values(state.rowSelection).some(Boolean);
    },
    getVisibleItems(state: CollectionState<T>): T[] {
      // For client-side pagination, slice the items array
      const { pageIndex, pageSize } = state.pagination;
      return state.items.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
    },
  };

  return { initialState, actions, selectors };
}

// ============================================================================
// Helpers
// ============================================================================

function buildInitialVisibility(collection: CollectionDefinition<any>): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  for (const [key, fa] of Object.entries(collection.fieldAffordances)) {
    if (fa.visible === false || (fa as any).hidden) {
      visibility[key] = false;
    }
  }
  return visibility;
}

function buildInitialOrder(collection: CollectionDefinition<any>): string[] {
  return Object.entries(collection.fieldAffordances)
    .sort(([, a], [, b]) => ((a as any).order ?? 999) - ((b as any).order ?? 999))
    .map(([key]) => key);
}
