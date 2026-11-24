import { describe, it, expect, vi } from 'vitest';
import { selectIds, selectMatching } from '@zodal/core';
import type { Selection } from '@zodal/core';
import {
  createInMemoryProvider, resolveSelection, resolveMembership, resolveView, freezeSelection, resolveSelectionIds,
} from '../src/index.js';

const items = [
  { id: 'a', kind: 'x', n: 3, t: 'alpha' },
  { id: 'b', kind: 'y', n: 1, t: 'beta' },
  { id: 'c', kind: 'x', n: 2, t: 'gamma' },
  { id: 'd', kind: 'y', n: 4, t: 'delta' },
];
const ids = (list: { id: string }[]) => list.map((x) => x.id);
const xs = { filter: { field: 'kind', operator: 'eq' as const, value: 'x' } };

describe('resolveSelection', () => {
  it('explicit ids, in the items order', () => {
    expect(ids(resolveSelection(selectIds(['c', 'a', 'zz']), items))).toEqual(['a', 'c']);
  });
  it('all matching, plus included, minus excluded, evaluated when used', () => {
    const sel: Selection = { kind: 'query', query: xs, include: ['d'], exclude: ['a'] };
    expect(ids(resolveSelection(sel, items))).toEqual(['c', 'd']);
    const grown = [...items, { id: 'e', kind: 'x', n: 0, t: 'eps' }];
    expect(ids(resolveSelection(sel, grown))).toEqual(['c', 'e', 'd']);
  });
  it('search, and an empty search matches all', () => {
    expect(ids(resolveSelection(selectMatching({ search: 'ta' }), items))).toEqual(['b', 'd']);
    expect(ids(resolveSelection(selectMatching({ search: '' }), items))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('takes a key and an evaluator (a ranking survives)', () => {
    const rows = items.map(({ id, ...rest }) => ({ path: `/${id}`, ...rest }));
    const ranked = (list: readonly typeof rows[number][]) => [...list].reverse();
    const got = resolveSelection(selectMatching({ search: 'anything' }), rows, { key: (r) => r.path, evaluate: ranked });
    expect(got.map((r) => r.path)).toEqual(['/d', '/c', '/b', '/a']);
  });
});

describe('membership and views', () => {
  it('(rule ∪ pinned) − excluded, each item once', () => {
    expect(ids(resolveMembership({ rule: xs, pinned: ['b', 'a'], excluded: ['c'] }, items))).toEqual(['a', 'b']);
    expect(ids(resolveMembership({ pinned: ['d', 'b'] }, items))).toEqual(['b', 'd']);
    expect(resolveMembership({}, items)).toEqual([]);
  });
  it('a playlist (pinned, manual) and a smart playlist (rule, sort, limit)', () => {
    expect(ids(resolveView({ membership: { pinned: ['d', 'b'] }, ordering: { kind: 'manual', ids: ['d', 'b'] } }, items))).toEqual(['d', 'b']);
    const smart = { membership: { rule: { filter: { field: 'n', operator: 'gte' as const, value: 2 } }, limit: 2 }, ordering: { kind: 'sort' as const, keys: [{ field: 'n', desc: true }] } };
    expect(ids(resolveView(smart, items))).toEqual(['d', 'a']);
  });
  it('the trash is a rule on the deletion mark', () => {
    const rows = [{ id: 'a', deletedAt: null }, { id: 'b', deletedAt: 5 }];
    expect(ids(resolveView({ membership: { rule: { filter: { field: 'deletedAt', operator: 'isNotNull', value: null } } } }, rows))).toEqual(['b']);
  });
  it('freezes a query selection into the ids it covers now', () => {
    expect(freezeSelection({ kind: 'query', query: xs, exclude: ['c'] }, items)).toEqual({ kind: 'ids', ids: ['a'] });
    const explicit = selectIds(['b']);
    expect(freezeSelection(explicit, items)).toBe(explicit);
  });
});

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
