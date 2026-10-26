import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig, formFieldAffordance, selectedValue, closedChoice, PRIORITY } from '../src/index.js';

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
