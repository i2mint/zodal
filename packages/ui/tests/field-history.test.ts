import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { recordUse, startNewItem, toFormConfig, toOptionsFormConfig } from '../src/index.js';
import type { FieldHistoryStore, FormFieldConfig, HistoryEntry, RendererContext } from '../src/index.js';

/** A minimal store recording calls, so ui is tested without @zodal/store. */
function fakeHistory(fail = false) {
  const calls: [string, string, unknown][] = [];
  const store: FieldHistoryStore = {
    async record(scope, value, options) {
      if (fail) throw new Error('storage full');
      calls.push([scope, value, options]);
    },
    async list() { return [] as HistoryEntry[]; },
    async remove() {},
    async pin() {},
    async clear() { return []; },
    async restore() {},
  };
  return { store, calls };
}

const Piece = z.object({
  id: z.string(),
  title: z.string(),
  lyrics: z.string(),
  styles: z.string(),
  excludeStyles: z.string(),
  model: z.enum(['v4', 'v5']),
  duration: z.number(),
});

const collection = defineCollection(Piece, {
  fields: {
    lyrics: { history: true, editWidget: 'textarea' },
    styles: { history: { scope: 'style', max: 20 }, sticky: true },
    excludeStyles: { history: { scope: 'style' } },
    title: { history: true },
  },
});
const byName = (fields: FormFieldConfig[]) => Object.fromEntries(fields.map((f) => [f.name, f]));

describe('toFormConfig: sticky and history', () => {
  const f = byName(toFormConfig(collection));
  it('resolves sticky', () => {
    expect(f.title.sticky).toBe(false);
    expect(f.lyrics.sticky).toBe(false);
    expect(f.styles.sticky).toBe(true);
    expect(f.model.sticky).toBe(true);
    expect(f.duration.sticky).toBe(true);
  });
  it('resolves history with its defaults', () => {
    expect(f.lyrics.history).toEqual({ max: 50, scope: 'lyrics' });
    expect(f.styles.history).toEqual({ max: 20, scope: 'style' });
    expect(f.excludeStyles.history).toEqual({ max: 50, scope: 'style' });
    expect(f.model.history).toBeUndefined();
    expect('history' in f.duration).toBe(false);
  });
});

describe('toOptionsFormConfig: sticky and history', () => {
  const fields = toOptionsFormConfig(z.object({
    prompt: z.string().meta({ history: true }),
    style: z.string().meta({ sticky: true, history: { scope: 's' } }),
    format: z.enum(['mp3', 'wav']),
    retry: z.object({ note: z.string() }).optional(),
  }));
  const f = Object.fromEntries(fields.map((x) => [x.name, x]));
  it('resolves sticky from .meta(), else by type', () => {
    expect(f.prompt.sticky).toBe(false);
    expect(f.style.sticky).toBe(true);
    expect(f.format.sticky).toBe(true);
    expect(f.retry.fields![0].sticky).toBe(false);
  });
  it('resolves history, scoped by path by default', () => {
    expect(f.prompt.history).toEqual({ max: 50, scope: 'prompt' });
    expect(f.style.history).toEqual({ max: 50, scope: 's' });
    expect(f.format.history).toBeUndefined();
  });
  it('refuses history on a secret', () => {
    expect(() => toOptionsFormConfig(z.object({ apiKey: z.string().meta({ history: true }) }))).toThrow(/"apiKey".*secret/);
    expect(() => toOptionsFormConfig(z.object({ note: z.string().meta({ history: true }) }), { secretPaths: [['note']] })).toThrow(/"note"/);
  });
});

describe('recordUse', () => {
  const fields = toFormConfig(collection);
  it('records every history field with a value, sticky or not (reason submit)', async () => {
    const { store, calls } = fakeHistory();
    await recordUse(fields, { title: 'Song', lyrics: 'la\nla', styles: 'synthwave', excludeStyles: '  ', model: 'v5', duration: 30 }, { history: store });
    expect(calls).toEqual([
      ['title', 'Song', { reason: 'submit', max: 50 }],
      ['lyrics', 'la\nla', { reason: 'submit', max: 50 }],
      ['style', 'synthwave', { reason: 'submit', max: 20 }],
    ]);
  });
  it('skips non-string values', async () => {
    const { store, calls } = fakeHistory();
    await recordUse([{ name: 'n', sticky: true, history: { max: 5, scope: 'n' } }], { n: 3 }, { history: store });
    expect(calls).toEqual([]);
  });
});

describe('startNewItem', () => {
  const fields = toFormConfig(collection);
  const values = { id: 'x1', title: 'Song', lyrics: 'la la', styles: 'synthwave', excludeStyles: 'metal', model: 'v5', duration: 30, extra: 'kept' };

  it('keeps sticky fields and clears the others', async () => {
    const { values: next } = await startNewItem(fields, values);
    expect(next).toEqual({ id: 'x1', title: undefined, lyrics: undefined, styles: 'synthwave', excludeStyles: undefined, model: 'v5', duration: 30, extra: 'kept' });
    expect('title' in next).toBe(true);
  });

  it('returns the reset fields previous values, for an Undo', async () => {
    const { values: next, previous } = await startNewItem(fields, values);
    expect(previous).toEqual({ title: 'Song', lyrics: 'la la', excludeStyles: 'metal' });
    expect({ ...next, ...previous }).toEqual(values);
  });

  it('records each cleared history value first (reason reset), never the sticky ones', async () => {
    const { store, calls } = fakeHistory();
    await startNewItem(fields, values, { history: store });
    expect(calls.map(([scope, value, o]) => [scope, value, (o as any).reason]).sort()).toEqual([
      ['lyrics', 'la la', 'reset'],
      ['style', 'metal', 'reset'],
      ['title', 'Song', 'reset'],
    ]);
  });

  it('rejects, clearing nothing, when recording fails', async () => {
    const { store } = fakeHistory(true);
    await expect(startNewItem(fields, values, { history: store })).rejects.toThrow('storage full');
  });

  it('goes back to a field default when there is one', async () => {
    const { values: next } = await startNewItem([{ name: 'note', sticky: false, defaultValue: 'hi' }], { note: 'typed' });
    expect(next).toEqual({ note: 'hi' });
  });
});

describe('RendererContext.history', () => {
  it('is an optional slot beside suggest', () => {
    const { store } = fakeHistory();
    const ctx: RendererContext = { mode: 'form', history: store };
    expect(ctx.history).toBe(store);
  });
});
