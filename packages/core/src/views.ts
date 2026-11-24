/**
 * Views, selection and collections: one model (i2mint/zodal#154).
 *
 * Four serialisable types, as Zod schemas (the schemas are the single source of truth; the types
 * are inferred from them), plus the pure functions that need nothing but the types:
 *
 * - **Query**: what to match, a {@link FilterExpression} and a text search.
 * - **Selection**: what an action applies to. Explicit (`{kind: 'ids'}`), implicit (`{kind:
 *   'query'}`, evaluated when used), or composite (a query plus included and excluded ids: "all
 *   340 matching, except these 3"). `expectedCount` is what the user saw when choosing, checked
 *   when the action runs.
 * - **Ordering**: manual (an id list), sort keys, or a score (relevance to a ranked query).
 * - **Membership**: what a collection holds: `(rule ∪ pinned) − excluded`, then `limit` (the
 *   zodal-groups fluid-group semantics).
 *
 * One model covers a view (membership + ordering + presentation), a saved filter (membership
 * only), a playlist (pinned ids, manual order), a smart playlist (a rule, sort keys), the trash
 * (the rule `deletedAt isNotNull`), "select all matching" (a query selection), and "save the
 * selection as a playlist" (freeze a query selection into ids).
 *
 * Resolving a selection or a membership against items needs a query evaluator, so the resolvers
 * (`resolveSelection`, `resolveMembership`, `resolveView`, `freezeSelection`) live in
 * `@zodal/store`, beside `applyQuery`. Terminology and the request → piece map:
 * `docs/views-selection.md`.
 */

import { z } from 'zod';
import type { FilterCondition, FilterExpression, FilterOperator } from './types.js';

/** An item's id, as views and selections hold it. */
export type ItemId = string;

/** The filter operators, as a runtime list (the `FilterOperator` type's members). */
export const FILTER_OPERATORS = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith',
  'in', 'notIn', 'arrayContains', 'arrayContainsAny', 'isNull', 'isNotNull',
] as const satisfies readonly FilterOperator[];

const ItemIdSchema = z.string().min(1);
const PlainValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A {@link FilterExpression}, checked all the way down: a condition, or `and` / `or` over a
 * non-empty list, or `not`. A condition's value is a plain JSON value or a list of them (absent
 * for `isNull` / `isNotNull`), so a saved view validates its filter instead of holding opaque JSON.
 */
export const FilterExpressionSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(FilterExpressionSchema).min(1) }).strict(),
    z.object({ or: z.array(FilterExpressionSchema).min(1) }).strict(),
    z.object({ not: FilterExpressionSchema }).strict(),
    z.object({
      field: z.string().min(1),
      operator: z.enum(FILTER_OPERATORS),
      value: z.union([PlainValueSchema, z.array(PlainValueSchema)]).optional(),
    }).strict(),
  ]),
) as unknown as z.ZodType<FilterExpression>;

/** What to match: a filter and a text search (both optional: an empty query matches everything). */
export const QuerySchema = z.object({
  filter: FilterExpressionSchema.optional(),
  search: z.string().optional(),
});
export type Query = z.infer<typeof QuerySchema>;

/** The items an action applies to: explicit ids, or a query plus exceptions. */
export const SelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ids'), ids: z.array(ItemIdSchema) }),
  z.object({
    kind: z.literal('query'),
    query: QuerySchema,
    include: z.array(ItemIdSchema).optional(),
    exclude: z.array(ItemIdSchema).optional(),
    /** How many it covered when chosen; checked when an action runs (the data may have moved). */
    expectedCount: z.number().int().nonnegative().optional(),
  }),
]);
export type Selection = z.infer<typeof SelectionSchema>;

/** One sort key: a field, ascending unless `desc`. */
export const SortKeySchema = z.object({ field: z.string().min(1), desc: z.boolean().optional() });
export type SortKey = z.infer<typeof SortKeySchema>;

/** In what order a collection's items come: by hand, by sort keys, or by a score. */
export const OrderingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), ids: z.array(ItemIdSchema) }),
  z.object({ kind: z.literal('sort'), keys: z.array(SortKeySchema).min(1) }),
  /** The order of a ranked query (`by: 'search'`, or a named score); `threshold` drops weak matches. */
  z.object({ kind: z.literal('score'), by: z.string().min(1), threshold: z.number().optional() }),
]);
export type Ordering = z.infer<typeof OrderingSchema>;

/** What a collection holds: `(rule ∪ pinned) − excluded`, then `limit`. */
export const MembershipSchema = z.object({
  rule: QuerySchema.optional(),
  pinned: z.array(ItemIdSchema).optional(),
  excluded: z.array(ItemIdSchema).optional(),
  limit: z.number().int().positive().optional(),
});
export type Membership = z.infer<typeof MembershipSchema>;

// -- building and changing a selection (what a list's checkboxes do) --------------------------

/** Nothing selected. */
export const EMPTY_SELECTION: Selection = Object.freeze({ kind: 'ids', ids: [] }) as Selection;

/** These items, explicitly. */
export const selectIds = (ids: readonly ItemId[]): Selection => ({ kind: 'ids', ids: [...ids] });

/** Every item matching the query, kept as the query (evaluated when an action runs). */
export function selectMatching(query: Query, expectedCount?: number): Selection {
  return expectedCount === undefined ? { kind: 'query', query } : { kind: 'query', query, expectedCount };
}

/** Whether nothing is selected (a query selection is never empty by itself: it depends on the data). */
export const isSelectionEmpty = (selection: Selection): boolean =>
  selection.kind === 'ids' && selection.ids.length === 0;

/**
 * Whether `id` is selected. `matches` says whether the item with that id matches a query
 * selection's query (unused for an explicit selection).
 */
export function isSelected(selection: Selection, id: ItemId, matches: (id: ItemId) => boolean): boolean {
  if (selection.kind === 'ids') return selection.ids.includes(id);
  if (selection.exclude?.includes(id)) return false;
  return !!selection.include?.includes(id) || matches(id);
}

const without = (ids: readonly ItemId[] | undefined, id: ItemId): ItemId[] => (ids ?? []).filter((x) => x !== id);

/** Select or unselect one item. A query selection records it as an exception (include / exclude). */
export function toggleSelected(selection: Selection, id: ItemId, matches: (id: ItemId) => boolean): Selection {
  const on = isSelected(selection, id, matches);
  if (selection.kind === 'ids') {
    return { kind: 'ids', ids: on ? without(selection.ids, id) : [...selection.ids, id] };
  }
  const matched = matches(id);
  if (on) {
    return { ...selection, include: without(selection.include, id), exclude: matched ? [...(selection.exclude ?? []), id] : selection.exclude };
  }
  return { ...selection, exclude: without(selection.exclude, id), include: matched ? selection.include : [...(selection.include ?? []), id] };
}

/** Select (or unselect) each of `ids`, keeping the rest of the selection as it is. */
export function setSelected(selection: Selection, ids: readonly ItemId[], on: boolean, matches: (id: ItemId) => boolean): Selection {
  let out = selection;
  for (const id of ids) if (isSelected(out, id, matches) !== on) out = toggleSelected(out, id, matches);
  return out;
}

/**
 * Shift-click: give every item between `anchor` and `id` (in the shown order) the anchor's state,
 * selected or not, keeping the rest. An anchor or id not shown falls back to toggling `id`.
 */
export function selectRange(
  selection: Selection,
  anchor: ItemId,
  id: ItemId,
  shown: readonly ItemId[],
  matches: (id: ItemId) => boolean,
): Selection {
  const a = shown.indexOf(anchor);
  const b = shown.indexOf(id);
  if (a < 0 || b < 0) return toggleSelected(selection, id, matches);
  return setSelected(selection, shown.slice(Math.min(a, b), Math.max(a, b) + 1), isSelected(selection, anchor, matches), matches);
}

/** A selection without these ids (they were deleted or trashed). */
export function forgetSelected(selection: Selection, ids: readonly ItemId[]): Selection {
  const gone = new Set(ids);
  if (selection.kind === 'ids') return { kind: 'ids', ids: selection.ids.filter((x) => !gone.has(x)) };
  return { ...selection, include: selection.include?.filter((x) => !gone.has(x)) };
}

// -- ordering ---------------------------------------------------------------------------------

const rankOf = (v: unknown): number =>
  typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : v instanceof Date ? 3 : 4;

/**
 * The portable order of sort keys, the same wherever a view is evaluated (a browser, a Node
 * server, a Python server: i2mint/zodal#159): `null` / `undefined` first, then numbers (NaN after
 * the other numbers), then strings lower-cased and compared by code point (no locale: a locale's
 * collation differs between runtimes), then booleans, then Dates by time; other values are equal
 * (a stable sort keeps their order).
 */
export function compareSortKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const na = Number.isNaN(a);
    const nb = Number.isNaN(b);
    if (na || nb) return na === nb ? 0 : na ? 1 : -1;
  }
  if (ra === 3) return (a as Date).getTime() - (b as Date).getTime();
  if (ra === 4) return 0;
  const [x, y] = ra === 1 ? [(a as string).toLowerCase(), (b as string).toLowerCase()] : [a as number, b as number];
  return x < y ? -1 : x > y ? 1 : 0;
}

export interface OrderingOptions<T> {
  /** An item's id. Default: its `id` field. */
  key?: (item: T) => ItemId;
  /** How two sort-key values compare. Default: {@link compareSortKeys}. */
  compare?: (a: unknown, b: unknown) => number;
}

const defaultKey = <T>(item: T): ItemId => String((item as { id?: unknown }).id);

/**
 * The items in an ordering (a new array; the input is not changed). Manual: the listed ids first,
 * in that order, the rest after as they were. Sort: by the keys, stable. Score, or none: unchanged
 * (a score is the evaluator's order already).
 */
export function applyOrdering<T>(items: readonly T[], ordering: Ordering | undefined, options: OrderingOptions<T> = {}): T[] {
  const { key = defaultKey, compare = compareSortKeys } = options;
  if (!ordering || ordering.kind === 'score') return [...items];
  if (ordering.kind === 'manual') {
    const at = new Map(ordering.ids.map((id, i) => [id, i]));
    const rank = (x: T) => at.get(key(x)) ?? Number.MAX_SAFE_INTEGER;
    return [...items].sort((a, b) => rank(a) - rank(b));
  }
  const keys = ordering.keys;
  const field = (x: T, f: string) => (x as Record<string, unknown>)[f];
  return [...items].sort((x, y) => {
    for (const k of keys) {
      const c = compare(field(x, k.field), field(y, k.field));
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

// -- checking a saved query against a schema --------------------------------------------------

/** Every condition in a filter expression, depth first. */
export function filterConditions(expression: FilterExpression | undefined): FilterCondition[] {
  if (!expression) return [];
  if ('and' in expression) return expression.and.flatMap(filterConditions);
  if ('or' in expression) return expression.or.flatMap(filterConditions);
  if ('not' in expression) return filterConditions(expression.not);
  return [expression];
}

/** A clause of a saved query, view or ordering that names a field the collection no longer has. */
export interface MissingFieldClause {
  field: string;
  /** Where it was found: `'filter'` (a condition's operator in `operator`), `'sort'`, or `'presentation'`. */
  in: 'filter' | 'sort' | 'presentation';
  operator?: FilterOperator;
}

/**
 * The clauses that name a field not in `fields` (the collection's fields now). A schema change
 * must flag these to the user, never drop them silently: a dropped clause widens a view (a smart
 * playlist would suddenly hold everything). A dotted path is checked by its first segment.
 */
export function missingFieldClauses(
  target: { membership?: Membership; ordering?: Ordering; rule?: Query; filter?: FilterExpression; presentation?: { columns?: readonly string[]; groupBy?: string } },
  fields: Iterable<string>,
): MissingFieldClause[] {
  const known = new Set(fields);
  const has = (f: string) => known.has(f) || known.has(f.split('.')[0]!);
  const out: MissingFieldClause[] = [];
  const filters = [target.filter, target.rule?.filter, target.membership?.rule?.filter];
  for (const c of filters.flatMap(filterConditions)) {
    if (!has(c.field)) out.push({ field: c.field, in: 'filter', operator: c.operator });
  }
  if (target.ordering?.kind === 'sort') {
    for (const k of target.ordering.keys) if (!has(k.field)) out.push({ field: k.field, in: 'sort' });
  }
  const p = target.presentation;
  for (const f of [...(p?.columns ?? []), ...(p?.groupBy ? [p.groupBy] : [])]) {
    if (!has(f)) out.push({ field: f, in: 'presentation' });
  }
  return out;
}
