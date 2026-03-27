# Existing Implementation: zod-collections-ui

## Overview

**Package name**: `zod-collection-ui` (npm name; repo directory is `zod-collections-ui`)
**Version**: 0.0.1
**License**: MIT
**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`

**Tech stack**: TypeScript (ES module), Zod v4+ (peer dependency), Vitest for testing.
No runtime dependencies beyond Zod. The demo app adds React 19, TanStack Table v8, shadcn/ui (Radix primitives), Tailwind CSS v4, and react-hook-form.

**Test status**: 173 tests across 7 test files (2,408 lines of test code). All modules have dedicated test coverage.

**Tagline**: "Declare once, render anywhere. Schema-driven collection UIs from Zod -- auto-generated table columns, form fields, filters, state, and data providers."

**Design philosophy**: headless library (~1,500 lines of source) that reads Zod schemas and produces configuration objects for existing renderers. Convention over configuration. Zod-native. The schema IS the source of truth.

---

## Module Inventory

### types.ts -- Type Definitions

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/types.ts` (287 lines)

Defines the full vocabulary for declaring what operations a collection supports. Organized into four sections:

**Field-Level Affordances** (`FieldAffordance` interface, ~70 properties across 5 groups):
- Query capabilities: `sortable`, `filterable`, `searchable`, `groupable`, `aggregatable`
- CRUD capabilities: `readable`, `editable`, `inlineEditable`, `requiredOnCreate`, `requiredOnUpdate`, `immutableAfterCreate`
- Visibility and layout: `visible`, `hidden`, `detailOnly`, `summaryField`, `columnWidth`, `minWidth`, `maxWidth`, `resizable`, `pinned`, `order`
- Display: `title`, `description`, `displayFormat`, `badge`, `copyable`, `truncate`, `tooltip`
- Edit widget override: `editWidget`, `editPlaceholder`, `editHelp`

**Supporting scalar types**:
- `SortDirection`: `'asc' | 'desc' | 'both' | 'none'`
- `FilterType`: `'exact' | 'search' | 'select' | 'multiSelect' | 'range' | 'contains' | 'boolean' | 'fuzzy'`
- `AggregationFn`: `'sum' | 'avg' | 'min' | 'max' | 'count' | 'median' | 'uniqueCount'`

**Collection-Level Affordances** (`CollectionAffordances` interface):
- CRUD flags: `create`, `read`, `update`, `delete`
- Bulk: `bulkDelete`, `bulkEdit`, `bulkArchive`
- Query: `search` (with `SearchConfig`), `pagination` (with `PaginationConfig`), `defaultSort`, `multiSort`, `filterPanel`, `filterPresets`, `savedFilters`, `groupBy`
- Views: `defaultView`, `views` (`ViewMode[]`), `savedViews`
- Export/Import: `export`, `import`
- Selection: `selectable` (`boolean | 'single' | 'multi'`)
- Column config: `columnVisibility`, `columnOrder`, `columnResize`, `columnPin`
- Other: `reorder`, `undo`, `refresh`, `autoRefresh`

**Operations** (Siren-inspired custom actions):
- `OperationScope`: `'item' | 'selection' | 'collection'`
- `OperationDefinition<TParams>`: `name`, `label`, `scope`, `icon`, `variant`, `confirm` (with `OperationConfirmation`), `keyboardShortcut`

**Collection Definition** (`CollectionConfig<TShape>`): the top-level config that users pass to `defineCollection`.

**Resolved Types**: `ResolvedFieldAffordance`, `ResolvedCollectionAffordances` -- the output after inference + merge.

### inference.ts -- 4-Layer Inference Engine

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/inference.ts` (449 lines)

The core intelligence of the library. Given a Zod schema field, infers sensible default affordances through four layers (later layers override earlier):

1. **Type-based defaults**: Maps Zod base type to a default `FieldAffordance`. Eight type categories (string, number, boolean, enum, date, array, object, unknown) each have a hardcoded default object.
2. **Validation-based refinements**: Inspects Zod checks (email, url, uuid, regex) and formats to refine the defaults (e.g., email -> email widget, uuid -> not editable).
3. **Name-based heuristics**: Regex patterns on field names. Patterns for: ID fields, timestamps (created/updated/deleted), secrets (password/token), email, name/title, description, image URLs, status fields.
4. **Zod `.meta()` annotations**: Reads the Zod v4 metadata registry for explicit developer overrides.

**Exported functions**:
- `inferFieldAffordances(key: string, schema: z.ZodType): FieldAffordance` -- the main entry point
- `getZodBaseType(schema: z.ZodType): string` -- unwraps optionals/nullables/defaults to get the base type name
- `unwrapZodSchema(schema: z.ZodType): z.ZodType` -- returns the inner schema after unwrapping wrappers
- `hasZodCheck(schema: z.ZodType, kind: string): boolean` -- checks for specific validations
- `getEnumValues(schema: z.ZodType): string[] | null` -- extracts enum values (handles Zod v4 `entries` format)
- `getZodMeta(schema: z.ZodType): Record<string, unknown> | undefined` -- reads Zod v4 metadata
- `getNumericBounds(schema: z.ZodType): { min?: number; max?: number }` -- extracts min/max from checks
- `humanizeFieldName(key: string): string` -- converts camelCase/snake_case to "Title Case"

### collection.ts -- defineCollection()

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/collection.ts` (367 lines)

The main entry point for the library.

**Exported function**: `defineCollection<TSchema extends z.ZodObject<any>>(schema, config?) -> CollectionDefinition<TSchema>`

Takes a Zod object schema and optional `CollectionConfig`, produces a `CollectionDefinition` that contains:
- `schema` -- the source Zod schema (preserved for downstream use)
- `affordances` -- resolved collection-level affordances (merged with defaults)
- `fieldAffordances` -- per-field affordances (inferred + explicit overrides merged)
- `operations` -- custom operations array
- `idField` -- auto-detected or explicit unique identifier field
- `labelField` -- auto-detected or explicit human-readable label field
- `getVisibleFields()` -- fields for table view (respects `visible`, `hidden`, `detailOnly`, `order`)
- `getSearchableFields()` -- fields for global search
- `getFilterableFields()` -- fields with filter config
- `getSortableFields()` -- sortable fields
- `getGroupableFields()` -- groupable fields
- `getOperations(scope)` -- operations by scope
- `describe()` -- human-readable text summary

**Internal logic**:
- `resolveCollectionAffordances()` merges explicit config with `DEFAULT_COLLECTION_AFFORDANCES` (CRUD all true, pagination 25/page, selectable multi, etc.)
- `resolveAllFieldAffordances()` runs `inferFieldAffordances()` per field then merges explicit overrides
- `detectIdField()` checks for `id`, `_id`, `uuid`, `key`, then fields ending with `Id`/`_id`
- `detectLabelField()` checks for `summaryField` flag, then common names (`name`, `title`, `label`), then first editable string field

**Exported type**: `CollectionDefinition<TSchema>`

### generators.ts -- Config Generators

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/generators.ts` (372 lines)

Transforms a `CollectionDefinition` into framework-specific configurations. All generators are headless -- they produce data, not components.

**`toColumnDefs(collection) -> ColumnConfig[]`**
Produces TanStack Table-compatible column definitions. Each `ColumnConfig` has:
- Feature flags: `enableSorting`, `enableColumnFilter`, `enableGlobalFilter`, `enableGrouping`, `enableHiding`, `enableResizing`
- Sort/filter function names: `sortingFn` (text/basic/datetime), `filterFn` (equalsString/includesString/arrIncludes/inNumberRange/etc.)
- Sizing: `size`, `minSize`, `maxSize`
- `meta` block with: `zodType`, `filterType`, `editable`, `inlineEditable`, `displayFormat`, `badge`, `copyable`, `truncate`, `tooltip`, `enumValues`, `numericBounds`, `pinned`
- Automatically adds a selection column (if selectable) and an actions column (if item-level operations exist)

**`toFormConfig(collection, mode: 'create' | 'edit') -> FormFieldConfig[]`**
Produces form field configurations. Each `FormFieldConfig` has: `name`, `label`, `type` (inferred widget: text/number/checkbox/select/date/tags/json/textarea/email/url), `required`, `disabled`, `hidden`, `placeholder`, `helpText`, `defaultValue`, `options` (for enums), `order`, `zodType`. Skips hidden fields, non-editable fields, and immutable fields on edit.

**`toFilterConfig(collection) -> FilterFieldConfig[]`**
Produces filter panel configurations. Each `FilterFieldConfig` has: `name`, `label`, `filterType`, `options` (for enum select/multiSelect), `bounds` (for range filters), `zodType`.

### store.ts -- State Management

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/store.ts` (266 lines)

Framework-agnostic state factory. No dependency on React, Zustand, or any framework.

**`createCollectionStore<T>(collection) -> CollectionStore<T>`**

Returns:
- `initialState: CollectionState<T>` -- derived from collection affordances (items, totalCount, loading, error, sorting, columnFilters, globalFilter, pagination, rowSelection, columnVisibility, columnOrder, grouping)
- `actions: CollectionActions<T>` -- pure functions `(state, args) -> newState` for: `setItems`, `setSorting`, `setColumnFilters`, `setGlobalFilter`, `setPagination`, `setRowSelection`, `setColumnVisibility`, `setColumnOrder`, `setGrouping`, `setLoading`, `setError`, `clearSelection`, `selectAll`, `reset`
- `selectors` -- derived data: `getSelectedItems`, `getSelectedCount`, `getPageCount`, `isAllSelected`, `hasSelection`, `getVisibleItems`

State shape is compatible with TanStack Table's state model. Actions reset `pageIndex` to 0 when filters change.

### data-provider.ts -- DataProvider Interface

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/data-provider.ts` (275 lines)

**The `DataProvider<T>` interface** (normalized CRUD, inspired by React Admin):

```typescript
interface DataProvider<T> {
  getList(params: GetListParams): Promise<GetListResult<T>>;
  getOne(id: string): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  updateMany(ids: string[], data: Partial<T>): Promise<T[]>;
  delete(id: string): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  upsert?(data: T): Promise<T>;  // optional
}
```

`GetListParams`: `sort?`, `filter?`, `search?`, `pagination?` (page-based, 1-indexed).
`GetListResult<T>`: `{ data: T[]; total: number }`.

**`createInMemoryProvider<T>(initialData, options?) -> DataProvider<T>`**
In-memory adapter for prototyping and testing. Options: `idField` (default: `'id'`), `simulateDelay` (ms), `searchFields` (default: all string fields). Supports multi-column sorting, column filters (array, range, boolean, string contains), global search, and pagination. Mutable internal store with auto-incrementing IDs for creates.

### prompt.ts -- AI Prompt Generation

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/prompt.ts` (254 lines)

**`toPrompt(collection) -> string`**

Generates a structured markdown document for LLM consumption. Sections:
- Collection Definition header with ID/label fields
- Data Shape table (field, type, sortable, filterable, searchable, editable, notes)
- Collection Capabilities (bulleted list of enabled features)
- Filter Configuration (per-field filter types)
- Custom Operations table (name, label, scope, confirm, variant)
- UI Generation Hints (visible fields, groupable fields, badge fields, inline-editable fields, summary fields, detail-only fields)

### codegen.ts -- Code Generation

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/src/codegen.ts` (408 lines)

Three approaches to using the library: runtime-only, codegen-only, or hybrid (recommended).

**`toCode(collection, options?) -> string`**
Generates a TypeScript file exporting a `CollectionConfig` object that captures all inferred affordances. Options: `header` (generation comment), `imports`, `exportName`, `indent`, `diffOnly` (only properties that differ from runtime inference), `importFrom`.

**`writeIfChanged(filePath, content) -> Promise<WriteResult>`**
Node.js-only. Writes content to a file only if it differs from existing content. Preserves file modification timestamps to avoid unnecessary rebuilds. Creates parent directories if needed.

**`generateAndWrite(collection, filePath, options?) -> Promise<WriteResult>`**
Convenience: `toCode()` + `writeIfChanged()`.

**`WriteResult`**: `{ written: boolean; reason: 'created' | 'updated' | 'unchanged'; filePath: string }`.

The serializer outputs clean TypeScript: single-quoted strings, objects inlined when under 60 chars, multi-line with proper indentation otherwise. Field properties are serialized in a canonical order defined by `FIELD_PROP_ORDER`.

---

## Architecture Rules (Settled)

These patterns are established in the codebase and should carry forward to zodal:

1. **Headless first**: The core library produces data structures (config objects), never React components or DOM. Renderers are separate.
2. **Zod as SSOT**: The Zod schema is the single source of truth. All affordances are either inferred from it or declared as metadata on it (via `.meta()`).
3. **Convention over configuration**: A plain Zod schema with zero annotations produces a fully functional collection definition.
4. **Exclusion-based defaults (OData pattern)**: Query capabilities (sortable, filterable) default to true and are opted out. CRUD operations (create, delete) default to true and are opted in. Bulk operations default to false.
5. **4-layer inference precedence**: Type defaults < Validation refinements < Name heuristics < `.meta()` annotations. Later layers override earlier ones.
6. **Pure state functions**: Store actions are `(state, args) -> newState`. No framework dependency. Users wire into Zustand, useReducer, or anything else.
7. **DataProvider as normalized interface**: 7 required methods + 1 optional (`upsert`). All return Promises. Implementations wrap any data source.
8. **TanStack Table compatibility**: Column defs, sorting state, filter state, and pagination state shapes are structurally compatible with TanStack Table.
9. **No React dependency in core**: The core package has only `zod` as a peer dependency.
10. **ESM-only**: The package is `"type": "module"` with `.js` extensions in imports.

---

## Zod v4 Gotchas

Critical introspection patterns used throughout the codebase that any agent working on zodal must know:

1. **Internal structure access**: Zod v4 uses `(schema as any)._zod?.def` to access the type definition. There is no public introspection API.
2. **Wrapper unwrapping**: `optional`, `nullable`, and `default` types must be unwrapped via `def.innerType` to get the actual type.
3. **Enum values**: Zod v4 uses `def.entries` (an object like `{ a: 'a', b: 'b' }`) instead of Zod v3's `def.values` (an array). The code handles both with `Object.values(def.entries)`.
4. **Checks and formats**: Validations may be on `def.checks` (array of `{ kind: string }`) or on `def.format` (string). Both must be checked.
5. **Numeric bounds**: May be instance properties (`schema.minValue`, `schema.maxValue`) or in the checks array. The code checks both locations.
6. **Metadata**: Zod v4 `.meta()` called without arguments returns the metadata object. Wrapped in try/catch because it may throw on schemas without metadata.
7. **Schema shape access**: `schema.shape` returns the shape record for `z.object()` schemas.

---

## What's Typed But NOT Implemented

Features defined in `types.ts` but not yet built (affordance is declared, UI/logic is absent):

- **`inlineEditable`**: Declared in `FieldAffordance`, inferred, and propagated to column meta, but no click-to-edit rendering exists in the demo.
- **`export`/`import`**: Collection affordances defined but no export or import functionality.
- **`savedFilters`/`savedViews`**: Declared in `CollectionAffordances` but no persistence.
- **`filterPresets`**: Type defined (`FilterPreset[]`) but not rendered.
- **`groupBy`**: Affordance declared, fields marked as `groupable`, but no grouping UI.
- **`aggregatable`**: Field affordance defined, aggregation functions listed, but no aggregation rendering.
- **View modes beyond table**: `ViewMode` type includes `'table' | 'grid' | 'list' | 'kanban'` but only table is implemented.
- **`reorder`**: Declared but no drag-and-drop row reordering.
- **`undo`**: Declared but no undo/redo.
- **`keyboardShortcut`** on operations: Declared but not wired.
- **`columnPin`**: Affordance declared, `pinned` field exists, but no pin UI.
- **`autoRefresh`**: Declared but no polling.
- **`bulkArchive`**: Declared but no handler.

---

## Demo App

**Source**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/demo/`

A Vite + React 19 + shadcn/ui + TanStack Table v8 + Tailwind CSS v4 application that renders the headless configs as interactive UI.

**Stack** (from `demo/package.json`):
- React 19, React DOM 19
- TanStack React Table v8
- shadcn/ui components (Radix primitives: dialog, dropdown-menu, select, checkbox, switch, tooltip, separator, label)
- react-hook-form v7 + @hookform/resolvers v5 (with Zod resolver)
- Tailwind CSS v4, class-variance-authority, tailwind-merge, clsx
- lucide-react (icons)
- Vite v7

**Custom collection components** (`demo/src/components/collection/`):
- `collection-view.tsx` -- top-level orchestrator, tabbed demos
- `collection-table.tsx` -- renders TanStack Table from column defs
- `collection-toolbar.tsx` -- search bar, filter button, view controls, bulk actions
- `collection-filter-panel.tsx` -- filter panel UI
- `collection-form-dialog.tsx` -- create/edit dialog using react-hook-form
- `collection-pagination.tsx` -- pagination controls
- `cell-renderers.tsx` -- custom cell rendering (badges, dates, arrays, booleans)

**shadcn/ui primitives** (`demo/src/components/ui/`): badge, button, checkbox, dialog, dropdown-menu, input, label, select, separator, switch, table, textarea, tooltip.

**Data definitions** (`demo/src/data/`): contacts.ts, products.ts, tasks.ts -- three demo collections with schemas, sample data, and `defineCollection` calls.

**React integration hook** (`demo/src/hooks/use-collection.ts`): `useCollection()` hook that wires `createCollectionStore`, `toColumnDefs`, `toFormConfig`, `toFilterConfig` into React state. This is demo-only code but serves as the reference integration pattern.

**What the demo proves**:
- Zero-config (Contacts): everything inferred from plain schema
- `.meta()` annotations (Tasks): colored badges, custom operations
- Explicit overrides (Products): currency formatting, star ratings
- Working features: sorting, search, filtering, pagination, row selection, create/edit forms, bulk actions, badge rendering

**What's demo-only vs reusable**: The 7 collection components and the `useCollection` hook are coupled to the demo via Vite aliases. They are reference implementations, not published packages. The roadmap explicitly notes the question of whether to extract them into `@zod-collection-ui/react`.

---

## Test Coverage

7 test files, 173 tests, 2,408 total lines of test code.

| Test File | Lines | What It Covers |
|-----------|-------|---------------|
| `inference.test.ts` | 317 | `getZodBaseType`, `unwrapZodSchema`, `getEnumValues`, `humanizeFieldName`, `getNumericBounds`, `inferFieldAffordances` (type defaults, validation refinements, name heuristics) |
| `collection.test.ts` | 412 | `defineCollection` with various schemas (Project, User), auto-detection of ID/label fields, affordance resolution, explicit overrides, `getVisibleFields`, `getSearchableFields`, `describe()` |
| `generators.test.ts` | 352 | `toColumnDefs` (selection column, data columns, actions column, sort/filter functions), `toFormConfig` (create vs edit mode, field types, options), `toFilterConfig` (filter types, enum options, range bounds) |
| `store.test.ts` | 278 | `createCollectionStore` initial state, all actions (setItems, setSorting, setColumnFilters, pagination reset, selectAll, clearSelection, reset), all selectors (getSelectedItems, getPageCount, isAllSelected) |
| `data-provider.test.ts` | 372 | `createInMemoryProvider` CRUD operations, getList with sorting/filtering/search/pagination, edge cases (not found, empty filters, range filters, boolean filters, array filters), deleteMany, updateMany, upsert |
| `prompt.test.ts` | 220 | `toPrompt` output contains expected sections (data shape table, capabilities, filter config, UI hints), handles custom operations, handles different schema shapes |
| `codegen.test.ts` | 457 | `toCode` full and diffOnly modes, `writeIfChanged` (create/update/unchanged), `generateAndWrite`, serialization (strings, objects, arrays, nesting), header/import generation, `CodegenOptions` |

---

## Design Tensions (Open)

From the roadmap, these are explicitly left undecided:

1. **Headless vs. batteries-included**: Should React components ship in core or in a separate `@zod-collection-ui/react` package? Current lean: separate. The demo proves the pattern.

2. **Convention depth vs. explicit config**: The zero-config inference is powerful but opaque. When a field named `description` is auto-hidden from the table, that's magic. Options under consideration: debug mode, `explain()` method. Current lean: add `explain()`.

3. **Form validation: Zod-native vs. form-library-native**: `FormFieldConfig` carries display hints, but the original Zod schema has richer validation. Current lean: both. The schema is available on `collection.schema` for native Zod validation. `FormFieldConfig` carries display-level hints.

4. **State management: pure functions vs. Zustand**: The store uses pure functions `(state, args) -> newState`. This is maximally portable but verbose to wire into React. Current lean: extract and publish the demo's `useCollection` hook as the reference integration.

---

## Roadmap Priorities

### Near-term: v0.1.0 (Polish and Harden)

- Extract or document renderer components from demo
- Implement inline editing (click-to-edit cells backed by `provider.update()`)
- Wire custom operation handlers (`onOperation` callback)
- Server-side data provider adapters (REST adapter: `createRestProvider`)
- Error boundaries, empty states, loading skeletons, virtual scrolling
- Documentation improvements (API reference, "build your own renderer" guide)

### Medium-term: v0.2.0 -- v0.5.0 (Feature Completeness)

- Export/import (CSV, JSON, clipboard)
- Saved views and filter presets (URL params, JSON serialization)
- Keyboard shortcuts
- Column pinning, reordering, resizing (all typed, TanStack supports natively)
- View modes: kanban, list, grid
- Grouping and aggregation with group headers

### Long-term: v1.0.0+ (Ecosystem)

- Renderer registry (JSON Forms tester-based dispatch): `(fieldSchema, meta) -> priority -> component`
- Multiple renderer sets (shadcn, MUI, Ant Design)
- GraphQL / Supabase / Firebase data providers
- Real-time and optimistic updates (WebSocket/SSE, cursor-based pagination)
- `zod-affordances` umbrella (beyond collections: forms, navigation, permissions)
- AI agent integration (HATEOAS for AI: collection tells the agent what it can do)
