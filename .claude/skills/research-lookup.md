# Skill: Research Lookup

## Purpose
Quickly find the right research report or reference for a zodal design question.

## Concept -> Report Mapping

| Concept/Topic | Primary Report | Secondary Reports |
|---------------|---------------|-------------------|
| Table columns, sorting, filtering | TanStack Table v8 column definitions and plugin architecture.md | DataProvider Interfaces - react-admin vs. Refine.md, State Management for Collection UIs... |
| Form generation, widgets | AutoForm schema-to-widget mapping and limitations.md | Uniforms schema-agnostic bridge architecture.md, JSON Forms (EclipseSource)... |
| Renderer selection, dispatch | JSON Forms (EclipseSource) - Tester:Renderer Registry Architecture.md | Metawidget's pluggable pipeline architecture for UI generation.md, json-render... |
| State management | Zustand & Immer.md | State Management for Collection UIs..., sqlrooms_and_zodal.md |
| Data fetching, CRUD | DataProvider Interfaces - react-admin vs. Refine.md | Storage adapter API comparison..., Type-safe query builders... |
| Schema metadata | Zod v4 metadata API and schema preservation.md | Codec-Transform Systems Compared..., analysis_zod_v4_metadata.md |
| Codec, transforms | Codec-Transform Systems Compared - io-ts, effect:Schema, superjson, zod-to-json-schema.md | dol_ideas_for_zodal.md, Zod v4 metadata... |
| Storage, IndexedDB | Storage adapter API comparison - Dexie, localForage, Supabase.md | dol_ideas_for_zodal.md |
| ORM, typed queries | Type-safe query builders in Prisma and Drizzle.md | DataProvider Interfaces... |
| AI/LLM integration | json-render (Vercel Labs) component catalog and Zod-native action schemas.md | (prompt.ts in predecessor) |
| Python interop | dol_ideas_for_zodal.md | cosmograph and zodal.md |
| Graph visualization | cosmograph and zodal.md | sqlrooms_and_zodal.md |
| Pipeline architecture | Metawidget's pluggable pipeline architecture for UI generation.md | (meshed essay in top-level corpus) |

## Report Index by Filename

All reports are at: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/zodal_research/`

| # | Filename | One-Line Description |
|---|----------|---------------------|
| 1 | AutoForm schema-to-widget mapping and limitations.md | How AutoForm maps Zod schemas to form widgets, plus its limitations |
| 2 | Codec-Transform Systems Compared - io-ts, effect:Schema, superjson, zod-to-json-schema.md | Side-by-side comparison of codec/transform approaches across TS libraries |
| 3 | cosmograph and zodal.md | How Cosmograph's Column+Strategy+Fn triple maps to zodal concepts |
| 4 | DataProvider Interfaces - react-admin vs. Refine.md | CRUD interface design patterns from react-admin and Refine |
| 5 | dol_ideas_for_zodal.md | Python dol patterns (wrap_kvs, Codec) applicable to zodal's TS design |
| 6 | JSON Forms (EclipseSource) - Tester:Renderer Registry Architecture.md | Ranked tester/renderer dispatch and composable predicates |
| 7 | json-render (Vercel Labs) component catalog and Zod-native action schemas.md | AI-driven generative UI with component catalog and Zod-native schemas |
| 8 | Metawidget's pluggable pipeline architecture for UI generation.md | Five-stage pluggable pipeline: inspect, widen, decide, build, layout |
| 9 | sqlrooms_and_zodal.md | Slice-based composition, config/runtime split, DuckDB-WASM patterns |
| 10 | State Management for Collection UIs - Zustand, Jotai, TanStack Store, and TanStack Query.md | Comparison of state management approaches for collection UIs |
| 11 | Storage adapter API comparison - Dexie, localForage, Supabase.md | Client-side and hybrid storage adapter APIs compared |
| 12 | TanStack Table v8 column definitions and plugin architecture.md | Headless table engine: column defs, features as plugins, row models |
| 13 | Type-safe query builders in Prisma and Drizzle.md | Schema-driven type-safe query building in Prisma and Drizzle ORM |
| 14 | Uniforms schema-agnostic bridge architecture.md | Schema-agnostic bridge with 8-method contract and ComponentDetector |
| 15 | Zod v4 metadata API and schema preservation.md | Zod v4 registries, .meta(), metadata-loss footguns, codec design |
| 16 | Zustand & Immer.md | Vanilla-first Zustand store design with Immer middleware and patches |

## Navigation Tips
- Research reports are at: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/zodal_research/`
- Each report has sections: What It Is, Architecture, What zodal Should Steal, What zodal Should Avoid
- Reference summaries (curated): `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/reference_summaries/`
- Raw downloads: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/reference_downloads/`
- Top-level corpus docs (vision, taxonomy, landscape report): `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/`
- Synopsis docs (distilled for zodal development): `docs/`
