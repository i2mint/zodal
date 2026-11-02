import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection, affordanceRegistry, inferFieldAffordancesWithTrace } from '@zodal/core';
import { toFormConfig, toOptionsFormConfig, toCode } from '../src/index.js';

const byName = <T extends { name: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.name, x]));
const layout = { layout: 'tiles-3', clearValue: '', heading: { level: 2 } };

describe('editWidgetOptions (#77)', () => {
  it('reaches FormFieldConfig from .meta()', () => {
    const c = defineCollection(z.object({ mood: z.enum(['low', 'ok', 'good']).meta({ editWidgetOptions: layout }) }));
    expect(c.fieldAffordances.mood.editWidgetOptions).toEqual(layout);
    expect(byName(toFormConfig(c)).mood.editWidgetOptions).toEqual(layout);
  });
  it('each config gets its own copy: a renderer writing to it changes nothing else', () => {
    const declared = { layout: 'list' };
    const c = defineCollection(z.object({ mood: z.string().meta({ editWidgetOptions: declared }) }));
    const opts = byName(toFormConfig(c)).mood.editWidgetOptions as Record<string, unknown>;
    opts.layout = 'changed';
    expect(declared.layout).toBe('list');
    expect(byName(toFormConfig(c)).mood.editWidgetOptions).toEqual({ layout: 'list' });
  });
  it('the registry and a config override replace it whole; a field without it has none', () => {
    const inner = z.enum(['low', 'ok']);
    affordanceRegistry.register(inner, { editWidgetOptions: { layout: 'registry' } });
    const c = defineCollection(z.object({ mood: inner.optional(), other: inner.optional(), note: z.string() }), {
      fields: { other: { editWidgetOptions: { heading: { level: 3 } } } },
    });
    const f = byName(toFormConfig(c));
    expect(f.mood.editWidgetOptions).toEqual({ layout: 'registry' });
    expect(f.other.editWidgetOptions).toEqual({ heading: { level: 3 } });
    expect(f.note).not.toHaveProperty('editWidgetOptions');
  });
  it('only a plain object is taken from .meta()', () => {
    for (const bad of ['tiles', ['a'], 42, new Date(0)]) {
      const direct = defineCollection(z.object({ x: z.string().meta({ editWidgetOptions: bad }) }));
      const nested = defineCollection(z.object({ x: z.string().meta({ affordances: { editWidgetOptions: bad } }) }));
      expect(direct.fieldAffordances.x).not.toHaveProperty('editWidgetOptions');
      expect(nested.fieldAffordances.x).not.toHaveProperty('editWidgetOptions');
    }
  });
  it('an options form carries it, except for a secret or a code-only value', () => {
    const f = byName(toOptionsFormConfig(
      z.object({
        region: z.string().meta({ editWidgetOptions: { layout: 'list' } }),
        apiKey: z.string().meta({ editWidgetOptions: { reveal: true } }),
        client: z.custom<object>().meta({ editWidgetOptions: { layout: 'list' } }),
        odd: z.string().meta({ editWidgetOptions: 'list' }),
      }),
      { secretPaths: [['apiKey']] },
    ));
    expect(f.region.editWidgetOptions).toEqual({ layout: 'list' });
    expect(f.apiKey).not.toHaveProperty('editWidgetOptions');
    expect(f.client).not.toHaveProperty('editWidgetOptions');
    expect(f.odd).not.toHaveProperty('editWidgetOptions');
  });
  it('toCode lists it; the inference trace follows it', () => {
    const c = defineCollection(z.object({ mood: z.string() }), { fields: { mood: { editWidgetOptions: { layout: 'list' } } } });
    expect(toCode(c, { diffOnly: true })).toContain("mood: { editWidgetOptions: { layout: 'list' } }");
    const { traces } = inferFieldAffordancesWithTrace('mood', z.string().meta({ editWidgetOptions: { layout: 'list' } }));
    expect(traces.map((t) => t.affordance)).toContain('editWidgetOptions');
  });
});
