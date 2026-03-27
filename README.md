# zodal

Schema-driven affordances for collections, resources, and beyond.

Declare your data shape once via [Zod v4](https://zod.dev) schemas. zodal infers UI configuration, state management, data access, and API interfaces from that single declaration.

## Packages

| Package | Description |
|---|---|
| `@zodal/core` | Types, inference engine, `defineCollection()`, `explain()`, codecs |
| `@zodal/store` | `DataProvider`, capabilities, filters, in-memory adapter |
| `@zodal/ui` | Headless UI generators, state store, renderer registry, `toPrompt()`, `toCode()` |

## Quick Start

```typescript
import { z } from 'zod';
import { defineCollection } from '@zodal/core';

const collection = defineCollection(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: z.enum(['draft', 'active', 'archived']),
    priority: z.number().int().min(1).max(5),
    createdAt: z.date(),
  })
);

collection.idField;              // 'id'
collection.labelField;           // 'name'
collection.getVisibleFields();   // ['name', 'status', 'priority', 'createdAt']
collection.getSearchableFields(); // ['name']
collection.explain('name');      // layer-by-layer inference trace
```

## Key Ideas

- **Convention over configuration** -- zero annotations gives you working defaults
- **6-layer inference** -- Zod type, refinements, name heuristics, `.meta()`, affordance registry, config overrides
- **Headless first** -- produces configuration objects, never DOM/React directly
- **Escape hatches everywhere** -- any inferred default can be overridden
- **Thin glue, not a framework** -- configures existing tools (TanStack Table, Zustand, etc.)

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Monorepo managed with pnpm workspaces + Turborepo. Built with tsup (dual CJS/ESM + .d.ts).

## License

MIT
