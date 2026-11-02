import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig, formFieldAffordance, selectedValue, optionKey, closedChoice, PRIORITY } from '../src/index.js';

const cfg = (schema: z.ZodType) => toFormConfig(defineCollection(z.object({ x: schema })))[0];

describe('selectedValue', () => {
  it('writes numbers and booleans back as themselves', () => {
    expect(selectedValue(cfg(z.literal([2, 4])), '4')).toBe(4);
    expect(selectedValue(cfg(z.boolean().pipe(z.literal(true))), 'true')).toBe(true);
  });
  it('writes strings back as strings', () => {
    expect(selectedValue(cfg(z.enum(['a', 'b'])), 'b')).toBe('b');
  });
  it('coerces a bigint choice', () => {
    const f = cfg(z.literal([1n, 2n]));
    expect(f.options?.[0].kind).toBe('bigint');
    expect(f.options?.[0].raw).toBeUndefined();
    expect(selectedValue(f, '2')).toBe(2n);
  });
  it('keeps raw false and 0', () => {
    expect(selectedValue({ options: [{ label: 'No', value: 'false', raw: false }], required: true }, 'false')).toBe(false);
    expect(selectedValue({ options: [{ label: 'Zero', value: '0', raw: 0 }], required: true }, '0')).toBe(0);
  });
  it('a stale value is no value', () => {
    expect(selectedValue(cfg(z.literal([2, 4])), '3')).toBeUndefined();
  });
  it('the placeholder clears an optional field and leaves a required one empty', () => {
    const f = cfg(z.enum(['a', 'b']));
    expect(selectedValue({ ...f, required: false }, '')).toBeUndefined();
    expect(selectedValue({ ...f, required: true }, '')).toBe('');
  });
});

describe('optionKey', () => {
  it('keys numbers, booleans, bigints and strings by their option value', () => {
    expect(optionKey(cfg(z.literal([2, 4])), 4)).toBe('4');
    expect(optionKey(cfg(z.literal([true, false])), false)).toBe('false');
    expect(optionKey(cfg(z.literal([1n, 2n])), 2n)).toBe('2');
    expect(optionKey(cfg(z.enum(['a', 'b'])), 'b')).toBe('b');
  });
  it('matches by schema value, not by its string form', () => {
    expect(optionKey(cfg(z.literal([2, 4])), '4')).toBe('');
    expect(optionKey(cfg(z.literal([1n, 2n])), 2)).toBe('');
    expect(optionKey(cfg(z.literal([0, 1])), false)).toBe('');
  });
  it('no value, or a stale one, is the placeholder', () => {
    const f = cfg(z.literal([2, 4]));
    expect(optionKey(f, undefined)).toBe('');
    expect(optionKey(f, null)).toBe('');
    expect(optionKey(f, 3)).toBe('');
    expect(optionKey({}, 'a')).toBe('');
  });
  it('round-trips with selectedValue', () => {
    for (const schema of [z.literal([2, 4]), z.literal([1n, 2n]), z.enum(['a', 'b']), z.boolean().pipe(z.literal(true))]) {
      const f = cfg(schema);
      for (const o of f.options ?? []) expect(optionKey(f, selectedValue(f, o.value))).toBe(o.value);
      expect(optionKey(f, selectedValue({ ...f, required: true }, ''))).toBe('');
      expect(optionKey(f, selectedValue({ ...f, required: false }, ''))).toBe('');
    }
  });
  it('keys each element of a tags value', () => {
    const f = cfg(z.array(z.literal([1, 2, 3])));
    expect(f.type).toBe('tags');
    expect([3, 1, 9].map((v) => optionKey(f, v))).toEqual(['3', '1', '']);
  });
});

describe('formFieldAffordance', () => {
  it('carries config.type as editWidget without mutating', () => {
    const c = defineCollection(z.object({ x: z.literal([2, 4]) }));
    const fa = c.fieldAffordances.x;
    const out = formFieldAffordance(fa, toFormConfig(c)[0]);
    expect(out.editWidget).toBe('select');
    expect(fa.editWidget).toBeUndefined();
  });
});

describe('closedChoice tester', () => {
  const fa = (schema: z.ZodType) => defineCollection(z.object({ x: schema })).fieldAffordances.x;
  const ctx = { mode: 'form' } as any;
  it('matches by arity', () => {
    expect(closedChoice()(fa(z.enum(['a'])), ctx)).toBe(PRIORITY.DEFAULT);
    expect(closedChoice('single')(fa(z.array(z.enum(['a']))), ctx)).toBe(-1);
    expect(closedChoice('multi')(fa(z.array(z.enum(['a']))), ctx)).toBe(PRIORITY.DEFAULT);
  });
  it('defaults to single, and a non-choice editWidget opts out', () => {
    expect(closedChoice()(fa(z.array(z.enum(['a']))), ctx)).toBe(-1);
    expect(closedChoice()({ ...fa(z.enum(['a'])), editWidget: 'text' }, ctx)).toBe(-1);
    expect(closedChoice()({ ...fa(z.enum(['a'])), editWidget: 'select' }, ctx)).toBe(PRIORITY.DEFAULT);
  });
  it('does not match open fields or stubs without choice', () => {
    expect(closedChoice()(fa(z.string()), ctx)).toBe(-1);
    expect(closedChoice()({} as any, ctx)).toBe(-1);
  });
});
