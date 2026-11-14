import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  canonicalKey,
  normalizeKeyPart,
  parsePath,
  getPath,
  keyOf,
  detectKey,
  resolveKey,
  defineCollection,
} from '../src/index.js';

describe('canonicalKey', () => {
  it('keeps one part readable, NFC-normalized and trimmed', () => {
    expect(canonicalKey(['  Café '])).toBe('Café');
    expect(canonicalKey([42])).toBe('42');
  });
  it('serializes several parts unambiguously', () => {
    expect(canonicalKey(['a', 'b c'])).not.toBe(canonicalKey(['a b', 'c']));
    expect(canonicalKey(['a', 'b'])).toBe('["a","b"]');
  });
  it('treats blank, NaN and invalid dates as missing', () => {
    expect(normalizeKeyPart('  ')).toBeUndefined();
    expect(normalizeKeyPart(Number.NaN)).toBeUndefined();
    expect(normalizeKeyPart(new Date('nope'))).toBeUndefined();
    expect(normalizeKeyPart(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('paths', () => {
  it('parses dotted, quoted and indexed segments', () => {
    expect(parsePath('a.b')).toEqual(['a', 'b']);
    expect(parsePath('a["b.c"][0]')).toEqual(['a', 'b.c', '0']);
    expect(getPath({ a: { 'b.c': ['x'] } }, 'a["b.c"][0]')).toBe('x');
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
  it('keyOf needs every part of a composite', () => {
    expect(keyOf({ a: 'x', b: 'y' }, ['a', 'b'])).toBe('["x","y"]');
    expect(keyOf({ a: 'x' }, ['a', 'b'])).toBeUndefined();
    expect(keyOf({ n: 3 }, (i: any) => `n${i.n}`)).toBe('n3');
  });
});

describe('detectKey', () => {
  it('prefers an identifier name', () => {
    const r = detectKey([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(r.chosen?.spec).toBe('id');
  });
  it('finds a nested identifier', () => {
    const r = detectKey([{ meta: { uuid: 'u1' }, name: 'x' }, { meta: { uuid: 'u2' }, name: 'y' }]);
    expect(r.chosen?.spec).toBe('meta.uuid');
  });
  it('finds the smallest unique composite when nothing else is unique', () => {
    const samples = [
      { artist: 'A', title: 'T1', year: 2000 },
      { artist: 'A', title: 'T2', year: 2000 },
      { artist: 'B', title: 'T1', year: 2001 },
      { artist: 'B', title: 'T1', year: 2002 },
    ];
    const r = detectKey(samples);
    expect(r.chosen).not.toBeNull();
    expect(Array.isArray(r.chosen!.spec)).toBe(true);
    expect(r.chosen!.uniqueness).toBe(1);
  });
  it('flags display text and duplicates', () => {
    const r = detectKey([{ title: 'Hello world' }, { title: 'Hello world' }]);
    expect(r.chosen).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('resolveKey', () => {
  it('uses an explicit composite key', () => {
    const k = resolveKey(z.object({ artist: z.string(), title: z.string() }), { key: ['artist', 'title'] });
    expect(k.source).toBe('config');
    expect(k.idField).toBe('id');
    expect(k.keyOf({ artist: 'A', title: 'T' })).toBe('["A","T"]');
  });
  it('finds a nested identifier in the schema', () => {
    const k = resolveKey(z.object({ meta: z.object({ uuid: z.string() }).optional(), name: z.string() }));
    expect(k.spec).toBe('meta.uuid');
    expect(k.source).toBe('schema');
    expect(k.keyOf({ meta: { uuid: 'u' } })).toBe('u');
  });
  it('detects on samples before falling back', () => {
    const k = resolveKey(z.object({ name: z.string(), isrc: z.string() }), {
      samples: [{ name: 'a b', isrc: 'X1' }, { name: 'c d', isrc: 'X2' }],
    });
    expect(k.spec).toBe('isrc');
    expect(k.source).toBe('samples');
  });
  it('records the first-field fallback, or refuses it when strict', () => {
    const schema = z.object({ artist: z.string(), title: z.string() });
    const k = resolveKey(schema);
    expect(k.source).toBe('fallback');
    expect(k.spec).toBe('artist');
    expect(k.warnings[0]).toMatch(/fell back/);
    expect(k.explain()[0].layers[0].reason).toMatch(/fallback/);
    expect(() => resolveKey(schema, { strict: true })).toThrow(/no field identifies/);
  });
  it('check() reports duplicates', () => {
    const k = resolveKey(z.object({ id: z.string() }));
    const r = k.check([{ id: 'a' }, { id: 'a' }]);
    expect(r.chosen).toBeNull();
    expect(r.candidates[0].duplicates).toEqual([[0, 1]]);
  });
});

describe('defineCollection keys', () => {
  it('keeps flat id inference', () => {
    const c = defineCollection(z.object({ userId: z.string(), name: z.string() }));
    expect(c.idField).toBe('userId');
    expect(c.key.source).toBe('schema');
  });
  it('accepts a composite idField and materialises it in id', () => {
    const c = defineCollection(z.object({ artist: z.string(), title: z.string() }), { idField: ['artist', 'title'] });
    expect(c.idField).toBe('id');
    expect(c.key.keyOf({ artist: 'A', title: 'T' })).toBe('["A","T"]');
  });
  it('explains the fallback instead of applying it silently', () => {
    const c = defineCollection(z.object({ artist: z.string(), title: z.string() }));
    expect(c.idField).toBe('artist');
    const trace = c.explain().find((t) => t.affordance === 'key');
    expect(trace?.layers[0].reason).toMatch(/fallback/);
    expect(c.explain('title').some((t) => t.affordance === 'key')).toBe(false);
  });
  it('no longer picks an object field as the id', () => {
    const c = defineCollection(z.object({ meta: z.object({ uuid: z.string() }), name: z.string() }));
    expect(c.key.spec).toBe('meta.uuid');
    expect(c.idField).toBe('id');
  });
});
