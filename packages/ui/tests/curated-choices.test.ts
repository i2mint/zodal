import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig, toFilterConfig, selectedValue, optionKey } from '../src/index.js';

const byName = <T extends { name: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.name, x]));

describe('curated choices in forms and filters (#79)', () => {
  const schema = z.object({
    interval: z.int().min(1).max(1440).meta({ filterable: 'select' }),
    mood: z.enum(['low', 'ok', 'good']),
    days: z.array(z.int().min(0).max(6)),
    big: z.bigint(),
  });
  const c = defineCollection(schema, {
    fields: {
      interval: { choices: [{ value: 60, label: 'Every hour', hint: 'The default', data: { tone: 'calm' } }, { value: 15 }] },
      mood: { choices: [{ value: 'good', label: 'Good day' }, { value: 'low' }] },
      days: { choices: [{ value: 0, label: 'Sun' }, { value: 6, label: 'Sat' }] },
      big: { choices: [{ value: 10n, label: 'Ten' }] },
    },
  });
  const f = byName(toFormConfig(c));

  it('a bounded number with choices is a select of them, in order, with hint and data', () => {
    expect(f.interval.type).toBe('select');
    expect(f.interval.options).toEqual([
      { label: 'Every hour', value: '60', raw: 60, hint: 'The default', data: { tone: 'calm' } },
      { label: '15', value: '15', raw: 15 },
    ]);
    expect(selectedValue(f.interval, '60')).toBe(60);
    expect(optionKey(f.interval, 15)).toBe('15');
  });
  it('on an enum, the curated list replaces the vocabulary; an unlabelled value is capitalised', () => {
    expect(f.mood.options?.map((o) => o.label)).toEqual(['Good day', 'Low']);
  });
  it('an array field with choices is closed tags', () => {
    expect(f.days.type).toBe('tags');
    expect(f.days.allowCreate).toBe(false);
    expect(f.days.options?.map((o) => o.raw)).toEqual([0, 6]);
  });
  it('a bigint choice keeps its kind', () => {
    expect(f.big.options).toEqual([{ label: 'Ten', value: '10', kind: 'bigint' }]);
    expect(selectedValue(f.big, '10')).toBe(10n);
  });
  it('a select filter offers the curated choices', () => {
    const filters = byName(toFilterConfig(c));
    expect(filters.interval.options?.map((o) => o.label)).toEqual(['Every hour', '15']);
  });
});
