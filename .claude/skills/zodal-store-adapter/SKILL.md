# Skill: Building a zodal Store Adapter

## Purpose
Guide for implementing a `DataProvider<T>` adapter — the zodal interface for connecting any storage backend (REST API, database, file system, browser storage, cloud storage) to zodal collections.

## When to Use
- Creating a new storage backend for zodal (e.g., Supabase, S3, localStorage, filesystem)
- Wrapping an existing SDK or API client as a DataProvider
- Understanding what methods to implement and what capabilities to report

## Key Concepts

### What is a DataProvider?
A `DataProvider<T>` is zodal's normalized CRUD + query interface. It's the **only** contract between zodal and your storage backend. Implement this interface and your backend works with all of zodal's UI generators, state management, and tooling.

### Dependencies
Your adapter package should depend on:
- `@zodal/core` — for types (`SortingState`, `FilterExpression`, `FilterOperator`)
- `@zodal/store` — for the `DataProvider` interface, `ProviderCapabilities`, and optionally `filterToFunction()` for client-side fallback filtering

```json
{
  "peerDependencies": {
    "@zodal/core": "^0.1.0",
    "@zodal/store": "^0.1.0"
  }
}
```

## The DataProvider Interface

```typescript
import type { SortingState, FilterExpression } from '@zodal/core';
import type { ProviderCapabilities } from '@zodal/store';

interface GetListParams {
  sort?: SortingState[];
  filter?: FilterExpression;
  search?: string;
  pagination?: { page: number; pageSize: number };
}

interface GetListResult<T> {
  data: T[];
  total: number;
}

interface DataProvider<T> {
  // --- Required: 7 CRUD methods ---
  getList(params: GetListParams): Promise<GetListResult<T>>;
  getOne(id: string): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  updateMany(ids: string[], data: Partial<T>): Promise<T[]>;
  delete(id: string): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;

  // --- Optional ---
  upsert?(data: T): Promise<T>;
  getCapabilities?(): ProviderCapabilities;
  subscribe?(callback: (event: DataChangeEvent<T>) => void): () => void;
}
```

## Step-by-Step: Implement an Adapter

### Step 1: Define your factory function

Adapters are created via a factory function, not a class. Follow the pattern:

```typescript
import type { DataProvider } from '@zodal/store';

export interface MyBackendOptions {
  /** How your backend identifies items. Default: 'id'. */
  idField?: string;
  // ... backend-specific options (URL, credentials, table name, etc.)
}

export function createMyBackendProvider<T extends Record<string, any>>(
  config: MyBackendOptions,
): DataProvider<T> {
  const idField = config.idField ?? 'id';

  return {
    async getList(params) { /* ... */ },
    async getOne(id) { /* ... */ },
    async create(data) { /* ... */ },
    async update(id, data) { /* ... */ },
    async updateMany(ids, data) { /* ... */ },
    async delete(id) { /* ... */ },
    async deleteMany(ids) { /* ... */ },
    getCapabilities() { /* ... */ },
  };
}
```

### Step 2: Implement getList with FilterExpression

The `getList` method receives structured `FilterExpression` objects. You have two strategies:

**Strategy A: Translate to backend query language** (preferred for server-capable backends)
```typescript
async getList(params) {
  let query = myClient.from(tableName).select('*');

  // Translate FilterExpression to backend query
  if (params.filter) {
    query = applyFilter(query, params.filter);
  }
  if (params.sort?.length) {
    for (const s of params.sort) {
      query = query.order(s.id, { ascending: !s.desc });
    }
  }
  if (params.pagination) {
    const { page, pageSize } = params.pagination;
    const start = (page - 1) * pageSize;
    query = query.range(start, start + pageSize - 1);
  }

  const { data, count } = await query;
  return { data: data ?? [], total: count ?? 0 };
}
```

**Strategy B: Client-side fallback** (for backends that can't filter/sort)
```typescript
import { filterToFunction } from '@zodal/store';

async getList(params) {
  let items = await fetchAllItems(); // your backend fetch

  // Client-side filter using zodal's built-in utility
  if (params.filter) {
    const predicate = filterToFunction<T>(params.filter);
    items = items.filter(predicate);
  }

  const total = items.length;

  // Client-side sort
  if (params.sort?.length) {
    items.sort((a, b) => {
      for (const s of params.sort!) {
        const cmp = a[s.id] < b[s.id] ? -1 : a[s.id] > b[s.id] ? 1 : 0;
        if (cmp !== 0) return s.desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  // Client-side pagination
  if (params.pagination) {
    const { page, pageSize } = params.pagination;
    items = items.slice((page - 1) * pageSize, page * pageSize);
  }

  return { data: items, total };
}
```

### Step 3: Translate FilterExpression to your backend

`FilterExpression` is a recursive tree:
```typescript
type FilterExpression =
  | FilterCondition                    // leaf: { field, operator, value }
  | { and: FilterExpression[] }        // compound AND
  | { or: FilterExpression[] }         // compound OR
  | { not: FilterExpression };         // compound NOT

type FilterOperator =
  | 'eq' | 'ne'                        // equality
  | 'gt' | 'gte' | 'lt' | 'lte'       // comparison
  | 'contains' | 'startsWith' | 'endsWith' // string
  | 'in' | 'notIn'                     // set membership
  | 'arrayContains' | 'arrayContainsAny'   // array
  | 'isNull' | 'isNotNull';           // existence
```

Write a recursive translator for your backend. Example for a SQL-like backend:
```typescript
function applyFilter(query: Query, filter: FilterExpression): Query {
  if ('and' in filter) {
    return filter.and.reduce((q, f) => applyFilter(q, f), query);
  }
  if ('or' in filter) {
    return query.or(filter.or.map(f => buildWhereClause(f)).join(','));
  }
  if ('not' in filter) {
    return query.not(filter.not.field, operatorMap[filter.not.operator], filter.not.value);
  }
  // Leaf condition
  const { field, operator, value } = filter;
  switch (operator) {
    case 'eq': return query.eq(field, value);
    case 'ne': return query.neq(field, value);
    case 'gt': return query.gt(field, value);
    case 'gte': return query.gte(field, value);
    case 'lt': return query.lt(field, value);
    case 'lte': return query.lte(field, value);
    case 'contains': return query.ilike(field, `%${value}%`);
    case 'in': return query.in(field, value as any[]);
    // ... etc.
    default: return query;
  }
}
```

### Step 4: Report capabilities honestly

`getCapabilities()` tells zodal what your backend can do server-side. The UI layer uses this to decide whether to sort/filter client-side or delegate to the server.

```typescript
import type { ProviderCapabilities } from '@zodal/store';

getCapabilities(): ProviderCapabilities {
  return {
    // CRUD
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canBulkUpdate: true,     // true if updateMany does real bulk ops
    canBulkDelete: true,     // true if deleteMany does real bulk ops
    canUpsert: false,        // true only if you implement upsert()

    // Query — what the SERVER handles (not client-side fallback)
    serverSort: true,        // true | false | string[] (specific fields only)
    serverFilter: true,      // true | false | string[] (specific fields only)
    serverSearch: false,     // true if backend has full-text search
    serverPagination: true,  // true if backend paginates natively

    // Optional fine-grained details
    filterOperators: {       // per-field operator support
      name: ['eq', 'ne', 'contains', 'startsWith'],
      priority: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
    },
    paginationStyle: 'offset', // 'offset' or 'cursor'
    realtime: false,           // true if subscribe() is implemented
  };
}
```

**Rules**:
- If you do client-side filtering via `filterToFunction()`, report `serverFilter: false`
- Only report `serverSort: true` if the backend sorts — not if you sort in JS after fetching
- `string[]` means "server can sort/filter these specific fields only"

### Step 5: Optional — implement subscribe() for real-time

```typescript
subscribe(callback: (event: DataChangeEvent<T>) => void): () => void {
  const channel = myClient.channel('changes')
    .on('INSERT', (payload) => callback({ type: 'created', item: payload.new }))
    .on('UPDATE', (payload) => callback({ type: 'updated', id: payload.new.id, item: payload.new }))
    .on('DELETE', (payload) => callback({ type: 'deleted', id: payload.old.id }))
    .subscribe();

  // Return unsubscribe function
  return () => channel.unsubscribe();
}
```

Report `realtime: true` in capabilities when this is implemented.

## Package Structure

```
zodal-store-mybackend/
  src/
    index.ts              # re-exports
    provider.ts           # createMyBackendProvider factory
    filter-translator.ts  # FilterExpression → backend query (if server-side)
  tests/
    provider.test.ts      # test against DataProvider contract
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  README.md
```

## Testing Your Adapter

Test every DataProvider method against the contract. Use this pattern:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMyBackendProvider } from '../src/index.js';

describe('createMyBackendProvider', () => {
  let provider: DataProvider<TestItem>;

  beforeEach(() => {
    provider = createMyBackendProvider({ /* test config */ });
  });

  // --- CRUD contract tests ---
  it('creates and retrieves an item', async () => {
    const created = await provider.create({ name: 'Test' });
    expect(created).toHaveProperty('id');
    const fetched = await provider.getOne(created.id);
    expect(fetched.name).toBe('Test');
  });

  it('updates an item', async () => {
    const created = await provider.create({ name: 'Before' });
    const updated = await provider.update(created.id, { name: 'After' });
    expect(updated.name).toBe('After');
  });

  it('deletes an item', async () => {
    const created = await provider.create({ name: 'Doomed' });
    await provider.delete(created.id);
    await expect(provider.getOne(created.id)).rejects.toThrow();
  });

  // --- getList contract tests ---
  it('filters with FilterExpression', async () => {
    await provider.create({ name: 'Alpha', priority: 1 });
    await provider.create({ name: 'Beta', priority: 3 });
    const { data } = await provider.getList({
      filter: { field: 'priority', operator: 'gte', value: 2 },
    });
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Beta');
  });

  it('sorts results', async () => {
    await provider.create({ name: 'Zebra' });
    await provider.create({ name: 'Alpha' });
    const { data } = await provider.getList({
      sort: [{ id: 'name', desc: false }],
    });
    expect(data[0].name).toBe('Alpha');
  });

  it('paginates results', async () => {
    for (let i = 0; i < 25; i++) {
      await provider.create({ name: `Item ${i}` });
    }
    const { data, total } = await provider.getList({
      pagination: { page: 2, pageSize: 10 },
    });
    expect(data).toHaveLength(10);
    expect(total).toBe(25);
  });

  // --- Capabilities ---
  it('reports capabilities', () => {
    const caps = provider.getCapabilities?.();
    expect(caps).toBeDefined();
    expect(caps!.canCreate).toBe(true);
  });
});
```

## Codec Integration

If your backend stores data in a different format than the app uses (e.g., ISO strings instead of Date objects), users can wrap your provider with `wrapProvider()`:

```typescript
import { wrapProvider } from '@zodal/store';

const rawProvider = createMyBackendProvider({ tableName: 'projects' });
const typedProvider = wrapProvider(rawProvider, {
  decode: (raw) => ({ ...raw, createdAt: new Date(raw.createdAt) }),
  encode: (typed) => ({ ...typed, createdAt: typed.createdAt.toISOString() }),
});
```

You don't need to handle codecs inside your adapter — that's the user's concern via `wrapProvider()`.

## Reference Implementation

The in-memory provider in `@zodal/store` (`packages/store/src/in-memory.ts`) is the canonical reference. Study it for:
- How `filterToFunction()` is used for client-side filtering
- How sorting, search, and pagination are implemented
- How `getCapabilities()` reports what the provider supports
- The `InMemoryProviderOptions` pattern for factory options

## Checklist

- [ ] Factory function `create___Provider<T>(options)` returning `DataProvider<T>`
- [ ] All 7 required methods implemented
- [ ] `getCapabilities()` reports honest capabilities
- [ ] `FilterExpression` translated or evaluated client-side via `filterToFunction()`
- [ ] `getOne()` throws on not-found
- [ ] `getList()` returns `{ data, total }` (total is pre-pagination count)
- [ ] Pagination uses 1-based page numbers
- [ ] Tests cover CRUD, filtering, sorting, pagination
- [ ] `peerDependencies` on `@zodal/core` and `@zodal/store`
- [ ] README with install, quick start, capabilities table
