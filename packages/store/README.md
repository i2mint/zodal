# @zodal/store

DataProvider interface, capability discovery, and adapters for zodal.

## Install

```bash
npm install @zodal/store @zodal/core zod@^4
```

## Quick Start

```typescript
import { createInMemoryProvider } from '@zodal/store';

const provider = createInMemoryProvider([
  { id: '1', name: 'Alpha', priority: 3 },
  { id: '2', name: 'Beta', priority: 1 },
]);

// Structured filters (not untyped ColumnFilter[])
const { data, total } = await provider.getList({
  filter: {
    and: [
      { field: 'priority', operator: 'gte', value: 2 },
      { field: 'name', operator: 'contains', value: 'alpha' },
    ],
  },
  sort: [{ id: 'priority', desc: false }],
  pagination: { page: 1, pageSize: 10 },
});

// Capability discovery
const caps = provider.getCapabilities!();
caps.serverSort;  // false (in-memory is client-side)
```

## What's Inside

- **DataProvider\<T\>** -- 7 required + 1 optional CRUD method + `getCapabilities()` + `subscribe?()`
- **FilterExpression** -- structured, serializable filters with AND/OR/NOT composition
- **createInMemoryProvider()** -- full-featured client-side adapter for prototyping/testing
- **wrapProvider()** -- apply encode/decode codecs to any DataProvider
- **createTieredProvider()** -- a bounded local cache (hot tier, e.g. localStorage) over a remote source of truth (cold tier, e.g. HTTP or S3): fresh cached reads, write-through, LRU eviction past `maxItems`, recency kept in its own `accessLog` provider, and offline reads answered from the cache
- **filterToFunction()** -- compile FilterExpression to a predicate for client-side evaluation

## Tiered provider: recent items cached on the device

```typescript
import { createTieredProvider } from '@zodal/store';
import { createHttpProvider } from '@zodal/store-http';
import { createLocalStorageProvider } from '@zodal/store-localstorage';

const songs = createTieredProvider({
  cold: createHttpProvider({ baseUrl: '/api/songs' }),                         // source of truth
  hot: createLocalStorageProvider({ storageKey: 'songs:recent' }),           // bounded cache
  accessLog: createLocalStorageProvider({ storageKey: 'songs:recent:at' }),  // LRU survives reloads
  maxItems: 100,
  isFresh: (song) => song.status === 'complete',  // re-read items still changing remotely
});

await songs.getOne('abc');   // cold on first read, hot afterwards
await songs.cached();        // what is on this device, most recently used first
```

Writes go to the cold tier first and are cached only once it accepted them. When the cold tier is unreachable, `getList` and `getOne` answer from the cache. Content (`getContent`, `getUrl`) stays with the cold tier for now; byte budgets, pins and blob tiering are the next slices of [zodal#115](https://github.com/i2mint/zodal/issues/115).
