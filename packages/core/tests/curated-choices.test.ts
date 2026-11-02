import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/index.js';

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
