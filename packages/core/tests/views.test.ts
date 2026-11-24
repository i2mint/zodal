import { describe, it, expect } from 'vitest';
import {
  FilterExpressionSchema, QuerySchema, SelectionSchema, OrderingSchema, MembershipSchema,
  EMPTY_SELECTION, selectIds, selectMatching, isSelectionEmpty, isSelected, toggleSelected, setSelected,
  selectRange, forgetSelected, compareSortKeys, applyOrdering, filterConditions, missingFieldClauses,
} from '../src/index.js';
import type { Selection } from '../src/index.js';

const xs = { filter: { field: 'kind', operator: 'eq' as const, value: 'x' } };
const items = [
  { id: 'a', kind: 'x', n: 3, t: 'alpha' },
  { id: 'b', kind: 'y', n: 1, t: 'Beta' },
  { id: 'c', kind: 'x', n: 2, t: 'gamma' },
  { id: 'd', kind: 'y', n: null, t: 'delta' },
];
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('schemas', () => {
  it('validate filter expressions all the way down', () => {
    const expr = { and: [xs.filter, { not: { field: 'n', operator: 'isNull' } }, { or: [{ field: 't', operator: 'in', value: ['a', 'b'] }] }] };
    expect(FilterExpressionSchema.parse(expr)).toEqual(expr);
    expect(() => FilterExpressionSchema.parse({ field: 'n', operator: 'like', value: 1 })).toThrow();
    expect(() => FilterExpressionSchema.parse({ and: [] })).toThrow();
    expect(() => FilterExpressionSchema.parse({ field: 'n', operator: 'eq', value: 1, extra: true })).toThrow();
    expect(() => FilterExpressionSchema.parse({ and: [{ field: '', operator: 'eq', value: 1 }] })).toThrow();
  });
  it('round-trip a selection, an ordering and a membership through JSON', () => {
    const sel = selectMatching(xs, 2);
    expect(SelectionSchema.parse(JSON.parse(JSON.stringify(sel)))).toEqual({ kind: 'query', query: xs, expectedCount: 2 });
    expect(SelectionSchema.parse(selectIds(['a']))).toEqual({ kind: 'ids', ids: ['a'] });
    expect(OrderingSchema.parse({ kind: 'sort', keys: [{ field: 'n', desc: true }] }).kind).toBe('sort');
    expect(() => OrderingSchema.parse({ kind: 'sort', keys: [] })).toThrow();
    expect(MembershipSchema.parse({ rule: xs, pinned: ['d'], limit: 3 })).toEqual({ rule: xs, pinned: ['d'], limit: 3 });
    expect(() => MembershipSchema.parse({ limit: 0 })).toThrow();
    expect(QuerySchema.parse({})).toEqual({});
  });
});

describe('changing a selection', () => {
  const matchesX = (id: string) => items.find((x) => x.id === id)?.kind === 'x';
  const none = () => false;

  it('explicit: toggle adds and removes', () => {
    let s: Selection = EMPTY_SELECTION;
    expect(isSelectionEmpty(s)).toBe(true);
    s = toggleSelected(s, 'a', none);
    s = toggleSelected(s, 'b', none);
    expect(s).toEqual({ kind: 'ids', ids: ['a', 'b'] });
    s = toggleSelected(s, 'a', none);
    expect(s).toEqual({ kind: 'ids', ids: ['b'] });
    expect(EMPTY_SELECTION).toEqual({ kind: 'ids', ids: [] }); // never mutated
  });

  it('composite: unselecting a match excludes it, selecting a non-match includes it', () => {
    let s = selectMatching(xs);
    expect(isSelected(s, 'a', matchesX)).toBe(true);
    expect(isSelectionEmpty(s)).toBe(false);
    s = toggleSelected(s, 'a', matchesX);
    expect(s).toMatchObject({ exclude: ['a'] });
    expect(isSelected(s, 'a', matchesX)).toBe(false);
    s = toggleSelected(s, 'b', matchesX);
    expect(s).toMatchObject({ include: ['b'] });
    s = toggleSelected(s, 'a', matchesX);
    expect(isSelected(s, 'a', matchesX)).toBe(true);
    expect((s as { exclude?: string[] }).exclude).toEqual([]);
    s = toggleSelected(s, 'b', matchesX);
    expect(isSelected(s, 'b', matchesX)).toBe(false);
  });

  it('shift-click gives the range the anchor state; unknown ids fall back to toggle', () => {
    const shown = ['a', 'b', 'c', 'd'];
    let s = selectIds(['b']);
    s = selectRange(s, 'b', 'd', shown, none);
    expect(new Set((s as { ids: string[] }).ids)).toEqual(new Set(['b', 'c', 'd']));
    s = selectRange(selectIds(['b', 'c', 'd']), 'a', 'c', shown, none); // anchor unselected: clears a..c
    expect(s).toEqual({ kind: 'ids', ids: ['d'] });
    expect(selectRange(EMPTY_SELECTION, 'zz', 'a', shown, none)).toEqual({ kind: 'ids', ids: ['a'] });
    expect(setSelected(selectIds(['a']), ['a', 'b'], true, none)).toEqual({ kind: 'ids', ids: ['a', 'b'] });
  });

  it('forgets deleted ids', () => {
    expect(forgetSelected(selectIds(['a', 'b']), ['a'])).toEqual({ kind: 'ids', ids: ['b'] });
    expect(forgetSelected({ kind: 'query', query: xs, include: ['b', 'd'] }, ['d'])).toMatchObject({ include: ['b'] });
  });
});

describe('ordering', () => {
  it('compareSortKeys: null first, numbers, strings case-folded by code point, booleans, dates', () => {
    const vals = [true, 'b', null, 2, 'A', new Date(5), NaN, 1];
    expect([...vals].sort(compareSortKeys)).toEqual([null, 1, 2, NaN, 'A', 'b', true, new Date(5)]);
    // (Array#sort never hands undefined to a comparator, so check it directly.)
    expect(compareSortKeys(undefined, 1)).toBeLessThan(0);
    expect(compareSortKeys(undefined, null)).toBe(0);
    expect(compareSortKeys('a', 'A')).toBe(0);
  });
  it('manual: listed first in that order, the rest after as they were', () => {
    expect(ids(applyOrdering(items, { kind: 'manual', ids: ['c', 'a'] }))).toEqual(['c', 'a', 'b', 'd']);
  });
  it('sort keys, desc, stable on ties; score and none leave the order', () => {
    expect(ids(applyOrdering(items, { kind: 'sort', keys: [{ field: 'n' }] }))).toEqual(['d', 'b', 'c', 'a']);
    expect(ids(applyOrdering(items, { kind: 'sort', keys: [{ field: 'kind', desc: true }, { field: 't' }] }))).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(applyOrdering(items, { kind: 'score', by: 'search' }))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(applyOrdering(items, undefined))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('takes a key and a comparator', () => {
    const rows = [{ k: 'x', v: 'b' }, { k: 'y', v: 'a' }];
    expect(applyOrdering(rows, { kind: 'manual', ids: ['y'] }, { key: (r) => r.k }).map((r) => r.k)).toEqual(['y', 'x']);
    const reverse = (a: unknown, b: unknown) => -compareSortKeys(a, b);
    expect(applyOrdering(rows, { kind: 'sort', keys: [{ field: 'v' }] }, { compare: reverse }).map((r) => r.v)).toEqual(['b', 'a']);
  });
});

describe('a clause on a removed field is flagged, never dropped', () => {
  it('lists filter, sort and presentation clauses naming unknown fields', () => {
    const view = {
      membership: { rule: { filter: { and: [xs.filter, { not: { field: 'rating', operator: 'lt' as const, value: 3 } }] } } },
      ordering: { kind: 'sort' as const, keys: [{ field: 'plays' }, { field: 'n' }] },
      presentation: { columns: ['t', 'cover'], groupBy: 'meta.album' },
    };
    expect(missingFieldClauses(view, ['kind', 'n', 't', 'meta'])).toEqual([
      { field: 'rating', in: 'filter', operator: 'lt' },
      { field: 'plays', in: 'sort' },
      { field: 'cover', in: 'presentation' },
    ]);
    expect(missingFieldClauses({ filter: xs.filter }, ['kind'])).toEqual([]);
    expect(filterConditions({ or: [xs.filter, { not: xs.filter }] })).toHaveLength(2);
  });
});
