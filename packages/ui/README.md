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
- **Options forms** -- `toOptionsFormConfig(schema, { secretPaths })`: a form for a settings-like object that is not a collection record (provider options, connection settings): no record name heuristics, secrets as password fields, nested objects as fieldsets, functions and `z.custom` values marked "supplied in code"
- **State** -- `createCollectionStore()` (pure functions) + 5 composable slices
- **Zustand adapter** -- `createZustandStoreSlice()` for Zustand `create()` integration
- **Persisted view state** -- `createViewStateStore()`: the view mode, collapsed groups, sort, search and filters a person chose, written through a `DataProvider` and read back on the next visit (a choice made before the stored record arrives wins)
- **Renderer registry** -- ranked testers with priority bands and `explain()` debugging
- **AI tools** -- `toPrompt()` for LLM consumption, `toCode()` for TypeScript codegen

## Remembering a person's view

```typescript
import { createViewStateStore } from '@zodal/ui';
import { createLocalStorageProvider } from '@zodal/store-localstorage';

const view = createViewStateStore(products, createLocalStorageProvider({ storageKey: 'app.views', idField: 'id' }), { key: 'products' });
await view.hydrate({ groups: categoryIds }); // the stored choices, or the collection's defaults
view.set({ viewMode: 'grid' });              // written through
view.toggleGroup('archived');
const off = view.subscribe((state) => render(state));
```

This is the working view state (one record per collection and key, last write wins), not named saved views. A record of an older shape is mapped by `migrate`; a stored view the collection no longer offers opens on its `defaultView`.
