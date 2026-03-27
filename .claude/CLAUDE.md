# zodal — Agent Guide

## Project Stage: ACTIVE DEVELOPMENT

Monorepo is scaffolded, core packages implemented, 214 tests passing. Design approved and documented at `.claude/plans/stateless-beaming-feather.md`.

## What zodal Is

Schema-driven affordances for collections, resources, and beyond. A TypeScript/JavaScript monorepo that declares collection shape + capabilities once (via Zod schemas) and generates UI configuration, state management, data access, and API interfaces from that declaration.

## Package Structure (implemented)

```
packages/
  core/    @zodal/core     — types, inference engine, defineCollection, explain
  store/   @zodal/store    — DataProvider, capabilities, filters, in-memory adapter
  ui/      @zodal/ui       — generators, state store, renderer registry, toPrompt, toCode
  ui-shadcn/ @zodal/ui-shadcn — concrete shadcn/ui renderers (future)
apps/
  demo/    Vite + React 19 demo (future)
```

**Dependency rule**: `core ← store`, `core ← ui`. Never `ui ↔ store`.

**Build**: pnpm workspaces + Turborepo + tsup (dual CJS/ESM + .d.ts). Zod v4 peer dependency.

## Key Architectural Rules

1. **Headless first** — produce configuration objects, never DOM/React directly
2. **Convention over configuration** — zero annotations = working defaults
3. **6-layer inference** — Zod type → refinements → name heuristics → `.meta()` → affordanceRegistry → config overrides
4. **Escape hatches everywhere** — any inferred default can be overridden
5. **Zod v4 as schema substrate** — not schema-agnostic
6. **Thin glue, not a framework** — configure existing tools (TanStack Table, Zustand, etc.)

## Zod v4 Introspection Gotchas

1. **Schema internals**: Access via `schema._zod.def` (not `.shape` or `._def`)
2. **Enum entries**: Stored as `{ key: value }` object (not array)
3. **Reading metadata**: `schema.meta()` with no arguments returns metadata
4. **Import extensions**: Use `.js` extensions in imports for ESM compatibility
5. **Metadata survival**: `.meta()` returns new instance — metadata lost if wrapped with `.optional()` etc. Use `.register()` on inner schemas before wrapping
6. **Registry identity**: Registries use object identity, not structural equality
7. **z.codec()** (v4.1+): Use for bidirectional field-level transforms

## Testing Architecture

zodal uses a layered testing approach:

- **Unit tests**: Per-package in `packages/*/tests/*.test.ts` — run on every commit
- **Integration tests**: In `tests/integration/` — cross-package stories
- **Heavy/manual tests**: In `tests/heavy/` — not in CI, documented for agent use
- **Story specs**: BDD-style Given/When/Then in `tests/stories/` — declarative, executor-agnostic

Run tests: `pnpm test` (all), `pnpm --filter @zodal/core test` (one package)

## Skills (conditional)

Before starting work on zodal, check if relevant skills exist:

- **Using zodal**: Read `.claude/skills/zodal-collections/SKILL.md` — recipes for defining collections, generating configs, data providers, state management, codecs
- **zodal development skills**: Read `.claude/skills/zodal-dev/SKILL.md` — patterns, conventions, and helpers for implementing zodal features
- **zodal testing skills**: Read `.claude/skills/zodal-testing/SKILL.md` — BDD story spec format, test patterns, executor conventions
- **Research lookup**: Read `.claude/skills/research-lookup.md` — find the right research report for a design question

### Skills for third-party adapter/renderer authors

These skills guide the creation of external packages that plug into zodal:

- **Building a store adapter**: Read `.claude/skills/zodal-store-adapter/SKILL.md` — how to implement `DataProvider<T>` for any storage backend
- **Building a UI renderer**: Read `.claude/skills/zodal-ui-renderer/SKILL.md` — how to build a renderer package for a UI library (shadcn, MUI, etc.)
- **Wiring a collection UI**: Read `.claude/skills/zodal-collection-ui/SKILL.md` — how to assemble generators + renderers + state + DataProvider into a working page

After completing significant work, consider:
- Does this create patterns others should follow? → Update `.claude/skills/zodal-dev/SKILL.md`
- Does this establish testing conventions? → Update `.claude/skills/zodal-testing/SKILL.md`
- Should a new skill be created for a reusable pattern?

## Reference Materials

- **Approved design**: `.claude/plans/stateless-beaming-feather.md`
- **Architecture**: `docs/architecture.md` — package structure, dependency graph, API surfaces
- **Ideas & future**: `docs/ideas-and-future.md` — unimplemented ideas, deferred features
- **Known issues**: `docs/known-issues.md` — limitations, gotchas, workarounds
- **Research docs**: `docs/research/01-vision-and-scope.md` through `docs/research/07-open-questions.md`
- **Predecessor code**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`
- **Research reports**: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/zodal_research/`
- These are **read-only references**. Do not modify them.
