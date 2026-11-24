# Views, selection and collections: one model

Apps keep rebuilding the same things: "save this filter and sort as a view", "select these" or "select all matching", "do X to the selection", "a playlist" versus "a smart playlist", "a trash". zodal answers all of them with four serialisable types and a few pure functions. This page is the map; the code is `packages/core/src/views.ts` (types, schemas, resolvers, selection changes, ordering) and `packages/store/src/views.ts` (resolving a selection against a `DataProvider`). Tracking issue: i2mint/zodal#154; siblings #155 (view store and selection slice), #156 (`withTrash`), #157 (the `zodal-views` skill).

## Terminology

Use these words in code, UI and docs. The aliases are what people (and LLMs) also say; treat them as the same thing.

| Term | Aliases | Meaning |
|---|---|---|
| **view** | saved view, perspective, smart view | A named, saved membership + ordering + presentation over one collection. Built-in quick tabs ("All", "Audio") are **system views**. |
| **saved filter** | saved search, filter preset | A named membership rule only (no ordering, no presentation). |
| **selection** | | The items an action will apply to. **Explicit**: ids. **Implicit**: a query, evaluated when used. **Composite**: a query plus included and excluded ids ("all 340 matching, except these 3"). |
| **ordering** | sort, order | A separate layer: **manual** (an id list), **sort** keys, or **score** (relevance, coupled to a ranked query). |
| **bulk action** | batch action, mass action, selection action | An action applied to a selection. In code: an operation with `scope: 'selection'`. |
| **collection** | playlist, folder, list | A named membership (+ ordering). **Smart collection** (smart playlist, smart folder) when the membership has a rule. |
| **Move to Trash / Restore / Delete permanently / Empty Trash** | Move to Bin, recycle bin | Soft delete is the default meaning of "delete"; the Trash is a system view over `deletedAt isNotNull`. **Remove** is for membership (leave a playlist, untag), not deletion. |

## The types (`@zodal/core`)

```ts
type Query = { filter?: FilterExpression; search?: string };
type Selection =
  | { kind: 'ids'; ids: ItemId[] }
  | { kind: 'query'; query: Query; include?: ItemId[]; exclude?: ItemId[]; expectedCount?: number };
type Ordering =
  | { kind: 'manual'; ids: ItemId[] }
  | { kind: 'sort'; keys: { field: string; desc?: boolean }[] }
  | { kind: 'score'; by: string; threshold?: number };
type Membership = { rule?: Query; pinned?: ItemId[]; excluded?: ItemId[]; limit?: number };
// extent = (rule ∪ pinned) − excluded, then ordering, then limit
```

Each has a Zod schema (`QuerySchema`, `SelectionSchema`, `OrderingSchema`, `MembershipSchema`, and `FilterExpressionSchema` for the filter language itself), so a stored view validates its filter instead of holding opaque JSON. The types are inferred from the schemas.

## One model, many requests

| Request | Expressed as |
|---|---|
| Save this filter and sort | a view: `{ membership: { rule }, ordering: { kind: 'sort', keys } }` |
| A saved filter / filter preset | `{ membership: { rule } }` |
| A playlist | `{ membership: { pinned: ids }, ordering: { kind: 'manual', ids } }` |
| A smart playlist ("25 most played jazz") | `{ membership: { rule, limit: 25 }, ordering: { kind: 'sort', keys } }` |
| A smart playlist with hand-picked extras and exceptions | `{ membership: { rule, pinned, excluded } }` |
| The Trash | a system view, `{ membership: { rule: { filter: { field: 'deletedAt', operator: 'isNotNull', value: null } } } }` |
| Select these | `selectIds(ids)` |
| Select all matching | `selectMatching(query, count)`, then `toggleSelected` records exceptions |
| Shift-click | `selectRange(selection, anchor, id, shownIds, matches)` |
| Save the selection as a playlist | `freezeSelection(selection, items)` gives the ids |
| Do X to the selection | `resolveSelectionIds(provider, selection)` (the provider runs the query; `countChanged` says if the data moved since the user chose) |

## Functions

`@zodal/core`, all in memory with the core evaluator (`filterToFunction` + `matchesSearch`, which moved here from `@zodal/store`; store re-exports them):

- Resolving: `resolveSelection`, `resolveMembership`, `resolveView`, `freezeSelection`, `evaluateQuery`. Seams (options): `idOf` (an item's id, `item.id` by default; media apps key files by path; the same name as the hand-order functions), `evaluate` (how a query runs; a ranked search passes its own and the ranking survives), `compare` (the sort-key order).
- Changing a selection: `selectIds`, `selectMatching`, `EMPTY_SELECTION`, `isSelectionEmpty`, `isSelected`, `toggleSelected`, `setSelected`, `selectRange(selection, { anchor, id, shown })`, `forgetSelected`. A query selection needs `{ matches }` to know which items its query covers; `queryMatcher(query, items)` builds one.
- Ordering: `applyOrdering(items, ordering, { idOf, compare })` and `compareSortKeys`, the portable order of sort keys: null first, numbers, strings lower-cased by code point (no locale, so a Python or SQL evaluator can match it), booleans, dates. `toSortingState(ordering)` gives a provider's `GetListParams.sort`; providers sort with their own comparator (`compareValues`, locale-aware), so pass `{ compare: compareSortKeys }` to `applyQuery` where the portable order matters.
- Checking: `missingFieldClauses(view, fields)`, the clauses of a saved view that name a field the collection no longer has. On a schema change, show these to the user; never drop them silently (a dropped clause widens a view).
- Schemas: `FilterExpressionSchema` (built from `FILTER_OPERATORS`, the one list the `FilterOperator` type is derived from), `QuerySchema`, `SelectionSchema`, `OrderingSchema`, `MembershipSchema`, `PresentationSchema`, `ViewSchema`.

`@zodal/store`:

- `resolveSelectionIds(provider, selection, { idOf, pageSize })` against any `DataProvider`: the provider runs the query, server side when it can, so "all matching" never has to be held as ids in the browser. `countChanged` says whether the count moved since the user chose (`expectedCount`).

- `withTrash(provider, { field, retentionDays, stamp, idOf })` (i2mint/zodal#156): delete becomes Move to Trash (a `deletedAt` mark in the provider's own storage). The live provider hides trashed items from `getList` and `getOne` (the DataProvider contract still holds); `moveToTrash`, `restore` and `purge` take ids or a `Selection`, so a bulk move and its Undo are one call each; `trashed` is the Trash as a provider (its delete purges); `trashView` is the system view; `emptyTrash` and `purgeExpired` delete for real. Capabilities report `softDelete: true`, so a UI knows Undo is available instead of a confirmation.

## The two defaults

1. **Delete means Move to Trash.** Any app that deletes user data gets a Trash view with Restore and Delete permanently. Hard delete only for things with no value to recover (a draft just made, a cache), or where the backend cannot keep it, and then with a confirmation.
2. **A bulk action asks for confirmation, with the count, unless one Undo takes the whole operation back in place.** "Recoverable by hand" does not count. Delete permanently and Empty Trash always confirm.
