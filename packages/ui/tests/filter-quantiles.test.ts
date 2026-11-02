import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFilterConfig, quantilesOf } from '../src/index.js';

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
  it('carries filterWidget from .meta() onto the field affordance', () => {
    expect(collection.fieldAffordances.gross.filterWidget).toBe('range-slider');
    expect(collection.fieldAffordances.year.filterWidget).toBeUndefined();
  });
});
