/**
 * The `trash` collection affordance (zodal#162): declare that "delete" in a collection means
 * **Move to Trash**, so generated UIs label the action that way, offer the Trash view, and keep
 * **Remove** for membership (a playlist, a tag). The mechanism is `withTrash` in `@zodal/store`;
 * this file only reads the declaration, and its result is shaped to be passed to `withTrash`.
 *
 * ```ts
 * affordances: { trash: true }                                   // default field `deletedAt`
 * affordances: { trash: { field: 'removedAt', retentionDays: 30 } }
 * ```
 */

import type { CollectionAffordances } from './types.js';

/** The default name of the deletion mark (the same as `withTrash`'s default). */
export const DEFAULT_TRASH_FIELD = 'deletedAt';

/** A collection's resolved trash settings. */
export interface TrashConfig {
  /** The field holding the deletion mark. */
  field: string;
  /** Purge items trashed longer ago than this; `undefined` = never. */
  retentionDays?: number;
}

/** The collection's trash settings, or `null` when it declares no trash (delete is final). */
export function resolveTrashAffordance(affordances: Pick<CollectionAffordances, 'trash'> | undefined): TrashConfig | null {
  const t = affordances?.trash;
  if (!t) return null;
  if (t === true) return { field: DEFAULT_TRASH_FIELD };
  return { field: t.field ?? DEFAULT_TRASH_FIELD, ...(t.retentionDays !== undefined ? { retentionDays: t.retentionDays } : {}) };
}
