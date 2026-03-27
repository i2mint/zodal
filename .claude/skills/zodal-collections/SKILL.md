# Skill: Using zodal Collections

## Purpose
Guide for using zodal to define and work with schema-driven collections in a TypeScript project.

## When to Use
- Setting up a new collection from a Zod schema
- Generating table columns, form configs, or filter configs
- Working with DataProviders (CRUD, filtering, sorting)
- Integrating zodal with React (Zustand, TanStack Table)

## Quick Recipe: Define a Collection

```typescript
import { z } from 'zod';
import { defineCollection } from '@zodal/core';

// 1. Define your Zod schema
const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']),
  priority: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  createdAt: z.date(),
});

// 2. Define collection (zero-config works!)
const projects = defineCollection(ProjectSchema);

// 3. Or with explicit config
const projects = defineCollection(ProjectSchema, {
  affordances: { bulkDelete: true, export: ['csv'] },
  fields: {
    name: { inlineEditable: true },
    status: { badge: { draft: 'secondary', active: 'default', archived: 'outline' } },
  },
  operations: [
    { name: 'archive', label: 'Archive', scope: 'item', confirm: true },
  ],
});
```

## Quick Recipe: Generate UI Configs

```typescript
import { toColumnDefs, toFormConfig, toFilterConfig } from '@zodal/ui';

// TanStack Table columns
const columns = toColumnDefs(projects);

// Form fields (mode: 'create' or 'edit')
const createFields = toFormConfig(projects, 'create');

// Filter panel fields
const filters = toFilterConfig(projects);
```

## Quick Recipe: Data Provider

```typescript
import { createInMemoryProvider } from '@zodal/store';

// In-memory for prototyping
const provider = createInMemoryProvider(data, { idField: 'id' });

// Structured filters
const { data, total } = await provider.getList({
  filter: {
    and: [
      { field: 'status', operator: 'eq', value: 'active' },
      { field: 'priority', operator: 'gte', value: 3 },
    ],
  },
  sort: [{ id: 'createdAt', desc: true }],
  pagination: { page: 1, pageSize: 25 },
});
```

## Quick Recipe: State Management

### Pure functions (framework-agnostic)
```typescript
import { createCollectionStore } from '@zodal/ui';

const store = createCollectionStore(projects);
let state = store.initialState;
state = store.actions.setItems(state, items, total);
state = store.actions.setSorting(state, [{ id: 'name', desc: false }]);
const selected = store.selectors.getSelectedItems(state);
```

### With Zustand
```typescript
import { create } from 'zustand';
import { createZustandStoreSlice } from '@zodal/ui';

const useProjectStore = create(
  createZustandStoreSlice(projects, provider)
);

// In component:
const items = useProjectStore(s => s.items);
const fetchData = useProjectStore(s => s.fetchData);
await fetchData(); // auto-fetches with current sort/filter/pagination
```

### Composable slices (pick what you need)
```typescript
import { createSortingSlice, createPaginationSlice } from '@zodal/ui';

const sorting = createSortingSlice(projects);
const pagination = createPaginationSlice(projects);
```

## Quick Recipe: Metadata That Survives Wrapping

```typescript
import { affordanceRegistry } from '@zodal/core';

// Register BEFORE wrapping with .optional()
const priceSchema = z.number().min(0);
affordanceRegistry.register(priceSchema, { displayFormat: 'currency' });

const Product = z.object({
  price: priceSchema.optional(), // registry metadata survives!
});
```

## Quick Recipe: Debug Inference

```typescript
const collection = defineCollection(schema);

// See what was inferred and why
const traces = collection.explain('fieldName');
for (const trace of traces) {
  console.log(`${trace.affordance}: ${trace.finalValue}`);
  for (const layer of trace.layers) {
    console.log(`  [${layer.layer}] ${layer.value} — ${layer.reason}`);
  }
}
```

## Quick Recipe: Provider Codecs

```typescript
import { wrapProvider } from '@zodal/store';
import { dateIsoCodec } from '@zodal/core';

// Raw provider stores dates as ISO strings
const rawProvider = createRestProvider('/api/projects');

// Wrapped provider converts dates automatically
const typedProvider = wrapProvider(rawProvider, {
  decode: (raw) => ({ ...raw, createdAt: new Date(raw.createdAt) }),
  encode: (typed) => ({ ...typed, createdAt: typed.createdAt.toISOString() }),
});
```

## Common Patterns

### Override a single field's inference
```typescript
defineCollection(schema, {
  fields: { myField: { sortable: false, editWidget: 'richtext' } },
});
```

### Custom renderer for a field type
```typescript
import { createRendererRegistry, zodTypeIs, PRIORITY } from '@zodal/ui';

const registry = createRendererRegistry();
registry.register({
  tester: zodTypeIs('string'),
  renderer: TextInput,
  name: 'TextInput',
});
```

### Generate AI-consumable description
```typescript
import { toPrompt } from '@zodal/ui';
const prompt = toPrompt(collection);
// Feed to LLM for UI generation or CRUD agent
```
