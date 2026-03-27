# zodal Architecture

## Package Structure

```
zodal/
  packages/
    core/       @zodal/core     — types, inference, defineCollection, explain, codecs
    store/      @zodal/store    — DataProvider, capabilities, filters, adapters
    ui/         @zodal/ui       — generators, state, renderer registry, AI tools
    ui-shadcn/  @zodal/ui-shadcn — concrete shadcn/ui renderers (future)
  apps/
    demo/       Vite + React 19 demo (future)
  tests/
    stories/    BDD story specs
    integration/ Cross-package integration tests
    heavy/      Long-running tests (not in CI)
    executors/  BDD executor backends
```

## Dependency Graph

```
@zodal/ui-shadcn  -->  @zodal/ui  -->  @zodal/core  <--  @zodal/store
```

**Rule**: `@zodal/ui` and `@zodal/store` never depend on each other.

## @zodal/core

**Purpose**: Schema types, inference engine, and the `defineCollection()` entry point.

**Key exports**:
- `defineCollection(schema, config?)` → `CollectionDefinition` with resolved affordances
- `inferFieldAffordances(key, schema)` → inferred `FieldAffordance` from Zod type
- `explain()` on `CollectionDefinition` → layer-by-layer inference trace
- `affordanceRegistry` — external metadata that survives Zod schema transforms
- `Codec<TEncoded, TDecoded>` + pre-built codecs (`dateIsoCodec`, `jsonCodec()`, etc.)
- Type vocabulary: `FieldAffordance`, `CollectionConfig`, `FilterExpression`, `SortingState`, etc.

**6-layer inference** (lowest to highest precedence):
1. Type defaults — `z.string()` → sortable, searchable
2. Validation refinements — `.email()` → email widget
3. Name heuristics — `password` → hidden, `createdAt` → not editable
4. `.meta()` annotations — explicit Zod metadata
5. `affordanceRegistry` — external registry, survives `.optional()` wrapping
6. `CollectionConfig.fields` — explicit config overrides, always wins

## @zodal/store

**Purpose**: DataProvider interface, capability discovery, and concrete adapters.

**Key exports**:
- `DataProvider<T>` — 7 required + 1 optional CRUD method + `getCapabilities()` + `subscribe?()`
- `createInMemoryProvider(data, options)` — client-side adapter for prototyping/testing
- `filterToFunction(filter)` — compile `FilterExpression` to a JS predicate
- `wrapProvider(provider, codec)` — apply encode/decode transforms to any DataProvider
- `ProviderCapabilities` — runtime capability discovery (zodal's novel contribution)

**FilterExpression** (replaces untyped `ColumnFilter[]`):
```typescript
type FilterExpression =
  | { field: string; operator: FilterOperator; value: unknown }
  | { and: FilterExpression[] }
  | { or: FilterExpression[] }
  | { not: FilterExpression };
```

## @zodal/ui

**Purpose**: Generators, state management, renderer registry, and AI tools.

**Key exports**:
- `toColumnDefs(collection)` — TanStack Table-compatible column definitions
- `toFormConfig(collection, mode)` — form field configs for create/edit
- `toFilterConfig(collection)` — filter panel configs
- `createCollectionStore(collection)` — pure-function state management
- 5 composable slices: `createSortingSlice`, `createFilterSlice`, `createPaginationSlice`, `createSelectionSlice`, `createColumnSlice`
- `createZustandStoreSlice(collection, provider?)` — Zustand `create()` compatible
- `createRendererRegistry()` — ranked tester registry with `PRIORITY` bands
- `toPrompt(collection)` — AI/LLM-consumable description
- `toCode(collection, options?)` — TypeScript code generation

## Build & Tools

- **Monorepo**: pnpm workspaces + Turborepo
- **Build**: tsup (dual CJS/ESM + .d.ts)
- **Test**: vitest (unit per-package + integration at root)
- **Schema**: Zod v4 (peer dependency)

## Design Principles

1. **Headless first** — produce configuration objects, never DOM/React
2. **Convention over configuration** — zero annotations = working defaults
3. **Escape hatches everywhere** — any inferred default can be overridden
4. **Zod v4 as schema substrate** — not schema-agnostic
5. **Thin glue, not a framework** — configure existing tools, don't replace them
