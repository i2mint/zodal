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
  /**
   * How items are copied into and out of the store, so that a caller mutating a
   * returned item never changes the store. Default: `structuredClone`, which
   * requires plain data (objects, arrays, Dates, Maps...): it throws on functions
   * and Proxies (e.g. immer drafts) and drops class prototypes. Pass your own
   * copier for such items, or `(v) => v` to share references (not recommended).
   */
  clone?: <V>(value: V) => V;
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
  const clone: <V>(v: V) => V = options.clone ?? ((v) => structuredClone(v));
  let items = initialData.map(clone);
  let nextId = items.length + 1;
  // Ids in use, kept in step with `items`, so create's collision check and
  // freshId are O(1) rather than a scan per call.
  let usedIds = new Set(items.map((i) => String((i as any)[idField])));
  const reindex = () => {
    usedIds = new Set(items.map(getItemId));
  };

  /** The next numeric id not already used (seeded ids may collide with a counter). */
  function freshId(): string {
    while (usedIds.has(String(nextId))) nextId++;
    return String(nextId++);
  }

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
      const given = (data as any)[idField];
      if (given != null && usedIds.has(String(given))) {
        throw new Error(`Item already exists: ${given}`);
      }
      const newItem = clone({
        ...data,
        [idField]: given ?? freshId(),
      } as T);
      items.push(newItem);
      usedIds.add(getItemId(newItem));
      return clone(newItem);
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      await maybeDelay();
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) throw new Error(`Item not found: ${id}`);
      items[index] = { ...items[index], ...clone(data) };
      if (idField in data) reindex(); // an update may rename the id
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
      if (idField in data) reindex();
      return updated;
    },

    async delete(id: string): Promise<void> {
      await maybeDelay();
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) throw new Error(`Item not found: ${id}`);
      items.splice(index, 1);
      usedIds.delete(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      await maybeDelay();
      const idSet = new Set(ids);
      items = items.filter(i => !idSet.has(getItemId(i)));
      for (const id of ids) usedIds.delete(id);
    },

    async upsert(data: T): Promise<T> {
      await maybeDelay();
      const id = getItemId(data);
      const index = items.findIndex(i => getItemId(i) === id);
      const item = clone(data);
      if (index === -1) {
        items.push(item);
        usedIds.add(id);
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
