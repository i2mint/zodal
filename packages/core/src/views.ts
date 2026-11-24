/**
 * Views, selection and collections: one model (i2mint/zodal#154).
 *
 * Four serialisable types, as Zod schemas (the schemas are the single source of truth; the types
 * are inferred from them), and the pure functions over them:
 *
 * - **Query**: what to match, a {@link FilterExpression} and a text search.
 * - **Selection**: what an action applies to. Explicit (`{kind: 'ids'}`), implicit (`{kind:
 *   'query'}`, evaluated when used), or composite (a query plus included and excluded ids: "all
 *   340 matching, except these 3"). `expectedCount` is how many it covered when the user chose,
 *   checked when the action runs.
 * - **Ordering**: manual (an id list), sort keys, or a score (relevance to a ranked query).
 * - **Membership**: what a collection holds: `(rule ∪ pinned) − excluded`, then `limit` (the
 *   zodal-groups fluid-group semantics).
 * - **View**: a named membership + ordering + presentation; `scope` says whether it is built in
 *   (`system`), the person's own, or shared; `version` guards shared writes.
 *
 * One model covers a view, a saved filter (membership only), a playlist (pinned ids, manual
 * order), a smart playlist (a rule, sort keys), the trash (the rule `deletedAt isNotNull`), "select
 * all matching" (a query selection), and "save the selection as a playlist" (freeze a query
 * selection into ids).
 *
 * Everything here runs in memory with the core evaluator (`filterToFunction` + `matchesSearch`).
 * Against a `DataProvider`, `resolveSelectionIds` in `@zodal/store` lets the provider run the
 * query. Terminology and the request → type map: `docs/views-selection.md`.
 */

import { z } from 'zod';
import { FILTER_OPERATORS } from './types.js';
import type { FilterCondition, FilterExpression, FilterOperator, SortingState } from './types.js';
import { compareSortKeys, filterToFunction, matchesSearch } from './filters.js';
import { defaultIdOf, restoreOrder } from './order.js';
import type { IdOf } from './order.js';

/** An item's id, as views and selections hold it. */
export type ItemId = string;

const ItemIdSchema = z.string().min(1);
/** A condition's value as stored: JSON only (a view must survive serialisation). */
const PlainValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A {@link FilterExpression}, checked all the way down: a condition, `and` / `or` over a non-empty
 * list, or `not`. A stored condition's value is a JSON value or a list of them (absent for
 * `isNull` / `isNotNull`); the TS type allows any value, for filters built in code.
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

/**
 * One sort key: a field, ascending unless `desc`. Stored as `field` (what it names); a provider's
 * `GetListParams.sort` takes `{id, desc}`: convert with {@link toSortingState}.
 */
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

/** How a view is shown: which columns, grouped by what, how dense. */
export const PresentationSchema = z.object({
  columns: z.array(z.string()).optional(),
  groupBy: z.string().optional(),
  density: z.string().optional(),
});
export type Presentation = z.infer<typeof PresentationSchema>;

/** Where a view comes from: built in (not deletable), the person's own, or shared. */
export const VIEW_SCOPES = ['system', 'personal', 'shared'] as const;
export type ViewScope = (typeof VIEW_SCOPES)[number];

/**
 * A saved view: a named membership + ordering + presentation over one collection. The view store
 * and its lifecycle (no autosave, Modified / Save / Save as / Revert, overlays, URL) are
 * `@zodal/ui`'s (i2mint/zodal#155); this is the record they keep.
 */
export const ViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  scope: z.enum(VIEW_SCOPES),
  membership: MembershipSchema,
  ordering: OrderingSchema.optional(),
  presentation: PresentationSchema.optional(),
  /** Shown among the quick views (chips, the top of a menu). */
  pinned: z.boolean().optional(),
  /** Incremented on every save; a shared view's write with a stale version is refused. */
  version: z.number().int().nonnegative(),
});
export type View = z.infer<typeof ViewSchema>;

/** The part of a view the resolvers read. */
export type ViewShape = Pick<View, 'membership'> & Partial<Pick<View, 'ordering' | 'presentation'>>;

// -- evaluating ---------------------------------------------------------------------------------

/** Options of the in-memory resolvers. */
export interface ResolveOptions<T> {
  /** An item's id. Default: its `id` field. */
  idOf?: IdOf<T>;
  /**
   * How a query runs over the items, returning the matches in their order (a ranking survives).
   * Default: {@link evaluateQuery}.
   */
  evaluate?: (items: readonly T[], query: Query) => readonly T[];
  /** How sort-key values compare. Default: {@link compareSortKeys}. */
  compare?: (a: unknown, b: unknown) => number;
}

/** The core evaluator: the items matching a query's filter and search, in their order. */
export function evaluateQuery<T>(items: readonly T[], query: Query): T[] {
  const { filter, search } = query;
  const pass = filter ? filterToFunction<Record<string, unknown>>(filter) : undefined;
  return items.filter((item) => {
    const row = item as unknown as Record<string, unknown>;
    return (!pass || pass(row)) && (!search || matchesSearch(row, search));
  });
}

/**
 * A `matches(id)` for a query, over these items: what the selection functions need to tell
 * whether an item a query selection covers is selected.
 */
export function queryMatcher<T>(query: Query, items: readonly T[], options: Pick<ResolveOptions<T>, 'idOf' | 'evaluate'> = {}): (id: ItemId) => boolean {
  const { idOf = defaultIdOf, evaluate = evaluateQuery } = options;
  const matching = new Set(evaluate(items, query).map(idOf));
  return (id) => matching.has(id);
}

/**
 * `(matching ∪ include) − exclude`: the matches in the evaluator's order, then the included ones
 * that did not match, in the items' order. Each item once.
 */
function compose<T>(items: readonly T[], matching: readonly T[], include: readonly ItemId[] = [], exclude: readonly ItemId[] = [], idOf: IdOf<T>): T[] {
  const taken = new Set(exclude);
  const take = (x: T) => {
    const id = idOf(x);
    if (taken.has(id)) return false;
    taken.add(id);
    return true;
  };
  const extra = new Set(include);
  return [...matching.filter(take), ...items.filter((x) => extra.has(idOf(x)) && take(x))];
}

/** The items a selection covers: explicit ids in the items' order, a query's in its order. */
export function resolveSelection<T>(selection: Selection, items: readonly T[], options: ResolveOptions<T> = {}): T[] {
  const { idOf = defaultIdOf, evaluate = evaluateQuery } = options;
  if (selection.kind === 'ids') {
    const ids = new Set(selection.ids);
    return items.filter((x) => ids.has(idOf(x)));
  }
  return compose(items, evaluate(items, selection.query), selection.include, selection.exclude, idOf);
}

/** The items a collection holds: `(rule ∪ pinned) − excluded`, unordered and unlimited (see {@link resolveView}). */
export function resolveMembership<T>(membership: Membership, items: readonly T[], options: ResolveOptions<T> = {}): T[] {
  const { idOf = defaultIdOf, evaluate = evaluateQuery } = options;
  const matching = membership.rule ? evaluate(items, membership.rule) : [];
  return compose(items, matching, membership.pinned, membership.excluded, idOf);
}

/** A collection's items: its membership, ordered, then limited. */
export function resolveView<T>(view: ViewShape, items: readonly T[], options: ResolveOptions<T> = {}): T[] {
  const ordered = applyOrdering(resolveMembership(view.membership, items, options), view.ordering, options);
  return view.membership.limit ? ordered.slice(0, view.membership.limit) : ordered;
}

/** A query selection as the explicit ids it covers now ("save the selection as a playlist"). */
export function freezeSelection<T>(selection: Selection, items: readonly T[], options: ResolveOptions<T> = {}): Selection {
  if (selection.kind === 'ids') return selection;
  const idOf = options.idOf ?? defaultIdOf;
  return { kind: 'ids', ids: resolveSelection(selection, items, options).map(idOf) };
}

// -- building and changing a selection (what a list's checkboxes do) --------------------------

/** Nothing selected. */
export const EMPTY_SELECTION: Selection = Object.freeze({ kind: 'ids', ids: Object.freeze([]) as unknown as ItemId[] }) as Selection;

/** These items, explicitly. */
export const selectIds = (ids: readonly ItemId[]): Selection => ({ kind: 'ids', ids: [...ids] });

/** Every item matching the query, kept as the query (evaluated when an action runs). */
export function selectMatching(query: Query, expectedCount?: number): Selection {
  return expectedCount === undefined ? { kind: 'query', query } : { kind: 'query', query, expectedCount };
}

/** Whether nothing is selected (a query selection is never empty by itself: it depends on the data). */
export const isSelectionEmpty = (selection: Selection): boolean =>
  selection.kind === 'ids' && selection.ids.length === 0;

/** Options of the selection-changing functions. */
export interface SelectionOptions {
  /**
   * Whether the item with this id matches a query selection's query (see {@link queryMatcher}).
   * Needed only for a query selection; an explicit selection never reads it.
   */
  matches?: (id: ItemId) => boolean;
}

function matcherOf(selection: Selection, options: SelectionOptions, caller: string): (id: ItemId) => boolean {
  if (selection.kind === 'ids') return () => false;
  if (options.matches) return options.matches;
  throw new TypeError(
    `${caller}: a query selection needs { matches } to know which items its query covers; ` +
      'build one with queryMatcher(selection.query, items).',
  );
}

/** Whether `id` is selected. */
export function isSelected(selection: Selection, id: ItemId, options: SelectionOptions = {}): boolean {
  if (selection.kind === 'ids') return selection.ids.includes(id);
  if (selection.exclude?.includes(id)) return false;
  return !!selection.include?.includes(id) || matcherOf(selection, options, 'isSelected')(id);
}

const without = (ids: readonly ItemId[] | undefined, id: ItemId): ItemId[] => (ids ?? []).filter((x) => x !== id);

/** Select or unselect one item. A query selection records it as an exception (include / exclude). */
export function toggleSelected(selection: Selection, id: ItemId, options: SelectionOptions = {}): Selection {
  if (selection.kind === 'ids') {
    const on = selection.ids.includes(id);
    return { kind: 'ids', ids: on ? without(selection.ids, id) : [...selection.ids, id] };
  }
  const matches = matcherOf(selection, options, 'toggleSelected');
  const on = isSelected(selection, id, { matches });
  const matched = matches(id);
  if (on) {
    return { ...selection, include: without(selection.include, id), exclude: matched ? [...(selection.exclude ?? []), id] : selection.exclude };
  }
  return { ...selection, exclude: without(selection.exclude, id), include: matched ? selection.include : [...(selection.include ?? []), id] };
}

/** Select (or unselect) each of `ids`, keeping the rest of the selection as it is. */
export function setSelected(selection: Selection, ids: readonly ItemId[], on: boolean, options: SelectionOptions = {}): Selection {
  let out = selection;
  for (const id of ids) if (isSelected(out, id, options) !== on) out = toggleSelected(out, id, options);
  return out;
}

/**
 * Shift-click: give every item between `anchor` and `id` (in the `shown` order) the anchor's state,
 * selected or not, keeping the rest. An anchor or id not shown falls back to toggling `id`.
 */
export function selectRange(
  selection: Selection,
  range: { anchor: ItemId; id: ItemId; shown: readonly ItemId[] },
  options: SelectionOptions = {},
): Selection {
  const { anchor, id, shown } = range;
  const a = shown.indexOf(anchor);
  const b = shown.indexOf(id);
  if (a < 0 || b < 0) return toggleSelected(selection, id, options);
  return setSelected(selection, shown.slice(Math.min(a, b), Math.max(a, b) + 1), isSelected(selection, anchor, options), options);
}

/** A selection without these ids (they were deleted or trashed). */
export function forgetSelected(selection: Selection, ids: readonly ItemId[]): Selection {
  const gone = new Set(ids);
  if (selection.kind === 'ids') return { kind: 'ids', ids: selection.ids.filter((x) => !gone.has(x)) };
  return { ...selection, include: selection.include?.filter((x) => !gone.has(x)) };
}

// -- ordering ---------------------------------------------------------------------------------

/**
 * The items in an ordering (a new array; the input is not changed). Manual: the listed ids first,
 * in that order, the rest after as they were ({@link restoreOrder}). Sort: by the keys, stable,
 * with {@link compareSortKeys} unless `compare` is given. Score, or none: unchanged (a score is the
 * evaluator's order already).
 */
export function applyOrdering<T>(items: readonly T[], ordering: Ordering | undefined, options: Pick<ResolveOptions<T>, 'idOf' | 'compare'> = {}): T[] {
  const { idOf = defaultIdOf, compare = compareSortKeys } = options;
  if (!ordering || ordering.kind === 'score') return [...items];
  if (ordering.kind === 'manual') return restoreOrder(items, ordering.ids, idOf);
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

/**
 * A sort ordering as a provider's `GetListParams.sort` (`{id, desc}`); empty for a manual or score
 * ordering, which a provider cannot run (resolve those in memory). Note that a provider sorts with
 * its own comparator (`compareValues`, locale-aware, in the in-memory adapters); pass
 * `{ compare: compareSortKeys }` to `applyQuery` where the portable order matters.
 */
export function toSortingState(ordering: Ordering | undefined): SortingState[] {
  if (ordering?.kind !== 'sort') return [];
  return ordering.keys.map((k) => ({ id: k.field, desc: !!k.desc }));
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
  /** Where it was found: a filter condition (its operator in `operator`), a sort key, or the presentation. */
  in: 'filter' | 'sort' | 'presentation';
  operator?: FilterOperator;
}

/**
 * The clauses that name a field not in `fields` (the collection's fields now). A schema change
 * must show these to the user, never drop them silently: a dropped clause widens a view (a smart
 * playlist would suddenly hold everything). A dotted path is checked by its first segment.
 */
export function missingFieldClauses(target: Partial<ViewShape> & { filter?: FilterExpression }, fields: Iterable<string>): MissingFieldClause[] {
  const known = new Set(fields);
  const has = (f: string) => known.has(f) || known.has(f.split('.')[0]!);
  const out: MissingFieldClause[] = [];
  for (const c of [target.filter, target.membership?.rule?.filter].flatMap(filterConditions)) {
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
