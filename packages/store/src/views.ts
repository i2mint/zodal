/**
 * Resolving views, selections and collections into items (i2mint/zodal#154).
 *
 * The types (`Selection`, `Membership`, `Ordering`, `Query`) and the pure functions that need no
 * query evaluator live in `@zodal/core` (`views.ts`). The resolvers live here, beside
 * {@link applyQuery}, which is their default evaluator:
 *
 * - in memory: {@link resolveSelection}, {@link resolveMembership}, {@link resolveView},
 *   {@link freezeSelection}, with two seams, `key` (an item's id) and `evaluate` (how a query runs);
 * - against a {@link DataProvider}: {@link resolveSelectionIds}, which lets the provider run the
 *   query (server side when it can), so "all matching" never has to be held as ids client side.
 */

import { applyOrdering } from '@zodal/core';
import type { ItemId, Membership, Ordering, Query, Selection } from '@zodal/core';
import type { DataProvider } from './data-provider.js';
import { applyQuery } from './query.js';

export interface ResolveOptions<T> {
  /** An item's id. Default: its `id` field. */
  key?: (item: T) => ItemId;
  /**
   * How a query runs over the items, returning the matches in their order (a ranking survives).
   * Default: {@link applyQuery}'s filter and search.
   */
  evaluate?: (items: readonly T[], query: Query) => readonly T[];
  /** How sort-key values compare (see `compareSortKeys` in `@zodal/core`, the default). */
  compare?: (a: unknown, b: unknown) => number;
}

const defaultKey = <T>(item: T): ItemId => String((item as { id?: unknown }).id);

/** {@link applyQuery}'s filter and search, as a selection's evaluator. */
export function evaluateQuery<T>(items: readonly T[], query: Query): T[] {
  return applyQuery(items as unknown as readonly Record<string, unknown>[], {
    filter: query.filter,
    search: query.search || undefined,
  }).data as unknown as T[];
}

/**
 * `(matching ∪ include) − exclude`: the matches in the evaluator's order, then the included ones
 * that did not match, in the items' order. Each item once.
 */
function compose<T>(
  items: readonly T[],
  matching: readonly T[],
  include: readonly ItemId[] = [],
  exclude: readonly ItemId[] = [],
  key: (item: T) => ItemId,
): T[] {
  const taken = new Set(exclude);
  const take = (x: T) => {
    const id = key(x);
    if (taken.has(id)) return false;
    taken.add(id);
    return true;
  };
  const extra = new Set(include);
  return [...matching.filter(take), ...items.filter((x) => extra.has(key(x)) && take(x))];
}

/** The items a selection covers: explicit ids in the items' order, a query's in its order. */
export function resolveSelection<T>(selection: Selection, items: readonly T[], options: ResolveOptions<T> = {}): T[] {
  const { key = defaultKey, evaluate = evaluateQuery } = options;
  if (selection.kind === 'ids') {
    const ids = new Set(selection.ids);
    return items.filter((x) => ids.has(key(x)));
  }
  return compose(items, evaluate(items, selection.query), selection.include, selection.exclude, key);
}

/** The items a collection holds: `(rule ∪ pinned) − excluded`, unordered and unlimited (see {@link resolveView}). */
export function resolveMembership<T>(membership: Membership, items: readonly T[], options: ResolveOptions<T> = {}): T[] {
  const { key = defaultKey, evaluate = evaluateQuery } = options;
  const matching = membership.rule ? evaluate(items, membership.rule) : [];
  return compose(items, matching, membership.pinned, membership.excluded, key);
}

/** A collection's items: its membership, ordered, then limited. */
export function resolveView<T>(
  view: { membership: Membership; ordering?: Ordering },
  items: readonly T[],
  options: ResolveOptions<T> = {},
): T[] {
  const ordered = applyOrdering(resolveMembership(view.membership, items, options), view.ordering, options);
  return view.membership.limit ? ordered.slice(0, view.membership.limit) : ordered;
}

/** A query selection as the explicit ids it covers now ("save the selection as a playlist"). */
export function freezeSelection<T>(selection: Selection, items: readonly T[], options: ResolveOptions<T> = {}): Selection {
  if (selection.kind === 'ids') return selection;
  const key = options.key ?? defaultKey;
  return { kind: 'ids', ids: resolveSelection(selection, items, options).map(key) };
}

export interface ResolveIdsOptions<T> {
  /** An item's id. Default: its `id` field. */
  key?: (item: T) => ItemId;
  /** Page size for walking a query's matches. Default: 500. */
  pageSize?: number;
}

/** The result of resolving a selection against a provider. */
export interface ResolvedSelectionIds {
  ids: ItemId[];
  /**
   * For a query selection with an `expectedCount`: whether the count now differs from what the
   * user saw when choosing (the data moved). An action should say so before it runs.
   */
  countChanged: boolean;
}

/**
 * The ids a selection covers, asking the provider to run the query (server side when it can):
 * every page of the matches, then the included ids, minus the excluded ones. An explicit
 * selection is returned as is (ids that no longer exist are the action's to report).
 */
export async function resolveSelectionIds<T>(
  provider: DataProvider<T>,
  selection: Selection,
  options: ResolveIdsOptions<T> = {},
): Promise<ResolvedSelectionIds> {
  if (selection.kind === 'ids') return { ids: [...selection.ids], countChanged: false };
  const { key = defaultKey, pageSize = 500 } = options;
  const { filter, search } = selection.query;
  const out = new Set<ItemId>();
  const exclude = new Set(selection.exclude ?? []);
  for (let page = 1; ; page++) {
    const { data, total } = await provider.getList({ filter, search: search || undefined, pagination: { page, pageSize } });
    for (const item of data) {
      const id = key(item);
      if (!exclude.has(id)) out.add(id);
    }
    if (data.length < pageSize || page * pageSize >= total) break;
  }
  for (const id of selection.include ?? []) if (!exclude.has(id)) out.add(id);
  const ids = [...out];
  const countChanged = selection.expectedCount !== undefined && ids.length !== selection.expectedCount;
  return { ids, countChanged };
}
