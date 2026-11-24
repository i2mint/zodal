/**
 * Soft delete with a Trash (i2mint/zodal#156): `withTrash(provider)`.
 *
 * "Delete" in an app that holds the user's data should mean **Move to Trash**: the item gets a
 * deletion mark (`deletedAt`, a timestamp), disappears from every list, and can be restored from
 * the Trash until it is deleted permanently (purged), the Trash is emptied, or an optional
 * retention period runs out. Hard delete stays right for things with no value to recover (a draft
 * never saved, a cache), and wherever the backend cannot keep a mark (then the UI confirms first).
 *
 * The wrapper is a `DataProvider` (built by spreading the wrapped provider, so its optional
 * methods carry over; like every zodal provider, the wrapped one is a plain object, not a class
 * instance), so it composes with every other wrapper and renderer):
 *
 * - `delete` / `deleteMany` set the mark; `getList` leaves marked items out and `getOne` rejects
 *   them, as after a hard delete (the DataProvider contract holds); `trashed.getOne` finds them.
 * - `moveToTrash`, `restore`, `purge` take ids or a `Selection` (so "move all 340 matching to the
 *   Trash" is one call, and its Undo, `restore` of the returned ids, is one call too).
 * - `trashed` is the Trash itself as a provider: its `getList` lists only marked items, its delete
 *   purges. `trashView` is the matching system view (`deletedAt isNotNull`).
 * - `emptyTrash()` and `purgeExpired()` delete for real; retention is off unless `retentionDays`.
 *
 * The mark lives in the wrapped provider's own storage, as an ordinary field, so a server-side
 * adapter keeps it in its database. **Remove** (from a playlist, a tag) is membership, not this.
 */

import type { FilterExpression, IdOf, ItemId, Selection, View } from '@zodal/core';
import { defaultIdOf } from '@zodal/core';
import type { DataProvider, GetListParams, GetListResult } from './data-provider.js';
import type { Version } from './versioning.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';
import { resolveSelectionIds } from './views.js';

/** The default name of the deletion mark. */
export const TRASH_FIELD = 'deletedAt';

/** The id of the Trash system view ({@link TrashProvider.trashView}). */
export const TRASH_VIEW_ID = 'trash';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WithTrashOptions<T> {
  /** The field holding the deletion mark: absent or `null` = live. Default {@link TRASH_FIELD}. */
  field?: string;
  /** Purge items trashed longer ago than this, when {@link TrashProvider.purgeExpired} runs. Default: never. */
  retentionDays?: number;
  /** The mark written on delete. Default: the current time as an ISO string. */
  stamp?: () => string | number;
  /** The current time in ms (retention), injectable for tests. Default `Date.now`. */
  now?: () => number;
  /** An item's id. Default: its `id` field. */
  idOf?: IdOf<T>;
  /** The Trash view's name (what a view switcher shows). Default `'Trash'`. */
  trashViewName?: string;
}

/** A `DataProvider` whose delete moves to the Trash, plus the Trash's own operations. */
export interface TrashProvider<T> extends DataProvider<T> {
  /** Mark items as trashed; returns the ids actually moved (already trashed ones are skipped). */
  moveToTrash(target: readonly ItemId[] | Selection): Promise<ItemId[]>;
  /** Clear the mark: the items are live again. Returns the ids restored. A selection is resolved in the Trash. */
  restore(target: readonly ItemId[] | Selection): Promise<ItemId[]>;
  /** Delete permanently (whether trashed or not). Returns the ids purged. A selection is resolved in the Trash. */
  purge(target: readonly ItemId[] | Selection): Promise<ItemId[]>;
  /** Delete everything in the Trash permanently; returns how many. */
  emptyTrash(): Promise<number>;
  /** Purge what has been in the Trash longer than `retentionDays` (nothing when unset); returns how many. */
  purgeExpired(): Promise<number>;
  /** The Trash as a provider: lists only trashed items; its delete purges. */
  readonly trashed: DataProvider<T>;
  /** The Trash system view: `deletedAt isNotNull`. */
  readonly trashView: View;
  /** The deletion mark's field. */
  readonly trashField: string;
}

const and = (a: FilterExpression | undefined, b: FilterExpression): FilterExpression => (a ? { and: [a, b] } : b);

/**
 * Wrap a provider so that delete moves to a Trash (see the module docs).
 *
 * @example
 * ```ts
 * const songs = withTrash(createLocalStorageProvider({ key: 'songs' }));
 * await songs.delete('s1');                    // moved to the Trash
 * const moved = await songs.moveToTrash(selectMatching({ filter }));
 * await songs.restore(moved);                  // Undo: one call
 * await songs.trashed.getList({});             // what the Trash view shows
 * ```
 */
export function withTrash<T>(provider: DataProvider<T>, options: WithTrashOptions<T> = {}): TrashProvider<T> {
  const {
    field = TRASH_FIELD,
    retentionDays,
    stamp = () => new Date().toISOString(),
    now = Date.now,
    idOf = defaultIdOf,
    trashViewName = 'Trash',
  } = options;
  const live: FilterExpression = { field, operator: 'isNull', value: null };
  const dead: FilterExpression = { field, operator: 'isNotNull', value: null };
  const mark = (value: unknown) => ({ [field]: value }) as unknown as Partial<T>;
  const markOf = (item: T) => (item as Record<string, unknown>)[field];

  const scoped = (filter: FilterExpression) => (params: GetListParams): Promise<GetListResult<T>> =>
    provider.getList({ ...params, filter: and(params.filter, filter) });

  /** The ids of every item matching `filter`, walking the pages. */
  async function idsWhere(filter: FilterExpression): Promise<ItemId[]> {
    const { ids } = await resolveSelectionIds(provider, { kind: 'query', query: { filter } }, { idOf });
    return ids;
  }

  /** Resolve a target in a scope (live items, or the Trash). */
  async function idsOf(target: readonly ItemId[] | Selection, scope: DataProvider<T>): Promise<ItemId[]> {
    if (Array.isArray(target)) return [...target];
    return (await resolveSelectionIds(scope, target as Selection, { idOf })).ids;
  }

  const purgeIds = async (ids: ItemId[]) => {
    if (ids.length) await provider.deleteMany(ids);
    return ids;
  };

  const trashed: DataProvider<T> = {
    ...provider,
    getList: scoped(dead),
    async delete(id) { await provider.delete(id); },
    async deleteMany(ids) { await purgeIds(ids); },
    getCapabilities: () => ({ ...(provider.getCapabilities?.() ?? DEFAULT_CAPABILITIES), softDelete: false }),
  };

  /** A live item, or a rejection as if it did not exist (the contract: after delete, getOne rejects). */
  async function getLive(id: ItemId): Promise<T> {
    const item = await provider.getOne(id);
    if (markOf(item) != null) throw new Error(`Item not found: ${id} (it is in the Trash)`);
    return item;
  }

  /**
   * The live ones among these ids: trashing again would move an item's mark (and its retention
   * clock), and an id that does not exist is skipped, as `deleteMany` skips it (the contract).
   */
  async function liveAmong(ids: readonly ItemId[]): Promise<ItemId[]> {
    const out: ItemId[] = [];
    for (const id of ids) {
      let item: T;
      try { item = await provider.getOne(id); } catch { continue; }
      if (markOf(item) == null) out.push(id);
    }
    return out;
  }

  const wrapped: DataProvider<T> = {
    ...provider,
    getList: scoped(live),
    getOne: getLive,
    async delete(id) {
      await getLive(id);
      await provider.update(id, mark(stamp()));
    },
    async deleteMany(ids) {
      const liveIds = await liveAmong(ids);
      if (liveIds.length) await provider.updateMany(liveIds, mark(stamp()));
    },
    // A conditional delete is a conditional move to the Trash, never a silent hard delete: without
    // `updateIfVersion` to do that with, the wrapper offers no conditional delete at all.
    deleteIfVersion: provider.updateIfVersion
      ? async (id: string, expected: Version) => { await provider.updateIfVersion!(id, mark(stamp()), expected); }
      : undefined,
    getCapabilities: (): ProviderCapabilities => ({ ...(provider.getCapabilities?.() ?? DEFAULT_CAPABILITIES), softDelete: true }),
  };

  return {
    ...wrapped,
    trashed,
    trashField: field,
    trashView: {
      id: TRASH_VIEW_ID,
      name: trashViewName,
      scope: 'system',
      membership: { rule: { filter: dead } },
      ordering: { kind: 'sort', keys: [{ field, desc: true }] },
      version: 0,
    },

    async moveToTrash(target) {
      // A selection resolves among live items already; explicit ids are checked.
      const ids = await idsOf(target, wrapped);
      const liveIds = Array.isArray(target) ? await liveAmong(ids) : ids;
      if (liveIds.length) await provider.updateMany(liveIds, mark(stamp()));
      return liveIds;
    },

    async restore(target) {
      const ids = await idsOf(target, trashed);
      if (ids.length) await provider.updateMany(ids, mark(null));
      return ids;
    },

    async purge(target) {
      return purgeIds(await idsOf(target, trashed));
    },

    async emptyTrash() {
      return (await purgeIds(await idsWhere(dead))).length;
    },

    async purgeExpired() {
      if (retentionDays === undefined) return 0;
      const cutoff = now() - retentionDays * DAY_MS;
      const old: ItemId[] = [];
      let page = 1;
      const pageSize = 500;
      for (;;) {
        const { data, total } = await trashed.getList({ pagination: { page, pageSize } });
        for (const item of data) {
          const at = markOf(item);
          const t = typeof at === 'number' ? at : Date.parse(String(at));
          if (Number.isFinite(t) && t < cutoff) old.push(idOf(item));
        }
        if (data.length < pageSize || page * pageSize >= total) break;
        page++;
      }
      return (await purgeIds(old)).length;
    },
  };
}
