import { describe, it, expect } from 'vitest';
import {
  FilterExpressionSchema, QuerySchema, SelectionSchema, OrderingSchema, MembershipSchema,
  EMPTY_SELECTION, selectIds, selectMatching, isSelectionEmpty, isSelected, toggleSelected, setSelected,
  selectRange, forgetSelected, compareSortKeys, applyOrdering, filterConditions, missingFieldClauses,
  resolveSelection, resolveMembership, resolveView, freezeSelection, queryMatcher, toSortingState, ViewSchema,
  FILTER_OPERATORS, compareValues,
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
  const matchesX = { matches: queryMatcher(xs, items) };
  const none = {};

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
    s = selectRange(s, { anchor: 'b', id: 'd', shown });
    expect(new Set((s as { ids: string[] }).ids)).toEqual(new Set(['b', 'c', 'd']));
    s = selectRange(selectIds(['b', 'c', 'd']), { anchor: 'a', id: 'c', shown }); // anchor unselected: clears a..c
    expect(s).toEqual({ kind: 'ids', ids: ['d'] });
    expect(selectRange(EMPTY_SELECTION, { anchor: 'zz', id: 'a', shown })).toEqual({ kind: 'ids', ids: ['a'] });
    expect(setSelected(selectIds(['a']), ['a', 'b'], true, none)).toEqual({ kind: 'ids', ids: ['a', 'b'] });
  });

  it('a query selection without { matches } says how to build one', () => {
    expect(() => isSelected(selectMatching(xs), 'a')).toThrow(/queryMatcher/);
    expect(() => toggleSelected(selectMatching(xs), 'a')).toThrow(/queryMatcher/);
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
    expect(applyOrdering(rows, { kind: 'manual', ids: ['y'] }, { idOf: (r) => r.k }).map((r) => r.k)).toEqual(['y', 'x']);
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

// The resolvers' fixture (as arioso_studio's donor tests have it).
const pool = [
  { id: 'a', kind: 'x', n: 3, t: 'alpha' },
  { id: 'b', kind: 'y', n: 1, t: 'beta' },
  { id: 'c', kind: 'x', n: 2, t: 'gamma' },
  { id: 'd', kind: 'y', n: 4, t: 'delta' },
];

describe('resolveSelection', () => {
  it('explicit ids, in the pool order', () => {
    expect(ids(resolveSelection(selectIds(['c', 'a', 'zz']), pool))).toEqual(['a', 'c']);
  });
  it('all matching, plus included, minus excluded, evaluated when used', () => {
    const sel: Selection = { kind: 'query', query: xs, include: ['d'], exclude: ['a'] };
    expect(ids(resolveSelection(sel, pool))).toEqual(['c', 'd']);
    const grown = [...pool, { id: 'e', kind: 'x', n: 0, t: 'eps' }];
    expect(ids(resolveSelection(sel, grown))).toEqual(['c', 'e', 'd']);
  });
  it('search, and an empty search matches all', () => {
    expect(ids(resolveSelection(selectMatching({ search: 'ta' }), pool))).toEqual(['b', 'd']);
    expect(ids(resolveSelection(selectMatching({ search: '' }), pool))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('takes a key and an evaluator (a ranking survives)', () => {
    const rows = pool.map(({ id, ...rest }) => ({ path: `/${id}`, ...rest }));
    const ranked = (list: readonly typeof rows[number][]) => [...list].reverse();
    const got = resolveSelection(selectMatching({ search: 'anything' }), rows, { idOf: (r) => r.path, evaluate: ranked });
    expect(got.map((r) => r.path)).toEqual(['/d', '/c', '/b', '/a']);
  });
});

describe('membership and views', () => {
  it('(rule ∪ pinned) − excluded, each item once', () => {
    expect(ids(resolveMembership({ rule: xs, pinned: ['b', 'a'], excluded: ['c'] }, pool))).toEqual(['a', 'b']);
    expect(ids(resolveMembership({ pinned: ['d', 'b'] }, pool))).toEqual(['b', 'd']);
    expect(resolveMembership({}, pool)).toEqual([]);
  });
  it('a playlist (pinned, manual) and a smart playlist (rule, sort, limit)', () => {
    expect(ids(resolveView({ membership: { pinned: ['d', 'b'] }, ordering: { kind: 'manual', ids: ['d', 'b'] } }, pool))).toEqual(['d', 'b']);
    const smart = { membership: { rule: { filter: { field: 'n', operator: 'gte' as const, value: 2 } }, limit: 2 }, ordering: { kind: 'sort' as const, keys: [{ field: 'n', desc: true }] } };
    expect(ids(resolveView(smart, pool))).toEqual(['d', 'a']);
  });
  it('the trash is a rule on the deletion mark', () => {
    const rows = [{ id: 'a', deletedAt: null }, { id: 'b', deletedAt: 5 }];
    expect(ids(resolveView({ membership: { rule: { filter: { field: 'deletedAt', operator: 'isNotNull', value: null } } } }, rows))).toEqual(['b']);
  });
  it('freezes a query selection into the ids it covers now', () => {
    expect(freezeSelection({ kind: 'query', query: xs, exclude: ['c'] }, pool)).toEqual({ kind: 'ids', ids: ['a'] });
    const explicit = selectIds(['b']);
    expect(freezeSelection(explicit, pool)).toBe(explicit);
  });
});

describe('one source for the filter language and the orders', () => {
  it('every operator the evaluator knows is in the schema', () => {
    const op = (operator: string) => ({ field: 'n', operator, value: 1 });
    for (const o of FILTER_OPERATORS) expect(() => FilterExpressionSchema.parse(op(o))).not.toThrow();
    expect(FILTER_OPERATORS).toHaveLength(15);
  });
  it('compareSortKeys differs from compareValues only on strings (case-folded, no locale)', () => {
    expect(compareSortKeys('B', 'a')).toBeGreaterThan(0);
    expect(compareSortKeys(2, 'a')).toBe(compareValues(2, 'a'));
    expect(compareSortKeys(new Date(1), true)).toBe(compareValues(new Date(1), true));
  });
  it('toSortingState converts a sort ordering for a provider', () => {
    expect(toSortingState({ kind: 'sort', keys: [{ field: 'n', desc: true }, { field: 't' }] })).toEqual([{ id: 'n', desc: true }, { id: 't', desc: false }]);
    expect(toSortingState({ kind: 'manual', ids: [] })).toEqual([]);
    expect(toSortingState(undefined)).toEqual([]);
  });
  it('a View validates, with its scope and version', () => {
    const v = { id: 'trash', name: 'Trash', scope: 'system', membership: { rule: { filter: { field: 'deletedAt', operator: 'isNotNull' } } }, version: 0 };
    expect(ViewSchema.parse(v)).toEqual(v);
    expect(() => ViewSchema.parse({ ...v, scope: 'team' })).toThrow();
  });
});
