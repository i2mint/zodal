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
    "@zodal/core": "^0.1.0",
    "@zodal/ui": "^0.1.0",
    "react": "^18.0.0 || ^19.0.0"
  }
}
```

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
  order: number;
  zodType: string;
}
```

### FilterFieldConfig (from toFilterConfig)
```typescript
interface FilterFieldConfig {
  name: string;
  label: string;
  filterType: FilterType;  // 'exact' | 'search' | 'select' | 'multiSelect' | 'range' | 'contains' | 'boolean' | 'fuzzy'
  options?: { label: string; value: string }[];
  bounds?: { min?: number; max?: number };
  zodType: string;
}
```

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
- [ ] `peerDependencies` on `@zodal/core`, `@zodal/ui`, and your UI lib
- [ ] README with install, quick start, supported renderers table
