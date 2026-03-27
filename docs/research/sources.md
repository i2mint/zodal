# Source Material Manifest

## How to Use
This index maps every source file to its location and the synopsis doc(s) that reference it.

Synopsis docs are in this folder:
- **docs/01** = `01-vision-and-scope.md`
- **docs/02** = `02-existing-implementation.md`
- **docs/03** = `03-technology-research-takeaways.md`
- **docs/04** = `04-affordance-taxonomy-summary.md`
- **docs/05** = `05-architecture-and-patterns.md`
- **docs/06** = `06-prior-art-and-landscape.md`

---

## Research Corpus
Location: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/`

### Top-Level Documents
| File | Description | Referenced By |
|------|-------------|---------------|
| zodal_vision.md | Vision statement: the problem, the goal, schema-driven affordances | docs/01 |
| README.md | Project context index: key files and directory layout | -- |
| zoddal_docs_guide.md | Guide to the documentation suite and reading order | -- |
| collection_affordances_taxonomy.md | Exhaustive taxonomy of collection affordances (item, selection, collection, field, view levels) | docs/04 |
| collection_affordances_taxonomy.pdf | PDF export of the above | -- |
| schema_affordance_ui_report.md | Landscape analysis: MBUID, HATEOAS, affordance theory, ecosystem survey | docs/05, docs/06 |
| schema_affordance_ui_report.pdf | PDF export of the above | -- |
| collection-pattern-concepts.md | Generic collection pattern formalization, operation taxonomy, capability schema | docs/05 |
| collection-pattern-implementation-in-cosmograph.md | Mapping the generic collection pattern to Cosmograph (snapshots, stories) | docs/05 |
| cosmograph_tech_stack.md | Cosmograph technology stack reference (alias) | docs/05 |
| reference_notes.md | Implementation-relevant extractions from 87+ references, organized by build need | docs/05 |
| resources_design.md | Resource collection architecture for Cosmograph: ROA, generic repository, command pattern | docs/05 |
| resources_design_chatgpt.md | ChatGPT-generated variant of the resource architecture design | -- |
| resources_design_gemini.md | Gemini-generated variant of the resource architecture design | -- |
| implementation_design.pdf | Implementation design document (PDF) | -- |
| meshed - Formal Foundations and Design Patterns for Declarative Object Composition.md | Meshed essay: DAG-as-SSOT, topology/execution separation, composition primitives | docs/01, docs/05, docs/06 |
| qh - From Function to Web Service and Back - Schema-Based Middleware Design.md | QH essay: schema-based middleware, function-to-service round-trip | docs/05 |

### Research Reports (zodal_research/)
| File | Topic | Referenced By |
|------|-------|---------------|
| TanStack Table v8 column definitions and plugin architecture.md | Headless table engine, column defs, plugin architecture | docs/03, docs/05 |
| AutoForm schema-to-widget mapping and limitations.md | Schema-to-widget mapping, SchemaProvider, fieldConfig | docs/03 |
| json-render (Vercel Labs) component catalog and Zod-native action schemas.md | AI-driven generative UI, component catalog, Zod-native actions | docs/03, docs/06 |
| Metawidget's pluggable pipeline architecture for UI generation.md | Five-stage UI generation pipeline, pluggable architecture | docs/03, docs/05 |
| Zod v4 metadata API and schema preservation.md | Registries, `.meta()`, metadata-loss footgun, codecs | docs/03 |
| Codec-Transform Systems Compared - io-ts, effect:Schema, superjson, zod-to-json-schema.md | Codec/transform comparison across libraries | docs/03 |
| Uniforms schema-agnostic bridge architecture.md | Schema-agnostic bridge, 8-method contract, ComponentDetector | docs/03 |
| JSON Forms (EclipseSource) - Tester:Renderer Registry Architecture.md | Tester/renderer registry, ranked dispatch, composable predicates | docs/03, docs/05 |
| Zustand & Immer.md | Vanilla-first store, middleware composition, Immer patches | docs/03, docs/05 |
| State Management for Collection UIs - Zustand, Jotai, TanStack Store, and TanStack Query.md | State management library comparison for collection UIs | docs/03 |
| DataProvider Interfaces - react-admin vs. Refine.md | CRUD interface design, filters, pagination, capability discovery | docs/03 |
| Storage adapter API comparison - Dexie, localForage, Supabase.md | Client-side storage adapter comparison | docs/03 |
| Type-safe query builders in Prisma and Drizzle.md | Schema-to-query type safety, ORM comparison | docs/03 |
| dol_ideas_for_zodal.md | wrap_kvs, Codec composition, KvStore-to-DataProvider bridge | docs/03, docs/05 |
| sqlrooms_and_zodal.md | Slice composition, config/runtime split, DuckDB-WASM | docs/03 |
| cosmograph and zodal.md | Column+Strategy+Fn triple, auto-strategy resolution, data prep | docs/03 |

### Reference Summaries (reference_summaries/)
| File | Topic | Referenced By |
|------|-------|---------------|
| analysis_affordance_standards.md | Analysis of affordance standards across ecosystems | docs/04, docs/05 |
| analysis_json_render.md | Deep analysis of json-render (Vercel Labs) | docs/03 |
| analysis_tanstack_table.md | Deep analysis of TanStack Table architecture | docs/03, docs/05 |
| analysis_zod_v4_metadata.md | Deep analysis of Zod v4 metadata API | docs/03 |
| ref_01_w3c_mbui_report.md | W3C MBUI report summary | docs/06 |
| ref_04_w3c_mbui_intro.md | W3C MBUI introduction summary | docs/06 |
| ref_10_meshery_schema_ui.md | Meshery schema-driven UI patterns | docs/06 |
| ref_11_hydra_core.md | Hydra Core hypermedia vocabulary | docs/06 |
| ref_12_siren.md | Siren hypermedia spec | docs/06 |
| ref_13_hateoas_ai.md | HATEOAS and AI integration patterns | docs/06 |
| ref_21_json_forms.md | JSON Forms reference summary | docs/03, docs/06 |
| ref_30_shadcn_datatable.md | shadcn data table reference | docs/05 |
| ref_40_tanstack_column_def.md | TanStack column definition reference | docs/03, docs/05 |
| ref_41_odata_capabilities.md | OData capabilities vocabulary | docs/06 |
| ref_42_zod_metadata.md | Zod metadata reference | docs/03 |
| ref_49_schema_org_actions.md | Schema.org actions vocabulary | docs/06 |
| ref_51_graphql_introspection.md | GraphQL introspection reference | docs/06 |
| ref_53_headless_components.md | Headless component patterns | docs/05, docs/06 |
| ref_65_zustand_immer.md | Zustand + Immer integration reference | docs/03, docs/05 |
| ref_66_zustand_selectors.md | Zustand selectors reference | docs/03, docs/05 |
| ref_81_json_render.md | json-render reference summary | docs/03 |
| ref_83_llm_format_restrictions.md | LLM format restrictions research | docs/06 |
| ref_86_jsonschemabench.md | JSONSchemaBench benchmark reference | docs/06 |

---

## Predecessor Code
Location: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`

### Source Modules (src/)
| File | Purpose | Referenced By |
|------|---------|---------------|
| types.ts | Type definitions (40+ affordances, CollectionConfig, FieldConfig) | docs/02, docs/04 |
| inference.ts | Schema-to-affordance inference engine (449 lines) | docs/02 |
| collection.ts | Collection resolution, default affordance merging | docs/02 |
| generators.ts | UI component generation from resolved collections | docs/02 |
| store.ts | Zustand store for collection state management | docs/02, docs/05 |
| data-provider.ts | CRUD data provider abstraction | docs/02, docs/03 |
| prompt.ts | LLM prompt generation from schemas | docs/02 |
| codegen.ts | Code generation from collection definitions | docs/02 |
| index.ts | Package entry point / re-exports | docs/02 |

### Documentation (docs/)
| File | Purpose | Referenced By |
|------|---------|---------------|
| collection_affordances_taxonomy.md | Affordance taxonomy (predecessor copy) | docs/04 |
| implementation_design.md | Implementation design notes | docs/05 |
| schema_affordance_ui_report.md | Schema/affordance/UI report (predecessor copy) | docs/06 |
| roadmap.md | Development roadmap | docs/01 |
