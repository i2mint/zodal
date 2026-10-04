# Cross-Package Development Rules

These rules apply when working across the zodal ecosystem (multiple packages in `_zodals/`).

## Interface Changes Require Impact Assessment

Before modifying any type or interface exported from `@zodal/core`, `@zodal/store`, or `@zodal/ui`, grep all satellite packages for usage. The satellite packages are separate repos — they won't fail your monorepo build, so breakage is silent.

```bash
# Example: check who uses DataProvider
rg "DataProvider" ../zodal-store-* ../zodal-ui-*
```

## Satellite Packages Are Independent Repos

Each `zodal-store-*` and `zodal-ui-*` is its own git repo with its own `package.json`. They are NOT part of the pnpm workspace in `zodal/`. Do not add them to `zodal/pnpm-workspace.yaml`.

## Version Compatibility

Satellite packages declare `@zodal/core` and `@zodal/store` (or `@zodal/ui`) as **peer dependencies** with semver ranges. When making breaking changes to core interfaces:
1. Bump the core package version appropriately
2. Update each satellite's peer dependency range
3. Update each satellite's implementation if the interface changed

## No Cross-Satellite Dependencies

Satellite packages never depend on each other. `@zodal/store-s3` must not import from `@zodal/store-supabase`. Shared logic belongs in `@zodal/store` or `@zodal/core`.

## Consistent Patterns

All store adapters follow the same pattern (see `zodal/.claude/skills/zodal-store-adapter/SKILL.md`):
- Factory function named `create<Backend>Provider<T>(options)`
- Returns `DataProvider<T>` object literal
- Implements all 7 required CRUD methods + `getCapabilities()`
- Uses `filterToFunction()` for client-side filtering OR translates `FilterExpression` for server-side
- `idField` defaults to `'id'`
- Pagination uses 1-based page numbers

All UI renderers follow the same pattern (see `zodal/.claude/skills/zodal-ui-renderer/SKILL.md`):
- Factory function named `create<Lib>Registry()`
- Pre-loads all renderers into a `RendererRegistry`
- Exports individual renderer arrays for selective use
- Uses `PRIORITY` bands (not arbitrary numbers)

## Testing Consistency

Each satellite package must test against the `DataProvider` or `RendererRegistry` contract:
- CRUD operations (create, read, update, delete, bulk variants)
- `getList` with filtering, sorting, pagination
- `getCapabilities()` returns accurate information
- Error cases (not found, invalid input)

## npm Naming Convention

All official packages are published under the `@zodal` npm org scope:
- Core packages: `@zodal/core`, `@zodal/store`, `@zodal/ui`
- Store adapters: `@zodal/store-<backend>` (e.g., `@zodal/store-fs`, `@zodal/store-s3`)
- UI renderers: `@zodal/ui-<library>` (e.g., `@zodal/ui-shadcn`)

Community/third-party packages use unscoped names: `zodal-store-<backend>`, `zodal-ui-<library>`.

Note: GitHub repo names and local folder names remain unscoped (e.g., `zodal-store-fs/` folder publishes as `@zodal/store-fs`).

## README Consistency

Each satellite README should include:
- One-liner description
- Install command with peer dependencies (using `@zodal/*` scoped names)
- Quick-start code example
- Capabilities table (what's server-side vs. client-side)
- Link back to zodal monorepo

## Don't Duplicate Core Logic

If you find yourself copying sorting/filtering/pagination logic from one satellite to another, it probably belongs in `@zodal/store`. The `filterToFunction()` utility exists precisely for this reason.
