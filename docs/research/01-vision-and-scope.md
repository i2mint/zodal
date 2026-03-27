# Vision and Scope

## The Problem

Every application that manages collections -- projects, users, datasets, bookmarks --
reimplements the same operations (list, filter, sort, CRUD, export, bulk-select) at
every layer: backend repository, API routes, frontend table/form/state.

The cost is not just boilerplate; it is **drift**. Backend capabilities and frontend
affordances fall out of sync. Adding an operation means touching repository code, API
routes, state management, and UI components. Adding a new collection type means
copy-pasting all of the above.

**N collection types x M operations x 3 layers = combinatorial explosion + drift.**

## The Thesis

**Declare once, render anywhere.**

Describe a collection *once* -- its data shape (Zod schema), field-level capabilities
(sortable, filterable, editable), collection-level operations (create, bulk delete,
export), and access constraints -- and let infrastructure generate the appropriate
interface at every layer.

The schema is the **single source of truth**. A bare `z.object(...)` with no
annotations already produces a working table with sensible defaults inferred from
types: strings get text search, enums get select filters, numbers get range filters,
dates get date pickers. Explicit `.meta({...})` annotations override or extend those
conventions.

The progression is: **hand-written code -> configuration -> convention**. Each step
is available; zodal rewards staying declarative with maximum reuse, consistency, and
portability across layers and rendering targets.

## Package Architecture

```
@zodal/core     Schema types, affordance taxonomy, inference engine, codecs
@zodal/store    DataProvider interface, concrete adapters (REST, IndexedDB, tRPC, S3-via-dol)
@zodal/ui       Generators (toColumnDefs, toFormConfig, ...), state management, hooks
@zodal/ui-shadcn  Concrete shadcn/ui renderer (later phase)
```

**Dependency rule:** `core <- store`, `core <- ui`. Never `ui <-> store`.

`core` is roughly 500-1000 lines of TypeScript that reads Zod schemas and produces
configuration objects for existing renderers. It does not own the table, form, state
store, or data fetcher -- it *configures* them.

A tester-based renderer registry (inspired by JSON Forms) maps schema types plus
affordance metadata to concrete components. shadcn/ui is the default target, but the
registry is swappable for MUI, Ant Design, a CLI, or an LLM tool-calling description.

## What zodal Is NOT

- **Not a framework.** Thin glue that configures existing tools (TanStack Table,
  Zustand, AutoForm, etc.). Every default can be overridden at the field, collection,
  view, or render level.
- **Not a component library.** Headless: produces configuration objects, not DOM
  nodes. Renderers are pluggable.
- **Not a form builder.** Forms are one output among many (tables, stores, API
  routes, CLI descriptions). The focus is the schema contract, not any single
  rendering target.
- **Not backend-only or frontend-only.** The same schema drives UI column definitions
  *and* backend repository interfaces with typed query objects for
  filter/sort/pagination.

## Relationship to zod-collections-ui

`zod-collections-ui` is the working predecessor. It contains the core inference
engine, early affordance types, and proof-of-concept generators (column defs, form
configs, Zustand slices). zodal absorbs that code and reorganizes it into a monorepo
with clearer package boundaries (`core`, `store`, `ui`), a richer affordance
taxonomy, and a backend/resource layer that `zod-collections-ui` did not address.

Predecessor source: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`

## Beyond Collections

Collections (sets of items with CRUD and query operations) are the first concrete use
case, but the affordance-schema pattern generalizes:

- **Form affordances** -- validation, conditional visibility, widget selection.
- **Dataflow affordances** -- meshed-style DAGs with typed ports and composable
  execution strategies. A DAG topology is the SSOT; execution, introspection, and
  rendering are all derived from it.
- **Navigation affordances** -- routes, breadcrumbs, deep links.

Each pattern gets its own schema vocabulary, inference engine, and renderer set, but
all share the same architectural skeleton: declare structure and capabilities, infer
defaults from types, generate config for existing tools, provide escape hatches.

## Design Lineage

zodal inherits design principles from two Python projects:

- **dol** -- wraps any storage backend behind a `Mapping` interface with composable
  layers (key transforms, value serialization, caching). zodal applies the same
  pattern full-stack: declare shape and capabilities, stack layers, swap any layer
  independently.
- **meshed** -- declares function-composition DAGs as topology; execution and
  rendering derive from that topology. This informs the "dataflow affordances" track.

## Source Material

- Vision document: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/zodal_vision.md`
- Research corpus: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/`
- Predecessor code: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`
