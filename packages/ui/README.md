# @zodal/ui

Generators, state management, and renderer registry for zodal.

## Install

```bash
npm install @zodal/ui @zodal/core zod@^4
```

## Quick Start

```typescript
import { defineCollection } from '@zodal/core';
import { toColumnDefs, toFormConfig, toFilterConfig, createCollectionStore, toPrompt } from '@zodal/ui';

const collection = defineCollection(schema, config);

// TanStack Table-compatible column definitions
const columns = toColumnDefs(collection);

// Form field configs for create/edit
const createFields = toFormConfig(collection, 'create');
const editFields = toFormConfig(collection, 'edit');

// Filter panel configs
const filters = toFilterConfig(collection);

// Pure-function state management
const store = createCollectionStore(collection);
let state = store.initialState;
state = store.actions.setItems(state, items, total);

// AI-consumable description
const prompt = toPrompt(collection);
```

## What's Inside

- **Generators** -- `toColumnDefs()`, `toFormConfig()`, `toFilterConfig()` (headless, framework-agnostic)
- **State** -- `createCollectionStore()` (pure functions) + 5 composable slices
- **Zustand adapter** -- `createZustandStoreSlice()` for Zustand `create()` integration
- **Renderer registry** -- ranked testers with priority bands and `explain()` debugging
- **AI tools** -- `toPrompt()` for LLM consumption, `toCode()` for TypeScript codegen
