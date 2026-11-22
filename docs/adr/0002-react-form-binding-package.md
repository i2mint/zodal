# ADR 0002: The React form binding lives in `@zodal/ui-react`

Status: accepted (2026-11-23), [i2mint/zodal#83](https://github.com/i2mint/zodal/issues/83)

## Context

Every React host assembled the same glue itself: `toFormConfig` → `formFieldAffordance` → `registry.resolve(..., { mode: 'form' })` → render with `{ field, config, context, affordance }`. The copies drifted: one host's `SchemaField` passed widget options through the context, another's `SchemaForm` drew its own labels and resolved with the raw affordance (so the widget `toFormConfig` chose never reached the testers), a third rebuilt the whole value on change without `formFieldAffordance` either ([#73](https://github.com/i2mint/zodal/issues/73) gap 7).

The binding depends on React but on no component library: the registry is an argument. Two homes were weighed: a new `@zodal/ui-react` in this monorepo, or a `SchemaField` export inside `@zodal/ui-shadcn`.

## Decision

`@zodal/ui-react`, as `packages/ui-react`, the option #83 recommended. It peers on `react`, `@zodal/core` and `@zodal/ui` (the UI side only, per the workspace's dependency rule) and exports `SchemaField`, `SchemaForm`, `RendererRegistryProvider`, `useRendererRegistry`, `resolveFormField` and `useFormConfigs`. `@zodal/ui` stays headless. Putting it in `@zodal/ui-shadcn` would have made a host whose renderers are not shadcn depend on shadcn for the binding.

It is written with `createElement`, so the package needs no JSX transform, and it draws no labels or layout of its own beyond one wrapper per field (`data-field`), because the renderers already draw their labels.

## Seams

| Seam | v1 default | Replacement already in view |
|---|---|---|
| renderer registry | the `registry` prop, else `RendererRegistryProvider`'s | any `create<Lib>Registry()` (`@zodal/ui-shadcn` today) |
| field wrapper | a `div.zodal-field[data-field]` | a host layout via `useFormConfigs` + `SchemaField` |
| unmatched field | nothing, or `fallback` | a JSON editor fallback (lacing-ui has one) |

## Consequences

- Hosts replace their local copies with this package (lacing-ui, hearing, steadyday, podpatch each have one); those migrations are follow-ups in their repos.
- Publishing a new npm name cannot be undone, and publishing is blocked on trusted publishers ([#23](https://github.com/i2mint/zodal/issues/23)). This change adds the package at 0.1.0 without a `[publish]` commit; the first publish is a deliberate act once #23 is done.
- Reversible until published: removing `packages/ui-react` undoes it.
