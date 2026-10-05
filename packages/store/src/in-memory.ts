/**
 * In-Memory Data Provider.
 *
 * Full in-memory implementation supporting sorting, filtering, search, and pagination.
 * Useful for prototyping, testing, and small datasets.
 */

import type { DataProvider, GetListParams, GetListResult } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { applyQuery } from './query.js';

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

  // Internal mutable store. Items go in and come out as deep copies
  // (structuredClone), so a caller mutating a returned item, or one of its arrays
  // such as `tags`, never changes the store behind the provider's back.
  const clone = <V>(v: V): V => structuredClone(v);
  let items = initialData.map(clone);
  let nextId = items.length + 1;

  const maybeDelay = () =>
    delay > 0 ? new Promise<void>(r => setTimeout(r, delay)) : Promise.resolve();

  function getItemId(item: T): string {
    return String((item as any)[idField]);
  }

  return {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      await maybeDelay();

      const result = applyQuery(items, params, { searchFields });
      return { data: result.data.map(clone), total: result.total };
    },

    async getOne(id: string): Promise<T> {
      await maybeDelay();
      const item = items.find(i => getItemId(i) === id);
      if (!item) throw new Error(`Item not found: ${id}`);
      return clone(item);
    },

    async create(data: Partial<T>): Promise<T> {
      await maybeDelay();
      const newItem = clone({
        ...data,
        [idField]: (data as any)[idField] ?? String(nextId++),
      } as T);
      items.push(newItem);
      return clone(newItem);
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      await maybeDelay();
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) throw new Error(`Item not found: ${id}`);
      items[index] = { ...items[index], ...clone(data) };
      return clone(items[index]);
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      await maybeDelay();
      const updated: T[] = [];
      for (const id of ids) {
        const index = items.findIndex(i => getItemId(i) === id);
        if (index !== -1) {
          items[index] = { ...items[index], ...clone(data) };
          updated.push(clone(items[index]));
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
      const item = clone(data);
      if (index === -1) {
        items.push(item);
      } else {
        items[index] = item;
      }
      return clone(item);
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
