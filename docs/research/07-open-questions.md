# Open Questions -- Unresolved Design Decisions

## Purpose

This document catalogs decisions that have **not** been settled. Design-phase agents must check this before assuming anything is decided. When a question is resolved during design, move it to a "Resolved" section at the bottom with its rationale and date.

---

## Package & Project Structure

### Monorepo tooling
**Question:** Which monorepo tool should zodal use -- pnpm workspaces, Turborepo, Nx, or something lighter?
- **pnpm workspaces:** Minimal overhead, well-understood, no build orchestration magic. Sufficient if the package count stays small.
- **Turborepo:** Adds caching and task graph on top of pnpm workspaces. Worth it if CI times matter early.
- **Nx:** Most powerful but heaviest; better suited for large orgs with many packages.
- **Discussed in:** 03-technology-research-takeaways.md (source report index), 05-architecture-and-patterns.md

### Package granularity
**Question:** Is `@zodal/store` a separate package from `@zodal/core`, or are they merged?
- **Separate:** Keeps the headless inference engine independent of any state management choice. Users who only need `defineCollection()` and `toColumnDefs()` don't pull in Zustand/Immer.
- **Merged:** Fewer packages to maintain, simpler dependency graph, one install for the common case.
- **Discussed in:** 05-architecture-and-patterns.md, roadmap.md (headless vs. batteries-included)

### Build system
**Question:** tsc only, tsup, or Vite library mode?
- **tsc:** Simplest, no bundler config, produces declaration files natively. Sufficient for a library.
- **tsup:** Zero-config bundler wrapping esbuild; produces CJS + ESM + .d.ts in one command.
- **Vite library mode:** Already used in the demo app, so familiar. But adds Rollup complexity.
- **Discussed in:** 03-technology-research-takeaways.md (source report index)

---

## Schema & Metadata

### Zod v4 only, or schema-agnostic bridge?
**Question:** Should zodal target Zod v4 exclusively, or provide a Uniforms-style bridge that could accept other schema sources?
- **Zod v4 only:** Simpler implementation, full access to `.meta()`, `.register()`, `z.codec()`. The entire inference engine can assume Zod internals.
- **Schema-agnostic bridge:** Broader adoption (JSON Schema users, io-ts users, etc.). But the Uniforms research shows this adds a translation layer that dilutes type safety.
- **Discussed in:** reference_notes.md (Section 11, Q1), 03-technology-research-takeaways.md (Uniforms report, Zod v4 metadata report)

### Metadata survival across schema transforms
**Question:** How should zodal handle `.meta()` not surviving `.optional()`, `.array()`, and other Zod transforms?
- **Enforce "meta last" convention:** Document that `.meta()` must be the final call. Simple but fragile; users will forget.
- **Custom registry with `.register()`:** Decouple metadata from the schema instance. More robust but requires explicit registration.
- **Hybrid (Strategy 4):** Read `.meta()` where present, fall back to inference, allow explicit overrides via `defineCollection()` config. Currently the recommended path, but implementation details are unresolved.
- **Discussed in:** reference_notes.md (Section 2.2), 03-technology-research-takeaways.md (Tension 3: .meta() vs. separate config)

### Affordance registry scope
**Question:** Should the renderer registry be global, per-collection, or user-supplied?
- **Global:** Simplest; one `registerRenderer()` call applies everywhere. Risk: two libraries conflict.
- **Per-collection:** Each `defineCollection()` can carry its own renderer overrides. More isolated but more verbose.
- **User-supplied (DI):** Pass a registry instance to the generator functions. Most flexible, avoids global mutable state (superjson's footgun).
- **Discussed in:** reference_notes.md (Section 1.2, JSON Forms tester pattern), 03-technology-research-takeaways.md (superjson warning in Tension 5)

### Inclusion vs. exclusion defaults
**Question:** Should all affordances be enabled by default (OData-style exclusion model) or disabled by default (opt-in)?
- **Exclusion (everything on):** Matches OData convention. Zero-config collections are immediately interactive. Risk: exposing capabilities users didn't intend (e.g., editable fields that shouldn't be).
- **Inclusion (opt-in):** Safer, no surprises. But defeats the "zero-config magic" value proposition.
- **Middle ground:** Read-only affordances (sortable, filterable, searchable) on by default; write affordances (editable, inlineEditable) off by default.
- **Discussed in:** reference_notes.md (Section 1.3, Section 11 Q2), 03-technology-research-takeaways.md (OData capabilities)

---

## State Management

### Pure functions vs. Zustand vs. Jotai
**Question:** What is the primary state management paradigm for zodal's store layer?
- **Pure functions (current zod-collection-ui approach):** `(state, args) => newState`. Maximally portable, no framework dependency. But verbose to wire into React.
- **Zustand:** Mature middleware ecosystem (persist, immer, devtools), slice pattern maps well to collections. Single-store model is simple.
- **Jotai:** Finer-grained reactivity via per-atom subscriptions. `splitAtom` is ideal for per-item updates. Derived atom DAGs suit the filter->sort->paginate pipeline.
- **Combine both (research recommendation):** Zustand for mutation pipeline, Jotai for derived state. Increases complexity.
- **Discussed in:** roadmap.md (Design Tensions: state management), 03-technology-research-takeaways.md (Tension 2: Zustand vs. Jotai), reference_notes.md (Section 9)

### Server state integration
**Question:** Where does server state live? Is TanStack Query a required peer dependency or optional?
- **Required:** Standardizes cache invalidation, optimistic updates, and background refetching. Most real-world apps already use it.
- **Optional:** Keeps the core library lighter. Users can bring their own data-fetching strategy.
- **Discussed in:** 03-technology-research-takeaways.md (State Management report, TanStack Query)

### TanStack DB adoption
**Question:** Should zodal build on TanStack DB's differential dataflow engine or build its own collection primitive?
- **Adopt:** Leverages TanStack DB's typed collections, live queries, and optimistic mutations. Avoids reinventing the wheel.
- **Build independently:** TanStack DB is very new, React-specific, tightly coupled to TanStack Query, and lacks affordance concepts. zodal maintains full control.
- **Watch and wait (current lean):** zodal's differentiator is the affordance layer, not the collection primitive. Adopt later if TanStack DB matures and becomes framework-agnostic.
- **Discussed in:** 03-technology-research-takeaways.md (Tension 6: TanStack DB as ally or competitor)

---

## Data Provider

### Method count and shape
**Question:** How many methods should zodal's DataProvider interface expose -- 6 (current), 9 (react-admin), or Refine's resource-based approach?
- **6 methods (current):** `getList`, `getOne`, `create`, `update`, `delete`, `deleteMany`. Simpler to implement adapters.
- **9 methods (react-admin):** Adds `getMany`, `getManyReference`, `updateMany`. Covers relational use cases but increases adapter burden.
- **Refine's approach:** Resource config objects with hooks. More opinionated but enables tighter framework integration.
- **Discussed in:** reference_notes.md (Section 1.5), 03-technology-research-takeaways.md (DataProvider report)

### Filter operator vocabulary
**Question:** What filter operators should zodal's query language support?
- **Refine's CrudOperators:** 20+ operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `ncontains`, etc.). Comprehensive but heavy.
- **Prisma-style object filters:** `{ age: { gte: 18 } }`. Type-safe, serializable, UI-renderable.
- **Drizzle-style function filters:** `gt(users.age, 18)`. Composable, SQL-close. Better for adapter internals than public API.
- **Discussed in:** 03-technology-research-takeaways.md (Tension 1: object-style vs. function-style filters, Type-safe query builders report)

### Capability discovery
**Question:** How does a backend communicate what operations and filters it supports?
- **Static declaration:** The DataProvider constructor accepts a capabilities object (`{ canSort: true, canFilterByRange: ['age', 'price'] }`).
- **Runtime introspection:** The provider exposes a `getCapabilities()` method. More dynamic but harder to type.
- **Convention-based:** If the provider implements `getMany`, it supports batch fetching. Presence of the method implies the capability.
- **Discussed in:** reference_notes.md (Section 4.2, Hydra supportedOperation), 03-technology-research-takeaways.md (DataProvider report)

---

## Rendering

### Renderer registry: ranked testers vs. type-to-component map
**Question:** Should zodal use JSON Forms-style scored testers or a simpler string-keyed dispatch?
- **Ranked testers:** `(schema, meta) => priority`. Most flexible; custom renderers override defaults by returning higher scores. But harder to debug -- users can't predict which component will render.
- **String-keyed map:** `{ string: TextInput, number: NumberInput, enum: Select }`. Simple, predictable, easy to override. But limited expressiveness (can't dispatch on metadata combinations).
- **Both (current lean):** Ranked testers internally, with string-keyed shortcuts (`editWidget: 'date-range'`). Built-in `explain()` for debugging.
- **Discussed in:** reference_notes.md (Section 1.2), 03-technology-research-takeaways.md (Tension 4: ranked testers vs. string-keyed dispatch)

### When to extract React components into @zodal/ui-shadcn
**Question:** At what maturity point should the demo app's components become a published package?
- **Early (now):** Gives adopters a working starting point. Risk: premature API lock-in.
- **After v0.2 (later):** Let the demo stabilize through inline editing, operations, and saved views before extracting.
- **Never (copy-paste pattern):** Document the pattern, let users copy what they need. Avoids maintenance burden.
- **Discussed in:** roadmap.md (Near-term item 1, Design Tensions: headless vs. batteries-included), 03-technology-research-takeaways.md (Tension 7)

### Non-React target support
**Question:** Should zodal support Vue, Svelte, CLI rendering, or LLM tool descriptions?
- **React only for v1:** Focus resources. The headless core is framework-agnostic; React is just the first renderer.
- **Multi-framework from the start:** Designing for multiple targets forces cleaner separation. Vue and Svelte adapters prove the headless architecture works.
- **LLM tool descriptions (already started):** `toPrompt()` exists in the current codebase. This is the easiest non-React target to maintain.
- **Discussed in:** roadmap.md (Long-term item 17: AI agent integration), reference_notes.md (Section 5.1)

---

## Inference Engine

### Convention depth: how aggressive should name heuristics be?
**Question:** Should field name "password" auto-infer a password widget? What about "email", "description", "avatar"?
- **Aggressive:** Maximum zero-config magic. `DESCRIPTION_PATTERNS` hides long-text fields from tables, `EMAIL_PATTERNS` infers email validation. Users love it when it guesses right, hate it when it guesses wrong.
- **Conservative:** Only infer from Zod types, not names. Explicit is better than implicit. But this weakens the zero-config story.
- **Aggressive with explain():** Keep heuristics aggressive but provide `collection.explain('fieldName')` so users can understand and override any inference decision.
- **Discussed in:** roadmap.md (Design Tensions: convention depth vs. explicit config), reference_notes.md (Section 11 Q6)

### Inference debugging API
**Question:** Should there be a formal `explain()` API that traces how each affordance was inferred?
- **Yes:** Essential for trust. Users need to understand why a field was hidden or marked non-sortable. JSON Forms has no equivalent, and debugging is painful.
- **Debug mode only:** `defineCollection(schema, { debug: true })` logs decisions to console. Lighter than a full API.
- **Discussed in:** roadmap.md (Design Tensions: convention depth), 03-technology-research-takeaways.md (Tension 4, explain() mention)

---

## Forms & Editing

### Form validation: Zod-native or form-library-native?
**Question:** Should form validation use the original Zod schema via `zodResolver()` or extracted rules in `FormFieldConfig`?
- **Zod-native (`zodResolver`):** Single source of truth. Rich validation (min/max, regex, email) without manual extraction. Works with react-hook-form.
- **Extracted rules in FormFieldConfig:** Renderer-agnostic. Any form library can consume the config. But risks drift between schema and extracted rules.
- **Both (current lean):** Schema available on `collection.schema` for native validation. `FormFieldConfig` carries display-level hints. Renderers choose.
- **Discussed in:** roadmap.md (Design Tensions: form validation)

### Inline editing architecture
**Question:** Should inline editing be cell-level, row-level, or both?
- **Cell-level:** Click a cell, edit in place. Most intuitive for spreadsheet-like UIs. Complex: each cell needs its own edit state.
- **Row-level:** Click an edit button, entire row becomes editable. Simpler state management. Less fluid UX.
- **Both:** Let the affordance schema declare per-field `inlineEditable` (cell) vs. per-collection `rowEditable`. More API surface.
- **Discussed in:** roadmap.md (Near-term item 2: inline editing)

### Create vs. edit schema differences
**Question:** How should zodal handle fields that are required-on-read but optional-on-create (e.g., `id`, `createdAt`)?
- **Separate schemas:** `createSchema` and `editSchema` as distinct Zod objects. Explicit but verbose.
- **Schema transforms:** Derive `createSchema` from the base schema via `.omit({ id: true }).partial({ createdAt: true })`. DRY but fragile if metadata is lost during transforms.
- **Metadata-driven:** Mark fields with `{ createMode: 'hidden' | 'optional' | 'required' }` in `.meta()`. The form generator reads these hints.
- **Discussed in:** reference_notes.md (Section 4.2, Hydra readable/writable/required model)

---

## Codec / Transform Layer

### How much of dol's wrap_kvs to port to TypeScript?
**Question:** Should zodal port dol's full codec composition model or build a simpler alternative?
- **Full port:** `wrapKvs(store, keyCodec, valueCodec)` is powerful and proven. Composable codecs for JSON, gzip, validation, path prefixing.
- **Simplified version:** Port the concept (key transforms + value transforms as composable functions) without the full Python class hierarchy.
- **Zod v4 codecs only:** Use `z.codec()` for field-level transforms and skip store-level wrapping for v1.
- **Discussed in:** 03-technology-research-takeaways.md (Tension 5: Zod v4 codecs vs. zodal's own codec model, dol report)

### Key transforms vs. value transforms: separate or unified?
**Question:** Should key codecs and value codecs be separate composable units or a single transform?
- **Separate (dol model):** `KeyCodec` and `ValueCodec` as distinct types. Clear separation of concerns. Key transforms affect routing/paths; value transforms affect serialization.
- **Unified:** A single `Codec<In, Out>` that handles both. Simpler API but loses the semantic distinction.
- **Discussed in:** 03-technology-research-takeaways.md (dol report, Codec-Transform report)

### Should codecs be part of @zodal/core or @zodal/store?
**Question:** Where does the codec layer live in the package hierarchy?
- **@zodal/core:** Codecs are schema-adjacent (field-level transforms derive from Zod types). Keeps core self-contained.
- **@zodal/store:** Codecs are transport-adjacent (they wrap data providers). Keeps core minimal.
- **Discussed in:** 03-technology-research-takeaways.md (Codec-Transform report, dol report)

---

## Operations & Commands

### Serializable command objects vs. callback functions
**Question:** Should operations be represented as serializable command objects (Command Pattern) or plain callback functions?
- **Command objects:** `{ type: 'archive', itemIds: ['a', 'b'] }`. Serializable, replayable, loggable. Enables undo/redo and audit trails. Heavier API.
- **Callbacks:** `(itemId, event) => void`. Simpler, familiar React pattern. But not serializable, not replayable.
- **Hybrid:** Declare operations as typed command objects in the schema; the runtime dispatches to callbacks. Best of both but more plumbing.
- **Discussed in:** reference_notes.md (Section 10, CollectionItemAction), 03-technology-research-takeaways.md (json-render action schemas)

### Undo/redo support
**Question:** Should zodal support undo/redo, and if so, how?
- **Immer patches:** Zustand + Immer can produce JSON patches for every mutation. Replay in reverse for undo. Low-overhead if already using Immer.
- **Command history:** Maintain a stack of command objects. More semantic (undo "archive" vs. undo "set field X"). Requires the Command Pattern decision above.
- **Not initially:** Defer to post-v1. Undo/redo is complex and rarely the deciding adoption factor.
- **Discussed in:** 03-technology-research-takeaways.md (Zustand & Immer report, Immer patches)

### Custom domain actions and DataProvider integration
**Question:** How do custom actions (e.g., "approve order", "send invoice") integrate with the DataProvider?
- **Extend DataProvider:** Add a generic `execute(resource, { action, params })` method. Keeps all server communication in one interface.
- **Separate ActionProvider:** A parallel interface for non-CRUD operations. Cleaner separation but more interfaces to implement.
- **Discussed in:** reference_notes.md (Section 4.3, Siren action model), 03-technology-research-takeaways.md (json-render action schemas)

---

## Future Scope

### defineFunction() and DAG composition
**Question:** When should zodal introduce meshed-style function composition (`defineFunction()` for building data pipelines)?
- **v1 scope:** If zodal aims to be a full data-interaction toolkit, function composition is core. But it risks scope creep.
- **Post-v1:** Focus v1 on collections. Add function composition when the collection layer is stable and real users request it.
- **Discussed in:** 01-vision-and-scope.md

### Navigation affordances
**Question:** Are navigation affordances (links between collections, drill-down, breadcrumbs) in scope for v1?
- **Yes:** Real apps have related collections (orders -> order items, users -> posts). Without navigation, zodal is limited to isolated tables.
- **No:** Navigation implies routing, which implies framework opinions. Keep v1 focused on single-collection interactions.
- **Discussed in:** roadmap.md (Long-term item 16: zod-affordances umbrella)

### Real-time / subscription support
**Question:** Does the architecture need to account for real-time data early, or is this deferrable?
- **Early:** WebSocket/SSE support affects DataProvider design (need a `subscribe()` method). Retrofitting is painful.
- **Deferrable:** The DataProvider interface can be extended later. Optimistic updates via Immer patches are a stepping stone.
- **Discussed in:** roadmap.md (Long-term item 15: real-time and optimistic updates), 03-technology-research-takeaways.md (State Management report)

---

## Cross-Cutting Concerns

### Server-side vs. client-side operation declaration
**Question:** How does zodal declare that filtering should happen server-side for field X but client-side for field Y?
- **Per-field metadata:** `{ filterable: 'server' | 'client' | true }`. Explicit but adds another dimension to the affordance vocabulary.
- **Provider-level declaration:** The DataProvider declares which operations it handles; everything else falls to the client.
- **Discussed in:** reference_notes.md (Section 11 Q3), 03-technology-research-takeaways.md (TanStack Table manual mode)

### Composition API surface
**Question:** Is the primary API `defineCollection(schema, affordances)`, `schema.meta({ affordances })`, or both?
- **`defineCollection()` only:** Single entry point, full control, no metadata-loss footguns.
- **`.meta()` only:** More Zod-idiomatic, co-located with schema definition. But fragile (metadata loss on transforms).
- **Both (hybrid):** `.meta()` for co-located hints, `defineCollection()` for overrides and aggregation. Current lean, but the precedence rules need specification.
- **Discussed in:** reference_notes.md (Section 11 Q6), 03-technology-research-takeaways.md (Tension 3)

### Escape hatches for auto-generated UI
**Question:** How does a developer override the auto-generated UI for one specific field without ejecting from the system?
- **Per-field component override:** `defineCollection(schema, { fields: { avatar: { component: AvatarUploader } } })`. Direct but couples the schema to React.
- **Renderer registry override:** Register a higher-priority tester that matches the specific field. Decoupled but indirect.
- **Slot pattern:** The generated UI exposes named slots (`renderCell`, `renderFilter`, `renderFormField`) that accept component overrides.
- **Discussed in:** reference_notes.md (Section 11 Q7), 03-technology-research-takeaways.md (MBUID failure modes: insufficient escape hatches)
