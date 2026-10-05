import { describe, it, expect } from 'vitest';
import { applyQuery, compareValues, matchesSearch } from '../src/query.js';

const rows = [
  { id: '1', name: 'Alpha', body: 'needle in content', n: 3, at: new Date(3000) },
  { id: '2', name: 'beta NEEDLE', body: '', n: 1, at: new Date(1000) },
  { id: '3', name: 'Gamma', body: '', n: 2, at: new Date(2000) },
];

describe('applyQuery', () => {
  it('filters, searches, counts before paginating, sorts and paginates', () => {
    const r = applyQuery(rows, {
      filter: { field: 'n', operator: 'gte', value: 1 },
      sort: [{ id: 'n', desc: false }],
      pagination: { page: 2, pageSize: 2 },
    });
    expect(r.total).toBe(3);
    expect(r.data.map((x) => x.id)).toEqual(['1']);
  });

  it('does not mutate the input array', () => {
    const input = [...rows];
    applyQuery(input, { sort: [{ id: 'n', desc: true }] });
    expect(input.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('sorts Dates by time', () => {
    const r = applyQuery(rows, { sort: [{ id: 'at', desc: false }] });
    expect(r.data.map((x) => x.id)).toEqual(['2', '3', '1']);
  });

  it('searches every string field by default, case-insensitively', () => {
    expect(applyQuery(rows, { search: 'needle' }).data.map((x) => x.id)).toEqual(['1', '2']);
  });

  it('honours searchFields and excludeFromSearch', () => {
    expect(applyQuery(rows, { search: 'needle' }, { searchFields: ['name'] }).data.map((x) => x.id)).toEqual(['2']);
    expect(applyQuery(rows, { search: 'needle' }, { excludeFromSearch: ['body'] }).data.map((x) => x.id)).toEqual(['2']);
  });

  it('skips the steps the backend already did', () => {
    const r = applyQuery(
      rows,
      { search: 'zzz', sort: [{ id: 'n', desc: true }], pagination: { page: 1, pageSize: 1 } },
      { skip: { search: true, paginate: true } },
    );
    expect(r.data.map((x) => x.id)).toEqual(['1', '3', '2']);
  });

  it('accepts a custom comparator (byte order for fractional indexes)', () => {
    const keys = [{ id: 'a', k: 'a0' }, { id: 'b', k: 'Zz' }, { id: 'c', k: 'a1' }];
    const binary = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    expect(applyQuery(keys, { sort: [{ id: 'k', desc: false }] }, { compare: binary }).data.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('compareValues / matchesSearch', () => {
  it('orders null first', () => {
    expect(compareValues(null, 1)).toBeLessThan(0);
    expect(compareValues(1, undefined)).toBeGreaterThan(0);
    expect(compareValues(2, 2)).toBe(0);
  });
  it('an empty search matches everything', () => {
    expect(matchesSearch({ a: 'x' }, '')).toBe(true);
  });
});

describe('ordering details', () => {
  it('compareValues gives a total, symmetric order across types and NaN', () => {
    const vals = [3, 'a', NaN, 1, true, null, 'B'];
    const sorted = [...vals].sort(compareValues);
    expect(sorted).toEqual([null, 1, 3, NaN, 'a', 'B', true]);
    expect(Math.sign(compareValues(1, 'a'))).toBe(-Math.sign(compareValues('a', 1)));
  });

  it('compareBinary orders strings by code unit', async () => {
    const { compareBinary } = await import('../src/query.js');
    expect(['a', 'B', 'a0', 'Zz'].sort(compareBinary)).toEqual(['B', 'Zz', 'a', 'a0']);
  });
});

describe('ordering is transitive across Dates and objects', () => {
  it('Dates sort among themselves, before other objects', () => {
    const d0 = new Date(0), d5 = new Date(5), o = {}, arr: unknown[] = [];
    const sorted = [o, d5, arr, d0].sort(compareValues);
    expect(sorted.slice(0, 2)).toEqual([d0, d5]);
  });
  it('symbols do not throw', () => {
    expect(() => [Symbol('a'), Symbol('b'), 1].sort(compareValues)).not.toThrow();
  });
});
