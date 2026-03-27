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
- **filterToFunction()** -- compile FilterExpression to a predicate for client-side evaluation
