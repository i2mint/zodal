import { describe, it, expect, vi } from 'vitest';
import { selectIds, selectMatching } from '@zodal/core';
import type { Selection } from '@zodal/core';
import { createInMemoryProvider, resolveSelectionIds } from '../src/index.js';

const items = [
  { id: 'a', kind: 'x' },
  { id: 'b', kind: 'y' },
  { id: 'c', kind: 'x' },
];
const xs = { filter: { field: 'kind', operator: 'eq' as const, value: 'x' } };

describe('resolveSelectionIds against a provider', () => {
  it('lets the provider run the query, walking every page, with exceptions', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, kind: i % 2 ? 'x' : 'y' }));
    const provider = createInMemoryProvider(many);
    const spy = vi.spyOn(provider, 'getList');
    const sel: Selection = { kind: 'query', query: xs, include: ['i0'], exclude: ['i1'], expectedCount: 6 };
    const got = await resolveSelectionIds(provider, sel, { pageSize: 4 });
    expect(got.ids).toEqual(['i3', 'i5', 'i7', 'i9', 'i11', 'i0']);
    expect(got.countChanged).toBe(false);
    expect(spy.mock.calls.length).toBe(2);
    expect(spy.mock.calls[0]![0]).toMatchObject({ filter: xs.filter, pagination: { page: 1, pageSize: 4 } });
  });
  it('says when the count moved since the user chose', async () => {
    const provider = createInMemoryProvider(items);
    const got = await resolveSelectionIds(provider, selectMatching(xs, 3));
    expect(got).toEqual({ ids: ['a', 'c'], countChanged: true });
  });
  it('returns an explicit selection as is', async () => {
    const provider = createInMemoryProvider(items);
    expect(await resolveSelectionIds(provider, selectIds(['b']))).toEqual({ ids: ['b'], countChanged: false });
  });
});
