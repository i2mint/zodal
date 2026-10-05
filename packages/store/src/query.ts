/**
 * Client-side query evaluation, shared by every adapter that does not (or not
 * fully) query server-side.
 *
 * Before this module each adapter re-implemented sort, search and pagination
 * (in-memory, fs, localStorage, S3, HTTP and the content providers), with small
 * drifts between the copies. `applyQuery` is the one implementation; an adapter
 * that delegates some steps to its backend skips them through `options.skip`.
 */

import type { GetListParams, GetListResult } from './data-provider.js';
import { filterToFunction } from './filters.js';

/**
 * Default ordering for client-side sort.
 *
 * `null`/`undefined` sort first; strings use `localeCompare`; `Date`s compare by
 * time; anything else by `<`. Note that `localeCompare` is locale-aware, so it does
 * not preserve the byte order of keys such as fractional indexes: pass a binary
 * comparator through {@link ApplyQueryOptions.compare} for those.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return (a as any) < (b as any) ? -1 : 1;
}

/**
 * Case-insensitive substring search over string fields.
 *
 * Searches `fields` when given, else every own string-valued field of the item
 * except those in `exclude` (content fields, for a content provider). An empty
 * search matches everything.
 */
export function matchesSearch(
  item: Record<string, unknown>,
  search: string,
  fields?: readonly string[],
  exclude?: ReadonlySet<string>,
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  const keys =
    fields ??
    Object.keys(item).filter(
      (k) => typeof item[k] === 'string' && !(exclude && exclude.has(k)),
    );
  return keys.some((k) => {
    const value = item[k];
    return typeof value === 'string' && value.toLowerCase().includes(needle);
  });
}

export interface ApplyQueryOptions {
  /** Fields the `search` parameter looks in. Default: every string field. */
  searchFields?: readonly string[];
  /** Fields never searched by default (ignored when `searchFields` is given). */
  excludeFromSearch?: Iterable<string>;
  /** Comparator for sorting. Default: {@link compareValues}. */
  compare?: (a: unknown, b: unknown) => number;
  /**
   * Steps the backend already performed, which are therefore skipped here.
   * When `paginate` is skipped, the caller should take `total` from its backend.
   */
  skip?: { filter?: boolean; search?: boolean; sort?: boolean; paginate?: boolean };
}

/**
 * Apply `GetListParams` to an in-memory array: filter, then search, then count,
 * then sort, then paginate (1-based pages).
 *
 * `total` counts the items after filter and search, before pagination. The input
 * array is never mutated; the returned `data` is a new array of the same item
 * objects (adapters copy items themselves when they need to).
 *
 * @example
 * ```ts
 * const { data, total } = applyQuery(items, {
 *   filter: { field: 'status', operator: 'eq', value: 'active' },
 *   sort: [{ id: 'priority', desc: true }],
 *   pagination: { page: 1, pageSize: 20 },
 * });
 * ```
 */
export function applyQuery<T extends Record<string, any>>(
  items: readonly T[],
  params: GetListParams = {},
  options: ApplyQueryOptions = {},
): GetListResult<T> {
  const skip = options.skip ?? {};
  let result = [...items];

  if (params.filter && !skip.filter) {
    result = result.filter(filterToFunction<T>(params.filter));
  }

  if (params.search && !skip.search) {
    const exclude = options.excludeFromSearch
      ? new Set(options.excludeFromSearch)
      : undefined;
    const search = params.search;
    result = result.filter((item) =>
      matchesSearch(item, search, options.searchFields, exclude),
    );
  }

  const total = result.length;

  if (params.sort && params.sort.length > 0 && !skip.sort) {
    const compare = options.compare ?? compareValues;
    const sort = params.sort;
    result.sort((a, b) => {
      for (const col of sort) {
        const cmp = compare(a[col.id], b[col.id]);
        if (cmp !== 0) return col.desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  if (params.pagination && !skip.paginate) {
    const { page, pageSize } = params.pagination;
    const start = (page - 1) * pageSize;
    result = result.slice(start, start + pageSize);
  }

  return { data: result, total };
}
