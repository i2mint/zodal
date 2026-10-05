---
name: zodal-ecosystem
description: Navigate the zodal package ecosystem — which package owns what, where new code should live, and how to coordinate a change across packages. Use when a task spans multiple zodal packages, when adding a satellite package, when deciding placement between `@zodal/core`, `@zodal/store`, `@zodal/ui`, or a `zodal-store-*` adapter, or when checking the blast radius of a core interface change.
---

# Skill: zodal Ecosystem Navigation

## Purpose
Guide for understanding the zodal package ecosystem, finding the right package to modify, and coordinating work across packages.

## When to Use
- Working on a task that spans multiple zodal packages
- Deciding where new code should live
- Adding a new satellite package to the ecosystem
- Checking impact of a core interface change

## The Ecosystem Map

### Core Monorepo: `zodal/`

Houses the three core packages that define all interfaces and abstractions:

| Package | Path | Exports |
|---------|------|---------|
| `@zodal/core` | `zodal/packages/core/` | `defineCollection`, affordance types, inference engine, `FilterExpression`, `SortingState`, codecs, `affordanceRegistry` |
| `@zodal/store` | `zodal/packages/store/` | `DataProvider<T>` interface, `GetListParams/Result`, `ProviderCapabilities`, `filterToFunction()`, `createInMemoryProvider()`, `wrapProvider()` |
| `@zodal/ui` | `zodal/packages/ui/` | Generators (`toColumnDefs`, `toFormConfig`, `toFilterConfig`), `CollectionState/Actions`, `createCollectionStore()`, `createZustandStoreSlice()`, `RendererRegistry`, tester predicates, `toPrompt()`, `toCode()` |

### Store Adapters: `zodal-store-*/`

Each implements `DataProvider<T>` for a specific storage backend:

| npm package | Folder | Backend | Server-side capabilities | Key dependency |
|-------------|--------|---------|------------------------|----------------|
| `@zodal/store-fs` | `zodal-store-fs/` | Node.js filesystem | None (all client-side) | `node:fs` |
| `@zodal/store-http` | `zodal-store-http/` | Any HTTP endpoint | Opt-in via `capabilities` (default: all client-side) | `fetch` (injectable) |
| `@zodal/store-localstorage` | `zodal-store-localstorage/` | Browser localStorage | None (all client-side) | Browser API |
| `@zodal/store-s3` | `zodal-store-s3/` | AWS S3 | None (all client-side) | `@aws-sdk/client-s3` |
| `@zodal/store-supabase` | `zodal-store-supabase/` | Supabase (PostgreSQL) | Sort, filter, search, pagination | `@supabase/supabase-js` |

### UI Renderers: `zodal-ui-*/`

Each provides concrete components for a UI library:

| npm package | Folder | UI Library | Status |
|-------------|--------|-----------|--------|
| `@zodal/ui-shadcn` | `zodal-ui-shadcn/` | shadcn/ui (React) | Plain HTML baseline, ready for real shadcn components |
| `@zodal/ui-vanilla` | `zodal-ui-vanilla/` | Vanilla DOM (no framework) | Published 0.2.0; same renderer set as shadcn |

### Domain specializations and the composition tier

| Repo | Packages | What | Read |
|------|----------|------|------|
| `zodal-groups/` | `@zodal/groups-core`, `-ui`, `-ui-vanilla` | Folders/tags/labels/polyhierarchy: membership edges, profiles, tree/columns/facet projections | `zodal-groups/.claude/CLAUDE.md` |
| `zodal-dials/` | `@zodal/dials-*` | Settings, config, preferences | `zodal-dials/AGENTS.md` |
| `zodal-graphs/` | `@zodal/graph-*` (not yet on npm) | Graphs: node/edge data, views, layouts | `zodal-graphs/.claude/CLAUDE.md` |
| `polytag/` | (planned) `polytag` | Composition tier: CRUD over tag-based collections; data in (formats × grammars), backend menu, view menu, playground. Depends on both store and UI sides, like an app | `polytag/.claude/CLAUDE.md`, epic i2mint/polytag#10 |

## Decision: Where Does This Code Go?

### "I need to add/change a type or interface"
→ `zodal/packages/core/src/types.ts` (if it's a shared type like `FilterExpression`)
→ `zodal/packages/store/src/data-provider.ts` (if it's the DataProvider interface)
→ `zodal/packages/ui/src/` (if it's a generator output type or state type)
→ Then check all satellite packages for impact

### "I need to add a utility used by multiple adapters"
→ `zodal/packages/store/src/` (e.g., `filterToFunction()` already lives here)
→ Export from `zodal/packages/store/src/index.ts`
→ Never duplicate shared logic into individual satellites

### "I need to build a new store adapter"
→ Create `zodal-store-<backend>/` as a new directory at the `_zodals/` level
→ Follow the pattern in `zodal/.claude/skills/zodal-store-adapter/SKILL.md`
→ Use any existing satellite (e.g., `zodal-store-fs`) as a template

### "I need to build a new UI renderer"
→ Create `zodal-ui-<lib>/` as a new directory at the `_zodals/` level
→ Follow the pattern in `zodal/.claude/skills/zodal-ui-renderer/SKILL.md`
→ Use `zodal-ui-shadcn` as a template

### "I need to fix how inference works"
→ `zodal/packages/core/src/inference.ts` — all 6 inference layers are here
→ `zodal/packages/core/tests/inference.test.ts` for test coverage

### "I need to change how state management works"
→ `zodal/packages/ui/src/state/` — pure state store, slices, and zustand integration
→ This affects all UI consumers but no store adapters

### "I need to change the filter system"
→ `zodal/packages/core/src/types.ts` for `FilterExpression` / `FilterOperator` types
→ `zodal/packages/store/src/filters.ts` for `filterToFunction()` (client-side evaluation)
→ `zodal-store-supabase/src/filter-translator.ts` for the server-side PostgREST translation
→ Any adapter doing server-side filtering will need its translator updated

## Creating a New Satellite Package

### Scaffold structure
```
zodal-store-<backend>/
  src/
    index.ts              # Re-exports
    provider.ts           # create<Backend>Provider<T>() factory
    filter-translator.ts  # (only if server-side filtering)
  tests/
    provider.test.ts      # DataProvider contract tests
  .claude/
    CLAUDE.md             # Package-specific agent guide
  package.json            # peer deps on @zodal/core + @zodal/store
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  README.md
```

### package.json template

Official packages use `@zodal/store-<backend>`; community packages use `zodal-store-<backend>`.

```json
{
  "name": "@zodal/store-<backend>",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "peerDependencies": {
    "@zodal/core": "^0.2.1",
    "@zodal/store": "^0.2.1"
  },
  "devDependencies": {
    "@zodal/core": "^0.2.1",
    "@zodal/store": "^0.2.1",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Peer ranges are a caret on the lowest version you need (`^0.2.1`), kept current. In `0.x` the minor number is the breaking one: zodal releases additive changes as patches and breaking ones as minors, and its CI (`scripts/check-satellite-peers.mjs`) refuses a release that would newly exclude a published satellite. Never `>=X <1.0.0` (it hides a breaking minor). Full policy: `zodal/docs/versioning.md`.

Note: `types` must come first in the `exports` condition map for correct TypeScript resolution. Satellite packages are NOT part of the monorepo pnpm workspace — use real version ranges (not `workspace:*`) for `@zodal/*` dev dependencies.

### .claude/CLAUDE.md template for a satellite
Keep it short — point back to the monorepo skills for the full pattern:
```markdown
# @zodal/store-<backend>

<One-sentence description>.

## Architecture
- Factory function `create<Backend>Provider<T>()` returns a `DataProvider<T>`
- <Key design decisions>

## Key Skill
For the adapter pattern, conventions, and DataProvider contract, see:
`zodal/.claude/skills/zodal-store-adapter/SKILL.md`

## Testing
`pnpm test` or `npx vitest run`
```

## Checking Cross-Package Impact

When you modify a core interface, run these checks:

```bash
# From the _zodals/ directory:

# Who implements DataProvider?
rg "DataProvider" zodal-store-*/src/ zodal-ui-*/src/

# Who uses FilterExpression?
rg "FilterExpression" zodal-store-*/src/ zodal-ui-*/src/

# Who uses ProviderCapabilities?
rg "ProviderCapabilities" zodal-store-*/src/

# Who uses RendererRegistry or RendererEntry?
rg "RendererRegistry|RendererEntry" zodal-ui-*/src/

# Run all satellite tests
for d in zodal-store-* zodal-ui-*; do echo "=== $d ===" && (cd "$d" && npx vitest run 2>&1 | tail -5); done
```

## Reference Implementations

| Pattern | Reference to study |
|---------|-------------------|
| Client-side store adapter | `zodal/packages/store/src/in-memory.ts` |
| Server-side store adapter | `zodal-store-supabase/src/provider.ts` |
| FilterExpression translator | `zodal-store-supabase/src/filter-translator.ts` |
| UI renderer registry | `zodal-ui-shadcn/src/registry.ts` |
| Renderer tester patterns | `zodal-ui-shadcn/src/renderers/cell-renderers.ts` |
