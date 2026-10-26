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

describe('resolved affordance carries the choice arity (#64)', () => {
  const c = defineCollection(
    z.object({
      status: z.enum(['a', 'b']),
      size: z.literal([1, 2]),
      tags: z.array(z.enum(['x', 'y'])),
      free: z.string(),
      maybe: z.union([z.enum(['a', 'b']), z.null()]),
    }),
  );
  it('is single, multi or null', () => {
    const f = c.fieldAffordances;
    expect([f.status.choice, f.size.choice, f.tags.choice, f.free.choice, f.maybe.choice]).toEqual(['single', 'single', 'multi', null, 'single']);
  });
  it('is structural: an explicit override cannot change it', () => {
    const o = defineCollection(z.object({ free: z.string() }), { fields: { free: { title: 'X', choice: 'single' } as any } });
    expect(o.fieldAffordances.free.choice).toBeNull();
  });
});
