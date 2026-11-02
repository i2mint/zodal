import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineRendererSet, closedChoice, zodTypeIs, type RendererSet } from '../src/index.js';

interface TremorOptions { minTargetPx: number; tapGuardMs: number }

describe('defineRendererSet (#81)', () => {
  const createTremorRegistry = defineRendererSet<TremorOptions, string>({
    defaults: { minTargetPx: 64, tapGuardMs: 450 },
    entries: (o) => [
      { tester: closedChoice(), renderer: `tiles@${o.minTargetPx}px`, name: 'TileChoice' },
      { tester: zodTypeIs('string'), renderer: `text@${o.tapGuardMs}ms`, name: 'Text' },
    ],
  });

  it('works with no options, from the defaults', () => {
    const registry = createTremorRegistry();
    expect(registry.options).toEqual({ minTargetPx: 64, tapGuardMs: 450 });
    expect(registry.resolve({ zodType: 'string' } as any, { mode: 'form' })).toBe('text@450ms');
  });
  it('builds the renderers with the options given; undefined keeps a default', () => {
    const registry = createTremorRegistry({ minTargetPx: 84, tapGuardMs: undefined });
    expect(registry.options).toEqual({ minTargetPx: 84, tapGuardMs: 450 });
    expect(registry.entries.map((e) => e.renderer)).toEqual(['tiles@84px', 'text@450ms']);
    expect(Object.isFrozen(registry.options)).toBe(true);
  });
  it('each call is its own registry', () => {
    const a = createTremorRegistry();
    a.register({ tester: () => 1, renderer: 'extra' });
    expect(createTremorRegistry().entries).toHaveLength(2);
  });
  it('refuses an option the set does not define, naming it and what it takes', () => {
    expect(() => createTremorRegistry({ tapGaurdMs: 1 } as any)).toThrow(/Unknown renderer-set option\(s\) tapGaurdMs; this set takes: minTargetPx, tapGuardMs/);
  });
  it('is a typed registry', () => {
    expectTypeOf(createTremorRegistry()).toEqualTypeOf<RendererSet<TremorOptions, string>>();
    // @ts-expect-error a misspelt option is a type error too
    expect(() => createTremorRegistry({ tapGaurdMs: 1 })).toThrow();
  });
});
