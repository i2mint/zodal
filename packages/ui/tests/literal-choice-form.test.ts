import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig } from '../src/index.js';

const field = (schema: z.ZodType) =>
  toFormConfig(defineCollection(z.object({ x: schema })))[0];

describe('toFormConfig: literal choices (#56)', () => {
  it.each([
    ['numeric literal array', z.literal([2, 4]).default(2)],
    ['union of numeric literals', z.union([z.literal(2), z.literal(4)])],
  ])('%s becomes a select that keeps numbers', (_n, schema) => {
    const f = field(schema);
    expect(f).toBeDefined();
    expect(f.type).toBe('select');
    expect(f.options?.map((o) => o.raw)).toEqual([2, 4]);
  });

  it('string literals and unions of them become selects', () => {
    expect(field(z.literal('a')).type).toBe('select');
    const f = field(z.union([z.literal('a'), z.literal('b')]).optional());
    expect(f.type).toBe('select');
    expect(f.options?.map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('an explicit editWidget still wins', () => {
    expect(field(z.literal([2, 4]).meta({ editWidget: 'radio' })).type).toBe('radio');
  });

  it('an array of literals stays a closed tags field', () => {
    const f = field(z.array(z.literal(['a', 'b'])));
    expect(f.type).toBe('tags');
    expect(f.allowCreate).toBe(false);
  });
});
