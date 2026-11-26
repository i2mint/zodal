import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection, resolveTrashAffordance } from '../src/index.js';

describe('trash affordance (zodal#162)', () => {
  it('resolves true, an object, and absence', () => {
    expect(resolveTrashAffordance(undefined)).toBeNull();
    expect(resolveTrashAffordance({})).toBeNull();
    expect(resolveTrashAffordance({ trash: false })).toBeNull();
    expect(resolveTrashAffordance({ trash: true })).toEqual({ field: 'deletedAt' });
    expect(resolveTrashAffordance({ trash: { retentionDays: 30 } })).toEqual({ field: 'deletedAt', retentionDays: 30 });
    expect(resolveTrashAffordance({ trash: { field: 'removedAt' } })).toEqual({ field: 'removedAt' });
  });

  it('survives defineCollection and is shown in explain/describe', () => {
    const Song = z.object({ id: z.string(), title: z.string(), deletedAt: z.string().nullable().optional() });
    const songs = defineCollection(Song, { affordances: { trash: { retentionDays: 7 } } });
    expect(resolveTrashAffordance(songs.affordances)).toEqual({ field: 'deletedAt', retentionDays: 7 });
    expect(songs.describe()).toContain('Move to Trash');
    expect(defineCollection(Song).describe()).not.toContain('Move to Trash');
  });
});
