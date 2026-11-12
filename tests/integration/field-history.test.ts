/**
 * Integration: field input history and sticky fields.
 *
 * Schema -> defineCollection (sticky inferred, history declared) -> toFormConfig ->
 * createFieldHistory (@zodal/store) -> recordUse on a submit, startNewItem on a new item, and the
 * history the renderer reads through RendererContext.history. Also checks that the store's
 * FieldHistoryStore and @zodal/ui's structural copy stay the same shape, both ways.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createFieldHistory, createInMemoryProvider } from '@zodal/store';
import type { FieldHistoryStore as StoreHistory, HistoryEntry as StoreEntry } from '@zodal/store';
import { recordUse, startNewItem, toFormConfig } from '@zodal/ui';
import type { FieldHistoryStore as UiHistory, HistoryEntry as UiEntry, RendererContext } from '@zodal/ui';

describe('field history across packages', () => {
  it('the store and ui declare the same shapes', () => {
    expectTypeOf<StoreHistory>().toEqualTypeOf<UiHistory>();
    expectTypeOf<StoreEntry>().toEqualTypeOf<UiEntry>();
  });

  it('a form used, then started over, then picked from', async () => {
    const collection = defineCollection(z.object({
      title: z.string(),
      lyrics: z.string(),
      styles: z.string(),
      model: z.enum(['v4', 'v5']),
    }), {
      fields: { lyrics: { history: true }, styles: { history: true, sticky: true } },
    });
    const fields = toFormConfig(collection);
    let t = 0;
    const history = createFieldHistory({ provider: createInMemoryProvider<StoreEntry>([]), now: () => ++t });
    const ctx: RendererContext = { mode: 'form', history };

    // Generate: what was used is remembered.
    const used = { title: 'A', lyrics: 'first verse', styles: 'synthwave', model: 'v5' };
    await recordUse(fields, used, { history });

    // Edit, never used, then a new item: the typing is saved before it is cleared.
    const edited = { ...used, lyrics: 'second verse, never generated' };
    const { values, previous } = await startNewItem(fields, edited, { history: ctx.history });
    expect(values).toEqual({ title: undefined, lyrics: undefined, styles: 'synthwave', model: 'v5' });
    expect(previous).toEqual({ title: 'A', lyrics: 'second verse, never generated' });

    expect((await history.list('lyrics')).map((e) => e.value)).toEqual(['second verse, never generated', 'first verse']);
    expect((await history.list('styles')).map((e) => e.value)).toEqual(['synthwave']);
    expect(await history.list('title')).toEqual([]); // no history declared
  });
});
