import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/collection.js';
import { DEFAULT_HISTORY_MAX, resolveFieldHistory } from '../src/field-history.js';
import { affordanceRegistry } from '../src/registry.js';

const Piece = z.object({
  id: z.string(),
  title: z.string(),
  lyrics: z.string(),
  mood: z.enum(['calm', 'loud']),
  speed: z.literal(['slow', 'fast']),
  duration: z.number(),
  instrumental: z.boolean(),
  due: z.date(),
  tags: z.array(z.string()),
});

describe('sticky: inferred', () => {
  const c = defineCollection(Piece);
  it('is false for free text', () => {
    expect(c.fieldAffordances.title.sticky).toBe(false);
    expect(c.fieldAffordances.lyrics.sticky).toBe(false);
  });
  it('is true for closed choices, numbers, booleans, dates and lists', () => {
    for (const key of ['mood', 'speed', 'duration', 'instrumental', 'due', 'tags']) {
      expect(c.fieldAffordances[key].sticky, key).toBe(true);
    }
  });
  it('is true for a string with curated choices', () => {
    const d = defineCollection(z.object({ style: z.string() }), {
      fields: { style: { choices: [{ value: 'pop' }, { value: 'jazz' }] } },
    });
    expect(d.fieldAffordances.style.sticky).toBe(true);
  });
});

describe('sticky: overrides', () => {
  it('.meta() overrides the inferred value', () => {
    const c = defineCollection(z.object({ style: z.string().meta({ sticky: true }), n: z.number().meta({ sticky: false }) }));
    expect(c.fieldAffordances.style.sticky).toBe(true);
    expect(c.fieldAffordances.n.sticky).toBe(false);
  });
  it('the collection config overrides .meta()', () => {
    const c = defineCollection(z.object({ style: z.string().meta({ sticky: true }) }), { fields: { style: { sticky: false } } });
    expect(c.fieldAffordances.style.sticky).toBe(false);
  });
  it('explain() traces sticky and history', () => {
    const c = defineCollection(z.object({ style: z.string().meta({ sticky: true, history: true }) }));
    const sticky = c.explain('style').find((t) => t.affordance === 'sticky');
    expect(sticky?.finalValue).toBe(true);
    expect(sticky?.layers.map((l) => l.layer)).toEqual(['type', 'meta']);
    expect(c.explain('style').find((t) => t.affordance === 'history')?.finalValue).toBe(true);
  });
});

describe('history: declared', () => {
  it('is never inferred', () => {
    const c = defineCollection(Piece);
    expect(c.fieldAffordances.lyrics.history).toBeUndefined();
  });
  it('comes from .meta(), the registry or the config', () => {
    const viaRegistry = z.string();
    affordanceRegistry.register(viaRegistry, { history: { scope: 'shared' } });
    const c = defineCollection(z.object({ a: z.string().meta({ history: true }), b: viaRegistry, c: z.string() }), {
      fields: { c: { history: { max: 5 } } },
    });
    expect(c.fieldAffordances.a.history).toBe(true);
    expect(c.fieldAffordances.b.history).toEqual({ scope: 'shared' });
    expect(c.fieldAffordances.c.history).toEqual({ max: 5 });
  });
  it('throws on a malformed spec, naming the field', () => {
    expect(() => defineCollection(z.object({ a: z.string() }), { fields: { a: { history: { max: 0 } } } })).toThrow(/"a".*max/);
    expect(() => defineCollection(z.object({ a: z.string() }), { fields: { a: { history: { scope: '' } } } })).toThrow(/"a".*scope/);
    expect(() => defineCollection(z.object({ a: z.string() }), { fields: { a: { history: 'yes' as any } } })).toThrow(/"a"/);
  });
});

describe('history: only on free text', () => {
  it('throws on a number, a list or a closed choice, naming the field', () => {
    expect(() => defineCollection(z.object({ n: z.number() }), { fields: { n: { history: true } } })).toThrow(/"n".*not free text/);
    expect(() => defineCollection(z.object({ t: z.array(z.string()) }), { fields: { t: { history: true } } })).toThrow(/"t"/);
    expect(() => defineCollection(z.object({ m: z.enum(['a', 'b']) }), { fields: { m: { history: true } } })).toThrow(/"m".*closed choice/);
  });
});

describe('history: refused on secrets', () => {
  it('throws on a field with a secret-looking name', () => {
    expect(() => defineCollection(z.object({ apiKey: z.string() }), { fields: { apiKey: { history: true } } }))
      .toThrow(/"apiKey".*secret/);
  });
  it('throws on a field marked secret, whatever layer set history', () => {
    expect(() => defineCollection(z.object({ pass: z.string().meta({ sensitivity: 'secret', history: true }) })))
      .toThrow(/"pass"/);
  });
  it('throws on a structured field that holds a secret', () => {
    expect(() => defineCollection(z.object({ auth: z.string(), token: z.string() }).meta({}), { fields: { token: { history: true } } }))
      .toThrow(/"token"/);
  });
  it('leaves a secret alone when no field asks for history', () => {
    expect(() => defineCollection(z.object({ apiKey: z.string(), lyrics: z.string() }))).not.toThrow();
  });
  it('allows history beside a secret on another field', () => {
    const c = defineCollection(z.object({ apiKey: z.string(), lyrics: z.string() }), { fields: { lyrics: { history: true } } });
    expect(c.fieldAffordances.lyrics.history).toBe(true);
  });
  it('history: false on a secret is fine', () => {
    expect(() => defineCollection(z.object({ apiKey: z.string() }), { fields: { apiKey: { history: false } } })).not.toThrow();
  });
});

describe('resolveFieldHistory', () => {
  it('fills in the defaults', () => {
    expect(resolveFieldHistory('lyrics', true)).toEqual({ max: DEFAULT_HISTORY_MAX, scope: 'lyrics' });
    expect(resolveFieldHistory('styles', { scope: 'style' })).toEqual({ max: 50, scope: 'style' });
    expect(resolveFieldHistory('styles', { max: 3 })).toEqual({ max: 3, scope: 'styles' });
  });
  it('is undefined without history', () => {
    expect(resolveFieldHistory('x', undefined)).toBeUndefined();
    expect(resolveFieldHistory('x', false)).toBeUndefined();
  });
  it('throws on a bad cap', () => {
    expect(() => resolveFieldHistory('x', { max: 1.5 })).toThrow(RangeError);
    expect(() => resolveFieldHistory('x', { max: -1 })).toThrow(RangeError);
  });
});
