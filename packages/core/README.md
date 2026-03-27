# @zodal/core

Schema types, inference engine, and `defineCollection()` for zodal.

## Install

```bash
npm install @zodal/core zod@^4
```

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

// Zero-config inference gives you:
collection.idField;           // 'id'
collection.labelField;        // 'name'
collection.getVisibleFields(); // ['name', 'status', 'priority', 'createdAt']
collection.getSearchableFields(); // ['name']
collection.explain('name');   // layer-by-layer inference trace
```

## What's Inside

- **types** -- `FieldAffordance`, `CollectionConfig`, `FilterExpression`, `SortingState`
- **inference** -- 6-layer engine: type -> validation -> name heuristic -> `.meta()` -> registry -> config
- **defineCollection()** -- main entry point; produces `CollectionDefinition` with query methods
- **explain()** -- transparency into how each affordance was inferred
- **affordanceRegistry** -- external metadata that survives `.optional()` / `.nullable()` wrapping
- **codecs** -- `Codec<TEncoded, TDecoded>`, pre-built date/JSON codecs, `composeCodecs()`
