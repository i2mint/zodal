# zodal

Schema-driven affordances for collections, resources, and beyond.

Declare your data shape once via [Zod v4](https://zod.dev) schemas. zodal infers UI configuration, state management, data access, and API interfaces from that single declaration.

## Packages

| Package | Description |
|---|---|
| `@zodal/core` | Types, inference engine, `defineCollection()`, `explain()`, codecs, content-metadata bifurcation types |
| `@zodal/store` | `DataProvider`, capabilities, filters, in-memory adapter, `createBifurcatedProvider()` |
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

## Content-Metadata Bifurcation

Collections often have both small/structured/queryable **metadata** (title, tags, timestamps) and large/opaque **content** (files, images, documents). zodal handles this with [schema-driven bifurcation](docs/research/bifurcation_design_notes.md):

```typescript
const DocSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  attachment: z.any(),  // auto-classified as content by name heuristic
});

const collection = defineCollection(DocSchema);
collection.getContentFields();  // ['attachment']
collection.hasBifurcation();    // true

// Route metadata to a DB, content to object storage
import { createBifurcatedProvider } from '@zodal/store';

const provider = createBifurcatedProvider({
  metadataProvider: supabaseProvider,
  contentProvider: s3Provider,
  contentFields: collection.getContentFields(),
});
```

See [The content-metadata bifurcation problem in software architecture](docs/research/The%20content-metadata%20bifurcation%20problem%20in%20software%20architecture.md) for the research background.

## Key Ideas

- **Convention over configuration** -- zero annotations gives you working defaults
- **6-layer inference** -- Zod type, refinements, name heuristics, `.meta()`, affordance registry, config overrides
- **Headless first** -- produces configuration objects, never DOM/React directly
- **Escape hatches everywhere** -- any inferred default can be overridden
- **Thin glue, not a framework** -- configures existing tools (TanStack Table, Zustand, etc.)
- **Content-metadata bifurcation** -- schema classifies fields by storage role; two providers compose into one

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Monorepo managed with pnpm workspaces + Turborepo. Built with tsup (dual CJS/ESM + .d.ts).

## License

MIT
