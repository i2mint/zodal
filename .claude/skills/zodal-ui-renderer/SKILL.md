---
name: zodal-ui-renderer
description: >-
  Guide for implementing a renderer package — concrete UI components that consume
  zodal's headless configuration objects and render actual DOM elements, bridging
  zodal's schema-driven configs to a specific component library (shadcn/ui, Material
  UI, Ant Design, etc.). Use when creating a renderer package for a UI library,
  registering custom renderers for specific field types or affordances, or
  understanding how the RendererRegistry and tester pattern work.
metadata:
  audience: developers
---

# Skill: Building a zodal UI Renderer Package

## Purpose
Guide for implementing a renderer package — concrete UI components that consume zodal's headless configuration objects and render actual DOM elements. This is the bridge between zodal's schema-driven configs and a specific component library (shadcn/ui, Material UI, Ant Design, etc.).

## When to Use
- Creating a renderer package for a UI library (e.g., `zodal-ui-shadcn`, `zodal-ui-mui`)
- Registering custom renderers for specific field types or affordances
- Understanding how the RendererRegistry and tester pattern work

## Key Concepts

### zodal's Headless Architecture
zodal generates **configuration objects**, never DOM/React. Three generators produce configs:
- `toColumnDefs(collection)` → `ColumnConfig[]` — table column definitions
- `toFormConfig(collection, mode)` → `FormFieldConfig[]` — form field configurations
- `toFilterConfig(collection)` → `FilterFieldConfig[]` — filter panel configurations

A renderer package provides **concrete components** that consume these configs and render UI.

### Dependencies
Your renderer package should depend on:
- `@zodal/core` — for types (`ResolvedFieldAffordance`)
- `@zodal/ui` — for `RendererRegistry`, tester utilities, generator output types

```json
{
  "peerDependencies": {
    "@zodal/core": "^0.2.1",
    "@zodal/ui": "^0.2.1",
    "react": "^18.0.0 || ^19.0.0"
  }
}
```

Use a caret on the lowest `@zodal/*` version you need, and keep it current: `^0.1.0` means `<0.2.0`, so it excludes every 0.2.x release. zodal's CI check `scripts/check-satellite-peers.mjs` refuses a core release that would newly exclude a published renderer (see `docs/versioning.md`).

## The Renderer Registry

The registry is **user-instantiated** (not a global singleton). Your package exports renderer entries; the user registers them.

```typescript
import type { RendererEntry } from '@zodal/ui';

// Your package exports an array of entries
export const shadcnRenderers: RendererEntry<React.ComponentType>[] = [
  { tester: ..., renderer: TextCell, name: 'TextCell' },
  { tester: ..., renderer: NumberCell, name: 'NumberCell' },
  // ...
];

// User registers them
import { createRendererRegistry } from '@zodal/ui';
const registry = createRendererRegistry<React.ComponentType>();
for (const entry of shadcnRenderers) {
  registry.register(entry);
}
```

### Tester Pattern

Each renderer has a **tester function** that scores how well it matches a field. Higher score wins.

```typescript
type RendererTester = (
  field: ResolvedFieldAffordance,
  context: RendererContext,
) => number;  // > 0 = match, -1 = no match

interface RendererContext {
  mode: 'cell' | 'form' | 'filter';
  [key: string]: unknown;
}
```

### Priority Bands

Use named constants to keep scores consistent:

| Band | Value | Use for |
|------|-------|---------|
| `FALLBACK` | 1 | Generic catch-all (render anything as text) |
| `DEFAULT` | 10 | Type-based defaults (`string` → TextInput) |
| `LIBRARY` | 50 | Specialized renderers (email → EmailInput) |
| `APP` | 100 | App-level overrides |
| `OVERRIDE` | 200 | Explicit `.meta({ editWidget: '...' })` |

### Composable Predicates

zodal provides predicate builders — use them instead of writing raw testers:

```typescript
import {
  zodTypeIs, hasRefinement, fieldNameMatches,
  metaMatches, editWidgetIs, and, or, PRIORITY,
} from '@zodal/ui';

// Match any string field
zodTypeIs('string')                              // score: DEFAULT (10)

// Match email-validated strings
hasRefinement('email')                           // score: LIBRARY (50)

// Combine: string + email refinement
and(zodTypeIs('string'), hasRefinement('email')) // score: DEFAULT + LIBRARY (60)

// Match by field name pattern
fieldNameMatches(/password/i)                    // score: LIBRARY (50)

// Match by metadata predicate
metaMatches(f => f.displayFormat === 'currency') // score: APP (100)

// Match explicit widget override
editWidgetIs('richtext')                         // score: OVERRIDE (200)

// Match by storage role (content-metadata bifurcation)
storageRoleIs('content')                         // score: LIBRARY (50)

// OR: match either condition (takes highest score)
or(zodTypeIs('string'), zodTypeIs('number'))
```

### Content-Aware Renderers

For collections with [bifurcated storage](../../../docs/research/bifurcation_design_notes.md), register renderers for content fields:

```typescript
import { storageRoleIs, isContentRef } from '@zodal/ui';

// Cell: render content as download link or thumbnail
registry.register({
  tester: storageRoleIs('content'),
  renderer: ContentCell,  // shows download link using ContentRef.url
  name: 'ContentCell',
});

// Form: render content as file upload
registry.register({
  tester: and(storageRoleIs('content'), (_, ctx) => ctx.mode === 'form' ? 50 : -1),
  renderer: FileUploadInput,
  name: 'FileUploadInput',
});
```

Content fields carry these meta properties in `ColumnConfig`:
- `meta.storageRole: 'content'` — identifies this as a content column
- `meta.isContentRef: true` — the cell value may be a `ContentRef` object

And in `FormFieldConfig`:
- `isContentField: true`
- `type: 'file'`
- `acceptMimeTypes?: string[]`
- `maxSize?: number`

## Step-by-Step: Build a Renderer Package

### Step 1: Define renderers for each mode

Three modes exist — a complete renderer package covers all three:

**Cell renderers** — read-only display in table cells
```typescript
// components/cells/TextCell.tsx
export function TextCell({ value, config }: CellProps) {
  if (config.meta.truncate && typeof value === 'string' && value.length > config.meta.truncate) {
    return <span title={value}>{value.slice(0, config.meta.truncate)}...</span>;
  }
  return <span>{String(value ?? '')}</span>;
}
```

**Form renderers** — editable inputs in create/edit forms
```typescript
// components/form/TextInput.tsx
export function TextInput({ field, config }: FormFieldProps) {
  return (
    <div>
      <Label htmlFor={config.name}>{config.label}</Label>
      <Input
        id={config.name}
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        placeholder={config.placeholder}
        required={config.required}
        disabled={config.disabled}
      />
      {config.helpText && <p className="text-sm text-muted-foreground">{config.helpText}</p>}
    </div>
  );
}
```

**Filter renderers** — filter widgets in the filter panel
```typescript
// components/filters/SelectFilter.tsx
export function SelectFilter({ field, config }: FilterFieldProps) {
  return (
    <Select value={field.value} onValueChange={field.onChange}>
      <SelectTrigger><SelectValue placeholder={`Filter ${config.label}...`} /></SelectTrigger>
      <SelectContent>
        {config.options?.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### Step 2: Register each renderer with a tester

```typescript
// renderers/cell-renderers.ts
import { zodTypeIs, hasRefinement, and, or, metaMatches, PRIORITY } from '@zodal/ui';
import type { RendererEntry } from '@zodal/ui';

export const cellRenderers: RendererEntry<React.ComponentType>[] = [
  // Fallback: render anything as text
  {
    tester: () => PRIORITY.FALLBACK,
    renderer: TextCell,
    name: 'TextCell (fallback)',
  },
  // String fields
  {
    tester: (field, ctx) => ctx.mode === 'cell' && field.zodType === 'string' ? PRIORITY.DEFAULT : -1,
    renderer: TextCell,
    name: 'TextCell',
  },
  // Number fields
  {
    tester: (field, ctx) => ctx.mode === 'cell' && ['number', 'int', 'float'].includes(field.zodType) ? PRIORITY.DEFAULT : -1,
    renderer: NumberCell,
    name: 'NumberCell',
  },
  // Enum fields → badge
  {
    tester: (field, ctx) => ctx.mode === 'cell' && field.zodType === 'enum' ? PRIORITY.DEFAULT : -1,
    renderer: BadgeCell,
    name: 'BadgeCell',
  },
  // Boolean fields → checkbox icon
  {
    tester: (field, ctx) => ctx.mode === 'cell' && field.zodType === 'boolean' ? PRIORITY.DEFAULT : -1,
    renderer: BooleanCell,
    name: 'BooleanCell',
  },
  // Date fields
  {
    tester: (field, ctx) => ctx.mode === 'cell' && field.zodType === 'date' ? PRIORITY.DEFAULT : -1,
    renderer: DateCell,
    name: 'DateCell',
  },
  // Currency display
  {
    tester: metaMatches(f => f.displayFormat === 'currency'),
    renderer: CurrencyCell,
    name: 'CurrencyCell',
  },
];
```

### Step 3: Export a convenience function

```typescript
// index.ts
import { createRendererRegistry } from '@zodal/ui';
import { cellRenderers } from './renderers/cell-renderers.js';
import { formRenderers } from './renderers/form-renderers.js';
import { filterRenderers } from './renderers/filter-renderers.js';

export { cellRenderers, formRenderers, filterRenderers };

/** Create a registry pre-loaded with all shadcn renderers. */
export function createShadcnRegistry() {
  const registry = createRendererRegistry<React.ComponentType>();
  for (const entry of [...cellRenderers, ...formRenderers, ...filterRenderers]) {
    registry.register(entry);
  }
  return registry;
}
```

**A renderer set with options.** Behaviour shared by every control of the set (a minimum target size, a tap guard, a lockout after an action, a default Undo window) belongs to the set, not to each screen: make the factory `createXRegistry(options?)` with keyword options that all have defaults, using `defineRendererSet({ defaults, entries: (options) => [...] })` from `@zodal/ui`. The renderers close over the resolved options, an unknown option is refused, and the registry exposes `registry.options`. What changes per render (the app's state, a suggestion source, the selection) stays in `RendererContext`; do not put set-wide policy there, and do not make hosts provide it through a framework context. Options are flat values (numbers, strings, functions such as an injected clock). Build the registry once, at module scope or memoised, never inside a render: its renderers are made per call, so a new registry remounts every control.

```typescript
export const createTremorRegistry = defineRendererSet({
  defaults: { minTargetPx: 64, tapGuardMs: 450, undoSeconds: 15 },
  entries: (o) => [{ tester: closedChoice(), renderer: makeTileChoice(o), name: 'TileChoice' }],
});
const registry = createTremorRegistry({ tapGuardMs: 600 }); // undoSeconds(op, { defaultSeconds: registry.options.undoSeconds })
```

### Step 4: Users consume your package

```typescript
import { createShadcnRegistry } from 'zodal-ui-shadcn';
import { toColumnDefs } from '@zodal/ui';
import { defineCollection } from '@zodal/core';

const registry = createShadcnRegistry();
const collection = defineCollection(mySchema);
const columns = toColumnDefs(collection);

// For each column, resolve the renderer:
for (const col of columns) {
  const field = collection.fieldAffordances[col.id];
  if (field) {
    const CellComponent = registry.resolve(field, { mode: 'cell' });
    // Use CellComponent to render the cell
  }
}
```

## Tag Fields and Operations

**Tag-like fields.** An array (or set) field becomes a form field of `type: 'tags'`. When its values are closed (an enum, literals, a numeric enum: `getVocabulary` in `@zodal/core`), the allowed values are in `options` and `allowCreate` is `false`; otherwise `allowCreate` is `true`. Filters (`contains`) and column metadata (`meta.enumValues`) carry the same vocabulary. Render these as chips (add/remove by keyboard, create a new value only when `allowCreate`), and a chip cell with overflow, never `value.join(', ')`. Field components take `FieldRenderProps` (`{ field, config, context?, affordance? }` from `@zodal/ui`, where `field` is the value binding `{ value, onChange }`), and suggestions come from `context.suggest?.(query, field, { signal, limit })` (a `SuggestionSource` the app injects: values already used, a zodal-groups vocabulary, a server endpoint), so a renderer never imports a store. Abort the previous request when the user keeps typing.

**Curated choices.** A field may declare `choices` (`[{ value, label?, hint?, data? }]`), which makes it a closed choice even when its schema is a plain bounded number: `defineCollection` refuses a malformed list, two values with the same text, and a value the schema refuses (one element for an array or set; a codec's output side), and gives the field a closed choice's defaults (a `select` filter, not a range). `affordance.choice` (`'single'` / `'multi'`) then says it is a closed choice, and its options come from one place, `getFieldChoices(schema, affordance)` in `@zodal/core` (`fieldOptions` in `@zodal/ui` as widget options), which every generator uses: `config.options` (forms, filters, item-view fields), `meta.options` and `meta.enumValues` (columns: a cell shows `labelOf(meta.options, value)`, per element for a multi-choice cell, and the hint as a tooltip), `group.order` (views). They list the choices in order; each option may carry a `hint` (draw it under the label) and `data` (a tone, an icon: typed by merging `ChoiceData`). Read options from the config, never from the schema: a curated list replaces an enum's vocabulary.

**Single-choice widgets (select, radio).** An option's `value` is a string; the schema's value may be a number, boolean or bigint. Never key the widget on `String(field.value ?? '')`: show `optionKey(config, field.value)` as the chosen key and write back `selectedValue(config, key)` (both from `@zodal/ui`). They are inverses, and a value of the wrong type or a stale one is shown as the placeholder `''`. Tags widgets use the tag helpers instead (`findOption`, `labelOf`, `resolveChoice`, `optionRaw`), which write a chosen option back as its schema value, bigints included.

**One meaning for a multi-value `contains` filter: OR within the field.** A `contains` filter on an array field matches an item carrying *any* selected value (`arrayContainsAny`; TanStack `arrIncludesSome` in `toColumnDefs`), the faceted-filter convention of OR within a facet and AND across facets. AND is explicit: `filterable: 'containsAll'` (`arrIncludesAll`; client-side only, there is no store operator for it). Build tag widgets on `@zodal/ui`'s tag logic (`resolveDraft`, `matchOptions`, `splitTags`, `toContainsFilter` / `fromContainsFilter`, `createSuggestionController`) rather than a copy, so every renderer reads and writes the same filter value.

**Operations are declarative; execution is a command.** Render `OperationDefinition`s (label, icon, confirm, shortcut) as buttons or menu items, and on activation dispatch the command whose id is `operationCommandId(namespace, op)`. The app builds those commands with `toCommandRecord(op, execute, { namespace })` from `@zodal/core` (acture's `CommandRecord` shape; `execute` returns `ok(value)` or `fail(code, message)`). A confirmation (`op.confirm`) is the renderer's to show before dispatching: commands carry no confirm, so gate destructive ones with `when` for other surfaces. An operation declared `undoable` (`true`, or `{ seconds }`) can be undone after it runs: offer Undo when its dispatch succeeds and the undo history actually recorded an entry for it (acture-undo skips an empty capture), for `undoSeconds(op, { defaultSeconds })` seconds (from `@zodal/core`: the operation's own `{ seconds }`, else the renderer set's default). View configs carry `undoable` on each operation. A renderer set for users who mis-tap may offer Undo instead of a confirmation; that choice is the set's policy, not the operation's. To let an app swap the control per operation, register operation renderers in their own registry, `createRendererRegistry<Component, OperationDefinition>()`, with the operation testers (`anyOperation` as the fallback, `operationScopeIs`, `operationVariantIs`, `operationIs`; they match only in `'operation'` mode), resolve with `registry.resolve(op, { mode: 'operation' })`, and give the component `OperationRenderProps` (`{ operation, dispatch, context?, disabled? }`). The host binds `dispatch` to the operation's command with `operationDispatcher({ namespace, execute, context })` from `@zodal/core` (`dispatchFor(op)`; with acture, `execute: (id, params, ctx) => registry.dispatch(id, params, ctx)`, and `context` gives what the commands' `when` clauses read, such as the selection), so it returns that command's `ok` / `fail` result: await it for progress and show a failure's message.

## Feedback Contract (every pressable)

Every element a renderer draws that a person presses (an operation button, a menu item, an item with `onOpen`, a tile) applies the feedback principle by default, with no host code. Decision and research: `docs/adr/0001-feedback-principle.md`.

- **Pressed within 0.1 s, on the element:** `data-pressed` on `pointerdown` (primary button), cleared on `pointerup` / `pointercancel` / `pointerleave`. CSS `:active` alone does not fire on iOS Safari.
- **Act on `click`** (and Enter for a non-button), never on `pointerdown` (WCAG 2.5.2).
- **Pending in the same event:** `data-pending`, `aria-busy="true"`, `aria-disabled="true"` (never native `disabled`: it drops focus); repeat presses ignored until it settles; `data-status="success" | "error"` after.
- **Indicator by elapsed time:** `data-indicator` (a spinner) only after `FEEDBACK_MS.indicator`, held at least 500 ms.
- **Back/forward cache:** clear pending on `pageshow` with `persisted`.
- **Styles ship with the renderer** at zero specificity or as utility classes, with a reduced-motion variant and `touch-action: manipulation`; hover is decoration only (`@media (hover: hover)`), and nothing is conveyed only by `title` or a hover tooltip.
- **Callbacks return the work:** type them `(…) => unknown` (not `void | PromiseLike<unknown>`, which breaks expression-bodied handlers that return a value), and treat a thenable result as pending; an operation's `dispatch` returns its `OperationCommandResult` (`{ ok: false }` reads as an error).

Build it on `createActionFeedback` from `@zodal/ui` (pending synchronously, the guard: `run()` returns `null` while pending, the delayed indicator, `reset()`), or on the renderers' own helpers: `wirePress` in `@zodal/ui-vanilla`, `usePress` + `PRESS_CLASS` + `PressIndicator` in `@zodal/ui-shadcn`. A DOM renderer that rebuilds its view on every state change keys the action's state outside the element (`wirePress`'s `share: { scope: config, key }`), registered when it turns pending and before the callback runs, or a button rebuilt mid-flight, even synchronously inside the callback, comes back idle and pressable. Draw the indicator in its own child element, never on the host's `::after`, which the host may already use.

**Test it** by copying a renderer package's `tests/feedback.test.ts`: pressed on `pointerdown`; pending, `aria-busy` and `aria-disabled` synchronously after `click()` with a never-resolving handler; three clicks run the handler once; cleared on settle; indicator at the delay and not before; a bfcache restore clears pending.

## Generator Output Types Reference

### ColumnConfig (from toColumnDefs)
```typescript
interface ColumnConfig {
  id: string;
  header: string;
  accessorKey?: string;
  enableSorting: boolean;
  enableColumnFilter: boolean;
  enableGlobalFilter: boolean;
  enableGrouping: boolean;
  enableHiding: boolean;
  enableResizing: boolean;
  size?: number;
  minSize?: number;
  maxSize?: number;
  sortingFn?: string;
  filterFn?: string;
  meta: {
    zodType: string;
    filterType: FilterType | boolean;
    editable: boolean;
    inlineEditable: boolean;
    displayFormat?: string;
    badge?: Record<string, string>;
    copyable?: boolean;
    truncate?: number;
    tooltip?: boolean;
    enumValues?: string[];
    numericBounds?: { min?: number; max?: number };
    pinned?: 'left' | 'right' | false;
  };
}
```

### FormFieldConfig (from toFormConfig)
```typescript
interface FormFieldConfig {
  name: string;
  label: string;
  type: string;       // 'text' | 'number' | 'checkbox' | 'select' | 'date' | 'tags' | 'json' | custom
  required: boolean;
  disabled: boolean;
  hidden: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  bounds?: { min?: number; max?: number };  // numeric fields
  step?: number;                            // numeric fields
  minLength?: number;                       // string fields: pass to the input, do not re-read the schema
  maxLength?: number;
  editWidgetOptions?: WidgetOptions;      // the edit widget's own options (layout, heading, clear value...); type its keys by merging into WidgetOptions
  order: number;
  zodType: string;
}
```

### FilterFieldConfig (from toFilterConfig)
```typescript
interface FilterFieldConfig {
  name: string;
  label: string;
  filterType: FilterType;  // 'exact' | 'search' | 'select' | 'multiSelect' | 'range' | 'contains' | 'containsAll' | 'boolean' | 'fuzzy'
  options?: { label: string; value: string }[];
  bounds?: { min?: number; max?: number };
  quantiles?: number[];    // range filters: the data's quantiles (quantiles[i] at percentile 100*i/(n-1)), from toFilterConfig(c, { data }) or the app
  zodType: string;
}
```

A range filter that should draw as a slider is declared with the `filterWidget` affordance (`.meta({ filterable: 'range', filterWidget: 'range-slider' })`), so the same field can be a `'slider'` in forms (`editWidget`) and a `'range-slider'` in filters. A filter tester matches it with `filterWidgetIs('range-slider')`, which reads `filterWidget ?? editWidget`. When `quantiles` is present, lay the track out by them (a percentile scale); otherwise use `bounds`.

## Package Structure

```
zodal-ui-mylib/
  src/
    index.ts                    # re-exports, createMyLibRegistry()
    components/
      cells/                    # cell renderers (table display)
        TextCell.tsx
        NumberCell.tsx
        BadgeCell.tsx
        BooleanCell.tsx
        DateCell.tsx
      form/                     # form field renderers
        TextInput.tsx
        NumberInput.tsx
        SelectInput.tsx
        CheckboxInput.tsx
        DatePicker.tsx
      filters/                  # filter widget renderers
        TextFilter.tsx
        SelectFilter.tsx
        RangeFilter.tsx
        BooleanFilter.tsx
    renderers/
      cell-renderers.ts         # RendererEntry[] for cells
      form-renderers.ts         # RendererEntry[] for forms
      filter-renderers.ts       # RendererEntry[] for filters
  tests/
    registry.test.ts            # test tester scoring and resolution
  package.json
  tsconfig.json
  tsup.config.ts
  README.md
```

## Testing Your Renderers

Test two things: (1) tester scoring resolves the right component, (2) components render correctly.

```typescript
import { describe, it, expect } from 'vitest';
import { createShadcnRegistry } from '../src/index.js';

describe('ShadcnRegistry', () => {
  const registry = createShadcnRegistry();

  it('resolves TextCell for string fields', () => {
    const field = { zodType: 'string', sortable: true } as ResolvedFieldAffordance;
    const component = registry.resolve(field, { mode: 'cell' });
    expect(component).toBeDefined();
  });

  it('resolves BadgeCell for enum fields', () => {
    const field = { zodType: 'enum' } as ResolvedFieldAffordance;
    const component = registry.resolve(field, { mode: 'cell' });
    expect(component).toBeDefined();
  });

  it('prefers CurrencyCell over NumberCell when displayFormat is currency', () => {
    const field = { zodType: 'number', displayFormat: 'currency' } as ResolvedFieldAffordance;
    const scores = registry.explain(field, { mode: 'cell' });
    expect(scores[0].name).toContain('Currency');
  });
});
```

## Debugging

Use `registry.explain()` to see why a particular renderer was chosen:

```typescript
const scores = registry.explain(field, { mode: 'form' });
for (const { name, score } of scores) {
  console.log(`${name}: ${score}`);
}
```

## Checklist

- [ ] Cell renderers for: string, number, boolean, enum, date, array
- [ ] Form renderers for: text, number, checkbox, select, date, tags
- [ ] Filter renderers for: search, select, multiSelect, range, boolean
- [ ] Fallback renderer (renders anything as text)
- [ ] Each entry has a `name` for debugging
- [ ] Testers use `PRIORITY` bands (not arbitrary numbers)
- [ ] `createMyLibRegistry()` convenience function exported
- [ ] Individual renderer arrays exported for selective use
- [ ] Tests verify tester resolution and priority ordering
- [ ] Feedback contract: every pressable is pressed on `pointerdown`, pending and guarded while its promise runs, with a delayed indicator, styled by default (reduced motion included)
- [ ] `tests/feedback.test.ts` copied from an existing renderer and passing
- [ ] `peerDependencies` on `@zodal/core`, `@zodal/ui`, and your UI lib
- [ ] README with install, quick start, supported renderers table
