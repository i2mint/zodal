import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig, toOptionsFormConfig, toPrompt, toViewConfig } from '../src/index.js';

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

describe('one widget rule for both form generators (#58)', () => {
  const schemas = {
    tags: z.set(z.string()),
    big: z.bigint(),
    choice: z.enum(['a', 'b']),
    many: z.array(z.literal(['a', 'b'])),
    n: z.literal([2, 4]),
  };
  it('toFormConfig and toOptionsFormConfig give the same widget for every field', () => {
    const expected = { tags: 'tags', big: 'text', choice: 'select', many: 'tags', n: 'select' };
    const form = toFormConfig(defineCollection(z.object(schemas)));
    const opts = toOptionsFormConfig(z.object(schemas));
    for (const [name, type] of Object.entries(expected)) {
      expect(form.find((f) => f.name === name)?.type, `form ${name}`).toBe(type);
      expect(opts.find((f) => f.name === name)?.type, `options ${name}`).toBe(type);
    }
  });

  it('a bigint vocabulary option stays JSON-safe', () => {
    const f = field(z.literal([1n, 2n]));
    expect(() => JSON.stringify(f.options)).not.toThrow();
  });

  it('toPrompt and view badges treat literal unions like enums', () => {
    const c = defineCollection(z.object({ id: z.string(), s: z.union([z.literal('a'), z.literal('b')]) }));
    expect(toPrompt(c)).toContain('enum field');
    const v = toViewConfig(c, 'list');
    expect(v.fields.badges.map((b) => b.name)).toContain('s');
  });
});

describe('view badges keep plain literals and enums (#58)', () => {
  it('a literal and an enum are badges', () => {
    const c = defineCollection(z.object({ id: z.string(), name: z.string(), k: z.literal('x'), e: z.enum(['a', 'b']) }));
    const names = toViewConfig(c, 'list').fields.badges.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(['k', 'e']));
  });
});

describe('open and mixed unions are not silently dropped (#57)', () => {
  it.each([
    ['open + literal', z.union([z.literal('a'), z.string()])],
    ['string | number', z.union([z.string(), z.number()])],
    ['intersection', z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))],
    ['discriminated union', z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b'), n: z.number() })])],
  ])('%s is an editable json field', (_n, schema) => {
    const f = field(schema);
    expect(f).toBeDefined();
    expect(f.type).toBe('json');
    expect(f.options).toBeUndefined();
  });

  it('a union of literals is still a select', () => {
    expect(field(z.union([z.literal('a'), z.literal('b')])).type).toBe('select');
  });
});
