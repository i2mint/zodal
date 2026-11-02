import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toFormConfig, toOptionsFormConfig, toCode } from '../src/index.js';

const byName = <T extends { name: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.name, x]));
const layout = { layout: 'tiles-3', clearValue: '', heading: { level: 2 } };

describe('widgetOptions (#77)', () => {
  it('reaches FormFieldConfig from .meta(), untouched', () => {
    const c = defineCollection(z.object({ mood: z.enum(['low', 'ok', 'good']).meta({ widgetOptions: layout }) }));
    expect(c.fieldAffordances.mood.widgetOptions).toEqual(layout);
    expect(byName(toFormConfig(c)).mood.widgetOptions).toEqual(layout);
  });
  it('a config override replaces it whole; a field without it has none', () => {
    const c = defineCollection(
      z.object({ mood: z.enum(['low', 'ok']).meta({ widgetOptions: layout }), note: z.string() }),
      { fields: { mood: { widgetOptions: { layout: 'list' } } } },
    );
    const f = byName(toFormConfig(c));
    expect(f.mood.widgetOptions).toEqual({ layout: 'list' });
    expect(f.note).not.toHaveProperty('widgetOptions');
  });
  it('an options form carries it too', () => {
    const f = byName(toOptionsFormConfig(z.object({ region: z.string().meta({ widgetOptions: { layout: 'list' } }) })));
    expect(f.region.widgetOptions).toEqual({ layout: 'list' });
  });
  it('toCode keeps it in a diff-only listing', () => {
    const c = defineCollection(z.object({ mood: z.string() }), { fields: { mood: { widgetOptions: { layout: 'list' } } } });
    expect(toCode(c, { diffOnly: true })).toContain("mood: { widgetOptions: { layout: 'list' } }");
  });
});
