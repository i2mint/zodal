/**
 * Evaluating the query language in memory: filter expressions, text search, and the value orders.
 *
 * `filterToFunction` compiles a {@link FilterExpression} into a predicate; `matchesSearch` is the
 * text search; `compareValues` / `compareBinary` / `compareSortKeys` order values. They live in
 * core (moved from `@zodal/store`, which re-exports them) so the in-memory view and selection
 * resolvers (`views.ts`) and every store adapter share one implementation.
 */

import type { FilterExpression, FilterCondition } from './types.js';

/**
 * Compile a FilterExpression into a predicate function for client-side evaluation.
 */
export function filterToFunction<T extends Record<string, any>>(
  filter: FilterExpression,
): (item: T) => boolean {
  // Compound: AND
  if ('and' in filter) {
    const predicates = filter.and.map(filterToFunction<T>);
    return (item) => predicates.every((p) => p(item));
  }

  // Compound: OR
  if ('or' in filter) {
    const predicates = filter.or.map(filterToFunction<T>);
    return (item) => predicates.some((p) => p(item));
  }

  // Compound: NOT
  if ('not' in filter) {
    const predicate = filterToFunction<T>(filter.not);
    return (item) => !predicate(item);
  }

  // Leaf: FilterCondition
  return evaluateCondition(filter as FilterCondition);
}

function evaluateCondition<T extends Record<string, any>>(
  condition: FilterCondition,
): (item: T) => boolean {
  const { field, operator, value } = condition;

  return (item: T) => {
    const fieldValue = item[field];

    switch (operator) {
      // Equality
      case 'eq':
        return fieldValue === value;
      case 'ne':
        return fieldValue !== value;

      // Comparison
      case 'gt':
        return fieldValue > (value as number);
      case 'gte':
        return fieldValue >= (value as number);
      case 'lt':
        return fieldValue < (value as number);
      case 'lte':
        return fieldValue <= (value as number);

      // String
      case 'contains':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().includes(value.toLowerCase())
          : false;
      case 'startsWith':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().startsWith(value.toLowerCase())
          : false;
      case 'endsWith':
        return typeof fieldValue === 'string' && typeof value === 'string'
          ? fieldValue.toLowerCase().endsWith(value.toLowerCase())
          : false;

      // Set
      case 'in':
        return Array.isArray(value) ? value.includes(fieldValue) : false;
      case 'notIn':
        return Array.isArray(value) ? !value.includes(fieldValue) : true;

      // Array
      case 'arrayContains':
        return Array.isArray(fieldValue) ? fieldValue.includes(value) : false;
      case 'arrayContainsAny':
        return Array.isArray(fieldValue) && Array.isArray(value)
          ? value.some((v) => fieldValue.includes(v))
          : false;

      // Existence
      case 'isNull':
        return fieldValue == null;
      case 'isNotNull':
        return fieldValue != null;

      default:
        return true;
    }
  };
}

const rankOf = (v: unknown): number => {
  switch (typeof v) {
    case 'number':
    case 'bigint':
      return 0;
    case 'string':
      return 1;
    case 'boolean':
      return 2;
    case 'object':
      return v instanceof Date ? 3 : 4;
    default:
      return 5; // symbol, function
  }
};

/**
 * Shared fallback for {@link compareValues} and {@link compareBinary}: a total,
 * transitive, engine-independent order for values of different types (numbers,
 * then strings, then booleans, then Dates, then other objects, then the rest; NaN
 * after every other number), so a sort over mixed data is deterministic.
 */
function compareMixed(a: any, b: any): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const na = Number.isNaN(a);
    const nb = Number.isNaN(b);
    if (na || nb) return na === nb ? 0 : na ? 1 : -1;
  }
  if (ra === 3) return a.getTime() - b.getTime();
  if (ra >= 4) return 0; // objects, symbols, functions: no meaningful order; keep input order
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Default ordering for client-side sort.
 *
 * `null`/`undefined` sort first; strings use `localeCompare`; `Date`s compare by
 * time; values of different types follow a fixed type order. Note that
 * `localeCompare` is locale-aware, so it does not preserve the byte order of keys
 * such as fractional indexes, and it orders `'a'` before `'B'`: use
 * {@link compareBinary} (through {@link ApplyQueryOptions.compare}) for those.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return compareMixed(a, b);
}

/**
 * Code-point ordering: like {@link compareValues} but strings compare by UTF-16
 * code unit (`'B' < 'a'`), which preserves the order of fractional-index keys and
 * matches a binary (`C`) database collation.
 */
export function compareBinary(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return compareMixed(a, b);
}

/**
 * The portable order of sort keys, used by the view resolvers (`resolveView`, `applyOrdering`):
 * like {@link compareValues}, but strings are lower-cased and compared by code point, with no
 * locale, so the same saved view sorts the same in a browser, a Node server and a Python server
 * (i2mint/zodal#159 copies this order). `null` / `undefined` first, then numbers (NaN last among
 * them), strings, booleans, Dates, then other objects (equal: a stable sort keeps their order).
 */
export function compareSortKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return compareMixed(a, b);
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
