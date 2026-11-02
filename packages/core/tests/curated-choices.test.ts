import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection, getChoiceArity, getFieldChoices, affordanceRegistry } from '../src/index.js';

const every = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 60, label: 'Every hour', hint: 'The default', data: { tone: 'calm' } },
];

describe('curated choices (#79)', () => {
  it('make a bounded number a closed single choice, without changing the schema', () => {
    const c = defineCollection(z.object({ interval: z.int().min(1).max(1440) }), { fields: { interval: { choices: every } } });
    expect(c.fieldAffordances.interval.choice).toBe('single');
    expect(c.fieldAffordances.interval.choices).toEqual(every);
  });
  it('make an array field a multi choice, each value checked as one element', () => {
    const c = defineCollection(z.object({ days: z.array(z.int().min(0).max(6)).min(1) }), {
      fields: { days: { choices: [{ value: 0, label: 'Sun' }, { value: 6, label: 'Sat' }] } },
    });
    expect(c.fieldAffordances.days.choice).toBe('multi');
  });
  it('come from .meta() too', () => {
    const c = defineCollection(z.object({ interval: z.number().meta({ choices: every }) }));
    expect(c.fieldAffordances.interval.choice).toBe('single');
  });
  it('refuse, where they are declared, a value the schema does not accept', () => {
    expect(() => defineCollection(z.object({ interval: z.int().max(60) }), { fields: { interval: { choices: [{ value: 61 }] } } }))
      .toThrow(/field "interval" lists the choice 61, which its schema refuses/);
    expect(() => defineCollection(z.object({ days: z.array(z.int().max(6)) }), { fields: { days: { choices: [{ value: 7 }] } } }))
      .toThrow(/"days".*7/);
    // On an enum too, whose own arity is kept.
    expect(() => defineCollection(z.object({ mood: z.enum(['low', 'ok']) }), { fields: { mood: { choices: [{ value: 'great' }] } } }))
      .toThrow(/"mood".*"great"/);
    const ok = defineCollection(z.object({ mood: z.enum(['low', 'ok']) }), { fields: { mood: { choices: [{ value: 'ok', hint: 'Fine' }] } } });
    expect(ok.fieldAffordances.mood.choice).toBe('single');
  });
  it('an empty list is no choices', () => {
    const c = defineCollection(z.object({ n: z.number() }), { fields: { n: { choices: [] } } });
    expect(c.fieldAffordances.n.choice).toBeNull();
  });
});

describe('curated choices: one decision in core (#79 review)', () => {
  const choices = [{ value: 60, label: 'every hour' }, { value: 15 }];

  it('getChoiceArity and getFieldChoices read the schema and the affordance together', () => {
    expect(getChoiceArity(z.number())).toBeNull();
    expect(getChoiceArity(z.number(), { choices })).toBe('single');
    expect(getChoiceArity(z.array(z.number()).optional(), { choices })).toBe('multi');
    expect(getFieldChoices(z.number(), {})).toBeNull();
    // A curated label is used as given; an unlabelled value (or a vocabulary label) is capitalised.
    expect(getFieldChoices(z.number(), { choices })).toEqual([
      { value: '60', raw: 60, label: 'every hour' },
      { value: '15', raw: 15, label: '15' },
    ]);
    expect(getFieldChoices(z.enum(['low', 'ok']))?.map((e) => e.label)).toEqual(['Low', 'Ok']);
  });

  it('a set and an optional array are multi choices, each value checked as one element', () => {
    const c = defineCollection(z.object({ s: z.set(z.int().max(6)), a: z.array(z.int().max(6)).optional() }), {
      fields: { s: { choices: [{ value: 1 }] }, a: { choices: [{ value: 2 }] } },
    });
    expect(c.fieldAffordances.s.choice).toBe('multi');
    expect(c.fieldAffordances.a.choice).toBe('multi');
    expect(() => defineCollection(z.object({ s: z.set(z.int().max(6)) }), { fields: { s: { choices: [{ value: 7 }] } } }))
      .toThrow(/"s" lists the choice 7/);
    expect(() => defineCollection(z.object({ a: z.array(z.int().max(6)).optional() }), { fields: { a: { choices: [{ value: 7 }] } } }))
      .toThrow(/"a" lists the choice 7/);
  });

  it('refuse duplicates by their text, naming the field and the value', () => {
    expect(() => defineCollection(z.object({ n: z.number() }), { fields: { n: { choices: [{ value: 1 }, { value: 1 }] } } }))
      .toThrow(/field "n" lists the choice 1 twice/);
    expect(() => defineCollection(z.object({ n: z.union([z.number(), z.string()]) }), { fields: { n: { choices: [{ value: 1 }, { value: '1' }] } } }))
      .toThrow(/field "n" lists the choices 1 and "1", which a widget cannot tell apart/);
  });

  it('refuse malformed entries, from .meta() too', () => {
    const shape = /field "interval": choices must be \[\{ value, label\?, hint\?, data\? \}, \.\.\.\], got /;
    expect(() => defineCollection(z.object({ interval: z.number().meta({ choices: [15, 60] }) })))
      .toThrow(new RegExp(shape.source + '15$'));
    expect(() => defineCollection(z.object({ interval: z.number().meta({ choices: 'abc' }) })))
      .toThrow(new RegExp(shape.source + '"abc"$'));
    for (const bad of [{ value: {} }, { value: 1, label: 2 }, { value: 1, hint: true }, { value: 1, data: [1] }, { label: 'x' }]) {
      expect(() => defineCollection(z.object({ interval: z.number() }), { fields: { interval: { choices: [bad] as never } } }))
        .toThrow(shape);
    }
  });

  it('print a bigint as 10n, unquoted', () => {
    expect(() => defineCollection(z.object({ big: z.bigint().max(5n) }), { fields: { big: { choices: [{ value: 10n }] } } }))
      .toThrow(/lists the choice 10n, which/);
  });

  it('name the field when an async refinement makes them uncheckable', () => {
    const n = z.number().refine(async () => true);
    expect(() => defineCollection(z.object({ n }), { fields: { n: { choices: [{ value: 1 }] } } }))
      .toThrow(/field "n" lists choices, but cannot check choices against an async refinement/);
  });

  it('are checked against a codec\'s output side, and refused on a .transform() output', () => {
    const minutes = z.codec(z.string(), z.int().max(120), { decode: Number, encode: String });
    const c = defineCollection(z.object({ m: minutes.optional() }), { fields: { m: { choices: [{ value: 60 }] } } });
    expect(c.fieldAffordances.m.choice).toBe('single');
    expect(() => defineCollection(z.object({ m: minutes }), { fields: { m: { choices: [{ value: 200 }] } } }))
      .toThrow(/"m" lists the choice 200, which its schema refuses/);
    expect(() => defineCollection(z.object({ m: minutes }), { fields: { m: { choices: [{ value: '60' }] } } }))
      .toThrow(/"m" lists the choice "60"/);
    const len = z.string().transform((s) => s.length);
    expect(() => defineCollection(z.object({ len }), { fields: { len: { choices: [{ value: 3 }] } } }))
      .toThrow(/field "len" lists choices, but its schema ends in a \.transform\(\).*z\.codec/);
  });

  it('give a field they make a closed choice the closed-choice defaults, under meta, registry and config', () => {
    const plain = defineCollection(z.object({ interval: z.int().min(1).max(1440) }), { fields: { interval: { choices } } });
    expect(plain.fieldAffordances.interval).toMatchObject({ filterable: 'select', groupable: true });
    expect(plain.fieldAffordances.interval.aggregatable).toBeUndefined();
    const fromMeta = defineCollection(z.object({ interval: z.number().meta({ choices }) }));
    expect(fromMeta.fieldAffordances.interval.filterable).toBe('select');
    const metaWins = defineCollection(z.object({ interval: z.number().meta({ choices, filterable: 'range' }) }));
    expect(metaWins.fieldAffordances.interval.filterable).toBe('range');
    const configWins = defineCollection(z.object({ interval: z.number() }), { fields: { interval: { choices, filterable: 'range' } } });
    expect(configWins.fieldAffordances.interval.filterable).toBe('range');
    const inner = z.number();
    affordanceRegistry.register(inner, { filterable: 'exact' });
    const registryWins = defineCollection(z.object({ interval: inner }), { fields: { interval: { choices } } });
    expect(registryWins.fieldAffordances.interval.filterable).toBe('exact');
    affordanceRegistry.unregister(inner);
    const trace = plain.explain('interval').find((t) => t.affordance === 'filterable');
    expect(trace?.layers[0].reason).toMatch(/has curated choices: enum defaults/);
  });
});
