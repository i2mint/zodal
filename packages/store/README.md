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
- **createTieredProvider()** -- a bounded local cache (hot tier, e.g. localStorage) over a remote source of truth (cold tier, e.g. HTTP or S3): fresh cached reads, write-through, LRU eviction past `maxItems`, recency kept in its own `residency` provider, offline reads answered from the cache, best-effort caching (a cache failure never fails a remote success), admission and eviction as policies
- **createAuthAwareProvider()** -- local while signed out, the account's store (cached locally) once signed in, with the device's records merged up on the first sign-in: union by id, newer `updatedAt` wins, or union only for an append-only log
- **createFieldHistory()** -- a field's past values, offered back (input history): dedupe moves a repeated value to the top, a cap per scope that never evicts pinned entries, pinned then most recent first, a query filter, `clear`/`restore` for an Undo; entries live in any `DataProvider<HistoryEntry>` (in memory by default, localStorage on one device, a tiered provider across devices). See `docs/research/field-input-history.md`
- **filterToFunction()** -- compile FilterExpression to a predicate for client-side evaluation

## Auth-aware provider: on the device until sign-in, in the account after

```typescript
import { createAuthAwareProvider } from '@zodal/store';

const presets = createAuthAwareProvider({
  local: createLocalStorageProvider({ storageKey: 'presets' }),
  remote: () => (auth.user ? createHttpProvider({ baseUrl: `/api/${auth.user.id}/presets` }) : null),
});

presets.onSwitch(({ to }) => refreshViews(to));  // 'local' -> 'remote' on sign-in, back on sign-out
await presets.refresh();                         // check right after sign-in, merging up now
```

`remote()` is asked before every operation. The first time a remote provider appears, every local record is merged into it (`merge` to replace the rule; `appendOnly: true` never overwrites); until that merge succeeds the remote is used directly, so no cache eviction can drop a record not yet in the account, and the merge is retried on the next operation. After it, the remote is read and written through `createTieredProvider` with `local` as the cache (`tier` passes its options). On sign-out it goes back to `local`, which still holds what the cache kept: a host that must not leave account data on a shared device clears it on sign-out. Conditional writes are forwarded; signed in, `versioned` is reported off, as the tier does.

## Tiered provider: recent items cached on the device

```typescript
import { createTieredProvider } from '@zodal/store';
import { createHttpProvider } from '@zodal/store-http';
import { createLocalStorageProvider } from '@zodal/store-localstorage';

const songs = createTieredProvider({
  cold: createHttpProvider({ baseUrl: '/api/songs' }),                         // source of truth
  hot: createLocalStorageProvider({ storageKey: 'songs:recent' }),           // bounded cache
  residency: createLocalStorageProvider({ storageKey: 'songs:recent:at' }),  // LRU survives reloads
  maxItems: 100,
  isFresh: (song) => song.status === 'complete',  // re-read items still changing remotely
});

await songs.getOne('abc');   // cold on first read, hot afterwards
await songs.cached();        // what is on this device, most recently used first
```

Writes go to the cold tier first and are cached only once it accepted them (a created item is cached; an updated one is refreshed only if it was cached). When the cold tier is unreachable (no HTTP status, or a 5xx; `fallbackOn` to change it), `getList` and `getOne` answer from the cache and `onFallback` is told, so the UI can say it is offline; a 404 drops the cached copy. A failing cache (a full quota) is reported to `onCacheError` and never fails an operation the cold tier completed. `admit` (which items are cached) and `selectEvictions` (which leave; least recently used by default) are the policy seams. Content (`getContent`, `getUrl`) stays with the cold tier for now; byte budgets, pins and blob tiering are the next slices of [zodal#115](https://github.com/i2mint/zodal/issues/115).
