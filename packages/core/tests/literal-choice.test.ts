import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/index.js';

describe('literal choices get enum defaults (#56)', () => {
  const c = defineCollection(z.object({ n: z.literal([2, 4]), u: z.union([z.literal('a'), z.string()]) }));

  it('a numeric literal choice is editable, filterable as select, groupable', () => {
    const fa = c.fieldAffordances.n;
    expect(fa.editable).toBe(true);
    expect(fa.filterable).toBe('select');
    expect(fa.groupable).toBe(true);
  });

  it('the trace names the closed choice', () => {
    const t = c.explain('n').find((x) => x.affordance === 'filterable');
    expect(t?.layers[0].reason).toMatch(/closed choice/);
  });

  it('an open union is editable but not filterable (#57)', () => {
    expect(c.fieldAffordances.u.filterable).toBe(false);
    expect(c.fieldAffordances.u.editable).toBe(true);
  });
});
