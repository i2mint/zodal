import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFilterConfig, quantilesOf, filterWidgetIs, toCode, PRIORITY } from '../src/index.js';
import { inferFieldAffordancesWithTrace } from '@zodal/core';

describe('quantilesOf', () => {
  it('interpolates between order statistics', () => {
    expect(quantilesOf([4, 1, 3, 2, 5], 4)).toEqual([1, 2, 3, 4, 5]);
    expect(quantilesOf([0, 10], 4)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(quantilesOf([0, 10])).toHaveLength(101);
  });
  it('ignores NaN and infinities; empty when nothing is finite', () => {
    expect(quantilesOf([NaN, 1, Infinity, 3, -Infinity], 2)).toEqual([1, 2, 3]);
    expect(quantilesOf([NaN])).toEqual([]);
    expect(quantilesOf([])).toEqual([]);
  });
  it('stays finite and ordered when the data spans more than Number.MAX_VALUE', () => {
    const q = quantilesOf([-1e308, 1e308], 4);
    expect(q.every(Number.isFinite)).toBe(true);
    expect(q).toEqual([...q].sort((x, y) => x - y));
    expect(q[0]).toBe(-1e308);
    expect(q[4]).toBe(1e308);
  });
  it('one value is a plateau', () => {
    expect(quantilesOf([7], 2)).toEqual([7, 7, 7]);
  });
  it('refuses a count that is not a whole number >= 1', () => {
    expect(() => quantilesOf([1], 0)).toThrow();
    expect(() => quantilesOf([1], 2.5)).toThrow();
  });
});

describe('toFilterConfig with data', () => {
  const schema = z.object({
    id: z.string(),
    gross: z.number().meta({ filterable: 'range', filterWidget: 'range-slider' }),
    year: z.number().int().min(1900).max(2100).meta({ filterable: 'range' }),
    genre: z.enum(['drama', 'comedy']).meta({ filterable: 'select' }),
  });
  const collection = defineCollection(schema);
  const rows = [
    { id: 'a', gross: 10, year: 2000, genre: 'drama' },
    { id: 'b', gross: 1000, year: 2001, genre: 'comedy' },
    { id: 'c', gross: 20, genre: 'drama' },
  ];
  const byName = (configs: ReturnType<typeof toFilterConfig>) => Object.fromEntries(configs.map((c) => [c.name, c]));

  it('fills quantiles on range filters only, from that field\'s numeric values', () => {
    const f = byName(toFilterConfig(collection, { data: rows, quantileCount: 2 }));
    expect(f.gross.quantiles).toEqual([10, 20, 1000]);
    expect(f.year.quantiles).toEqual([2000, 2000.5, 2001]); // the row with no year is skipped
    expect(f.year.bounds).toEqual({ min: 1900, max: 2100 });
    expect(f.genre).not.toHaveProperty('quantiles');
  });
  it('reads data given as a one-shot iterable once for every filter', () => {
    function* gen() { yield* rows; }
    const f = byName(toFilterConfig(collection, { data: gen(), quantileCount: 2 }));
    expect(f.gross.quantiles).toEqual([10, 20, 1000]);
    expect(f.year.quantiles).toEqual([2000, 2000.5, 2001]);
  });
  it('defaults to whole percentiles, and leaves quantiles out with no data or no values', () => {
    expect(byName(toFilterConfig(collection, { data: rows })).gross.quantiles).toHaveLength(101);
    expect(byName(toFilterConfig(collection)).gross).not.toHaveProperty('quantiles');
    expect(byName(toFilterConfig(collection, { data: [{ id: 'x' }] })).gross).not.toHaveProperty('quantiles');
  });
  it('accepts rows typed by an interface, and skips rows that are not objects', () => {
    interface Film { id: string; gross: number; year?: number; genre: string }
    const films: Film[] = [{ id: 'a', gross: 1, genre: 'drama' }, { id: 'b', gross: 3, genre: 'drama' }];
    const f = byName(toFilterConfig(collection, { data: [...films, null, undefined], quantileCount: 2 }));
    expect(f.gross.quantiles).toEqual([1, 2, 3]);
    expect(f.year).not.toHaveProperty('quantiles');
  });
  it('a date range filter gets no quantiles (numbers only)', () => {
    const c = defineCollection(z.object({ at: z.date().meta({ filterable: 'range' }) }));
    const f = byName(toFilterConfig(c, { data: [{ at: new Date(0) }, { at: new Date(1) }] }));
    expect(f.at).not.toHaveProperty('quantiles');
  });
  it('filterWidgetIs matches filterWidget, else editWidget', () => {
    const ctx = { mode: 'filter' } as any;
    expect(filterWidgetIs('range-slider')(collection.fieldAffordances.gross, ctx)).toBe(PRIORITY.OVERRIDE);
    expect(filterWidgetIs('range-slider')({ ...collection.fieldAffordances.year, editWidget: 'range-slider' }, ctx)).toBe(PRIORITY.OVERRIDE);
    expect(filterWidgetIs('range-slider')({ ...collection.fieldAffordances.gross, editWidget: 'slider' }, ctx)).toBe(PRIORITY.OVERRIDE);
    expect(filterWidgetIs('slider')({ ...collection.fieldAffordances.gross, editWidget: 'slider' }, ctx)).toBe(-1);
    // Only in filter mode: a filter renderer must not win a form or a cell.
    expect(filterWidgetIs('range-slider')(collection.fieldAffordances.gross, { mode: 'form' } as any)).toBe(-1);
    expect(filterWidgetIs('range-slider')(collection.fieldAffordances.gross, { mode: 'cell' } as any)).toBe(-1);
  });
  it('toCode and the inference trace know filterWidget', () => {
    const c = defineCollection(z.object({ g: z.number() }), { fields: { g: { filterable: 'range', filterWidget: 'range-slider' } } });
    expect(toCode(c, { diffOnly: true })).toContain("filterWidget: 'range-slider'");
    const { traces } = inferFieldAffordancesWithTrace('gross', schema.shape.gross);
    expect(traces.map((t) => t.affordance)).toContain('filterWidget');
  });
  it('carries filterWidget from .meta() onto the field affordance', () => {
    expect(collection.fieldAffordances.gross.filterWidget).toBe('range-slider');
    expect(collection.fieldAffordances.year.filterWidget).toBeUndefined();
  });
});
