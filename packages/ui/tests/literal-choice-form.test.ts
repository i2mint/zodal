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
  it('toFormConfig and toOptionsFormConfig agree on every widget', () => {
    const form = toFormConfig(defineCollection(z.object(schemas)));
    const opts = toOptionsFormConfig(z.object(schemas));
    for (const o of opts) {
      const f = form.find((x) => x.name === o.name);
      if (f) expect(f.type, o.name).toBe(o.type);
    }
    expect(form.find((f) => f.name === 'tags')?.type).toBe('tags');
  });

  it('a bigint vocabulary option stays JSON-safe', () => {
    const f = field(z.literal([1n, 2n]));
    expect(() => JSON.stringify(f.options)).not.toThrow();
  });

  it('toPrompt and view badges treat literal unions like enums', () => {
    const c = defineCollection(z.object({ id: z.string(), s: z.union([z.literal('a'), z.literal('b')]) }), {
      fields: { s: { filterable: 'select' } },
    } as any);
    expect(toPrompt(c)).toContain('enum field');
    const v = toViewConfig(c, 'list');
    expect(v.fields.badges.map((b) => b.name)).toContain('s');
  });
});
