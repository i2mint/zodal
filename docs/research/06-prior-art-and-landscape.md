# Prior Art and Ecosystem Landscape

## Overview

zodal sits at the intersection of form generation, table configuration, CRUD frameworks,
and schema-driven UI. No existing JS/TS tool unifies **data shape**, **field-level
affordances** (sortable, filterable, searchable), **collection-level operations**
(bulk delete, export, create), and **backend capabilities** into a single declaration
consumed by multiple renderers. This document maps the ecosystem and identifies what
zodal borrows, what it replaces, and where the gaps are.

---

## Form Generators

Form generators solve the "data shape -> input widgets" problem for single records.
None handle collections or operation declarations.

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **RJSF** | JSON Schema + optional UI Schema -> React forms; 15.5K stars, multiple themes | Widget registry pattern (Fields -> Widgets -> Templates) | No Zod support, no collections, no operation awareness |
| **JSON Forms** | Dual-schema (data + UI) with tester-based renderer registry; Eclipse-backed | Tester/renderer registry: `(schema, meta) -> priority`, highest score wins | Requires separate UI schema; forms only |
| **AutoForm** | Zero-config `ZodProvider(schema)` -> shadcn/ui forms via React Hook Form | SchemaProvider abstraction; best existing Zod-to-shadcn bridge | No inference layers, no collections, no CRUD lifecycle |
| **Uniforms** | Schema-agnostic bridge adapters (7-method contract); works with JSON Schema, GraphQL, SimpleSchema | Bridge abstraction pattern -- schema source is pluggable | Forms only, no operation awareness |
| **Formily** | Alibaba ecosystem; reactive engine with inter-field dependencies, visual designer; 12.4K stars | Reactive model for dynamic field relationships | Chinese-ecosystem docs, forms only |

Key pattern: JSON Forms' tester registry is the most extensible renderer-agnostic
dispatch mechanism. AutoForm is the closest Zod-to-shadcn bridge. zodal composes
these insights rather than replacing either library.

---

## Table / Grid Libraries

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **TanStack Table** | Headless table engine; column defs with `enableSorting`, `enableFiltering`, `filterFn`; extensible `meta` via TS declaration merging; 26K stars | Column def model, row pipeline, `meta` escape hatch, manual sort/filter/pagination modes | No schema awareness -- column defs are hand-written, not inferred |
| **AG Grid** | Enterprise grid with built-in cell editing, batch editing, export; 15.1K stars | Feature completeness benchmark | Monolithic rendering, not headless, not schema-driven, $999/dev/year for enterprise features |

---

## CRUD Frameworks

CRUD frameworks have the richest operation models but are imperative (JSX/hooks),
not schema-driven. Their DataProvider contracts are worth studying as interface shapes.

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **react-admin** | Full-stack CRUD with 9-method DataProvider (`getList`, `getOne`, `create`, `update`, `delete`, etc.); 45+ community adapters; 26.4K stars | DataProvider shape, resource abstraction | Component-driven not schema-driven; `filter: any` (untyped); MUI-coupled (shadcn kit emerging) |
| **Refine** | Headless CRUD; resources as config objects; hooks (`useTable`, `useForm`, `useCreate`); 28K stars | `CrudOperators` union type, structured filters, headless architecture | No schema-driven inference -- you still build page components manually |
| **API Platform Admin** | One-line Hydra/OpenAPI introspection -> complete CRUD UI; closest to the ideal | Proves hypermedia affordance declarations can drive full UI generation | Requires Hydra-compliant backend; React Admin-coupled |

---

## Schema and Validation

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **Zod v4** | Schema + `.meta()` + registries + `z.toJSONSchema()`; core substrate for zodal | Everything -- metadata carrier, type inference, JSON Schema interop | No UI awareness (that is zodal's job) |
| **io-ts** | Codec-as-value: decoder/encoder separation with algebraic laws | Codec laws, clean decoder/encoder split | fp-ts dependency, smaller ecosystem |
| **Effect Schema** | Standalone transformations with bidirectional codecs | Transform pipeline model | Complexity ceiling, smaller community |

---

## State Management

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **Zustand** | Minimal store with middleware composition; Immer middleware built-in | Middleware pattern, `StoreApi`, auto-generating-selectors pattern | No collection awareness |
| **Jotai** | Atomic, bottom-up state; derived atoms | Derived atoms for field-level reactive state | Different mental model than store-based |
| **TanStack Query** | Server state caching, background refetch, optimistic updates | Query key system, invalidation patterns, infinite queries | Fetching only, no local collection state |
| **TanStack DB** | Typed collections, live queries, differential dataflow, optimistic mutations | Collection-as-first-class-concept, live query model | Very new, API unstable |

---

## Storage / Data Access

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **Dexie** | IndexedDB wrapper with index-awareness and typed tables | Index-based query model, `BulkError` handling | Browser only |
| **Supabase** | PostgREST wrapper with chainable filter builder | `{data, error}` pattern, composable `.eq()/.gte()/.in()` filters | Server-coupled |
| **Prisma** | Generated ORM with per-type filter operators (`where`, `orderBy`, `select`) | Typed filter/sort operator model | Relies on code generation |
| **Drizzle** | TS-native ORM; schema defined in TS, `drizzle-zod` bridge exists | Schema-to-Zod bridge pattern, `customType` extension point | Server-side only |

---

## UI Generation

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **json-render** | Vercel Labs; `defineCatalog()` with Zod-validated component props + named actions; `defineRegistry()` maps to React; `@json-render/shadcn` with 36+ components | Catalog/registry duality, `toPrompt()` for AI, action schemas with parameter validation | Static `Table` (columns + rows, no sort/filter), top-down composition (AI picks components) |
| **Metawidget** | 5-stage pipeline: inspect -> widget build -> layout -> render; inspects both properties AND `@Action`-annotated methods | Pipeline decomposition, method-to-button generation | XML-centric, Java-only, no collections, abandoned |

---

## Standards and Protocols

These standards model capability and operation declarations at the API level.
OData Capabilities is the most granular per-field model; Hydra is the richest
resource-level operation vocabulary. Neither has JS/TS-native tooling.

| Standard | What It Does | What zodal Takes | What It Lacks |
|----------|-------------|-------------------|---------------|
| **OData Capabilities** | Per-field `FilterRestrictions`, `SortRestrictions`, `InsertRestrictions`, etc. (OASIS standard) | Two-level declaration model (field-level + entity-set-level); most granular REST capability schema | Enterprise-heavy XML, no JS/TS tooling |
| **Hydra Core** | `supportedOperation` + `supportedProperty` on JSON-LD resources | Resource-level operation model with expected/returned types | Limited adoption outside academic/API-Platform |
| **Siren** | Entity + typed `actions` (name, method, href, fields) -- HTML forms in JSON | Action with field schemas; closest HTTP standard to operation schemas | Niche adoption |
| **Schema.org Actions** | `potentialAction` on any `Thing` with `EntryPoint` and input constraints | Most widely deployed operation vocabulary | Too generic for UI generation |
| **W3C MBUI / Cameleon** | 4-layer model: Task -> Abstract UI -> Concrete UI -> Final UI | Academic grounding for abstraction layers | Not practical for direct implementation |

---

## Python Ecosystem (zodal's sibling context)

| Tool | What It Does | What zodal Takes | What It Lacks |
|------|-------------|-------------------|---------------|
| **dol** | Mapping-based storage abstraction; `wrap_kvs` codec pattern; composable layers | Codec wrapping, key/value transformation pipelines | Sync-only, no query/filter model |
| **meshed** | DAG composition from function signatures | Topology-as-SSOT principle | Python-only |
| **qh** | Function <-> webservice bidirectional mapping | Schema pipeline from function signatures to HTTP and back | Python-only |

---

## Headless CMS Platforms (Honorable Mentions)

**Payload CMS** (38K stars), **Directus** (29K stars), **Strapi** (70K stars), and
**KeystoneJS** (9K stars) all achieve schema-to-admin-UI generation in practice.
Payload's TypeScript collection config with fields, validation, conditional logic,
access control, hooks, and admin display hints is the closest production example of
the full vision. However, all are platform-locked -- their schemas are proprietary
and cannot be consumed by arbitrary renderers.

---

## The Gap

No JS/TS tool unifies these four concerns into a single declaration:

1. **Data shape** -- what fields exist, what types they have (Zod handles this)
2. **Field-level affordances** -- which fields are sortable, filterable, searchable, editable (OData models this, but no JS/TS library consumes it)
3. **Collection-level operations** -- create, bulk delete, export, search (CRUD frameworks have these, but imperatively)
4. **Backend capabilities** -- which operations the server actually supports (Hydra/Siren declare this, but nothing bridges to UI)

zodal's thesis: a thin layer (~500-1000 lines) on Zod v4 `.meta()` that carries
affordance declarations and produces configuration objects for existing renderers
(TanStack Table column defs, AutoForm field configs, Zustand store slices) bridges
the entire gap without building a monolithic framework.

---

## Key Architectural Patterns Worth Adopting

- **Tester-based renderer registry** (JSON Forms): `(schema, metadata) -> priority`
  dispatch lets renderers be swapped without touching schema definitions.
- **DataProvider contract** (react-admin/Refine): normalized 9-method interface
  (`getList`, `getOne`, `create`, `update`, `delete`, etc.) with sort/filter/pagination
  params -- proven across 45+ backend adapters.
- **Column `meta` declaration merging** (TanStack Table): extend third-party type
  systems with affordance metadata via `declare module`.
- **Headless + registry** (Radix, TanStack, AutoForm): separate logic from rendering,
  let consumers bring their own component library.
- **Convention over configuration** (OData): fields default to maximum capabilities;
  declare restrictions, not permissions.

---

## Source

Full landscape analysis with 87 references:
`schema_affordance_ui_report.md` in the research corpus.
