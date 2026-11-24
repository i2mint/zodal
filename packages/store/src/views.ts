/**
 * Resolving a selection against a {@link DataProvider} (i2mint/zodal#154).
 *
 * The types (`Selection`, `Membership`, `Ordering`, `Query`, `View`) and the in-memory resolvers
 * (`resolveSelection`, `resolveView`, ...) live in `@zodal/core` (`views.ts`). This module adds the
 * one that needs a provider: {@link resolveSelectionIds}, which lets the provider run the query
 * (server side when it can), so "all matching" never has to be held as ids in the browser.
 */

import { defaultIdOf } from '@zodal/core';
import type { IdOf, ItemId, Selection } from '@zodal/core';
import type { DataProvider } from './data-provider.js';

export interface ResolveIdsOptions<T> {
  /** An item's id. Default: its `id` field. */
  idOf?: IdOf<T>;
  /** Page size for walking a query's matches. Default: {@link RESOLVE_PAGE_SIZE}. */
  pageSize?: number;
}

/** The default page size of {@link resolveSelectionIds}. */
export const RESOLVE_PAGE_SIZE = 500;

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
 * The ids a selection covers, asking the provider to run the query: every page of the matches,
 * then the included ids, minus the excluded ones. An explicit selection is returned as is (ids
 * that no longer exist are the action's to report).
 */
export async function resolveSelectionIds<T>(
  provider: DataProvider<T>,
  selection: Selection,
  options: ResolveIdsOptions<T> = {},
): Promise<ResolvedSelectionIds> {
  if (selection.kind === 'ids') return { ids: [...selection.ids], countChanged: false };
  const { idOf = defaultIdOf, pageSize = RESOLVE_PAGE_SIZE } = options;
  const { filter, search } = selection.query;
  const out = new Set<ItemId>();
  const exclude = new Set(selection.exclude ?? []);
  for (let page = 1; ; page++) {
    const { data, total } = await provider.getList({ filter, search: search || undefined, pagination: { page, pageSize } });
    for (const item of data) {
      const id = idOf(item);
      if (!exclude.has(id)) out.add(id);
    }
    if (data.length < pageSize || page * pageSize >= total) break;
  }
  for (const id of selection.include ?? []) if (!exclude.has(id)) out.add(id);
  const ids = [...out];
  const countChanged = selection.expectedCount !== undefined && ids.length !== selection.expectedCount;
  return { ids, countChanged };
}
