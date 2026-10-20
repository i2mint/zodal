import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZOD_WRAPPER_TYPES, peelZodWrapper } from '../src/zod-unwrap.js';

const type = (s: unknown) => (s as any)?._zod?.def?.type;

describe('peelZodWrapper', () => {
  it.each([
    ['optional', z.string().optional()],
    ['nullable', z.string().nullable()],
    ['default', z.string().default('a')],
    ['prefault', z.string().prefault('a')],
    ['readonly', z.string().readonly()],
    ['catch', z.string().catch('a')],
    ['nonoptional', z.string().optional().nonoptional()],
  ])('peels %s', (name, schema) => {
    expect(ZOD_WRAPPER_TYPES.has(name)).toBe(true);
    expect(type(peelZodWrapper(schema))).not.toBe(name);
  });

  it('returns undefined for a non-wrapper or a non-schema', () => {
    expect(peelZodWrapper(z.string())).toBeUndefined();
    expect(peelZodWrapper({})).toBeUndefined();
    expect(peelZodWrapper(undefined)).toBeUndefined();
  });

  it('steps into the output side of a pipe by default, the input side on request', () => {
    const codec = z.codec(z.string(), z.date(), { decode: (s) => new Date(s), encode: (d) => d.toISOString() });
    expect(type(peelZodWrapper(codec))).toBe('date');
    expect(type(peelZodWrapper(codec, { pipe: 'input' }))).toBe('string');
  });

  it('uses the input side of a .transform() pipe', () => {
    expect(type(peelZodWrapper(z.string().transform((s) => s.length)))).toBe('string');
  });

  it('resolves a lazy, keeps it on request, and throws only in strict mode', () => {
    expect(type(peelZodWrapper(z.lazy(() => z.number())))).toBe('number');
    expect(peelZodWrapper(z.lazy(() => z.number()), { lazy: 'keep' })).toBeUndefined();
    const broken = z.lazy((): z.ZodType => {
      throw new Error('not yet');
    });
    expect(peelZodWrapper(broken)).toBeUndefined();
    expect(() => peelZodWrapper(broken, { lazy: 'strict' })).toThrow('not yet');
  });
});
