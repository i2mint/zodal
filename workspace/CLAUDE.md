# zodal Ecosystem — Workspace Guide

## What This Workspace Is

This workspace contains the **zodal monorepo** and all **satellite packages** that implement concrete backends and renderers using zodal's abstractions. Every package in this directory is part of a single cohesive ecosystem.

```
_zodals/
  zodal/                    # Core monorepo (@zodal/core, @zodal/store, @zodal/ui)
  zodal-store-fs/           # DataProvider → Node.js filesystem
  zodal-store-http/         # DataProvider → any HTTP endpoint (fetch)
  zodal-store-localstorage/ # DataProvider → browser localStorage
  zodal-store-s3/           # DataProvider → AWS S3
  zodal-store-supabase/     # DataProvider → Supabase (PostgreSQL/PostgREST)
  zodal-ui-shadcn/          # UI renderer → shadcn/ui (React)
  zodal-ui-vanilla/         # UI renderer → vanilla HTML/JS (no framework)
  zodal-graphs/             # Domain specialization → graphs (@zodal/graph-*)
  zodal-dials/              # Domain specialization → settings/config/preferences (@zodal/dials-*)
  zodal-groups/             # Domain specialization → hierarchical/polyhierarchical grouping (@zodal/groups-*)
  polytag/                  # Composition tier → CRUD over tag-based collections: formats×grammars, backend & view menus, playground
```

**Two kinds of package**: *satellites* (a single store adapter or UI renderer for the core
collections abstraction) and *domain specializations* (`zodal-graphs`, `zodal-dials`) — their own
monorepos that specialize zodal for a domain (Model → Affordances → Targets), each publishing a
`-core` keystone + `-ui` + concrete renderer/store packages. New specializations mirror this shape;
see each one's `AGENTS.md` (or `.claude/CLAUDE.md`) for its guide.

## Dependency Graph

```
@zodal/store-*  →  @zodal/store  →  @zodal/core  ←  @zodal/ui  ←  @zodal/ui-*
                                        ↑
                                    zod (v4 peer)
```

**npm scope**: All packages are published under the `@zodal` npm org. Official packages use `@zodal/*`; community/third-party packages use unscoped `zodal-*` names.

**Hard rule**: `@zodal/ui` and `@zodal/store` never depend on each other. Satellite packages depend on one side or the other, never both (store adapters → `@zodal/store`, UI renderers → `@zodal/ui`).

## Navigation

| Question | Where to look |
|----------|---------------|
| How does zodal work? | `zodal/.claude/CLAUDE.md` — full architecture guide |
| How do I organize items (folders/tags/taxonomies)? | `zodal-groups/.claude/CLAUDE.md` — membership is canonical; trees are projections |
| "Add CRUD over this data with this UI" — tagged data, pick a backend and a view | `polytag/.claude/CLAUDE.md` (research + ADR 0001; no code yet, epic i2mint/polytag#10) |
| How to build a store adapter? | `zodal/.claude/skills/zodal-store-adapter/SKILL.md` |
| How to build a UI renderer? | `zodal/.claude/skills/zodal-ui-renderer/SKILL.md` |
| How to wire a full collection UI? | `zodal/.claude/skills/zodal-collection-ui/SKILL.md` |
| zodal dev patterns & conventions | `zodal/.claude/skills/zodal-dev/SKILL.md` |
| zodal testing patterns | `zodal/.claude/skills/zodal-testing/SKILL.md` |
| Using zodal collections | `zodal/.claude/skills/zodal-collections/SKILL.md` |
| Design decisions & research | `zodal/docs/research/03-technology-research-takeaways.md` |
| Approved architecture plan | `zodal/.claude/plans/stateless-beaming-feather.md` |
| Known issues & gotchas | `zodal/docs/known-issues.md` |
| Future ideas | `zodal/docs/ideas-and-future.md` |

## Working Across Packages

### Which package am I in?

Before making changes, identify which package the work belongs to. File paths tell you:
- `zodal/packages/core/` → `@zodal/core` (types, inference, defineCollection)
- `zodal/packages/store/` → `@zodal/store` (DataProvider interface, filters, in-memory adapter)
- `zodal/packages/ui/` → `@zodal/ui` (generators, state, renderer registry)
- `zodal-store-*/` → satellite store adapter
- `zodal-ui-*/` → satellite UI renderer

### Interfaces live in the monorepo, implementations in satellites

- Adding/changing `DataProvider<T>`, `FilterExpression`, `ProviderCapabilities`, or any core type → work in `zodal/packages/store/` or `zodal/packages/core/`
- Adding/changing `RendererRegistry`, `RendererEntry`, generator output types → work in `zodal/packages/ui/`
- Implementing a concrete backend (fs, S3, Supabase, etc.) → work in `zodal-store-*/`
- Implementing concrete renderers (shadcn, MUI, etc.) → work in `zodal-ui-*/`

### When a core interface changes

If you modify a type or interface in `@zodal/core` or `@zodal/store` or `@zodal/ui`, check whether satellite packages need updates. Key interfaces to watch:
- `DataProvider<T>` — all `zodal-store-*` packages implement this
- `GetListParams`, `GetListResult` — all store adapters consume these
- `FilterExpression`, `FilterOperator` — all adapters that do server-side filtering translate these
- `ProviderCapabilities` — all adapters report these
- `RendererEntry`, `RendererRegistry` — all UI renderer packages use these
- `ColumnConfig`, `FormFieldConfig`, `FilterFieldConfig` — all UI renderers consume these
- `ResolvedFieldAffordance` — renderer testers inspect this

### Build & test commands

```bash
# Core monorepo
cd zodal && pnpm build              # Build all core packages
cd zodal && pnpm test               # Run all core tests
cd zodal && pnpm --filter @zodal/core test  # Test one core package

# Satellite packages (each is independent)
cd zodal-store-fs && pnpm test      # or: npx vitest run
cd zodal-ui-shadcn && npm test      # each has its own setup
```

## Shared Patterns Across All Packages

### Factory functions, not classes
Every adapter/renderer exports a factory: `createXxxProvider()`, `createXxxRegistry()`. Returns a plain object implementing the interface. No `new`, no `class`.

### Honest capability reporting
Store adapters must implement `getCapabilities()` and report truthfully what the backend handles server-side vs. what falls back to client-side.

### Zod v4 gotchas (apply everywhere)
1. Schema internals via `schema._zod.def` (not `.shape` or `._def`)
2. `.meta()` with no args returns metadata
3. `.meta()` returns new instance — metadata lost if wrapped. Use `affordanceRegistry.register(innerSchema, ...)` before wrapping
4. `.js` extensions in all internal imports for ESM compatibility
5. Registries use object identity, not structural equality

### Build tooling
All packages use: **tsup** (dual CJS/ESM + .d.ts), **vitest** (testing), **TypeScript** (strict mode). Core monorepo adds **Turborepo** + **pnpm workspaces**.

## Skills (conditional)

Read the skill that matches your current task — all skills live in `zodal/.claude/skills/`:

| Task | Skill to read |
|------|---------------|
| Working inside the zodal monorepo | `zodal-dev/SKILL.md` |
| Using zodal to define collections | `zodal-collections/SKILL.md` |
| Writing/running tests | `zodal-testing/SKILL.md` |
| Building a new store adapter | `zodal-store-adapter/SKILL.md` |
| Building a new UI renderer | `zodal-ui-renderer/SKILL.md` |
| Wiring schema → UI end-to-end | `zodal-collection-ui/SKILL.md` |
| Finding research context for a decision | `research-lookup.md` |

Also read the workspace-level skill when navigating across packages:
- **Ecosystem navigation**: `.claude/skills/zodal-ecosystem/SKILL.md`
