# Affordance Taxonomy Summary

## Overview

In zodal's context, an **affordance** is a declared capability -- an action, operation, or
behavior that a collection of typed items can support. Following Gibson/Norman theory, an
affordance is what the system *can do*; the corresponding **signifier** is the UI element
that makes the affordance visible to the user.

Affordances are organized across **five levels**:

| Level | Acts on | Examples |
|-------|---------|----------|
| **Field** | A single property of an item | sortable, filterable, editable |
| **Item** | One item in the collection | create, delete, duplicate, archive |
| **Selection** | A chosen subset of items | bulkDelete, bulkEdit, selectAll |
| **Collection** | The collection as a whole | search, paginate, export, viewMode |
| **View / Presentation** | Display configuration (no data mutation) | density, column management, theming |

A sixth conceptual layer -- **cross-cutting concerns** -- modifies how affordances at any
level behave (confirmation dialogs, async loading, keyboard shortcuts, conditional
visibility).

---

## Field-Level Affordances

Each field-level affordance declares what operations are meaningful on a single property
of an item. They inform both renderers (what controls to show) and the data layer (what
queries to support).

| Affordance | Definition | Typed in predecessor? |
|------------|------------|-----------------------|
| `sortable` | Field can be used to order items. Options: directions, nulls placement, custom sort fn, server delegation. | Yes -- `boolean \| SortDirection` |
| `filterable` | Field can narrow the collection. Filter types: exact, search, select, multiSelect, range, contains, boolean, fuzzy, faceted. | Yes -- `boolean \| FilterType` (8 types) |
| `searchable` | Field is included in full-text search. Options: search weight, analyzer. | Yes -- `boolean` |
| `groupable` | Items can be grouped by this field's values. Options: custom group fn, group labels. | Yes -- `boolean` |
| `aggregatable` | Field supports aggregate computations (sum, avg, min, max, count, median, etc.). | Yes -- `boolean \| AggregationFn[]` |
| `editable` | Field can be modified by the user. Options: edit widget, validation, permission, confirmation. | Yes -- `boolean` |
| `inlineEditable` | Editable directly in the collection view (click-to-edit cell). | Yes -- `boolean` |
| `visible` | Whether the field appears in the collection view by default. | Yes -- `boolean` |
| `hidden` | Stronger than `visible: false` -- cannot be toggled by user. | Yes -- `boolean` |
| `detailOnly` | Only shown in detail/edit view, never in the list/table. | Yes -- `boolean` |
| `summaryField` | Appears in compact/summary views. | Yes -- `boolean` |
| `displayFormat` | How to render the raw value (format string, currency, date, etc.). | Yes -- `string` |
| `badge` | Render enum values as colored badges/chips. | Yes -- `Record<string, string>` |
| `copyable` | Show a copy-to-clipboard button. | Yes -- `boolean` |
| `truncate` | Max character length before truncation. | Yes -- `number` |
| `tooltip` | Show full value on hover when truncated. | Yes -- `boolean` |
| `resizable` | User can resize this column. | Yes -- `boolean` |
| `pinned` | Pin column to left/right edge. | Yes -- `'left' \| 'right' \| false` |
| `order` | Default position in column order. | Yes -- `number` |
| `title` | Human-readable label. | Yes -- `string` |
| `description` | Help text for the field. | Yes -- `string` |
| `editWidget` | Override the default edit widget type. | Yes -- `string` |
| `readable` | Whether the field is returned in responses. | Yes -- `boolean` |
| `requiredOnCreate` | Required when creating but not on update. | Yes -- `boolean` |
| `requiredOnUpdate` | Required when updating. | Yes -- `boolean` |
| `immutableAfterCreate` | Editable on create, read-only on update. | Yes -- `boolean` |
| `columnWidth` / `minWidth` / `maxWidth` | Column sizing constraints. | Yes -- `number` |
| `bulkEditable` | Can be set to the same value across selected items. | No (taxonomy only) |
| `editHistory` | Track edit history for this field. | No (taxonomy only) |
| `editPermission` | Role/ownership-based edit control. | No (taxonomy only) |
| `reorderable` | User can drag this column to a different position. | No (taxonomy only) |
| `link` | Render as a clickable link with URL template. | No (taxonomy only) |
| `icon` | Map values to icons. | No (taxonomy only) |
| `image` | Render as image/thumbnail. | No (taxonomy only) |

---

## Item-Level Affordances

Operations on a single item in the collection.

| Affordance | Definition | Typed in predecessor? |
|------------|------------|-----------------------|
| **Core CRUD** | | |
| `create` | Add a new item. Options: form schema, defaults, templates, quick-create. | Yes (collection-level boolean) |
| `read` / `view` | View item details. Options: detail view layout, inline expand, hover preview. | Yes (collection-level boolean) |
| `update` / `edit` | Modify an item. Options: edit form, mode (form/inline/modal), partial update, autosave. | Yes (collection-level boolean) |
| `delete` / `remove` | Remove an item. Options: confirmation, soft delete, cascade, permissions. | Yes (collection-level boolean) |
| **Duplication** | | |
| `duplicate` / `clone` | Copy an item, excluding fields like IDs/timestamps. | No |
| `saveAsTemplate` | Save item as a reusable template. | No |
| **State transitions** | | |
| `archive` / `restore` | Move to/from archived state. | No (bulkArchive exists) |
| `publish` / `unpublish` | Toggle public visibility. | No |
| `lock` / `unlock` | Prevent/allow further edits. | No |
| `approve` / `reject` | Workflow state transitions. | No |
| `activate` / `deactivate` | Toggle active/inactive status. | No |
| **Navigation & context** | | |
| `navigate` | Click to go to detail page. | No |
| `select` | Toggle item selection for bulk ops. | Partially (collection `selectable`) |
| `expand` / `collapse` | Show/hide nested content. | No |
| `drag` | Drag for reordering or moving between groups. | No |
| `contextMenu` | Right-click menu with available actions. | No |
| **Annotation** | | |
| `tag` / `label` | Add/remove tags or colored labels. | No |
| `comment` / `annotate` | Add comments or annotations. | No |
| `rate` / `score` | Assign a rating. | No |
| `flag` / `bookmark` / `star` | Mark for attention. | No |
| `assignTo` | Assign to a user/team. | No |
| **Sharing & permissions** | | |
| `share` | Share with users/groups. | No |
| `setPermissions` | Change access control. | No |
| `transfer` | Transfer ownership. | No |
| **History & versioning** | | |
| `viewHistory` | See change history. | No |
| `revert` | Roll back to a previous version. | No |
| `snapshot` | Save current state as a named version. | No |
| **Relationships** | | |
| `link` / `associate` | Create a relationship to another item. | No |
| `unlink` | Remove a relationship. | No |
| `moveToCollection` | Transfer item to a different collection. | No |
| `mergeWith` | Merge two items into one. | No |

---

## Selection-Level Affordances

Operate on a chosen subset of items. Require a selection mechanism.

| Affordance | Definition | Typed in predecessor? |
|------------|------------|-----------------------|
| `bulkEdit` | Edit the same fields across all selected items. | Yes -- `boolean \| string[]` |
| `bulkDelete` | Delete all selected items. | Yes -- `boolean` |
| `bulkArchive` | Archive all selected. | Yes -- `boolean` |
| `bulkDuplicate` | Duplicate all selected. | No |
| `bulkPublish` / `bulkUnpublish` | Toggle publish state for selection. | No |
| `bulkTag` / `bulkLabel` | Add/remove tags/labels from selection. | No |
| `bulkAssign` | Assign selection to a user/team. | No |
| `bulkMove` | Move selected to a different group/collection. | No |
| `bulkMerge` | Merge selected into one item. | No |
| `selectAll` / `selectNone` | Select/clear all items. | Implicitly (via `selectable`) |
| `selectInverse` | Invert current selection. | No |
| `selectByFilter` | Select items matching a filter. | No |
| `selectionCount` / `selectionSummary` | Display count or aggregates for selection. | No |

---

## Collection-Level Affordances

Operate on the collection as a whole.

| Affordance | Definition | Typed in predecessor? |
|------------|------------|-----------------------|
| **Search & discovery** | | |
| `search` | Full-text search across searchable fields. Options: debounce, min chars, highlight. | Yes -- `boolean \| SearchConfig` |
| `globalFilter` | Single filter across multiple fields. | No |
| `advancedSearch` | Multi-field search with boolean operators. | No |
| **Sorting** | | |
| `defaultSort` | Default sort field and direction. | Yes -- `{ field, direction }` |
| `multiSort` | Sort by multiple fields simultaneously. | Yes -- `boolean \| MultiSortConfig` |
| **Filtering** | | |
| `filterPanel` | Show/hide a filter panel. | Yes -- `boolean` |
| `filterPresets` | Pre-defined filter configurations. | Yes -- `FilterPreset[]` |
| `savedFilters` | Save and recall filter configs. | Yes -- `boolean` |
| **Pagination** | | |
| `pagination` | Split collection into pages. Styles: pages, loadMore, infinite. | Yes -- `boolean \| PaginationConfig` |
| **Grouping** | | |
| `groupBy` | Group items by a field. Options: collapsible, default state, aggregates. | Yes -- `boolean \| GroupByConfig` |
| **View modes** | | |
| `views` / `defaultView` | Switch between table, grid, list, kanban (and more in taxonomy: calendar, timeline, tree, map). | Yes -- `ViewMode[]` |
| `savedViews` | Save/recall complete view configurations. | Yes -- `boolean` |
| **Export / Import** | | |
| `export` | Export collection to CSV, JSON, XLSX, etc. Options: scope, fields. | Yes -- `boolean \| string[]` |
| `import` | Import items from file. Options: mapping, validation, duplicate handling. | Yes -- `boolean \| string[]` |
| **Ordering** | | |
| `reorder` | Manually reorder items via drag-and-drop. | Yes -- `boolean` |
| **Column configuration** | | |
| `columnVisibility` | Toggle which columns are shown. | Yes -- `boolean` |
| `columnOrder` | Drag to reorder columns. | Yes -- `boolean` |
| `columnResize` | Drag to resize columns. | Yes -- `boolean` |
| `columnPin` | Pin columns to edges. | Yes -- `boolean` |
| **Refresh & sync** | | |
| `refresh` | Reload from data source. | Yes -- `boolean` |
| `autoRefresh` | Periodically refresh. | Yes -- `number` (interval) |
| `realtime` | Live updates via WebSocket/SSE. | No |
| **Undo / Redo** | | |
| `undo` | Undo last operation. | Yes -- `boolean` |
| `redo` | Redo last undone operation. | No (taxonomy only) |
| **Analytics** | | |
| `summary` / `charts` / `statistics` | Aggregate stats and visualizations. | No |
| **Collaboration** | | |
| `sharedView` / `presence` / `notifications` | Share views, show presence, notify on changes. | No |
| **Access control** | | |
| `permissions` / `audit` | Collection-level access control and audit logs. | No |

---

## View/Presentation-Level Affordances

Change how the collection is displayed without mutating data.

| Concern | Details |
|---------|---------|
| **Density** | Compact, comfortable, spacious row/card spacing. |
| **Column management** | Visibility toggles, reordering, resizing, pinning, freezing. All typed in predecessor (`columnVisibility`, `columnOrder`, `columnResize`, `columnPin`). |
| **View modes** | Table, grid, list, kanban (typed). Calendar, timeline, tree, map, chart, board (taxonomy only). |
| **Theming** | Not yet typed. Color schemes, dark/light mode. |
| **Layout** | Saved views combine all presentation settings into a recallable configuration (typed as `savedViews`). |

---

## Cross-Cutting Concerns

Meta-affordances that modify how other affordances behave. These apply across all levels.

| Concern | Key options | Typed in predecessor? |
|---------|-------------|-----------------------|
| **Confirmation** | `confirmMessage`, `confirmTitle`, `confirmStyle` (dialog/popover/inline). | Yes -- `OperationConfirmation` type |
| **Async / Loading** | Loading indicators, progress bars, cancelable, retryable. | No |
| **Notifications** | Toast on success/error, toast with undo button. | No |
| **Keyboard shortcuts** | Assign shortcut to any affordance (e.g., Ctrl+N, Delete, /). | Yes -- `keyboardShortcut` on `OperationDefinition` |
| **Context sensitivity** | `enabledWhen` / `visibleWhen` -- conditions based on selection state, user role, feature flags. | No |
| **Server vs. Client** | Declare whether operation is server-side, client-side, or hybrid. | Partially (`serverSide` on PaginationConfig) |

---

## Priority Tiers

From the taxonomy's implementation roadmap:

### Tier 1 -- Core (MVP)
The minimum for any useful collection UI.

- **Field**: `sortable`, `filterable`, `searchable`, `visible`, `editable`
- **Item**: `create`, `read`, `update`, `delete`, `select`
- **Selection**: `bulkDelete`, `selectAll`, `selectNone`
- **Collection**: `search`, `paginate`, multi-sort, compound filter, `columnVisibility`

> All Tier 1 affordances are typed in the predecessor.

### Tier 2 -- Essential
Significantly enhance usability.

- **Field**: `groupable`, `aggregatable`, `displayFormat`, `inlineEditable`, `resizable`, `pinnable`
- **Item**: `duplicate`, `archive`, `expand`, `navigate`, `contextMenu`, `drag`
- **Selection**: `bulkEdit`, `bulkArchive`, `bulkTag`, `selectionSummary`
- **Collection**: `groupBy`, `viewMode`, `export`, `columnOrder`, `savedFilters`, `filterPresets`, `refresh`

> Most Tier 2 collection/field affordances are typed; item-level affordances (duplicate, archive, navigate, etc.) are not yet.

### Tier 3 -- Advanced
Power users and complex use cases.

- **Field**: `bulkEditable`, `editHistory`, `copyable`, `link`, `badge`
- **Item**: `tag`, `label`, `comment`, `rate`, `flag`, `assignTo`, `share`, `viewHistory`, `revert`, `mergeWith`
- **Selection**: `bulkMove`, `bulkMerge`, `bulkAssign`, `bulkPrioritize`
- **Collection**: `import`, `reorder`, `savedViews`, `realtime`, `undo`/`redo`, `customFields`, `advancedSearch`, `sharedView`

### Tier 4 -- Specialized
Domain-specific.

- **Item**: `publish`/`unpublish`, `lock`/`unlock`, `approve`/`reject`, `transfer`, `snapshot`
- **Collection**: calendar/timeline/map/kanban views, `presence`, `audit`, `permissions`, `notifications`, `charts`

---

## How Affordances Attach to Schemas

Zodal uses three mechanisms to determine which affordances apply to a field or collection,
applied in order of increasing precedence:

### 1. Inference from Zod types (lowest precedence)

The system infers sensible defaults from the Zod schema itself:

- `z.string()` -> `searchable: true`, `filterable: 'search'`, `sortable: true`
- `z.number()` -> `aggregatable: ['sum', 'avg', 'min', 'max']`, `filterable: 'range'`
- `z.enum([...])` -> `filterable: 'select'`, `groupable: true`
- `z.boolean()` -> `filterable: 'boolean'`
- Fields named `id`, `createdAt`, etc. -> `editable: false`, `immutableAfterCreate: true`

### 2. The `.meta()` pattern (field-level overrides)

Zod v4's `.meta()` method attaches affordance metadata directly to schema fields:

```ts
z.object({
  title: z.string().meta({ searchWeight: 10, sortable: 'both' }),
  status: z.enum(['draft', 'published']).meta({ badge: { draft: 'secondary', published: 'success' } }),
  notes: z.string().meta({ detailOnly: true, editable: true }),
})
```

### 3. Collection config (highest precedence)

The `CollectionConfig.fields` map provides per-field overrides that merge on top of
inference and `.meta()`. The `CollectionConfig.affordances` object declares collection-level
capabilities:

```ts
const config: CollectionConfig = {
  affordances: { create: true, bulkEdit: true, pagination: { defaultPageSize: 25 } },
  fields: { title: { inlineEditable: true, pinned: 'left' } },
}
```

Resolution order: **inferred defaults < `.meta()` < `CollectionConfig.fields`**.

---

## Source

- **Full taxonomy**: `collection_affordances_taxonomy.md` in the research corpus
  (510 lines, 10 sections covering field/item/selection/collection levels plus
  cross-cutting concerns, terminology, UI signifier mapping, priority tiers,
  data model implications, and composability rules).
- **Predecessor types**: `zod-collections-ui/src/types.ts`
  (287 lines defining `FieldAffordance`, `CollectionAffordances`, `OperationDefinition`,
  `CollectionConfig`, and resolved types after inference + merge).
