/**
 * Zustand Adapter: Convenience wrapper for createCollectionStore.
 *
 * Produces a store initializer compatible with Zustand's create().
 * Does NOT import zustand — users bring their own.
 *
 * @example
 * ```typescript
 * import { create } from 'zustand';
 * import { createZustandStoreSlice } from '@zodal/ui';
 *
 * const useProductStore = create(
 *   createZustandStoreSlice(productCollection, productProvider)
 * );
 * ```
 */

import type { CollectionDefinition } from '@zodal/core';
import type { DataProvider, GetListParams } from '@zodal/store';
import { createCollectionStore, type CollectionState, type CollectionStore } from './store.js';

/** The bound actions interface — actions don't take state as first arg. */
export interface BoundCollectionActions<T> {
  setItems(items: T[], total?: number): void;
  setSorting(sorting: CollectionState<T>['sorting']): void;
  setColumnFilters(filters: CollectionState<T>['columnFilters']): void;
  setGlobalFilter(filter: string): void;
  setPagination(pagination: CollectionState<T>['pagination']): void;
  setRowSelection(selection: Record<string, boolean>): void;
  setColumnVisibility(visibility: Record<string, boolean>): void;
  setColumnOrder(order: string[]): void;
  setGrouping(grouping: string[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  clearSelection(): void;
  selectAll(): void;
  reset(): void;
  setContentLoading(itemId: string, field: string, loading: boolean): void;
  /** Fetch data from the provider with current state. Only available when provider is supplied. */
  fetchData?(params?: Partial<GetListParams>): Promise<void>;
}

export type ZustandCollectionState<T> = CollectionState<T> & BoundCollectionActions<T>;

/**
 * Create a Zustand-compatible store initializer.
 *
 * Pass the result to Zustand's `create()`:
 * ```typescript
 * const useStore = create(createZustandStoreSlice(collection, provider));
 * ```
 *
 * The returned function follows Zustand's StateCreator pattern:
 * `(set, get) => initialState + boundActions`
 */
export function createZustandStoreSlice<T>(
  collection: CollectionDefinition<any>,
  provider?: DataProvider<T>,
): (set: (fn: (state: any) => any) => void, get: () => any) => ZustandCollectionState<T> {
  const store = createCollectionStore<T>(collection);

  return (set, get) => ({
    ...store.initialState,

    setItems(items: T[], total?: number) {
      set((s: CollectionState<T>) => store.actions.setItems(s, items, total));
    },
    setSorting(sorting: CollectionState<T>['sorting']) {
      set((s: CollectionState<T>) => store.actions.setSorting(s, sorting));
    },
    setColumnFilters(filters: CollectionState<T>['columnFilters']) {
      set((s: CollectionState<T>) => store.actions.setColumnFilters(s, filters));
    },
    setGlobalFilter(filter: string) {
      set((s: CollectionState<T>) => store.actions.setGlobalFilter(s, filter));
    },
    setPagination(pagination: CollectionState<T>['pagination']) {
      set((s: CollectionState<T>) => store.actions.setPagination(s, pagination));
    },
    setRowSelection(selection: Record<string, boolean>) {
      set((s: CollectionState<T>) => store.actions.setRowSelection(s, selection));
    },
    setColumnVisibility(visibility: Record<string, boolean>) {
      set((s: CollectionState<T>) => store.actions.setColumnVisibility(s, visibility));
    },
    setColumnOrder(order: string[]) {
      set((s: CollectionState<T>) => store.actions.setColumnOrder(s, order));
    },
    setGrouping(grouping: string[]) {
      set((s: CollectionState<T>) => store.actions.setGrouping(s, grouping));
    },
    setLoading(loading: boolean) {
      set((s: CollectionState<T>) => store.actions.setLoading(s, loading));
    },
    setError(error: string | null) {
      set((s: CollectionState<T>) => store.actions.setError(s, error));
    },
    clearSelection() {
      set((s: CollectionState<T>) => store.actions.clearSelection(s));
    },
    selectAll() {
      set((s: CollectionState<T>) => store.actions.selectAll(s));
    },
    reset() {
      set((s: CollectionState<T>) => store.actions.reset(s));
    },
    setContentLoading(itemId: string, field: string, loading: boolean) {
      set((s: CollectionState<T>) => store.actions.setContentLoading(s, itemId, field, loading));
    },

    // Data fetching (only when provider is supplied)
    ...(provider ? {
      async fetchData(params?: Partial<GetListParams>) {
        const state = get() as CollectionState<T>;
        set((s: CollectionState<T>) => store.actions.setLoading(s, true));
        try {
          const { data, total } = await provider.getList({
            sort: state.sorting,
            search: state.globalFilter || undefined,
            pagination: {
              page: state.pagination.pageIndex + 1,
              pageSize: state.pagination.pageSize,
            },
            ...params,
          });
          set((s: CollectionState<T>) => {
            let next = store.actions.setItems(s, data, total);
            next = store.actions.setLoading(next, false);
            next = store.actions.setError(next, null);
            return next;
          });
        } catch (err) {
          set((s: CollectionState<T>) => {
            let next = store.actions.setLoading(s, false);
            next = store.actions.setError(next, err instanceof Error ? err.message : String(err));
            return next;
          });
        }
      },
    } : {}),
  });
}
