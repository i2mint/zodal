# Skill: zodal Development Patterns

## Purpose
Conventions, patterns, and helpers for implementing zodal features.

## Package Conventions

### Adding a new module to a package
1. Create `packages/<pkg>/src/<module>.ts`
2. Export from `packages/<pkg>/src/index.ts`
3. Add tests in `packages/<pkg>/tests/<module>.test.ts`
4. Run `pnpm --filter @zodal/<pkg> test` to verify

### Import conventions
- Within a package: relative paths with `.js` extension (`'./types.js'`)
- Cross-package: package name (`'@zodal/core'`)
- Never import from `@zodal/store` in `@zodal/ui` or vice versa

### Type conventions
- All public types exported from package `index.ts`
- Shared state types (`SortingState`, `ColumnFilter`, `PaginationState`, `FilterExpression`) live in `@zodal/core/types.ts`
- Inference types (`InferenceTrace`, `InferenceStep`) also in `@zodal/core/types.ts`

## Inference Engine

### Layer order (lowest to highest precedence)
1. **Type defaults** — `getTypeDefaults(zodType)` in `inference.ts`
2. **Validation refinements** — `refineByValidations(schema, defaults)`
3. **Name heuristics** — `refineByFieldName(key, defaults)` using regex patterns
4. **Zod `.meta()`** — `extractAffordancesFromMeta(meta)`
5. **affordanceRegistry** — external registry (`registry.ts`), survives `.optional()`/`.nullable()` wrapping
6. **CollectionConfig.fields** — explicit overrides, always wins

### Adding a new heuristic
Add regex pattern constant and case in `refineByFieldName()` in `packages/core/src/inference.ts`.

## Generator Pattern

All generators follow: `(collection: CollectionDefinition<T>) => Config[]`
- Pure functions, no side effects
- Return plain serializable objects
- TanStack Table compatible where applicable

## DataProvider Pattern

- Interface in `packages/store/src/data-provider.ts`
- 7 required + 3 optional methods: `upsert?()`, `getCapabilities?()`, `subscribe?()`
- 2 bifurcation-optional methods: `getContent?()`, `setContent?()` (only on `createBifurcatedProvider`)
- New adapters: implement `DataProvider<T>` interface
- Use `FilterExpression` (not `ColumnFilter[]`) for filters
- Client-side filter evaluation via `filterToFunction()` from `packages/store/src/filters.ts`

## Content-Metadata Bifurcation Pattern

Collections with both metadata (small/queryable) and content (large/opaque) fields use bifurcated storage. See [design notes](../../../docs/research/bifurcation_design_notes.md) and [implementation notes](../../../docs/research/bifurcation_implementation_notes.md).

### Core types (`@zodal/core`)
- `FieldStorageRole`: `'metadata' | 'content'`
- `ContentRef`: reference object returned in place of actual content
- `isContentRef()`: type guard
- `storageRole` property on `FieldAffordance` (Layer 3 name heuristic or explicit)
- `getContentFields()`, `getMetadataFields()`, `hasBifurcation()` on `CollectionDefinition`

### Store (`@zodal/store`)
- `createBifurcatedProvider()` in `packages/store/src/bifurcated-provider.ts`
- `splitFields()` utility: partition an object into metadata + content portions
- Writes: metadata first (commit point), then content; compensate on failure
- Reads: `getList` queries metadata provider only; content fields become `ContentRef`
- Capabilities: query caps from metadata provider, CRUD caps intersected

### Inference heuristic
Fields named `attachment`, `file`, `blob`, `upload`, `media`, `raw_data`, `payload`, `binary`, `document_content`, `source_file` (or suffixed `_file`, `_blob`, `_upload`, `_attachment`, `_binary`) infer `storageRole: 'content'`. Fields like `content`, `body`, `description` are NOT classified as content — they match `DESCRIPTION_PATTERNS` for textarea treatment instead. Override via `.meta()` or `CollectionConfig.fields`.

### UI awareness
- `ColumnConfig.meta.storageRole` / `meta.isContentRef` for renderers
- `FormFieldConfig.isContentField` + `type: 'file'` inferred
- `storageRoleIs('content')` composable tester predicate
- `contentLoading` state + `setContentLoading()` action in `CollectionState`

## Renderer Registry Pattern

- Ranked testers with named `PRIORITY` bands (FALLBACK=1, DEFAULT=10, LIBRARY=50, APP=100, OVERRIDE=200)
- Composable predicates: `zodTypeIs()`, `hasRefinement()`, `fieldNameMatches()`, `metaMatches()`, `and()`, `or()`
- Registry is user-supplied (not global singleton)
- Always include `explain()` for debugging

## Codec Pattern

Two levels:
1. **Field-level** — `Codec<TEncoded, TDecoded>` in `@zodal/core/codec-types.ts`. Pre-built: `dateIsoCodec`, `dateEpochCodec`, `jsonCodec()`. Compose with `composeCodecs()`.
2. **Provider-level** — `wrapProvider(provider, codec)` in `@zodal/store/wrap-provider.ts`. Wraps a `DataProvider<TStored>` with decode/encode to produce `DataProvider<TApp>`.

## State Slices

Individual composable slices in `@zodal/ui/state/slices.ts`:
- `createSortingSlice(collection)` — sorting state + setSorting/clearSorting
- `createFilterSlice(collection)` — columnFilters + globalFilter
- `createPaginationSlice(collection)` — pagination with setPageIndex/setPageSize/resetPage
- `createSelectionSlice(collection)` — rowSelection with toggleRow
- `createColumnSlice(collection)` — columnVisibility + columnOrder with toggle

Each returns `{ initialState, actions }`. Use `createCollectionStore()` for the fully composed version.

## AffordanceRegistry

- `createAffordanceRegistry()` creates an isolated registry (WeakMap-backed)
- `affordanceRegistry` is the default global instance
- Register on inner schemas BEFORE wrapping: `affordanceRegistry.register(priceSchema, { displayFormat: 'currency' })`
- Registry unwraps `.optional()`/`.nullable()`/`.default()` when looking up

## Build & Test Commands
```bash
pnpm build                  # Build all packages (Turborepo cached)
pnpm test                   # Run all unit tests
pnpm test:integration       # Run integration + BDD story tests
pnpm --filter @zodal/core test    # One package
pnpm --filter @zodal/core build   # Build one package
```
