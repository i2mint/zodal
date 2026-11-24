/**
 * Hand order (zodal#127): a collection the user orders by hand, as pure operations on a list.
 *
 * A playlist, a reading list, steps of a recipe: the order is data the person chose, not a sort.
 * Every operation here returns a new array (the input is never changed) and works on items with
 * ids, found through `idOf`. Moves that cannot happen (Up on the first item, an unknown id) return
 * the list unchanged, so a control can call them without checking first; `canMoveUp` /
 * `canMoveDown` tell it which buttons to disable (disabled, not hidden, so rows do not jump).
 *
 * Declare a hand-ordered collection with `affordances: { manualOrder: true }` (or `{ field }` to
 * name the field that stores each item's position); store the order by writing positions back
 * with {@link withPositions}.
 */

/** How an item's id is read. Default: its `id` field. */
export type IdOf<T> = (item: T) => string;

export const defaultIdOf = <T>(item: T): string => String((item as { id?: unknown }).id);

function indexOfId<T>(list: readonly T[], id: string, idOf: IdOf<T>): number {
  return list.findIndex((item) => idOf(item) === id);
}

/** Clamp a target index into `[0, length - 1]`. */
function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.trunc(i)));
}

/** Move the item with `id` to index `to` (clamped); unchanged when the id is unknown. */
export function moveItem<T>(list: readonly T[], id: string, to: number, idOf: IdOf<T> = defaultIdOf): T[] {
  const from = indexOfId(list, id, idOf);
  if (from === -1 || list.length < 2) return [...list];
  const target = clampIndex(to, list.length);
  if (target === from) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item!);
  return out;
}

/** Move one place up (towards index 0); unchanged for the first item. */
export function moveUp<T>(list: readonly T[], id: string, idOf: IdOf<T> = defaultIdOf): T[] {
  const i = indexOfId(list, id, idOf);
  return i <= 0 ? [...list] : moveItem(list, id, i - 1, idOf);
}

/** Move one place down; unchanged for the last item. */
export function moveDown<T>(list: readonly T[], id: string, idOf: IdOf<T> = defaultIdOf): T[] {
  const i = indexOfId(list, id, idOf);
  return i === -1 || i >= list.length - 1 ? [...list] : moveItem(list, id, i + 1, idOf);
}

/** Whether the item can move up (it exists and is not first). */
export function canMoveUp<T>(list: readonly T[], id: string, idOf: IdOf<T> = defaultIdOf): boolean {
  return indexOfId(list, id, idOf) > 0;
}

/** Whether the item can move down (it exists and is not last). */
export function canMoveDown<T>(list: readonly T[], id: string, idOf: IdOf<T> = defaultIdOf): boolean {
  const i = indexOfId(list, id, idOf);
  return i !== -1 && i < list.length - 1;
}

/**
 * Insert `item` at index `at` (clamped; default: the end). Throws when an item with its id is
 * already in the list (a hand-ordered list holds each item once).
 */
export function insertItem<T>(list: readonly T[], item: T, at: number = list.length, idOf: IdOf<T> = defaultIdOf): T[] {
  if (indexOfId(list, idOf(item), idOf) !== -1) throw new Error(`insertItem: ${JSON.stringify(idOf(item))} is already in the list`);
  const out = [...list];
  out.splice(Math.max(0, Math.min(list.length, Math.trunc(at))), 0, item);
  return out;
}

/** What {@link removeItem} removed, and where, so an Undo can put it back. */
export interface Removal<T> {
  list: T[];
  /** The removed item, or `undefined` when the id was not in the list. */
  removed: T | undefined;
  /** Where it was (`-1` when not found): `insertItem(list, removed, index)` undoes the removal. */
  index: number;
}

/** Remove the item with `id`, returning the new list, the item and its old index (for Undo). */
export function removeItem<T>(list: readonly T[], id: string, idOf: IdOf<T> = defaultIdOf): Removal<T> {
  const index = indexOfId(list, id, idOf);
  if (index === -1) return { list: [...list], removed: undefined, index };
  const out = [...list];
  const [removed] = out.splice(index, 1);
  return { list: out, removed, index };
}

/** Undo a {@link removeItem}: put the item back where it was. */
export function undoRemove<T>(list: readonly T[], removal: Removal<T>, idOf: IdOf<T> = defaultIdOf): T[] {
  return removal.removed === undefined ? [...list] : insertItem(list, removal.removed, removal.index, idOf);
}

/**
 * Restore an original order (an id list remembered earlier): items it names come first, in its
 * order; items it does not know keep their current relative order after them.
 */
export function restoreOrder<T>(list: readonly T[], originalIds: readonly string[], idOf: IdOf<T> = defaultIdOf): T[] {
  const rank = new Map(originalIds.map((id, i) => [id, i]));
  const known = list.filter((item) => rank.has(idOf(item))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  const unknown = list.filter((item) => !rank.has(idOf(item)));
  return [...known, ...unknown];
}

/** The ids of a list, in order (to remember an order for {@link restoreOrder}). */
export function orderOf<T>(list: readonly T[], idOf: IdOf<T> = defaultIdOf): string[] {
  return list.map(idOf);
}

/**
 * Write each item's position into `field` (0-based), returning new items, so a store can persist
 * the hand order and a list can be read back sorted by that field.
 */
export function withPositions<T extends object, F extends string = 'position'>(
  list: readonly T[],
  field: F = 'position' as F,
): (T & Record<F, number>)[] {
  return list.map((item, i) =>
    (item as Record<string, unknown>)[field] === i ? (item as T & Record<F, number>) : ({ ...item, [field]: i } as T & Record<F, number>),
  );
}

/** The items whose position changed between two orders (the writes a store needs after a move). */
export function changedPositions<T>(before: readonly T[], after: readonly T[], idOf: IdOf<T> = defaultIdOf): { id: string; position: number }[] {
  const was = new Map(before.map((item, i) => [idOf(item), i]));
  return after.flatMap((item, i) => (was.get(idOf(item)) === i ? [] : [{ id: idOf(item), position: i }]));
}
