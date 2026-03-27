/**
 * In-Memory Data Provider.
 *
 * Full in-memory implementation supporting sorting, filtering, search, and pagination.
 * Useful for prototyping, testing, and small datasets.
 */

import type { SortingState, FilterExpression } from '@zodal/core';
import type { DataProvider, GetListParams, GetListResult } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { filterToFunction } from './filters.js';

export interface InMemoryProviderOptions {
  /** Field name used as the unique identifier. Default: 'id'. */
  idField?: string;
  /** Delay in ms to simulate network latency. Default: 0. */
  simulateDelay?: number;
  /** Searchable fields for the `search` parameter. Default: all string fields. */
  searchFields?: string[];
}

/**
 * Create an in-memory DataProvider from an array of items.
 *
 * @example
 * ```typescript
 * const provider = createInMemoryProvider([
 *   { id: '1', name: 'Alpha', priority: 3 },
 *   { id: '2', name: 'Beta', priority: 1 },
 * ], { idField: 'id' });
 *
 * const { data, total } = await provider.getList({
 *   sort: [{ id: 'priority', desc: false }],
 *   pagination: { page: 1, pageSize: 10 },
 * });
 * ```
 */
export function createInMemoryProvider<T extends Record<string, any>>(
  initialData: T[],
  options: InMemoryProviderOptions = {},
): DataProvider<T> {
  const idField = options.idField ?? 'id';
  const delay = options.simulateDelay ?? 0;
  const searchFields = options.searchFields;

  // Internal mutable store
  let items = [...initialData];
  let nextId = items.length + 1;

  const maybeDelay = () =>
    delay > 0 ? new Promise<void>(r => setTimeout(r, delay)) : Promise.resolve();

  function getItemId(item: T): string {
    return String((item as any)[idField]);
  }

  function matchesSearch(item: T, search: string): boolean {
    if (!search) return true;
    const lowerSearch = search.toLowerCase();
    const fields = searchFields ?? Object.keys(item).filter(k => typeof (item as any)[k] === 'string');
    return fields.some(field => {
      const val = (item as any)[field];
      return typeof val === 'string' && val.toLowerCase().includes(lowerSearch);
    });
  }

  function compareValues(a: any, b: any): number {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }
    return a < b ? -1 : 1;
  }

  return {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      await maybeDelay();

      let result = [...items];

      // Apply structured filters
      if (params.filter) {
        const predicate = filterToFunction<T>(params.filter);
        result = result.filter(predicate);
      }

      // Apply search
      if (params.search) {
        result = result.filter(item => matchesSearch(item, params.search!));
      }

      const total = result.length;

      // Apply sorting
      if (params.sort && params.sort.length > 0) {
        result.sort((a, b) => {
          for (const sortCol of params.sort!) {
            const cmp = compareValues((a as any)[sortCol.id], (b as any)[sortCol.id]);
            if (cmp !== 0) return sortCol.desc ? -cmp : cmp;
          }
          return 0;
        });
      }

      // Apply pagination
      if (params.pagination) {
        const { page, pageSize } = params.pagination;
        const start = (page - 1) * pageSize;
        result = result.slice(start, start + pageSize);
      }

      return { data: result, total };
    },

    async getOne(id: string): Promise<T> {
      await maybeDelay();
      const item = items.find(i => getItemId(i) === id);
      if (!item) throw new Error(`Item not found: ${id}`);
      return { ...item };
    },

    async create(data: Partial<T>): Promise<T> {
      await maybeDelay();
      const newItem = {
        ...data,
        [idField]: (data as any)[idField] ?? String(nextId++),
      } as T;
      items.push(newItem);
      return { ...newItem };
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      await maybeDelay();
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) throw new Error(`Item not found: ${id}`);
      items[index] = { ...items[index], ...data };
      return { ...items[index] };
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      await maybeDelay();
      const updated: T[] = [];
      for (const id of ids) {
        const index = items.findIndex(i => getItemId(i) === id);
        if (index !== -1) {
          items[index] = { ...items[index], ...data };
          updated.push({ ...items[index] });
        }
      }
      return updated;
    },

    async delete(id: string): Promise<void> {
      await maybeDelay();
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) throw new Error(`Item not found: ${id}`);
      items.splice(index, 1);
    },

    async deleteMany(ids: string[]): Promise<void> {
      await maybeDelay();
      const idSet = new Set(ids);
      items = items.filter(i => !idSet.has(getItemId(i)));
    },

    async upsert(data: T): Promise<T> {
      await maybeDelay();
      const id = getItemId(data);
      const index = items.findIndex(i => getItemId(i) === id);
      const item = { ...data };
      if (index === -1) {
        items.push(item);
      } else {
        items[index] = item;
      }
      return { ...item };
    },

    getCapabilities(): ProviderCapabilities {
      return {
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canBulkUpdate: true,
        canBulkDelete: true,
        canUpsert: true,
        serverSort: false,
        serverFilter: false,
        serverSearch: false,
        serverPagination: false,
      };
    },
  };
}
