# Architecture and Design Patterns

## Overview

zodal's architecture follows patterns validated across 16+ research reports and the predecessor Cosmograph implementation. The design is not speculative: each pattern listed here has been tested in at least one production system (TanStack Table, JSON Forms, Metawidget, react-admin, dol, meshed, qh) and confirmed applicable to zodal's problem space through structured analysis.

The central thesis: a Zod schema, enriched with affordance metadata, contains enough information to generate correct UI configurations for tables, forms, filters, and actions -- without the generator ever importing a rendering library.

---

## Core Pipeline: Schema to Inference to Generation to Rendering

The fundamental flow through zodal has four stages:

```
Zod Schema  -->  Affordance Inference  -->  Config Generation  -->  Renderer Consumption
   (input)         (analysis)                (output)               (external)
```

1. **Zod Schema** -- The developer writes a `z.object(...)` with `.meta()` annotations on fields.
2. **Affordance Inference** -- The inference engine examines each field's type, refinements, name, and explicit metadata to determine what UI affordances apply (sortable, filterable, editable, etc.).
3. **Config Generation** -- Generator functions convert inferred affordances into plain config objects: column definitions, form field configs, filter descriptors, action descriptors.
4. **Renderer Consumption** -- External renderers (TanStack Table, shadcn DataTable, custom components) consume those config objects. zodal never produces DOM.

Each stage is independently replaceable. A different inference strategy, a different output format, or a different rendering target can be swapped without disturbing the others.

---

## Pattern 1: Multi-Layer Inference Engine

The inference engine resolves field affordances through four layers, applied in order of increasing specificity:

| Layer | Source | Example |
|-------|--------|---------|
| **Type defaults** | Zod type alone | `z.number()` implies `sortFn: "basic"`, `filterFn: "inNumberRange"` |
| **Refinement-driven** | Zod checks/refinements | `.email()` implies an email input widget; `.min(0).max(100)` implies a range slider |
| **Name heuristics** | Field key string | A field named `createdAt` implies `sortable: true`, `format: "relative-date"` |
| **Explicit `.meta()`** | Developer annotation | `.meta({ filterable: false })` overrides all inference |

Later layers override earlier ones. This means a developer who writes nothing beyond the Zod schema still gets reasonable defaults, while explicit `.meta()` always has final say. The predecessor implementation already applies all four layers.

---

## Pattern 2: Codec/Transform Composition

Transformations between stored data and displayed data follow the codec (encode/decode) duality pattern.

**The duality.** Every transform has two directions: encoding (store to display) and decoding (display to store). A date stored as an ISO string is *encoded* to a formatted display string and *decoded* back on edit. A currency stored as cents is encoded to dollars for display and decoded back on save.

**Composition via chaining.** Codecs compose: if codec A converts cents to dollars and codec B formats dollars with currency symbols, chaining A then B produces a cents-to-formatted-currency codec. The reverse direction chains in reverse order.

**Key vs value transforms.** Following dol's `wrap_kvs` pattern, transforms can apply to keys (field names/paths), values (field contents), or both. Key transforms enable field aliasing and path remapping. Value transforms enable formatting, unit conversion, and serialization.

**Sources:** dol's `wrap_kvs` layered store wrapping, io-ts's codec type, Zod 4's `z.codec()` proposal.

---

## Pattern 3: Ranked Tester Registry

Renderer selection uses a scored dispatch mechanism borrowed from JSON Forms and Metawidget.

```
(fieldSchema, metadata) --> tester function --> priority score (number)
                                                highest score wins
```

**How it works.** A registry holds `(tester, renderer)` pairs. When a field needs a renderer, every tester is evaluated against the field's schema and metadata. The renderer whose tester returns the highest score is selected.

**Composable predicates.** Testers are plain functions that can be composed: `and(isStringType, hasRefinement("email"))` returns a high score for email fields; `isStringType` alone returns a lower score for generic strings.

**Priority bands.** Scores are organized into bands: defaults (1-10), type-specific (11-50), refinement-specific (51-100), explicit override (101+). This ensures that a custom email renderer beats the generic string renderer, and an explicit `.meta({ renderer: "custom" })` beats everything.

**Extensibility.** Adding a new renderer means registering one new entry. No switch statements, no modification of existing code. The registry is open for extension, closed for modification.

**Sources:** JSON Forms tester registry, Metawidget's inspector/widget-builder pipeline.

---

## Pattern 4: Bridge from Minimal to Rich

zodal defines minimal interfaces (3-8 methods) for storage and data access, then uses a bridge layer to add richness.

**The minimal interface.** A collection backend implements a small contract:

```
save(item) -> item
getById(id) -> item | null
list(query?) -> { items, total }
updateMetadata(id, updates) -> item
delete(id) -> boolean
```

This is deliberately small -- any storage backend (IndexedDB, REST API, in-memory array, S3) can implement five methods.

**The bridge layer.** Generic infrastructure wraps the minimal interface to provide: optimistic updates, caching, retry logic, batch operations (by iterating over single-item methods), undo (by storing previous state before mutations), and real-time sync (by polling or subscribing to changes on the minimal interface).

**Why this matters.** The minimal interface is the integration contract. Third-party developers implement it once. The bridge layer is zodal's responsibility and grows without burdening integrators.

**Sources:** Uniforms (6-method bridge interface), localForage (5-method storage interface), dol's `Mapping`/`MutableMapping` (4-method core).

---

## Pattern 5: Capability Discovery

The backend communicates what operations it supports, and the UI degrades gracefully based on that declaration.

```typescript
CollectionCapabilities {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canReorder: boolean
  canExport: boolean
  supportedSorts: string[]
  supportedFilters: string[]
  commands: CommandDescriptor[]
}
```

**How it works.** The repository exposes a `getCapabilities()` method. The UI reads it before rendering controls. If `canDelete` is false, the delete button does not appear -- it is not merely disabled, it is absent. If `supportedSorts` excludes a field, the sort icon for that column is not rendered.

**Per-item capabilities.** When permissions are item-specific (e.g., shared read-only items), capabilities can travel with each item in the list response.

**Why this is novel.** Existing schema-driven UI libraries (JSON Forms, react-admin, Refine) assume a fixed set of capabilities per resource type defined at build time. zodal's capability discovery is runtime and dynamic -- the same collection type can expose different capabilities depending on the storage backend, user permissions, or network state. This is zodal's primary architectural contribution beyond the state of the art.

**Sources:** HATEOAS principles (runtime affordance discovery), Hydra's `supportedOperation`, OData capability annotations. The dynamic-per-instance aspect is zodal's novel contribution.

---

## Pattern 6: Headless (Config, not DOM)

zodal's generators return plain configuration objects, never UI elements.

**What "headless" means here.** A generator function like `toColumnDefs(schema)` returns an array of column definition objects (field name, sort function, filter function, header label, cell formatter). It does not return React components, HTML strings, or DOM nodes.

**Why this enables multi-target rendering.** The same column definitions can be consumed by TanStack Table (React), AG Grid (vanilla JS), a CLI table formatter, a PDF report generator, or an AI agent that needs to understand what a collection's fields are. The config is the product; rendering is the consumer's concern.

**What config objects look like.** They are plain serializable objects (with optional function references for formatters and validators). They carry enough information for a renderer to produce correct UI without additional schema inspection.

**Sources:** TanStack Table (headless table state), Radix UI (headless primitives), the predecessor's generator functions that already produce config objects.

---

## Pattern 7: Slice/Modular State Composition

Collection UI state is managed through independent slice factory functions composed into stores.

**The slice pattern.** Each concern (sorting state, filter state, selection state, pagination state, column visibility) is defined as an independent factory function that returns a state slice with its own actions:

```
createSortingSlice()    -> { sorting, setSorting }
createFilterSlice()     -> { filters, setFilter, clearFilters }
createSelectionSlice()  -> { selected, toggleRow, selectAll, clearSelection }
createPaginationSlice() -> { page, pageSize, setPage }
```

**Composition.** Slices are spread into a single store. Each slice is unaware of the others. Cross-cutting concerns (e.g., "clearing filters resets pagination to page 1") are handled by middleware or explicit orchestration in the consuming component, not by coupling slices.

**Why this matters for zodal.** Different collection types need different subsets of state. A simple list needs sorting and pagination. A data table needs all slices. A gallery view needs pagination and selection but not column visibility. Slices compose to match the need.

**Sources:** Zustand slice pattern, SQLRooms modular store composition, Immer for immutable updates within slices.

---

## Pattern 8: Zod as Core Schema Substrate

Zod v4 is not merely a validation library in zodal's architecture -- it is the single source of truth for data shape, constraints, and UI metadata.

**`.meta()` as the primary extension point.** Zod v4's `.meta()` attaches arbitrary metadata to any schema instance. zodal uses this to carry affordance declarations (`sortable`, `filterable`, `editable`, display hints, custom renderer keys) directly on the schema.

**Metadata registries.** `z.globalRegistry` stores metadata keyed by schema instance identity. Custom registries (via `z.registry()`) hold non-serializable data like React components, avoiding conflicts with JSON Schema generation.

**Instance identity.** Each `.meta()` call returns a new schema instance. This means metadata is per-instance, not per-type. Two `z.string()` fields in the same object can carry different metadata.

**Declaration merging.** TypeScript's declaration merging on `GlobalMeta` allows zodal to extend the metadata type system-wide, so `.meta({ sortable: true })` is type-checked.

**Critical constraint.** `.meta()` must be the last call in a chain. `z.string().meta({...}).optional()` loses the metadata because `.optional()` creates a new wrapper instance. zodal's inference engine accounts for this by unwrapping optional/nullable layers before reading metadata.

---

## Additional Patterns

### Catalog-Registry-Renderer Pipeline

From json-render's three-layer architecture:

1. **Catalog** -- Declarative vocabulary of available components and actions, defined with Zod schemas.
2. **Registry** -- Platform-specific mapping from vocabulary entries to implementations.
3. **Renderer** -- Runtime consumer that resolves catalog entries through the registry.

zodal adapts this as: affordance schema (catalog) mapped to generator output (registry) consumed by UI components (renderer). The catalog-as-documentation pattern (`catalog.prompt()`) is borrowed directly: zodal can auto-generate text describing what a collection supports, useful for developer docs and AI agent integration.

### Two-Level Declaration

From OData's capability annotations: collection-level defaults plus per-field overrides. Everything is allowed unless explicitly restricted:

```
collection-level: { filterable: true, sortable: true }
field-level:      { metadata: { filterable: false }, createdAt: { sortable: 'ascOnly' } }
```

This is more concise than requiring every field to declare its capabilities individually.

### Collection Pipeline

From Fowler's Collection Pipeline pattern: query operations (filter, sort, group, paginate) compose as a sequence of stages, each taking a collection and producing a collection. zodal's query layer follows this functional model, enabling stages to be reordered, omitted, or extended without breaking the pipeline.

### Command Pattern for Operations

Operations on collections and items are first-class command objects with metadata (id, label, icon, scope, confirmation config, execute function, undo function). The UI renders controls by iterating over the command list. Adding a new operation means registering a command object -- no JSX modification required. This directly enables keyboard shortcut binding, logging, undo/redo, and consistent confirmation dialogs from a single registration point.

---

## Related-Project Patterns

### meshed: DAG as Single Source of Truth

meshed represents computation pipelines as directed acyclic graphs where functions are nodes and data dependencies are edges. The DAG is the single source of truth: execution order, parallelism opportunities, and dependency visualization are all derived from it. zodal borrows this principle -- the Zod schema is the single source of truth from which inference, generation, and documentation are all derived.

### qh: Function-to-Webservice Bidirectional Mapping

qh demonstrates that a Python function's signature contains enough information to generate both a web API endpoint and a web form for calling it. The mapping is bidirectional: function to service and service back to function call. zodal applies the same principle in the JS/TS domain: a Zod schema contains enough information to generate both a data table configuration and a form configuration, and user interactions on those UIs map back to validated data operations.

### dol: Mapping Interface and Composable Layers

dol proves that most storage interactions reduce to Python's `MutableMapping` interface (5 methods: `__getitem__`, `__setitem__`, `__delitem__`, `__contains__`, `__iter__`). Complex behavior is added by wrapping: `wrap_kvs` applies key/value transforms, caching layers add persistence, and codec layers handle serialization -- all without modifying the underlying store. zodal's minimal repository interface (Pattern 4) and codec composition (Pattern 2) are direct adaptations of dol's architecture to the TypeScript/collection domain.

---

## Sources

This document synthesizes patterns from the following source files:

- `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/reference_notes.md` -- Extracted implementation patterns from 87+ references, Zod v4 metadata details, TanStack Table mappings, affordance standards, state management patterns.
- `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/resources_design.md` -- Cosmograph resource collection architecture, capability discovery pattern, generic repository design, command pattern application, composite collections.
- `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/collection-pattern-concepts.md` -- Generic collection pattern formalization, operation taxonomy, capability schema design, prior art references (Google AIP, Fowler, GoF).
