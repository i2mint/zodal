# Technology Research Takeaways for zodal

## How to Use This Document

This document distills the key findings from 16 research reports covering technologies, patterns, and libraries relevant to zodal's architecture. Read this document BEFORE any design work on zodal's core, UI, or store layers. The first section identifies cross-cutting themes that appear across multiple reports, synthesizing them into actionable architectural principles. The second section provides verbatim "What zodal Should Steal" and "What zodal Should Avoid" excerpts from each report, grouped by domain, with source file references. Each section names its source file so you can drill into the full report for code examples and detailed analysis.

## Source Report Index

All source files are located in the research corpus at `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/`. The path `zodal_research/[filename]` below is relative to that corpus root. From the zodal project root, these are accessible via the symlink alias `docs/local/zodal_docs__alias`.

| Report Title | Topic | Source File |
|---|---|---|
| TanStack Table v8 | Headless table engine, column defs, plugin architecture | `zodal_research/TanStack Table v8 column definitions and plugin architecture.md` |
| AutoForm | Schema-to-widget mapping, SchemaProvider, fieldConfig | `zodal_research/AutoForm schema-to-widget mapping and limitations.md` |
| json-render (Vercel Labs) | AI-driven generative UI, catalog/registry, Zod-native actions | `zodal_research/json-render (Vercel Labs) component catalog and Zod-native action schemas.md` |
| Metawidget | Five-stage UI generation pipeline, pluggable architecture | `zodal_research/Metawidget's pluggable pipeline architecture for UI generation.md` |
| Zod v4 metadata | Registries, `.meta()`, metadata-loss footgun, codecs | `zodal_research/Zod v4 metadata API and schema preservation.md` |
| Codec-Transform Systems | io-ts, effect/Schema, superjson, zod-to-json-schema, Zod 4 codecs | `zodal_research/Codec-Transform Systems Compared - io-ts, effect:Schema, superjson, zod-to-json-schema.md` |
| Uniforms | Schema-agnostic bridge, 8-method contract, ComponentDetector | `zodal_research/Uniforms schema-agnostic bridge architecture.md` |
| JSON Forms (EclipseSource) | Tester/renderer registry, ranked dispatch, composable predicates | `zodal_research/JSON Forms (EclipseSource) - Tester:Renderer Registry Architecture.md` |
| Zustand & Immer | Vanilla-first store, middleware composition, Immer patches | `zodal_research/Zustand & Immer.md` |
| State Management | Zustand, Jotai, TanStack Store, TanStack Query, TanStack DB | `zodal_research/State Management for Collection UIs - Zustand, Jotai, TanStack Store, and TanStack Query.md` |
| DataProvider (react-admin vs Refine) | CRUD interface design, filters, pagination, capability discovery | `zodal_research/DataProvider Interfaces - react-admin vs. Refine.md` |
| Storage adapters | Dexie, localForage, Supabase JS client | `zodal_research/Storage adapter API comparison - Dexie, localForage, Supabase.md` |
| Type-safe query builders | Prisma, Drizzle ORM, schema-to-query type safety | `zodal_research/Type-safe query builders in Prisma and Drizzle.md` |
| dol ideas for zodal | wrap_kvs, Codec composition, KvStore-to-DataProvider bridge | `zodal_research/dol_ideas_for_zodal.md` |
| SQLRooms and zodal | Slice composition, config/runtime split, DuckDB-WASM | `zodal_research/sqlrooms_and_zodal.md` |
| Cosmograph and zodal | Column+Strategy+Fn triple, auto-strategy resolution, data prep | `zodal_research/cosmograph and zodal.md` |

---

## Cross-Cutting Themes

### 1. Inference Engine Pattern

The inference engine -- where zodal automatically determines UI affordances from schema information without explicit configuration -- is validated across nearly every report. **TanStack Table** uses `'auto'` for `filterFn` and `sortingFn`, inspecting the first row's value at runtime to select the right built-in. **AutoForm** maps Zod types to widget strings (`z.string()` -> `"string"` -> `<Input>`), but with only one layer (no name heuristics, no refinement inspection). **Metawidget**'s Inspector stage gathers metadata from heterogeneous back-end annotations (JPA, Hibernate, Bean Validation) and normalizes them into a flat attribute map. **Cosmograph** auto-selects a visual strategy when `pointColorStrategy` is `undefined` (numeric -> `continuous`, string -> `categorical`). **Uniforms** uses `getType()` returning JS constructors (`String`, `Number`, `Date`) to drive its `AutoField` component detector. **Prisma** generates per-type filter operator sets (`StringFilter`, `IntFilter`) from the schema.

zodal's 4-layer inference engine (Zod type -> refinements -> name heuristics -> `.meta()` overrides) is strictly more capable than any single system studied. The key takeaway: every system that attempts inference stops at one layer and forces manual overrides for the rest. zodal's multi-layer approach is a genuine differentiator. Reports: TanStack Table, AutoForm, Metawidget, Cosmograph, Uniforms, Prisma/Drizzle.

### 2. Codec/Transform Composition

Composable encode/decode transforms appear in **io-ts** (the `Type<A, O, I>` codec with explicit round-trip laws), **effect/Schema** (standalone `Transformation` objects, `Schema.compose` for chaining), **Zod v4** (`z.codec()` as a first-class bidirectional schema), **dol** (`wrap_kvs` with `key_of_id`/`id_of_key`/`obj_of_data`/`data_of_obj` and the `Codec.__add__` operator for pipeline composition), **superjson** (walk-and-tag auto-serialization), **Drizzle** (`customType` with `toDriver`/`fromDriver`), and **Zustand** (middleware wrapping `set`/`get`). The universal pattern is: a codec is a pair of functions (encode/decode) that can be composed into a pipeline. zodal should use Zod v4's `z.codec()` for field-level transforms, `composeCodecs()` for store-level layering, and the `wrapKvs` pattern (from dol) for provider wrapping. Reports: Codec-Transform Systems, dol, Zustand & Immer, Type-safe query builders.

### 3. Registry Pattern (Ranked Testers)

**JSON Forms** provides the definitive model: a flat list of `{ tester, renderer }` pairs where each tester is a `(uischema, schema, context) -> number` function. The renderer with the highest score wins. Composable predicates (`and`, `or`, `schemaTypeIs`, `scopeEndsWith`) target exactly the field you want. **Metawidget** uses `CompositeWidgetBuilder` with a first-match-wins pattern (specialized builders return a component or `null`, fallback handles the rest). **Uniforms** uses `createAutoField(componentDetector)` with React context override. **AutoForm** uses a simple string-keyed dispatch (`fieldType -> component`).

zodal should adopt JSON Forms' ranked tester pattern for renderer selection, enhanced with Zod-native predicates (`zodTypeIs`, `zodRefinementMatches`, `fieldNameEndsWith`, `metaMatches`). Named priority bands (`'default' | 'library' | 'app' | 'override'`) would improve on JSON Forms' raw numeric ranks. Reports: JSON Forms, Metawidget, Uniforms, AutoForm.

### 4. Bridge from Minimal to Rich

Multiple reports show the pattern of wrapping a minimal interface with progressive capability layers. **dol**'s `wrap_kvs` takes any KV store and adds typed transforms. **localForage**'s 8-method driver interface is the JS analog of Python's `MutableMapping` -- the simplest possible storage contract. **Dexie** adds indexed queries on top of IndexedDB's raw API. **Refine** makes batch operations optional with single-call fallbacks. The **dol report** explicitly describes a `kvStoreToDataProvider` bridge that adds client-side filtering/sorting over a minimal KV store.

zodal's adapter hierarchy should be layered: simplest possible KV contract (get/set/delete/keys) -> codec middleware (type safety, transforms) -> query middleware (client-side filtering/sorting/pagination for KV-only backends) -> rich adapters (native server-side operations). Reports: dol, Storage adapters, DataProvider, Refine.

### 5. Capability Discovery / Affordance Degradation

No existing system fully solves this, but several point the way. **Dexie** distinguishes between `where()` (indexed, fast) and `filter()` (JS-level, O(n)). **Refine**'s `pagination.mode: "server" | "client" | "off"` explicitly declares where pagination happens. **TanStack Table**'s `manualSorting`/`manualFiltering`/`manualPagination` flags tell the table to skip client-side processing. **react-admin** and **Refine** both lack a real `getCapabilities()` method -- the DataProvider report explicitly calls this out as a gap zodal must fill. **Cosmograph** auto-selects strategies when unspecified but has no mechanism for the backend to report what it supports.

zodal's capability discovery should be granular: not just "supports filtering" but "supports indexed range filtering on fields X, Y" (Dexie) vs. "supports server-side filtering with operators eq, gt, lt, like" (Supabase) vs. "supports client-side filtering only" (localForage wrapper). Reports: Storage adapters, DataProvider, TanStack Table, Cosmograph.

### 6. Headless (Config, not DOM)

The headless-first principle is validated everywhere zodal looks. **TanStack Table** renders no DOM -- it produces row models and column APIs. **Metawidget**'s biggest limitation is that `buildWidget()` returns actual platform widgets, coupling the pipeline to the rendering target. **json-render** separates catalog (declaration) from registry (implementation). **Uniforms** separates Bridge (schema abstraction) from Theme (rendering). **Zustand**'s vanilla core is framework-agnostic; React is a thin wrapper.

zodal's headless approach -- returning config objects (`ColumnDef[]`, `FormFieldConfig[]`) instead of components -- is strictly better than DOM-returning pipelines. It enables multiple renderers, testing without a DOM, and server-side rendering. Reports: TanStack Table, Metawidget, json-render, Uniforms, Zustand & Immer.

### 7. Slice/Modular State Composition

**SQLRooms** builds on Zustand's slice pattern with curried factories: `createSqlEditorSlice(config)(set, get, store)`. **Zustand** itself documents the slices pattern (spread `StateCreator` functions). **Jotai** takes atomics further with `splitAtom` for per-item subscription and derived atom DAGs for the filter->sort->paginate pipeline. **TanStack DB** introduces normalized collections as the primitive with differential dataflow for live queries.

zodal should compose collection state as slices -- `createCollectionSlice(collectionDef)(set, get, store)` -- with each collection namespacing its state (`state.users.sorting`, `state.products.filters`). The config/runtime state split from SQLRooms (serializable config vs. transient runtime state) should be adopted. Reports: SQLRooms, Zustand & Immer, State Management.

### 8. Zod as Core Schema Substrate

**Zod v4** provides `.meta()` for typed metadata, `z.codec()` for bidirectional transforms, `z.toJSONSchema()` for schema emission, and registries for external metadata stores. **AutoForm** already builds on Zod (with the `superRefine` hack for v3, `.check()` for v4). **Drizzle** has native Zod integration via `drizzle-zod`. **Uniforms** has a Zod bridge. **json-render** uses Zod for component prop validation and action param schemas.

The critical finding from the Zod v4 metadata report: **metadata does not survive schema transforms**. `.optional()`, `.array()`, `.refine()` all return new instances that lose registry entries. zodal must adopt a hybrid strategy: use `.register()` with a custom `affordanceRegistry` on inner schemas (before wrapping), augment `GlobalMeta` for JSON Schema-compatible metadata, and keep an override config as an escape hatch. Reports: Zod v4 metadata, Codec-Transform Systems, AutoForm, Uniforms, Drizzle.

---

## Per-Report Takeaways

### Group A: Core Render Targets

---

#### TanStack Table v8

TanStack Table is zodal's primary render target for collection display. It is a headless, framework-agnostic table engine that produces row models and column APIs without rendering any DOM. The `meta` extension point on column definitions and the `enable*` boolean convention map directly to zodal's affordance system, while the row model pipeline (filter -> group -> sort -> expand -> paginate) provides the composable transform chain zodal needs.

**Source:** `zodal_research/TanStack Table v8 column definitions and plugin architecture.md`

**What zodal Should Steal:**

**3.1. The `meta` extension point for affordance injection.** zodal-ui's `toColumnDefs()` should populate `columnDef.meta` with the full resolved field affordance (widget type, filter variant, edit mode, validation rules, etc.). This is already the community-endorsed pattern -- there's no official "render hint" API because TanStack Table is headless, so `meta` is the sanctioned channel. zodal should **define a typed `ColumnMeta` interface** via declaration merging that carries all field-level affordances.

**3.2. The `defaultColumn` merge pattern.** TanStack Table's `defaultColumn` option (shallow-merged into every column def) is a clean parallel to zodal's inference layer. zodal should generate a `defaultColumn` from the inference engine that sets `enableSorting`, `enableColumnFilter`, `filterFn`, `sortingFn`, `size`, `meta`, etc. for every field based on Zod type, then let per-field overrides win.

**3.3. The `enable*` boolean convention.** Every feature uses a consistent `enableSorting`, `enableColumnFilter`, `enableGrouping`, etc. pattern at both the table level and the column level. zodal's affordance system should map directly: `sortable: true` -> `enableSorting: true`, `filterable: 'range'` -> `enableColumnFilter: true, filterFn: 'inNumberRange'`.

**3.4. Auto-inferred functions.** The `'auto'` value for `filterFn` and the auto-detected `sortingFn` (based on data type of the first row) are exactly zodal's inference philosophy. zodal should go further -- its inference has the Zod schema, so it can do this statically without needing runtime data inspection.

**3.5. The row model pipeline as a composable transform chain.** This is conceptually similar to dol's codec pipeline. Each transform takes rows in, produces rows out, and is opt-in. zodal's `createCollectionStore()` state management could mirror this pipeline structure for client-side data transformations.

**3.6. The `TableFeature` plugin architecture.** zodal-ui could define its own features (e.g., a `DensityFeature`, `InlineEditingFeature`) that plug into TanStack Table via the `_features` option. The interface is clean -- `getInitialState`, `getDefaultColumnDef`, `createColumn`, `createTable` is all you need.

**3.7. Manual/server-side mode flags.** `manualSorting`, `manualFiltering`, `manualPagination` -- when set, the table skips the corresponding row model and expects pre-processed data. zodal-store needs this exact pattern: when the DataProvider does server-side sorting, the UI should skip client-side sorting. The `manual*` booleans are zodal's capability handshake.

**What zodal Should Avoid:**

**4.1. The `meta` type being untyped `any` by default.** TanStack Table's `meta` is `unknown` and requires declaration merging to type. This works for end users but is awkward for library authors. zodal should generate column defs with a **strongly typed `meta`** that carries the full `ResolvedFieldAffordance` type, rather than relying on downstream consumers to augment the type.

**4.2. No built-in filter UI hints.** TanStack Table deliberately provides no mechanism for mapping a `filterFn` to a filter component -- the GitHub discussions show users repeatedly asking how to render filter UIs for different column types. The maintainer's response is "use `meta`." This is correct for a headless library, but zodal-ui must fill this gap. `toFilterConfig()` should produce explicit `{ type: 'range', min, max }` or `{ type: 'select', options: [...] }` objects, not leave it to the consumer to reverse-engineer from `filterFn`.

**4.3. The verbose boilerplate for a basic table.** Even a simple filtered + sorted table requires importing ~5 row models, wiring up state handlers, and manually rendering headers/cells. zodal's whole point is to eliminate this -- `toColumnDefs()` and `useCollection()` should produce a ready-to-use config from the schema.

**4.4. The all-features-loaded-by-default bundle.** The V9 roadmap acknowledges that all feature APIs are currently hardcoded into the core at 1-2kb each. zodal shouldn't couple to all features -- only import the row models needed based on the collection's declared affordances.

**4.5. Runtime data-type sniffing for auto filter/sort.** TanStack Table's `getAutoFilterFn()` inspects the first row's value at runtime. This is fragile (what if the first row has `null`?). zodal has the Zod schema -- it should resolve `filterFn` and `sortingFn` statically from the schema type, which is more reliable and available before any data loads.

---

#### AutoForm

AutoForm is a schema-driven form generation library that takes a Zod schema, parses it into an intermediate representation, and renders a complete form with validation, labels, and appropriate input widgets. It separates schema parsing (`SchemaProvider`) from rendering (`AutoFormFieldComponents` + `AutoFormUIComponents`), but its single-layer type-to-widget mapping has no inference beyond Zod type name.

**Source:** `zodal_research/AutoForm schema-to-widget mapping and limitations.md`

**What zodal Should Steal:**

**The SchemaProvider abstraction.** AutoForm's separation of `SchemaProvider` from the rendering layer is clean. zodal's `@zodal/core` should similarly define an interface that can be implemented for different schema libraries, though zodal's version will be richer (it needs to carry affordance metadata, not just field types). The three-method interface (`parseSchema`, `validateSchema`, `getDefaultValues`) is a good minimal contract.

**The `buildZodFieldConfig<FieldTypes, CustomData>()` pattern.** Making the `fieldConfig` function generic over the renderer's supported field types is a good TypeScript DX trick. zodal should adopt this so that when a user annotates `.meta({ editWidget: 'date-range' })`, TypeScript can verify `'date-range'` is a widget the current renderer supports.

**The `AutoFormFieldComponents` / `AutoFormUIComponents` split.** Separating "structural chrome" (form wrapper, field wrapper, error display, submit button) from "field-type renderers" (string, number, date, select) is the right decomposition. zodal-ui-shadcn should follow this exact split. The structural components are the same across all field types; the field components are what you swap per type.

**Validation refinements -> HTML attributes.** AutoForm automatically maps `z.string().min(8)` to `minlength="8"` on the input element. This is a small but excellent progressive enhancement. zodal's `toFormConfig()` generator should do the same -- walk Zod refinements and extract HTML5 constraint attributes where possible.

**The `fieldWrapper` per-field escape hatch.** Allowing a custom wrapper component per field (not just a custom field component) gives users a clean way to add adornments, custom layouts, or additional UI chrome without replacing the entire field renderer.

**What zodal Should Avoid:**

**The `superRefine()` hack for metadata.** Piggy-backing UI metadata on a validation refinement is clever but semantically wrong -- it conflates validation concerns with display concerns, and it means `fieldConfig` data must survive Zod's refinement pipeline. With Zod v4's `.meta()` API (and zodal's commitment to Zod-native metadata), zodal should never need this hack. All affordance metadata goes on `.meta()`, cleanly separated from validation.

**The flat type-string dispatch with no inference layers.** AutoForm's type -> widget mapping has exactly one layer: Zod type name -> component key. There's no name-heuristic inference (`email` -> email input, `password` -> password input, `url` -> URL input), no refinement-based inference (`.email()` refinement -> email widget), no pattern matching. zodal's 4-layer inference engine (Zod type -> refinements -> name heuristics -> `.meta()` overrides) is strictly more capable. AutoForm's approach forces users to manually configure common cases that should be automatic.

**No concept of "affordances" beyond widget type.** AutoForm's `fieldConfig` carries `description`, `inputProps`, `fieldType`, and `customData` -- but there's no notion of `sortable`, `filterable`, `editable: false`, `visible: false`, or any other collection-level affordance. It's purely a form generator with no awareness of the broader collection context. zodal should ensure that `toFormConfig()` consumes the *full* resolved affordance set, not just a widget-type override.

**No support for discriminated unions.** This is a fundamental gap for any schema-driven form library. Forms regularly need conditional sections: "if `type` is `'business'`, show `companyName` and `taxId`; if `type` is `'individual'`, show `ssn`." AutoForm simply punts on this. zodal needs to handle `z.discriminatedUnion()` by rendering the discriminator field as a select, then conditionally rendering the appropriate sub-form. This is complex but essential.

**Root schema must be `z.object()`.** Arrays at the root aren't supported, nested discriminated unions aren't supported, and the parser expects `ZodObject<any, any>`. zodal should accept any Zod type at the root and gracefully degrade (e.g., a root `z.string()` becomes a single input form, a root `z.array()` becomes a list editor).

**No layout control.** AutoForm renders fields vertically in schema-key order. There's no declarative way to specify grid layouts, multi-column rows, sections, or tabs. The `renderParent` escape hatch exists per-field but there's no form-level layout declaration. zodal should consider a layout metadata layer (either in `.meta()` or as a separate config) for multi-column forms and section grouping.

---

#### json-render (Vercel Labs)

json-render is a "Generative UI" framework from Vercel Labs that lets AI models generate user interfaces constrained to a developer-defined catalog of allowed components with Zod-validated props. It demonstrates the catalog/registry duality (abstract declaration vs. concrete implementation) and a well-designed `catalog.prompt()` for AI-consumable descriptions, but has no collection intelligence -- its Table component is static presentation only.

**Source:** `zodal_research/json-render (Vercel Labs) component catalog and Zod-native action schemas.md`

**What zodal Should Steal:**

**3.1 The Catalog/Registry Duality -- with Type Safety.** The `defineCatalog()` + `defineRegistry()` pattern is excellent. The catalog declares component names + Zod prop schemas; the registry must implement exactly those components with matching types. This gives compile-time guarantees that every declared component has an implementation, and every implementation receives correctly-typed props.

**zodal application:** zodal already plans `@zodal/core` (declarations) and `@zodal/ui-shadcn` (implementations). But zodal should adopt json-render's approach of making the registry *typed against* the core declarations, so that adding a new field type or affordance in core produces a type error in the renderer until it's handled.

**3.2 `catalog.prompt()` -> `toPrompt()` with Structured Component Descriptions.** json-render's prompt generation is well-designed: it converts Zod schemas to structured descriptions, includes component descriptions, lists available actions with param schemas, and accepts `customRules` for domain-specific constraints. The two-mode approach (generate vs. chat) is also worth adopting.

**zodal application:** zodal's planned `toPrompt()` should do the same for collections -- generate AI-consumable descriptions that include field types, affordances, available operations, and validation rules. This is directly applicable to the "function" abstraction too: `defineFunction()` should produce prompts describing input schemas, output schemas, and execution constraints.

**3.3 The Flat Spec Format for Streaming.** The `{ root, elements }` flat map is clever -- it avoids deep nesting, making JSON Patch operations simple and enabling progressive rendering as the LLM streams tokens. Each element is independently addressable.

**zodal application:** When zodal eventually supports AI-generated collection views or dashboards, this flat-map approach for the intermediate representation is better than nested trees. More immediately, the JSONL streaming + `createSpecStreamCompiler()` pattern is worth understanding for any zodal feature that involves streaming structured output from an LLM.

**3.4 Declarative Data Binding via Expressions.** The `$state`, `$bindState`, `$item`, `$cond`, `$template`, `$computed` expression system is a well-thought-out DSL for connecting data to UI without code. It's essentially a mini-language for reactive bindings that can be serialized as JSON -- crucial for AI generation since the AI can't write arbitrary callbacks.

**zodal application:** zodal's collection affordances (especially for forms and filters) could benefit from a similar expression system when generating configs. For instance, a filter's visibility could depend on another field's value, expressed as `{ "$cond": { field: "status", eq: "active" } }` rather than requiring a callback function.

**What zodal Should Avoid:**

**4.1 The Static Table Anti-Pattern.** json-render's `Table` component is shockingly primitive. Its props are `columns: string[]` (header labels) and `rows: string[][]` (2D array of cell strings). No sorting, no filtering, no pagination, no selection, no CRUD, no typed cells, no custom renderers. It's a presentation-only HTML table.

This is the central failure that validates zodal's entire thesis. json-render treats "Table" as just another UI component with static props, rather than as a *collection interface* that needs its own affordance system. There's no concept of "this data is sortable by these columns" or "this field is filterable with range queries." The AI can generate a table, but the table can't *do* anything.

**zodal lesson:** Never reduce collection display to static presentation. The Table/DataGrid must be an *affordance-aware* component that reads capabilities from the collection definition and enables/disables features accordingly. This is exactly what zodal's `toColumnDefs()` generator already does -- and json-render's gap here is zodal's opportunity.

**4.2 Top-Down-Only Composition (No Inference).** json-render is entirely top-down: the developer (or AI) must explicitly declare every component, every prop, and every composition. There is zero inference. If you want a Card with a title, you write `props: z.object({ title: z.string() })` and `description: "Container card"`. The framework never looks at the Zod schema and guesses that a `z.string()` field named `email` should get an email input widget.

This is appropriate for json-render's use case (AI generates arbitrary UIs from prompts), but it would be deadly for zodal's use case (developer defines a schema, gets a working CRUD interface with minimal effort). zodal's 4-layer inference engine (Zod type -> refinements -> name heuristics -> `.meta()` overrides) is a critical differentiator.

**zodal lesson:** Keep the inference engine as a first-class feature. Don't let the appeal of explicit declaration erode the convention-over-configuration principle.

**4.3 No Backend/Data Layer Awareness.** json-render's `StateProvider` is a pure client-side state bag with JSON Pointer paths. There's no concept of a DataProvider, no CRUD operations against a backend, no pagination model, no optimistic updates, no capability discovery. The `repeat` field iterates over client-side state arrays -- it can't page through a server-side collection.

**zodal lesson:** zodal must not follow this path. The DRY-across-layers principle -- where the same affordance declaration informs both UI and backend -- is zodal's central value proposition. json-render's pure-client architecture is fine for AI-generated dashboards but completely inadequate for data-driven applications.

**4.4 Description Strings Instead of Semantic Metadata.** json-render uses free-text `description` strings for AI prompt generation: `description: "Container card with optional title"`. This is fine for AI consumption but doesn't carry structured semantic information. zodal's affordance metadata (`filterable: 'range'`, `editable: true`, `visible: false`) is richer and machine-actionable.

---

#### Metawidget

Metawidget is an open-source Object/User Interface Mapping tool created as part of a PhD research project. Its five-stage pluggable pipeline (Inspector -> InspectionResultProcessor -> WidgetBuilder -> WidgetProcessor -> Layout) was derived from empirical industry research and represents the closest academic validation of zodal's layered architecture. It maps a single object to a single form -- it has no collection-level concerns.

**Source:** `zodal_research/Metawidget's pluggable pipeline architecture for UI generation.md`

**What zodal Should Steal:**

**3a. The five-stage decomposition as a design validation.** Metawidget arrived at its five stages through years of industry interviews and adoption studies -- not speculation. zodal's current architecture maps to this almost perfectly: `@zodal/core`'s inference engine ~ Inspector, `@zodal/core`'s `defineCollection()` ~ InspectionResultProcessor, `@zodal/ui`'s `toColumnDefs()`/`toFormConfig()` ~ WidgetBuilder, zodal's renderer packages ~ WidgetProcessor + Layout. The fact that Kennard independently validated this decomposition gives zodal strong confidence that its layered separation is sound.

**3b. The intermediate representation pattern.** The inspection result as a normalized, source-agnostic attribute map is exactly what zodal's resolved `CollectionDefinition` is. zodal should make this explicit: the output of `defineCollection()` is a pipeline IR, and it should be clearly documented as such. This also validates zodal's decision to use JSON Schema-like structures (via Zod) rather than framework-specific representations.

**3c. CompositeWidgetBuilder's first-match-wins pattern.** zodal's renderer registry (`zodal-ui-shadcn`, etc.) should adopt this: register widget builders in priority order, where specialized builders (e.g., a rich date picker) get first crack, and a generic fallback handles the rest. In TypeScript:

```typescript
// zodal equivalent of CompositeWidgetBuilder
const widgetBuilder = createCompositeWidgetBuilder([
  richDatePickerBuilder,   // returns component or null
  customBadgeBuilder,      // returns component or null
  shadcnDefaultBuilder,    // fallback -- always returns something
]);
```

**3d. Treating actions/operations as first-class inspectable entities alongside properties.** zodal already has `operations` in `defineCollection()`, but Metawidget's `@UiAction` concept shows that operations should flow through the same inspection pipeline as field affordances -- not be a separate bolt-on. The resolved collection definition should carry operations with the same normalized attribute format as fields (`label`, `icon`, `hidden`, `scope`, `confirm`, etc.), and WidgetBuilders should handle both `property` and `action` element types.

**3e. The InspectionResultProcessor as a distinct stage.** zodal currently merges inference and post-processing into `defineCollection()`. Metawidget's experience shows these should be separable: first inspect (infer defaults), then process the result (sort fields, apply view-specific overrides, exclude fields for different contexts like summary vs. detail). This would allow zodal users to write custom processors that modify the resolved definition before it reaches generators -- a cleaner extension point than overriding inference rules.

**What zodal Should Avoid:**

**4a. XML as the interchange format.** Metawidget's Java version uses XML (`inspection-result-1.0.xsd`) as the IR between pipeline stages. Even in 2010, this was heavyweight. The JavaScript version correctly switched to JSON Schema. zodal should stay with its current TypeScript-native approach: the IR is a typed JavaScript object, not a serialization format.

**4b. The DOM-centric, widget-returning pipeline.** Metawidget's `buildWidget()` returns actual platform widgets (a `JComponent`, a `UIComponent`, a DOM `HTMLElement`). This couples the pipeline to the rendering target. zodal's headless approach -- returning config objects (`ColumnDef[]`, `FormFieldConfig[]`) instead of actual components -- is strictly better. It allows the same pipeline to target multiple renderers, testing without a DOM, and server-side rendering.

**4c. Lack of capability negotiation.** Metawidget's pipeline has no mechanism for downstream stages to report back to upstream stages. If a WidgetBuilder can't handle a particular attribute combination, it returns `null` and hopes a fallback picks it up. There's no affordance degradation story -- no equivalent of "the backend doesn't support range queries, so degrade to client-side filtering." zodal's planned capability discovery system addresses this gap.

**4d. The `metawidget.xml` configuration approach.** Metawidget's Java version configures the pipeline through a verbose XML file listing Inspectors, WidgetBuilders, Processors, and Layouts. This is the Java-enterprise-era equivalent of configuration-over-convention. zodal should stick with programmatic configuration with sensible defaults -- `defineCollection(schema)` should "just work" without any pipeline configuration file.

**4e. No collection-level concerns.** Metawidget is purely a form/field generator -- it has no concept of collections, lists, pagination, filtering, sorting, or batch operations. It maps a single object to a single form. zodal's collection abstraction (keyed sets with CRUD + query affordances) is a significant extension beyond Metawidget's scope. This is not something to avoid, but rather a reminder that zodal is doing something Metawidget never attempted: bridging the gap from individual object forms to full collection interfaces including data tables, filters, and list views.

---

### Group B: Schema & Type Systems

---

#### Zod v4 metadata

This report examines Zod v4's metadata system: registries (external Maps keyed by schema instance identity), the `.meta()` convenience method, the `GlobalMeta` interface with its index signature, and the critical finding that metadata does not survive schema transforms. This is the mechanism zodal must build on for its affordance declarations, and the metadata-loss footgun is the single most important technical constraint zodal faces.

**Source:** `zodal_research/Zod v4 metadata API and schema preservation.md`

**What zodal Should Steal:**

**3.1 Registry-as-External-Store Pattern.** The design of metadata as an external `Map<SchemaInstance, MetaType>` rather than embedded in the schema's `_def` is architecturally clean. zodal should build its affordance registry as a **custom Zod registry**, not a parallel system. This gives zodal type-safe metadata for free and interoperability with the rest of the Zod ecosystem.

Concrete recommendation:

```typescript
// @zodal/core
import * as z from "zod";

type FieldAffordances = {
  sortable?: boolean | 'asc' | 'desc';
  filterable?: 'exact' | 'range' | 'search' | 'contains' | false;
  editable?: boolean | 'inline' | 'form';
  visible?: boolean;
  editWidget?: string;
  // ... rest of zodal's 40+ affordance properties
};

export const affordanceRegistry = z.registry<FieldAffordances>();
```

**3.2 Declaration Merging for `GlobalMeta`.** zodal should augment `GlobalMeta` so that `.meta()` natively accepts zodal affordance properties. This lets users write `z.string().meta({ filterable: 'range', description: 'Price' })` -- a single call that populates both JSON Schema metadata and zodal affordances. The `[k: string]: unknown` index signature on `GlobalMeta` means this already works at runtime; the declaration merge just adds type safety.

**3.3 `z.$output` / `z.$input` for Type-Aware Affordances.** The ability to reference a schema's inferred type within metadata opens doors for type-safe defaults and examples. zodal could use this for things like `defaultValue: z.$output` or typed example data in form previews.

**3.4 `z.toJSONSchema()` Integration.** Since `z.toJSONSchema()` copies all `globalRegistry` metadata into JSON Schema output, zodal affordances stored via `.meta()` will automatically appear in generated JSON Schemas. zodal could exploit this for `toPrompt()` (AI-consumable descriptions) -- generate a JSON Schema enriched with affordance metadata, which LLMs can consume.

**3.5 Codecs as First-Class Transforms.** Zod v4's `z.codec()` maps almost 1:1 to zodal's codec model (`val_encoder`/`val_decoder`). zodal should use `z.codec()` directly rather than reinventing its own transform abstraction. The type signatures align: codec takes an input schema (inner/storage), output schema (outer/domain), and bidirectional transforms.

**What zodal Should Avoid:**

**4.1 The Metadata-Loss Footgun (CRITICAL).** Metadata does not survive schema transforms. Every Zod method (`.optional()`, `.array()`, `.refine()`, `.transform()`, `.pick()`, `.extend()`, etc.) returns a **new schema instance**. The registry entry is keyed by instance identity. The new instance has no metadata:

```typescript
const A = z.string().meta({ filterable: 'search' });
A.meta();  // -> { filterable: 'search' }

const B = A.optional();
B.meta();  // -> undefined  <-- METADATA LOST
```

This is explicitly documented and is **by design**. zodal **cannot rely solely on `.meta()` for field-level affordances in the general case**. The user must either always put `.meta()` last, or zodal must implement a workaround.

**4.2 Don't Rely on Global Registry Alone.** The `z.globalRegistry` is a singleton. In monorepos, test suites, and server-side rendering, this creates collisions. The `id` uniqueness constraint throws at runtime if two schemas share the same `id`. zodal should use a **dedicated custom registry** (`affordanceRegistry`) rather than polluting the global one.

**4.3 Don't Over-Leverage the Index Signature.** `GlobalMeta`'s `[k: string]: unknown` means you can put anything in, but it also means tooling can't distinguish zodal metadata from random JSON Schema extensions. A custom registry with a precise type is safer than dumping everything into `globalRegistry`.

**4.4 Registry Is Not a WeakMap.** Registries use a regular `Map`, not a `WeakMap`. Schema instances stored in a registry will not be garbage-collected as long as the registry exists. In long-lived processes, this could be a memory concern if schemas are dynamically created and abandoned. zodal should be aware of this if it supports dynamic schema generation.

---

#### Codec-Transform Systems (io-ts, effect/Schema, superjson, zod-to-json-schema)

This report compares four libraries representing fundamentally different approaches to the encode/decode problem, plus Zod 4's native `z.codec()`. io-ts pioneered "codec as a value" with explicit round-trip laws. effect/Schema adds dependency injection and standalone composable transformations. superjson provides transparent type preservation via walk-and-tag. zod-to-json-schema is a one-way lossy schema compiler.

**Source:** `zodal_research/Codec-Transform Systems Compared - io-ts, effect:Schema, superjson, zod-to-json-schema.md`

**What zodal Should Steal:**

**From io-ts: The Codec Laws and Decoder/Encoder Separation.** io-ts's explicit round-trip laws (`decode(encode(a)) = Right(a)`) should be documented as a contract for zodal codecs. The v2 decomposition into independent `Decoder` and `Encoder` that are composed via `make()` maps cleanly to zodal's `val_decoder` / `val_encoder` split. zodal should ensure its `StoreCodecs` interface can be assembled from independently-defined pieces.

**From effect/Schema v4: Standalone Composable Transformations.** The v4 move to make `Transformation` objects standalone and composable is exactly what zodal needs. Instead of embedding transforms in the schema definition, transformations should be reusable, testable objects:

```typescript
// What zodal could adopt from effect/Schema v4's approach
const dateTransform = {
  decode: (epoch: number) => new Date(epoch),
  encode: (date: Date) => date.getTime(),
};
// Reuse across multiple collection schemas
```

Also steal the split `RD`/`RE` idea: zodal codecs that need async operations (e.g., a key_decoder that hits a lookup service) should track those requirements separately for encode vs. decode paths.

**From effect/Schema: `.pipe()` for Codec Composition.** Effect's `pipe` pattern for chaining schema transformations is elegant and zodal-compatible:

```typescript
// effect pattern: chain transforms
const schema = Schema.String.pipe(
  Schema.transform(Schema.Number, {
    decode: parseFloat,
    encode: String,
  }),
  Schema.filter(n => n > 0)
);
```

zodal should support a similar composition pattern for its codec middleware. Something like:

```typescript
const provider = createRestProvider(url).pipe(
  withCodecs({ valDecoder: JSON.parse, valEncoder: JSON.stringify }),
  withKeyPrefix('users/'),
  withValidation(userSchema),
);
```

**From Zod 4: Codecs as Regular Schemas.** Zod 4's insight that codecs are just schemas with bidirectional behavior (not a separate concept) should inform zodal's design. Since zodal is Zod-native, it should use `z.codec()` directly for field-level transforms. A `z.codec()` in the Zod schema should be automatically detected by zodal's inference engine and used to configure the corresponding store codec.

**From superjson: The "Walk and Tag" Strategy for Fallback Serialization.** When zodal's codec layer encounters an unknown type during serialization (e.g., the user didn't specify a `valEncoder`), a superjson-style fallback that auto-detects `Date`, `Map`, `Set`, etc. would provide a much better default than crashing. This could be a `createAutoCodec()` utility that walks the value and applies registered transforms.

**From zod-to-json-schema: The `override` Hook.** zod-to-json-schema's `override` callback receives the Zod definition and the current path, and can return custom JSON Schema, `undefined` to remove the property, or `ignoreOverride` to proceed normally. zodal's `toPrompt()` (which generates AI-consumable descriptions) needs exactly this pattern -- a visitor that can override how any field is described.

**What zodal Should Avoid:**

**io-ts's fp-ts Dependency.** io-ts's deep coupling to fp-ts (`Either`, `pipe`, `fold`, `chain`) creates a steep learning curve and ecosystem lock-in. Custom codecs require understanding `t.success`, `t.failure`, `E.chain`, and the `Context` threading. zodal should keep its codec interface as plain functions (or at most, a `Result<T, E>` union type), not algebraic types that require a functional programming library.

**io-ts's Infallible Encode.** io-ts's `encode: (a: A) => O` is infallible by design -- it can't report errors. This is a problem for zodal where encoding might involve validation (e.g., checking that a domain object meets constraints before writing to storage). effect/Schema and Zod 4 both allow encode to fail, which is the right choice.

**effect/Schema's Complexity Budget.** Effect/Schema v4 tracks 14+ type parameters per schema, including mutability, optionality, and constructor defaults. This enables extremely precise type-level tracking but creates complex recursive types that can slow the TypeScript language server. zodal should resist this temptation. The `StoreCodecs<OuterKey, InnerKey, OuterValue, InnerValue>` with four parameters is already at the complexity ceiling for most users.

**superjson's "Magic" Registration Model.** superjson's global mutable registry (`SuperJSON.registerCustom(...)`) is convenient but anti-modular. Two libraries can conflict on type names, and there's no way to scope registrations. zodal's codecs should be explicitly passed, not globally registered.

**zod-to-json-schema's Lossy Transformation.** `z.transform()` cannot be represented in JSON Schema at all -- it's a black box. Zod 4 acknowledges this: the output type of a transform is not introspectable at runtime. zodal's `toPrompt()` faces the same problem. The lesson: zodal should distinguish between *type-preserving* codecs (which can be reflected to external formats) and *type-changing* codecs (which are opaque). Zod 4's `.overwrite()` (which mutates value without changing type) is a useful precedent.

---

#### Uniforms

Uniforms is a mature React form library by Vazco that automatically generates complete forms from schema definitions via a three-layer architecture: Core Framework, Schema Bridges, and UI Themes. Its 8-method Bridge interface translates any schema format into a uniform internal representation. The `createAutoField(componentDetector)` pattern with React context override is an excellent progressive-disclosure escape hatch for renderer customization.

**Source:** `zodal_research/Uniforms schema-agnostic bridge architecture.md`

**What zodal Should Steal:**

**3a. The Bridge Interface as a Minimal Schema Protocol.** The 8-method Bridge interface is an excellent model for `@zodal/core`'s output contract. But zodal can improve it. Uniforms' bridge methods are UI-form-specific (`getError`, `getValidator`); zodal needs a more general "resolved schema descriptor" that also serves table columns, filter panels, and non-form UIs.

**Steal:** The general pattern of a schema-agnostic intermediate representation accessed through a small set of methods. Map it to zodal's resolved collection definition, which already has `toColumnDefs()`, `toFormConfig()`, `toFilterConfig()` etc. as output generators.

**Specific method ideas:** `getField()`, `getType()`, `getSubfields()` map directly to zodal's field introspection needs. `getProps()` is zodal's `resolvedAffordances(fieldName)`.

**3b. `getType()` Returns Constructors, Not Strings.** Using JS constructor references (`String`, `Number`, `Date`, `Array`, `Object`) as the type discriminant is clever -- it enables clean `switch` statements and strict equality checks. zodal's inference engine already classifies Zod types into categories; representing the resolved type as a constructor reference (or a discriminated union tag) enables the same clean dispatch.

**3c. The ComponentDetector Pattern (React Context Override).** `createAutoField(detector)` with `componentDetectorContext` is exactly the right progressive-disclosure escape hatch. zodal-ui-shadcn (or any renderer) should export an `AutoField` produced by this pattern, where the default detector maps resolved affordances to themed components, and users can override per-subtree via context.

**3d. Memoization Per Bridge Instance.** Per-instance memoization of all field introspection methods is smart because the schema is immutable once the bridge is constructed. zodal's `defineCollection()` should similarly memoize all derived computations (resolved affordances, column defs, form configs) on the resolved collection object.

**3e. The `uniforms` Metadata Escape Hatch.** Uniforms' convention of a `uniforms` key on field definitions (carrying component overrides, extra props) maps directly to zodal's `.meta()` overrides. The key insight: the metadata can be either a component reference directly or an object with `component` plus additional props. zodal should support the same pattern in its affordance overrides.

**What zodal Should Avoid:**

**4a. Returning Raw Schema-Native Objects from `getField()`.** Uniforms' `getField(name)` returns the *raw schema-native field definition* (e.g., the SimpleSchema field object, or the JSON Schema property node). This means downstream code that calls `getField()` has to know *which schema system is in use* to interpret the result. This leaks the abstraction. zodal should ensure its resolved field descriptor is fully normalized -- no raw Zod types leaking through the resolved interface.

**4b. JS Constructor as Type -- Too Coarse for Rich UIs.** `getType()` returning one of 6 constructors works for basic form fields, but it's insufficient for zodal's richer affordance model. There's no way to distinguish `email` from `url` from plain `string`, or `integer` from `float`, or `enum` from `array-of-enum`. Uniforms pushes all that into `getProps()` (the `options` bag, `decimal` flag, etc.). zodal's 4-layer inference engine already produces much richer type descriptors -- don't regress to uniforms' coarse 6-type model.

**4c. The Validator Ownership Problem.** The JSON Schema bridge requires users to manually construct a validator function using Ajv (or similar) and pass it to the bridge constructor. The Zod bridge gets validation for free from Zod itself. But the JSON Schema bridge's API is awkward -- you construct the validator separately and inject it. zodal should never require this; since Zod IS the schema AND the validator, this is a solved problem. For non-Zod schemas (if ever supported), the bridge should encapsulate validator construction internally.

**4d. Form-Only Scope Limitation.** Uniforms is purely a form library. It has no concept of collections (list views, data tables, filters, sorting, pagination). This isn't a criticism of uniforms -- it's a different scope -- but zodal must not constrain its bridge interface to form-only concerns. The bridge/protocol must serve `toColumnDefs()` and `toFilterConfig()` equally well.

**4e. Class-Based Bridge Architecture.** Uniforms uses class inheritance (`extends Bridge`). This makes composition harder -- you can't easily wrap one bridge with another (e.g., adding a caching or logging layer). zodal should prefer a functional/interface-based approach where the resolved collection definition is a plain object with methods, composable via wrapping.

---

#### JSON Forms (EclipseSource)

JSON Forms is a declarative, schema-driven form rendering framework that takes a JSON Schema (data model) and a UI Schema (layout/presentation model) and renders live forms. Its tester/renderer registry -- a ranked dispatch system where each candidate renderer self-reports a score for how well it can handle the current fragment -- is the best extensibility model in the schema-driven UI space.

**Source:** `zodal_research/JSON Forms (EclipseSource) - Tester:Renderer Registry Architecture.md`

**What zodal Should Steal:**

**The Ranked Tester Pattern Itself.** This is the single most important pattern from JSON Forms for zodal. The core idea: **renderer selection is a scored match, not a string-keyed lookup.** Instead of `fieldType -> component` (RJSF's approach), you have `(schema, uischema) -> score` where each candidate renderer self-reports how well it can handle the current fragment. This means:

- **Overriding is trivial.** To replace a default renderer, register a new one with a higher rank. No forking, no patching.
- **Fallback is built in.** Defaults always register at low ranks (1-2). Custom renderers at rank 3+ automatically override them only where the tester matches.
- **Composition is natural.** `and(schemaTypeIs('string'), scopeEndsWith('email'))` targets exactly the field you want without needing a whole new field type.

zodal's `toColumnDefs()` / `toFormConfig()` generators should adopt a tester-ranked registry. When zodal-ui-shadcn renders a field, the selection of which shadcn component to use should go through a ranked tester, not a `switch(fieldType)`.

**The Composable Predicate Library.** The `and`, `or`, `schemaTypeIs`, `schemaMatches`, `scopeEndsWith`, `formatIs` combinators are exactly the right granularity. zodal should build an equivalent set -- but targeting Zod schemas instead of JSON Schema. Something like:

```typescript
// zodal equivalent
zodTypeIs('ZodString')
zodRefinementMatches(fn)
fieldNameEndsWith('email')
metaMatches('editWidget', 'rating')
```

**The Dual-Registry (Renderers + Cells).** The separation between full renderers and simplified cells for table contexts is relevant for zodal. `toColumnDefs()` (table cell rendering) and `toFormConfig()` (form field rendering) need different component registries. JSON Forms validates this as a pattern worth adopting.

**What zodal Should Avoid:**

**The Separate UI Schema as a Mandatory Artifact.** JSON Forms requires (or strongly encourages) a separate UI Schema JSON document. This is the biggest ergonomic pain point visible in community issues -- users have to maintain two parallel, loosely-coupled JSON files. The UI schema uses JSON Pointer `scope` references into the data schema, which is fragile (rename a field and the UI schema silently breaks).

zodal's approach of attaching affordances directly onto the Zod schema via `.meta()` is fundamentally better. The "UI schema" is generated by the inference engine from the annotated Zod schema, not authored separately. zodal should keep this and *not* introduce a JSON Forms-style external UI schema.

**Raw Numeric Ranks Without Namespacing.** JSON Forms ranks are bare integers with no guardrails. Users have to know that defaults are rank 1-2, and pick "3" or "1000" by convention. There's no way to say "higher than the default but lower than any user override." zodal could improve on this with named priority bands (e.g. `'default' | 'library' | 'app' | 'override'`) that expand to numeric ranges, giving structure without losing flexibility.

**The Coupling to Redux (Historical) / Framework-Specific State.** Earlier versions of JSON Forms were deeply coupled to Redux for their renderer registry. In newer versions, the component-based API where renderers are passed as props to the `JsonForms` component replaced the Redux approach. zodal should learn from this: keep the registry as pure data (an array of `{ tester, component }` entries), not locked into any state management. Pass it down via context or props.

**Lack of "Explain" / Debugging.** When a JSON Forms tester doesn't match, debugging is painful -- you get "No applicable renderer found" with no insight into which testers were evaluated and what they returned. zodal's planned `collection.explain('fieldName')` API is a significant DX improvement. Consider making the tester dispatch itself loggable: `dispatch(uischema, schema, { debug: true })` -> returns the full ranked list.

---

### Group C: State & Data

---

#### Zustand & Immer

Zustand is a minimalist single-store state manager with a ~100-line vanilla core. Immer uses ES6 Proxies for mutable-syntax immutable updates with structural sharing. Together they form the most common pairing for ergonomic immutable state management in React. Zustand's middleware-as-composition pattern maps directly to zodal's codec/transform model, and Immer's patches API directly solves optimistic updates and undo.

**Source:** `zodal_research/Zustand & Immer.md`

**What zodal Should Steal:**

**3.1 The vanilla-first architecture.** Zustand's `zustand/vanilla` exports a framework-agnostic `createStore` that React's `create` wraps. Zustand core can be imported and used without the React dependency; the only difference is that the `create` function does not return a hook, but the API utilities. zodal's `createCollectionStore()` should follow this exact pattern: a vanilla store with `getState`/`setState`/`subscribe`, then a thin `useCollectionStore()` hook that binds it to React via `useSyncExternalStore`. This preserves zodal's "headless first" principle while making React integration trivial.

**3.2 Middleware-as-composition for codecs.** Zustand's middleware model -- wrapping `(set, get, api) => state` -- maps cleanly to zodal's codec composition. zodal should steal this specific pattern: middleware is just a higher-order function that wraps `set`/`get`, producing a store with the same interface but different behavior. This is the JS/TS equivalent of `dol`'s `wrap_kvs`. The key insight: Zustand's middleware modifies the *behavior* of `set`/`get` rather than requiring a different interface, which keeps composition simple.

**3.3 Immer for collection mutation ergonomics.** For `@zodal/ui`'s state management, Immer (as an optional middleware) would dramatically simplify how users write state updates for sorting, filtering, selection, and column state. zodal should adopt Immer as an **opt-in middleware** (not a hard dependency), matching Zustand's approach.

**3.4 Immer's Patches for optimistic updates and undo.** This is the biggest "steal" for zodal. Immer's `produceWithPatches` + `applyPatches` + inverse patches directly solve two of zodal's boundary questions from the affordance layers doc:

- **Optimistic updates:** Apply the patch optimistically to UI state; if the backend rejects, apply the inverse patch to roll back. The patch is also the payload to send to the backend.
- **Undo/redo:** Maintain a stack of inverse patches. Undo = apply inverse. Redo = apply forward patch. This is dramatically simpler than snapshotting full state.
- **Sync:** Patches can be serialized and sent over websockets for real-time collaboration.

zodal should expose a `produceWithPatches`-based mutation API as part of its optimistic update story, perhaps as part of `createCollectionStore()`.

**3.5 `subscribeWithSelector` for reactive affordance updates.** zodal's UI layer needs to react to specific state changes (e.g., "re-render the filter panel when available filters change, but not when sort order changes"). Zustand's `subscribeWithSelector` pattern -- `subscribe(selector, callback, { equalityFn })` -- is exactly the right granularity. zodal should either adopt Zustand directly or replicate this pattern in its own store.

**3.6 The 4-method store API.** `setState`, `getState`, `getInitialState`, `subscribe` is a near-perfect minimal interface for zodal's headless state management. Change detection uses `Object.is()` -- listeners are only notified if the new state is not referentially equal to the previous state. This pairs perfectly with Immer's structural sharing (unchanged subtrees keep reference identity).

**What zodal Should Avoid:**

**4.1 TypeScript middleware composition pain.** Zustand's middleware typing system uses a `StoreMutators` module augmentation pattern with tuple-level type tracking (`[["zustand/immer", never]]`). This is extremely complex to write and debug. zodal should avoid this complexity by:
- Not using module augmentation for middleware types
- Preferring explicit generic parameters over inferred middleware chains
- Keeping the middleware stack shallow (1-2 layers, not 4+)

**4.2 Slices as a convention, not a feature.** Zustand's slice pattern is a community convention (spread `StateCreator` functions), not a built-in feature. This leads to type-safety gaps and middleware interop issues. zodal should make collection state slicing a first-class concept -- perhaps with explicit slice definitions that compose with proper type inference, rather than relying on object spread hacks.

**4.3 Immer's proxy overhead for large collections.** Immer with proxies is roughly two to three times slower than a handwritten reducer. For collections with thousands of items, this matters. zodal should:
- Make Immer opt-in (not default)
- Provide a "fast path" for bulk operations (e.g., `setItems(newArray)` bypasses Immer entirely for full replacements)
- Document when to use Immer (complex nested updates) vs. plain updates (simple replacements)

**4.4 Mixing actions and state in the same object.** Zustand co-locates actions and state in a single object (`{ count: 0, increment: () => ... }`). This simplifies access but conflates two concerns -- state that needs to be serialized/persisted vs. functions that should never be serialized. zodal should maintain a clean separation (as the existing `zod-collection-ui` already does), keeping data state separate from action dispatchers.

**4.5 Immer's tree-only constraint.** Immer assumes your state to be a unidirectional tree -- no object should appear twice in the tree, and there should be no circular references. zodal collections referencing other collections (relationships) could run into this. zodal should normalize relational data before putting it through Immer, or avoid Immer for cross-collection state.

---

#### State Management (Zustand, Jotai, TanStack Store/Query)

This report compares four state management approaches: Zustand (single-store), Jotai (atomic/bottom-up), TanStack Store (signals-inspired primitives), and TanStack Query (server state cache). A surprise finding: TanStack DB (beta, 2025) builds on top of TanStack Query to provide typed collections, live queries via differential dataflow, and automatic optimistic mutations -- remarkably close to zodal's vision.

**Source:** `zodal_research/State Management for Collection UIs - Zustand, Jotai, TanStack Store, and TanStack Query.md`

**What zodal Should Steal:**

**From Zustand: Middleware Composition Pattern.** Zustand's middleware pattern -- wrapping the `(set, get, api)` triplet -- is exactly what zodal needs for its codec/transform pipeline at the store layer. Each middleware intercepts state transitions and can transform values in flight.

**Concrete steal:** zodal's `createCollectionStore()` should adopt composable middleware that intercepts mutations, enables optimistic state, and plugs in validation -- using the same `(set, get, api) => (set, get, api)` wrapping pattern.

**From Jotai: splitAtom for Per-Item Subscription.** For collection UIs, Jotai's `splitAtom` solves the re-render explosion problem. When a 500-row table has one cell edited, only that row's component should re-render. zodal's `@zodal/ui` should provide an equivalent: given a collection state, produce per-item reactive handles that allow isolated updates.

**Concrete steal:** zodal's `createCollectionStore()` should expose a `getItemAtom(key)` or similar mechanism that returns a subscribable, updatable handle for a single item.

**From Jotai: Derived Atom DAG as Affordance Pipeline.** Jotai's `atom((get) => ...)` with automatic dependency tracking is a natural fit for zodal's derived views. A collection's `filteredItems`, `sortedItems`, `paginatedItems` are a DAG of derived computations. Rather than recomputing everything on every state change, zodal should track which derived view depends on which state slice.

**Concrete steal:** zodal's headless state should model the filter->sort->paginate pipeline as composable, dependency-tracked derivations -- not as one monolithic selector.

**From TanStack Query: The Mutation Lifecycle.** TanStack Query's `onMutate -> onSuccess/onError -> onSettled` lifecycle is the right abstraction for zodal's DataProvider mutations. It cleanly separates: (1) Optimistic application (onMutate: snapshot + apply), (2) Server confirmation (onSuccess: update cache with server response), (3) Rollback (onError: restore snapshot), (4) Cleanup (onSettled: invalidate/refetch).

zodal's `DataProvider.create()`, `.update()`, `.delete()` should return a lifecycle object that mirrors this pattern, allowing zodal-ui to wire up optimistic UI automatically.

**From TanStack DB: The Collection Primitive (Biggest Find).** TanStack DB (beta, 2025) is essentially building a subset of what zodal needs. Key ideas zodal should absorb:

- **Normalized collections as the primitive.** Data loads into typed, keyed collections. Queries run *across* collections with joins.
- **Differential dataflow for live queries.** When one item changes, only affected query results recompute (sub-millisecond for 100k items).
- **Optimistic state stored separately from synced state.** Optimistic writes layer on top; rollback discards the layer. No manual snapshot/restore.
- **Backend-agnostic collection types.** REST (via QueryCollection), sync engines (ElectricSQL, RxDB, PowerSync), or custom sources.

**This is a strategic signal for zodal:** TanStack DB validates the collection-as-first-class-primitive approach. However, TanStack DB is React-specific, tightly coupled to TanStack Query, and doesn't have zodal's schema-driven affordance layer. zodal's differentiator is the *declarative* part.

**From TanStack Store: Framework-Agnostic Vanilla Core.** TanStack Store's strict separation of vanilla core from framework adapters matches zodal's headless-first principle. zodal's `createCollectionStore()` should be a vanilla JS construct; the React hook (`useCollection()`) should be a thin adapter.

**What zodal Should Avoid:**

**Zustand's Monolithic Store for Collections.** Putting `items[]`, `filter`, `sort`, `pagination`, `selection`, and `columnState` in a single Zustand store means every filter change triggers selector re-evaluation for every consumer. For a data-heavy collection UI, it's a bottleneck. zodal should decompose collection state into independent reactive units (closer to Jotai's atom model) rather than one big store.

**Jotai's Atom Proliferation Problem.** While atomic state is powerful, managing a collection of 500 atoms (one per row) creates complexity: cleanup, garbage collection, stable references across re-renders. zodal should encapsulate this complexity -- the user declares a collection, zodal manages the per-item subscription machinery internally.

**TanStack Store's Immaturity for Application State.** TanStack Store is alpha, explicitly designed for library internals, and lacks middleware, persistence, and developer tooling. Using it directly as zodal's state primitive would mean reimplementing what Zustand already provides.

**TanStack Query's Boilerplate for Optimistic Updates.** TanStack Query's optimistic update pattern requires 15-25 lines of boilerplate per mutation. TanStack DB exists precisely because this pattern doesn't scale. zodal's DataProvider should handle the lifecycle internally -- the user declares `optimistic: true` on the collection, and the machinery handles snapshot/apply/rollback/sync automatically.

---

#### DataProvider (react-admin vs Refine)

This report compares the two dominant React admin framework DataProvider interfaces. react-admin has 9 required methods with `filter: any` (completely opaque). Refine has 6 required + 5 optional methods with a structured `CrudFilter[]` type using 28+ operators. Neither framework has a real capability discovery mechanism.

**Source:** `zodal_research/DataProvider Interfaces - react-admin vs. Refine.md`

**What zodal Should Steal:**

**3.1 Refine's structured filter operators.** This is the single most important finding. react-admin's `filter: any` is a DX dead-end -- adapters must individually invent their filter mapping. Refine's `CrudOperators` union type creates a standard vocabulary that every adapter can translate from. zodal should adopt a similar typed operator set, but tie it to the field-level affordance declarations:

```typescript
// zodal vision: the schema declares what operators a field supports
// the DataProvider translates them; the UI renders matching widgets
defineCollection({
  schema: z.object({
    price: z.number().meta({ filterable: ['gte', 'lte', 'between'] }),
    status: z.enum(['active','archived']).meta({ filterable: ['eq', 'in'] }),
  })
})
```

This connects Refine's operator vocabulary to zodal's affordance system -- the schema becomes the single source of truth for what filters exist.

**3.2 Refine's required/optional method split.** Refine's distinction between required methods (5 CRUD + `getApiUrl`) and optional ones (batch variants, `custom`) is closer to zodal's design philosophy than react-admin's all-or-nothing 9 methods. The fallback pattern -- Refine issues individual `create()` calls if `createMany()` isn't implemented -- is exactly what zodal's capability discovery should automate.

**3.3 Refine's `pagination.mode` field.** The explicit `"server" | "client" | "off"` mode is cleaner than react-admin's implicit approach. This maps directly to zodal's universal affordance layer -- a declared pagination capability that both backend and UI respect.

**3.4 react-admin's `previousData` on mutations.** react-admin passes `previousData` to `update()` and `delete()`. This enables optimistic UI (show the change immediately, roll back on failure) without the UI needing to cache the old record separately. zodal should adopt this -- it's essential for the optimistic/pessimistic boundary question in the affordance layers doc.

**3.5 react-admin's `meta` passthrough on responses.** react-admin supports `meta` in both request params and response objects. The response `meta` can carry facets, aggregations, and other backend-provided information. This is a lightweight form of capability/metadata discovery that zodal can use for its capability negotiation system.

**3.6 Refine's `custom()` method.** An explicit typed escape hatch for non-CRUD operations. zodal should design its "operations beyond CRUD" (archive, publish, lock, etc.) as something more principled than either approach -- declared operations with typed parameters -- but `custom()` as a fallback valve is sound.

**3.7 Refine's multi-sort support.** react-admin only supports single-field sort in its base interface. Refine's `CrudSorting` (array of `{field, order}`) is the obviously correct choice for zodal.

**What zodal Should Avoid:**

**4.1 react-admin's `filter: any`.** The most glaring weakness. By leaving filters untyped, react-admin pushes all the complexity into every adapter and every custom hook call. There's no way for the UI to know what filter operators the backend supports, and no way to validate filter structures at the type level. zodal's entire value proposition depends on not repeating this mistake.

**4.2 react-admin's `getManyReference` as a required method.** This method exists because some REST APIs model relationships via sub-resource URLs (e.g., `GET /posts/123/comments`). But it's redundant with `getList` + a filter for most backends, and it forces every adapter author to implement it. zodal should handle this via the relationship affordance on the collection schema, not as a separate DataProvider method.

**4.3 Refine's `getApiUrl()` as a required method.** This leaks transport-layer concerns into the data abstraction. A DataProvider for IndexedDB or in-memory storage has no meaningful API URL. zodal targets storage backends well beyond HTTP -- requiring `getApiUrl()` would break the abstraction for local stores.

**4.4 Refine's `variables` naming for mutation data.** Refine calls mutation payloads `variables` (borrowing from GraphQL conventions). react-admin uses `data`. For zodal, `data` (or `value`, matching the `dol` convention) is clearer because zodal isn't GraphQL-specific.

**4.5 Neither framework's lack of real capability discovery.** Neither react-admin nor Refine have a mechanism where the backend **reports** what it can do. zodal needs something better -- a `getCapabilities()` method or equivalent that reports what operations, filters, and sorts the backend actually supports, enabling the UI to degrade gracefully.

---

#### Storage adapters (Dexie, localForage, Supabase)

This report examines three JavaScript storage libraries at different points on the local-to-remote spectrum: Dexie (rich local/IndexedDB), localForage (minimal local/KV), and Supabase JS (rich remote/PostgreSQL). Together they cover the storage spectrum zodal needs to support, from simple key-value to full relational queries.

**Source:** `zodal_research/Storage adapter API comparison - Dexie, localForage, Supabase.md`

**What zodal Should Steal:**

**From Dexie: The index-awareness pattern.** Dexie's sharp distinction between `where()` (indexed, fast) and `filter()` (JS-level, O(n)) maps directly to zodal's universal affordance concept. When a field is declared `filterable: 'range'`, `@zodal/store`'s IndexedDB adapter should use `where().between()` if the field is indexed, and fall back to `Collection.filter()` if not -- reporting this via capability discovery. The adapter should mirror Dexie's approach: try native first, emulate second, and let the consumer know which happened.

**From Dexie: Schema-as-string DSL for indexes.** zodal doesn't need to copy this verbatim (the Zod schema is richer), but the `defineCollection()` -> IndexedDB adapter pipeline should generate equivalent Dexie store definitions automatically from the schema's indexed/filterable annotations.

**From Dexie: BulkError partial-success semantics.** Dexie's approach to bulk operations -- commit successes, collect failures in a typed error -- is exactly right for `@zodal/store`'s bulk API. The current `DataProvider` interface should adopt a similar pattern: `{ succeeded: T[], failed: Array<{ item: T, error: Error }> }`.

**From Dexie: Reactive queries via `useLiveQuery()`.** Dexie's React hook re-runs a query function whenever underlying data changes. This is the right pattern for `@zodal/ui`'s `useCollection()` hook when backed by IndexedDB -- the hook should subscribe to change notifications from the adapter and invalidate.

**From localForage: The driver interface as a minimal contract.** localForage's 8-method driver interface is the closest JS analog to Python's `MutableMapping`. zodal's `DataProvider` should be able to wrap any localForage-compatible driver as the inner layer of a codec stack, adding query capabilities on top via client-side filtering.

**From localForage: Automatic driver fallback with `supports()`.** The `localforage.supports(localforage.INDEXEDDB)` pattern plus the ordered driver list is a clean capability detection model.

**From localForage: Auto-serialization.** localForage transparently handles `JSON.parse()`/`JSON.stringify()` even when falling back to localStorage. zodal should make the default codec for any adapter equally transparent, with zero config needed for JSON-serializable types.

**From Supabase JS: The chainable filter builder pattern.** Supabase's `.from('table').select().eq().gte().order().range()` chain is the best ergonomic model for expressing complex queries in a type-safe, composable way.

**From Supabase JS: The `{ data, error }` return type.** Every Supabase operation returns this two-field object instead of throwing. zodal's `DataProvider` methods should return a similar discriminated result type rather than throwing, especially for operations that might partially succeed.

**From Supabase JS: Relational select syntax.** Supabase's `select('posts(title, author(name))')` syntax for embedding related records in a single query is exactly the kind of "relationships" affordance zodal needs.

**From Supabase JS: Conditional filter building.** Supabase's pattern of building filters incrementally maps well to zodal's dynamic UI-driven filtering.

**What zodal Should Avoid:**

**From Dexie: The pagination trap.** Dexie's `offset()` is O(N). Combining `sortBy()` with `offset()`/`limit()` is even worse. zodal's IndexedDB adapter must default to cursor-based pagination (keyset/seek) rather than offset, and should document this limitation clearly in the capability report.

**From Dexie: Schema-as-string fragility.** While terse, Dexie's `'++id, name, age'` string doesn't express types, constraints, or non-index metadata. zodal's whole point is to derive this from Zod, so duplicating schema in Dexie's DSL would violate DRY.

**From localForage: Zero query support as an API design ceiling.** localForage proves that a pure KV interface is insufficient for any collection use case. zodal should never expose a "collection" adapter that lacks at least `getList()` with basic filtering -- if the underlying driver is KV-only, the adapter layer must add client-side query support and report this as emulated.

**From localForage: No TypeScript generics on the storage interface.** localForage's `getItem(key: string): Promise<any>` loses all type safety. zodal's adapters must be generic: `DataProvider<T>` where T flows through the codec pipeline.

**From localForage: Stale maintenance.** localForage's last significant release was 1.10.0 in 2021. WebSQL (one of its three backends) is deprecated. zodal shouldn't depend on localForage directly, but can use its driver contract as inspiration.

**From Supabase JS: Remote-only assumption.** The Supabase client has no offline story. zodal's REST adapter should add optional middleware layers (optimistic update buffer, request queue for offline) that Supabase doesn't provide.

**From Supabase JS: PostgREST syntax leakage.** Supabase's `or()` and `filter()` methods accept raw PostgREST filter strings. zodal's filter abstraction should be backend-agnostic.

**From Supabase JS: 1000-row default limit.** Supabase silently caps responses at 1000 rows unless configured otherwise. zodal's capability discovery for a REST adapter should report the pagination limit and default page size.

---

#### Type-safe query builders (Prisma, Drizzle)

This report compares two TypeScript ORMs representing fundamentally different strategies: Prisma (schema-first with code generation) and Drizzle (code-first with type inference). The most relevant findings are the dual filter representation (object-style vs. function-style), per-type filter operator sets, the insert vs. select type distinction, and the Drizzle-Zod bridge that validates zodal's schema-centric approach.

**Source:** `zodal_research/Type-safe query builders in Prisma and Drizzle.md`

**What zodal Should Steal:**

**3.1 The Dual Filter Representation (from both).** Prisma's object-style `WhereInput` maps perfectly to zodal's `FilterConfig`. Drizzle's function-style `eq(column, value)` maps to the kind of API a `DataProvider` adapter would use internally. zodal should support **both**:

- **Object-style filters** for the declarative/serializable layer (UI -> DataProvider, URL params, saved views):
  ```typescript
  { field: 'age', operator: 'gte', value: 18 }
  // or Prisma-style: { age: { gte: 18 } }
  ```

- **Function-style filters** as an escape hatch / adapter-internal API, for backends where composable SQL fragments make more sense.

The object-style is the "universal affordance" (serializable, UI-renderable); the function-style is a backend-specific adapter concern.

**3.2 Per-Type Filter Operator Sets (from Prisma).** Prisma's pattern of generating type-specific filter types (`StringFilter`, `IntFilter`, `DateTimeFilter`) with appropriate operators is exactly what zodal's affordance system needs. When a field is declared `z.string()`, the available filter operators should be `{ equals, contains, startsWith, endsWith, in, notIn }`. When it's `z.number()`, they should be `{ equals, gt, gte, lt, lte, in, notIn }`.

zodal's inference engine should produce a `FilterOperatorSet` per-field based on the Zod type, which serves the same purpose as Prisma's generated `StringFilter` / `IntFilter` types but derived at runtime from the schema rather than code-generated.

**3.3 Insert vs. Select Type Distinction (from Drizzle).** Drizzle's `$inferSelect` vs. `$inferInsert` is a sharp insight: the type of data you read is different from the type of data you write. zodal's `defineCollection()` should explicitly produce both a `SelectType` and an `InsertType` (and an `UpdateType` = `Partial<InsertType>`), derived from affordances like `editable`, `default`, `autoGenerated`.

**3.4 `createSelectSchema` / `createInsertSchema` Pattern (from drizzle-zod).** The pattern of `createXSchema(source, overrides?)` where overrides can refine or replace individual fields is exactly zodal's approach with `defineCollection()` and field-level `.meta()` overrides. Drizzle validates the pattern.

**3.5 Composable Query Fragments (from Drizzle).** Drizzle's `and()` and `or()` operators gracefully handle `undefined` values, ignoring them -- which enables clean conditional filter composition without nested if-statements. zodal's `DataProvider` filter API should similarly handle `undefined` filter values gracefully.

**3.6 Custom Types / Codec Pattern (from Drizzle).** Drizzle's `customType` interface has explicit `toDriver` and `fromDriver` methods. This maps almost 1:1 to zodal's codec model: `data` = outer type, `driverData` = inner type, `toDriver` = `valEncoder`, `fromDriver` = `valDecoder`.

**What zodal Should Avoid:**

**4.1 Code Generation (Prisma's approach).** Prisma generates types from the `.prisma` schema, requiring `prisma generate` after every change. zodal already commits to Zod-native inference, which aligns with Drizzle's philosophy. The code-generation approach adds friction (stale types, CI complexity, IDE lag on file rewrites) that zodal should not adopt. However, zodal should note that Prisma's generated types actually check faster than Drizzle's inferred types at scale -- zodal should watch for type-level performance as schemas grow.

**4.2 Prisma's DSL Lock-in.** Prisma's choice of a custom schema language creates a walled garden. zodal's Zod-native approach avoids this entirely -- schemas are first-class TypeScript values that can be composed, transformed, and introspected at runtime.

**4.3 Drizzle's Select-Before-From API Ordering.** Drizzle uses `select` before `from`, which means the select clause cannot type-check against available tables. zodal's `DataProvider.getList()` avoids this by taking a single options object where all constraints are co-located.

**4.4 Drizzle's Incomplete Type Safety in the SQL Builder.** Drizzle can accept technically invalid queries that TypeScript does not catch. For zodal, this is a caution about the function-style filter approach. zodal should prefer the object-style filter representation for its public API and reserve the function-style for adapter internals.

---

### Group D: Application Patterns

---

#### dol ideas for zodal

dol (Data Object Layer) is a pure-Python library that provides uniform dict-like interfaces (`Mapping`/`MutableMapping`) to any storage backend. It is zodal's spiritual ancestor. The `wrap_kvs` function -- which applies composable key/value transforms to any store -- is the core mechanism that `@zodal/store` needs to port. The report also identifies the critical `kvStoreToDataProvider` bridge pattern that connects dol's minimal KV interface to zodal-ui's richer `DataProvider`.

**Source:** `zodal_research/dol_ideas_for_zodal.md`

**What zodal Should Steal:**

**3.1. The `wrap_kvs` / `wrapKvs` Pattern -- Wholesale.** This is dol's crown jewel and zodal has already identified it. The ability to take *any* store and produce a new store with different outer types via composable transform layers is the core mechanism that `@zodal/store` needs. zodal should preserve the **four-function transform pipeline** and the **key-conditioned variants** (`preset`/`postget`). The key-conditioned transforms solve a real problem that many codec systems miss: choosing the serializer based on the key (e.g., file extension, content-type header).

**3.2. Codec Composition via Operator Overloading.** The `+` operator for composing codecs is one of dol's most elegant features. In TypeScript, zodal should offer `composeCodecs(a, b)` but *also* consider a fluent API:

```typescript
const pipeline = Codecs.csv().then(Codecs.stringToBytes()).then(Codecs.gzip());
```

This reads left-to-right like dol's `Pipe()` and is more natural in TypeScript than operator overloading (which TS doesn't support on arbitrary types).

**3.3. The `Pipe` Wrapping Pattern.** dol's `Pipe(KeyCodecs.suffixed('.pkl'), ValueCodecs.pickle())` creates a callable that applies multiple codec layers in order. zodal should provide an equivalent that stacks multiple codec wrappers:

```typescript
const wrapPost = pipe(
  withKeyCodec(Codecs.pathPrefixed('/api/posts')),
  withValueCodec(Codecs.zodValidated(PostSchema)),
);
const postStore = wrapPost(rawStore);
```

**3.4. The `head()` Method.** dol's `Collection.head()` returns the first (key, value) pair for quick inspection without needing to know any key. This is surprisingly useful for debugging and discovery. zodal's `DataProvider` should include something similar -- perhaps `peek(): Promise<T | undefined>`.

**3.5. Caching as a Composable Layer.** zodal should adopt the pattern that caching is not special -- it's just another store wrapping another store.

**3.6. Pre-built Codec Namespaces.** `KeyCodecs.suffixed('.json')`, `ValueCodecs.pickle()`, `ValueCodecs.gzip()` -- these are grab-and-go transforms. zodal should ship with equivalent ready-made codecs: `Codecs.json`, `Codecs.zodValidated(schema)`, `Codecs.pathPrefixed(prefix)`, `Codecs.urlEncoded`, and allow third-party extensions.

**3.7. The `kvStoreToDataProvider` Bridge.** The bridge from dol's minimal KV interface to zodal-ui's richer `DataProvider` (with filtering, sorting, pagination) is the key DRY mechanism. A KV store + a Zod schema should be sufficient to derive a working `DataProvider` with client-side filtering/sorting fallback, and the capability discovery system tells the UI whether server-side operations are available.

**What zodal Should Avoid:**

**4.1. The Synchronous-Only Design.** dol is entirely synchronous. All real frontend storage operations are async (`fetch`, IndexedDB, etc.). zodal's `KvStore` interface must be `Promise`-based from the start.

**4.2. The `Y_of_X` Naming Convention.** dol's `id_of_key`, `key_of_id`, `obj_of_data`, `data_of_obj` naming is mathematically precise but unfamiliar to most developers. zodal's existing `keyEncoder`/`keyDecoder`/`valEncoder`/`valDecoder` naming is more conventional and should be kept.

**4.3. The `store_decorator` Meta-Decorator's 4-Way Ambiguity.** The fact that `wrap_kvs` works as a class decorator, class decorator factory, instance decorator, and instance decorator factory is powerful but non-obvious. zodal should have explicit `wrapKvs(store, transforms)` for instances and, if needed, a separate `createStoreType(transforms)` for creating reusable store classes.

**4.4. `clear()` Disabling via LSP Violation.** dol disables `clear()` by assigning a method that throws. In TypeScript, zodal should express this at the type level: if a store doesn't support clear, it simply shouldn't have a `clear` method on its type.

**4.5. No Generic Type Parameters.** dol's `KvReader` has no type parameters. zodal must be generic from the start: `KvStore<K, V>`.

**4.6. The "dol Doesn't Query" Limitation.** dol deliberately provides only list+get+set+delete -- no filtering, no sorting, no complex queries. zodal spans both storage and UI, and needs the richer `getList()` interface.

---

#### sqlrooms and zodal

SQLRooms is a React toolkit for building data-centric analytics applications powered by DuckDB-WASM running entirely in the browser. Its central contribution to zodal is the slice composition pattern for Zustand stores (curried factory functions), the explicit config/runtime state split using Zod schemas, and the Zod schema merging pattern for modular configuration.

**Source:** `zodal_research/sqlrooms_and_zodal.md`

**What zodal Should Steal:**

**The Slice Composition Pattern.** SQLRooms' slice pattern is an excellent model for zodal's `@zodal/ui` state management. The key idea: **each feature declares its state shape as a factory function that accepts `(set, get, store)` and returns a partial state object.** This maps cleanly to zodal's collection model:

- A zodal collection's client-side state (sorting, filtering, pagination, selection, column visibility) could be a "collection slice"
- The `createCollectionStore()` function in `@zodal/ui` already uses pure-function reducers -- it could adopt the curried slice factory pattern to compose multiple collections into a single store
- Slices namespace their state (`state.sqlEditor.config.queries`) -- zodal could namespace by collection name (`state.users.sorting`, `state.products.filters`)

What SQLRooms adds on top of the vanilla Zustand pattern is the **curried factory** -- their slices are functions that accept config and *return* the `(set, get, store) => state` function, giving you a two-phase creation: `createSqlEditorSlice(config)(set, get, store)`. That extra level of indirection lets each slice accept its own initialization options before being composed.

For zodal, the implication is that you'd be building on a well-trodden, community-understood pattern rather than adopting something niche. The curried factory extension is worth keeping -- it maps naturally to `createCollectionSlice(collectionDef)(set, get, store)`.

**Config/Runtime State Split.** SQLRooms' explicit split between `config` (serializable, persistable via Zod) and `room` (transient runtime state) is directly applicable. A zodal collection has both:
- **Config:** current sort direction, active filters, selected columns, page size -- all serializable, all restorable
- **Runtime:** loading state, error state, selection set, optimistic update queue -- transient

zodal should adopt this pattern: `collectionConfig` (Zod-validated, serializable) vs `collectionState` (runtime-only).

**Zod Schema Merging for Modular Config.** The `.merge()` composition pattern for building combined config schemas from independent slice schemas is clean and directly usable.

**The `useSql()` Hook Design.** While zodal won't use SQL, the hook design pattern is worth noting: `useSql()` accepts a query + an `enabled` flag, returns `{ data, isLoading, error }`, automatically re-runs on dependency changes, and supports query deduplication.

**What zodal Should Avoid:**

**SQL as the Universal Query Language.** SQLRooms is tightly coupled to DuckDB and SQL as the query interface. Every data operation is a raw SQL string. This means there's **no abstract query model**. zodal's entire value proposition is the declarative, schema-driven query model.

**No DataProvider Abstraction.** SQLRooms has no equivalent of zodal's `DataProvider<T>` interface. Everything goes through the DuckDB connector via SQL. This means you can't swap backends, can't layer codecs, can't compose providers.

**Monolith Store for Unrelated Concerns.** SQLRooms puts everything -- AI state, SQL editor state, layout state, DuckDB state -- into one enormous Zustand store via slice composition. zodal should allow per-collection stores (or scoped slices within a shared store) rather than requiring one global store for all collections.

**Heavy Runtime, No Static Analysis.** SQLRooms has no inference engine, no convention-over-configuration for field types, no schema-driven UI generation. Each panel, each visualization, each interaction is explicitly wired.

---

#### cosmograph and zodal

Cosmograph is a multi-tier product for GPU-accelerated graph visualization and analytics. Its most zodal-relevant pattern is the configuration-driven visual mapping using a Column + Strategy + Fn triple for every visual property: which data column maps to which visual channel, what strategy algorithm interprets it, and an optional escape hatch function. The auto-strategy resolution when strategy is `undefined` validates zodal's inference approach.

**Source:** `zodal_research/cosmograph and zodal.md`

**What zodal Should Steal:**

**The Column + Strategy + Fn Triple.** Cosmograph's visual mapping pattern is a clean, practical design for zodal's field-level affordances. The key insight: **separate the "which field" from "what strategy" from "custom override function"**. Cosmograph proves this triple scales to many visual channels without combinatorial explosion. zodal has the same need: `filterable`, `sortable`, `editable`, `groupable` are all channels that need `{ field, strategy, fn? }`.

**Auto-Strategy Resolution.** When `pointColorStrategy` is `undefined`, Cosmograph infers the best strategy from the data type. Numeric -> `continuous`, string -> `categorical`, color string -> `direct`. This is exactly zodal's 4-layer inference engine, but Cosmograph does it per-visual-channel rather than per-affordance. zodal should ensure its inference layer can resolve not just "is this field filterable?" but also "what *kind* of filter widget?" -- i.e., the strategy, not just the boolean capability.

**Data Prep as an Explicit, Async Phase.** Cosmograph's `prepareCosmographData()` is an honest acknowledgment that transforming raw data into an optimized internal format is a distinct step that can be expensive and asynchronous. zodal's codec model assumes synchronous transforms, but for large datasets or complex transformations, an async prep phase would be valuable.

**The Python Widget as Isomorphic API.** The `py_cosmograph` widget uses the exact same `*By` config vocabulary as the JS library. For zodal, this validates the idea that the `defineCollection()` schema + affordances should be expressible in both JS/TS and Python (via `dol`), with the same semantic vocabulary.

**What zodal Should Avoid:**

**Flat Config Instead of Schema-Attached Metadata.** `CosmographConfig` is a single flat interface with 80+ properties. Every visual mapping is a top-level config key rather than metadata attached to the data schema itself. This means the config and the schema are separate -- you can easily misconfigure `pointColorBy: 'nonexistent_column'` with no type error. zodal's Zod-native approach (affordances as `.meta()` on the schema) is fundamentally better because the column-to-affordance binding is checked by the type system.

**No DataProvider / Collection Abstraction.** Like SQLRooms, Cosmograph has no abstraction over data access -- it's DuckDB-all-the-way-down. zodal must not couple its visual mapping system to a specific query engine.

**Closed-Source Core.** The `@cosmograph/cosmograph` library is on npm but not open-source, limiting the ability to study internal architecture details.

**Implicit State vs. Explicit Store.** The Cosmograph library manages its own internal state imperatively. zodal should ensure its state management is declarative from the start.

---

## What zodal Should Avoid -- Consolidated

The following anti-patterns are distilled from all 16 research reports, organized by theme:

### Schema & Metadata Anti-Patterns

1. **Metadata on validation refinements** (AutoForm's `superRefine()` hack). Conflates validation and display concerns. Use Zod v4's `.meta()` or a custom registry instead.
2. **Metadata loss on schema transforms** (Zod v4). `.optional()`, `.array()`, `.refine()` return new instances that lose registry entries. Always call `.meta()` last, or use `.register()` on inner schemas before wrapping.
3. **Global singleton registries** (Zod v4 `globalRegistry`, superjson's `registerCustom`). Creates collisions in monorepos and SSR. Use dedicated custom registries.
4. **Separate UI schema documents** (JSON Forms). Maintaining two parallel, loosely-coupled artifacts is fragile. Attach affordances to the data schema itself.
5. **Custom DSL lock-in** (Prisma Schema Language). Prevents programmatic composition. Keep schemas as first-class TypeScript values (Zod).
6. **Code generation for types** (Prisma). Adds friction (stale types, CI complexity). Prefer runtime inference from Zod, but watch type-checking performance at scale.

### Interface & API Anti-Patterns

7. **Untyped filters** (react-admin's `filter: any`). Pushes complexity into every adapter. Use structured, typed operator sets tied to field affordances.
8. **All-or-nothing required methods** (react-admin's 9 required DataProvider methods). Make batch operations optional with single-call fallbacks (Refine's pattern).
9. **Transport-layer leakage** (Refine's `getApiUrl()`, Supabase's PostgREST syntax in `or()`). The DataProvider interface must be backend-agnostic.
10. **No capability discovery** (react-admin, Refine, Metawidget, Cosmograph). The backend must be able to report what it supports. zodal needs a `getCapabilities()` method.
11. **Raw numeric ranks without namespacing** (JSON Forms). Use named priority bands (`'default' | 'library' | 'app' | 'override'`).

### State & Performance Anti-Patterns

12. **Monolithic store for collections** (Zustand single store, SQLRooms). Every filter change triggers selector re-evaluation for every consumer. Decompose into independent reactive units.
13. **Immer for all mutations** (performance cost). Immer is 2-3x slower than handwritten reducers. Make it opt-in, provide fast paths for bulk operations.
14. **Mixing actions and state** (Zustand co-location). Conflates serializable state with non-serializable functions. Keep them separate.
15. **Atom proliferation** (Jotai's per-row atoms). Managing 500+ atoms creates cleanup/GC complexity. Encapsulate per-item subscription internally.

### Architecture Anti-Patterns

16. **DOM-returning pipelines** (Metawidget's `buildWidget()`). Couples to the rendering target. Return config objects, not widgets.
17. **Synchronous-only design** (dol). All frontend storage is async. Promise-based from the start.
18. **No inference at all** (json-render, SQLRooms). Requiring explicit declaration for everything kills the convention-over-configuration principle.
19. **Single-layer type dispatch** (AutoForm's type-string mapping). One layer of inference is insufficient -- zodal needs Zod type + refinements + name heuristics + `.meta()` overrides.
20. **Static table components** (json-render's `Table`). Collection display must be affordance-aware, not presentation-only.
21. **Class-based bridge architecture** (Uniforms `extends Bridge`). Makes composition harder. Prefer functional/interface-based approaches.
22. **Infallible encode** (io-ts). Encoding might involve validation. Both encode and decode should be fallible.
23. **14+ type parameters** (effect/Schema v4). Extremely precise type-level tracking but creates complex recursive types that slow the TypeScript language server. Keep zodal's type parameter count manageable (4 max for codecs).

---

## Conflicts and Tensions

Several research reports recommend approaches that are in tension with each other. zodal must make deliberate choices at these intersection points:

### 1. Object-Style vs. Function-Style Filters

**Prisma** recommends object-style filters (`{ age: { gte: 18 } }`) for type safety and serializability. **Drizzle** recommends function-style filters (`gt(users.age, 18)`) for composability and SQL-level power. **Refine** uses a structured array of `CrudFilter` objects. **Resolution:** zodal should use object-style as the primary public API (serializable, UI-renderable, type-safe) and reserve function-style for adapter internals. The two representations should be interconvertible.

### 2. Zustand (Single Store) vs. Jotai (Atomic State)

**Zustand** is simpler, has a mature middleware ecosystem (persist, immer, devtools), and the slice pattern is well-understood. **Jotai** offers finer-grained reactivity (per-atom subscriptions, `splitAtom` for per-item updates, derived atom DAGs). The **State Management report** explicitly recommends combining them: Zustand-style middleware for the mutation pipeline, Jotai-style derived atoms for the filter->sort->paginate pipeline. **Tension:** combining two state management paradigms increases complexity. zodal may need to choose one as primary and offer the other's benefits through internal implementation.

### 3. `.meta()` on Schema vs. Separate Affordance Config

The **Zod v4 metadata report** warns that `.meta()` is fragile (metadata loss on transforms) and recommends a custom registry with `.register()`. The **AutoForm** and **json-render** reports show the appeal of schema-attached metadata. The **dol report** and current `zod-collection-ui` use a separate config object. **Resolution:** The hybrid approach (Strategy 4 in the Zod v4 report) -- read `.meta()` where present, fall back to inference, allow explicit overrides -- is the recommended path. But zodal must prominently document the `.meta()` ordering constraint.

### 4. Ranked Testers vs. String-Keyed Dispatch

**JSON Forms** recommends scored ranked testers for maximum flexibility. **AutoForm** and **Uniforms** use simpler string-keyed dispatch (type name -> component). **TanStack Table** uses `meta` properties. **Tension:** Ranked testers are more powerful but harder to debug. zodal should adopt ranked testers with built-in `explain()` debugging, while maintaining string-keyed shortcuts for the common case (`editWidget: 'date-range'` should work without writing a tester).

### 5. Zod v4 Codecs vs. zodal's Own Codec Model

The **Codec-Transform report** recommends using `z.codec()` directly for field-level transforms. The **dol report** recommends composable codec wrappers at the store level. **Tension:** `z.codec()` is schema-level (transforms individual field values), while `wrapKvs` codecs are store-level (transforms entire keys/values in transit). These operate at different granularities and should coexist: `z.codec()` for field-level transforms that the inference engine detects, `composeCodecs()`/`wrapKvs` for provider-level wrapping.

### 6. TanStack DB as Ally or Competitor

The **State Management report** identifies TanStack DB as building "a subset of what zodal needs" -- typed collections, live queries, optimistic mutations. **Tension:** zodal could build on top of TanStack DB (leveraging its differential dataflow engine) or build independently (maintaining full control of the abstraction). TanStack DB is React-specific, tightly coupled to TanStack Query, and lacks zodal's schema-driven affordance layer. **Resolution:** Watch TanStack DB's evolution. zodal's differentiator is the declarative affordance layer, not the collection primitive itself. If TanStack DB matures and becomes framework-agnostic, zodal could potentially adopt it as an internal engine while adding the affordance/inference/generator layers on top.

### 7. Headless Purity vs. Ready-to-Use Components

**TanStack Table** is purely headless (no components). **AutoForm**, **Uniforms**, and **JSON Forms** ship themed components. zodal plans both `@zodal/ui` (headless configs) and `@zodal/ui-shadcn` (themed components). **Tension:** The more zodal invests in themed components, the more it risks coupling to a specific UI framework. The headless layer must remain the primary API; themed components should be thin wrappers that demonstrate the pattern but are easily replaceable.
