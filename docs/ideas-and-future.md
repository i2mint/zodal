# Ideas & Future Directions

Collected from the design phase, research reports, and implementation experience. Items are roughly ordered by priority/readiness.

## Ready to Implement

### @zodal/ui-shadcn — Concrete renderer package
The renderer registry and generator outputs are designed for this. Extract demo app components into a proper package with shadcn/ui renderers for tables, forms, filters.

### REST DataProvider adapter
`createRestProvider(baseUrl, options)` implementing `DataProvider<T>` with fetch-based CRUD. Map `FilterExpression` to query parameters. Report capabilities based on API responses.

### Supabase DataProvider adapter
PostgREST-native adapter with server-side sort/filter/search. `getCapabilities()` reports `serverSort: true`, `serverFilter: true` with per-field operator support.

### useCollectionQuery — TanStack Query integration
Optional React hook wrapping a DataProvider with TanStack Query's caching, background refetch, and optimistic updates. Tree-shakeable, only imported when needed.

### Zod v4 z.codec() detection
The inference engine (Layer 2) should detect when a field uses `z.codec()` and record the transform in the resolved affordances. This enables generators to produce appropriate display/edit widgets.

## Needs More Design

### Navigation affordances
Real apps have related collections. A `Project` has `Tasks`; a `User` has `Orders`. Navigation affordances would declare these relationships so generators can produce drill-down links, breadcrumbs, and related-items panels. Risk: implies routing/framework opinions.

### defineFunction() and DAG composition
Generalize from collections to functions (meshed-style). A function's Zod input/output schemas could drive form generation and pipeline visualization. Post-v1 scope — don't let it drive current architecture.

### Real-time / subscription support
`subscribe?()` is in the `DataProvider` interface already. Implementation needs: WebSocket/SSE transport, event-to-state-update mapping, conflict resolution for optimistic updates.

### Saved views and filters
Persist filter/sort/column configurations per user per collection. Needs a persistence layer (localStorage, server-side) and UI for managing saved views.

### Undo/redo
Two approaches designed but not chosen:
- **Immer patches**: Low-overhead if using Zustand+Immer adapter. `produceWithPatches` + `applyPatches`.
- **Command history**: Record operations as typed command objects. More semantic, works with any state manager.

### Multi-collection dashboard
Compose multiple collections on one screen with cross-collection filtering (e.g., select a project → filter its tasks). Needs a composition model for collections.

## Research Ideas (from reports)

### AI agent integration
`toPrompt()` already generates LLM-consumable descriptions. Next step: generate tool-use schemas from `OperationDefinition` so LLMs can execute CRUD operations. Per the json-render research.

### Visual query builder
Use the `FilterExpression` type to build a visual drag-and-drop query builder (AND/OR/NOT tree). Each node is a `FilterCondition` with operator and value inputs derived from field affordances.

### Schema diffing for migrations
Compare two versions of a collection's resolved affordances to generate migration suggestions. "Field X was added", "Field Y changed from filterable:search to filterable:exact".

### Offline-first with Dexie
IndexedDB adapter using Dexie, with index-awareness in `getCapabilities()`. Per the storage adapter research: `where()` (indexed) vs `filter()` (JS-level).

### Per-item capabilities
`getCapabilities()` currently returns static capabilities. Extend to per-item: "this user can edit item X but not item Y". Requires capability function rather than static object.
