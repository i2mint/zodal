---
name: zodal-store-adapter
description: >-
  Implement a DataProvider<T> adapter — the zodal interface connecting any storage
  backend (REST API, database, filesystem, browser storage, cloud storage) to zodal
  collections. Use when creating a new storage backend, wrapping an existing SDK or
  API client as a DataProvider, or working out which methods to implement and which
  capabilities to report.
metadata:
  audience: developers
---

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
- `@zodal/store` — for the `DataProvider` interface, `ProviderCapabilities`, `applyQuery()` for client-side query fallback (filter, search, sort, paginate), and `@zodal/store/testing` for the conformance kit

Declare the peers with a caret on the lowest version you need (`^0.2.1` for `applyQuery` and the kit). In `0.x` the minor number is the breaking one, so `^0.2.1` correctly excludes a breaking `0.3.0`; zodal's CI (`scripts/check-satellite-peers.mjs`) refuses a core release that would newly exclude a published satellite, so the break is caught at release time, not in an app. Do not use `>=X <1.0.0`: it accepts a breaking `0.3.0` silently (see `docs/versioning.md`).

```json
{
  "peerDependencies": {
    "@zodal/core": "^0.2.1",
    "@zodal/store": "^0.2.1"
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

  // --- Optional: content (the bifurcation path — see below) ---
  getContent?(id: string, field: string): Promise<unknown>;
  setContent?(id: string, field: string, content: unknown): Promise<ContentRef>;
  getUrl?(id: string, field: string): Promise<string | null>;
}
```

### The content trio — implement these if your backend stores blobs

A "content" field is a large, opaque, non-queryable value (a video, an image, a
document) — as opposed to metadata, which is small, structured and queryable. See
`createBifurcatedProvider` for how the two halves compose.

- **`getContent(id, field)`** returns the **bytes**.
- **`getUrl(id, field)`** returns a **directly-fetchable URL** — public, pre-signed, or
  an endpoint that streams. Return `null` if your backend can't produce one (e.g. an
  in-memory or IndexedDB store); callers then fall back to `getContent()`.
- **`setContent(id, field, content)`** writes bytes and returns the resulting `ContentRef`.

**Implement `getUrl` whenever you can.** For anything a browser consumes by URL —
`<video src>`, `<img src>`, `<a download>` — bytes are the wrong currency: `getContent()`
defeats HTTP range requests, so you lose streaming and seeking, and the whole file sits in
memory. `getUrl` is also the seam that survives a storage migration: the same call returns
`/api/app/clips/x.mp4` today and `https://bucket.s3.../x.mp4` after the bytes move, so
consuming code never changes.

**`toContentRef` may be async.** Pre-signing is a round-trip, so any adapter accepting a
`toContentRef` option must type it as `(itemId, field) => ContentRef | Promise<ContentRef>`
and `await` it — including inside `getList`, where refs for a page of items should be built
with `Promise.all` rather than serially. Forgetting the `await` is the classic bug here: the
field silently holds a pending Promise, and `ref.url` reads as `undefined`.

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

Use `applyQuery` (from `@zodal/store` 0.2.1): filter, search, count, sort and paginate in one shared implementation. Do not hand-roll these steps; every adapter that did drifted slightly from the others.

```typescript
import { applyQuery } from '@zodal/store';

async getList(params) {
  const items = await fetchAllItems(); // your backend fetch
  return applyQuery(items, params, {
    searchFields,                      // optional; default: every string field
    // excludeFromSearch: contentFields, // e.g. for a content provider
    // skip: { filter: true },           // steps your backend already did server-side
  });
}
```

Return copies, not the objects you store: a caller that mutates a returned item (or its `tags` array) must not change your store. `structuredClone` does it.

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

**Run the conformance kit first.** `@zodal/store/testing` states the whole `DataProvider` contract (CRUD, filters including tag operators, search, sort, 1-based pagination and `total`, errors on missing ids, copies not aliases, honest capabilities) as framework-agnostic cases:

```typescript
import { describe, it } from 'vitest';
import { providerContract } from '@zodal/store/testing';
import { createMyBackendProvider } from '../src/index.js';

const cases = await providerContract({
  make: async (seed) => {
    const provider = createMyBackendProvider({ /* fresh test config */ });
    for (const row of seed) await provider.create(row); // or seed the backend directly
    return provider;
  },
  // skip: { 'getList sort by several keys': 'why this backend cannot' },  // documented deviations only
});

describe('my backend: DataProvider contract', () => {
  for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
});
```

Writes the provider declares it cannot do (`canCreate: false`, ...) are skipped automatically, and the kit then checks that those calls really reject. Add backend-specific tests (serialization, server-side translation, credentials) beside it.

## Bifurcation: Using Your Adapter with BifurcatedProvider

Any adapter can serve as the metadata or content provider in a `createBifurcatedProvider()` composition. No changes to your adapter are required. See [bifurcation research](../../../docs/research/bifurcation_research_for_zodal.md) for the design rationale.

**Natural metadata providers** (queryable, structured):
- Supabase, REST APIs, IndexedDB wrappers — strong `serverFilter`/`serverSort`

**Natural content providers** (blob-oriented):
- S3, filesystem, OPFS — optimized for large object read/write

```typescript
import { createBifurcatedProvider } from '@zodal/store';

const provider = createBifurcatedProvider({
  metadataProvider: createMyQueryableProvider(dbConfig),
  contentProvider: createMyBlobProvider(storageConfig),
  contentFields: ['attachment', 'file'],
});
// Consumers call provider.getList(), provider.create(), etc.
// Routing to the right backend is automatic.
```

Your adapter can also report bifurcation-specific capabilities:

```typescript
getCapabilities(): ProviderCapabilities {
  return {
    // ... standard capabilities ...
    bifurcated: true,          // only if YOUR adapter is itself bifurcated
    contentFields: ['attachment'],
  };
}
```

### Optional: getContent / setContent

`DataProvider<T>` now has two optional methods for explicit content access:

```typescript
getContent?(id: string, field: string): Promise<unknown>;
setContent?(id: string, field: string, content: unknown): Promise<ContentRef>;
```

Standard adapters do NOT need to implement these. Only `createBifurcatedProvider()` implements them. If you are building a specialized content-aware adapter, you can implement them for direct content access without going through the full CRUD path.

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
