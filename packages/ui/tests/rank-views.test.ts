import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { rankViews, toViewConfig, isItemViewMode, DEFAULT_VIEW_TESTERS, VIEW_FIT } from '../src/index.js';

const Task = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['todo', 'doing', 'done']),
  owner: z.string(),
});
const Photo = z.object({ id: z.string(), name: z.string(), thumbnail: z.string(), owner: z.string() });
const Note = z.object({ id: z.string(), title: z.string(), body: z.string() });

const views = (rows: { view: string }[]) => rows.map((r) => r.view);
const row = (rows: ReturnType<typeof rankViews>, view: string) => rows.find((r) => r.view === view)!;

describe('rankViews', () => {
  it('ranks a kanban first when a groupable field has a closed vocabulary, and says why', () => {
    const tasks = defineCollection(Task, { affordances: { groupBy: { defaultField: 'status' } } } as never);
    const ranked = rankViews(tasks);
    expect(ranked[0]).toMatchObject({ view: 'kanban', applicable: true, score: VIEW_FIT.strong, gaps: [] });
    expect(ranked[0].reasons[0]).toContain("'status'");
    expect(row(ranked, 'grid').gaps.map((g) => g.code)).toEqual(['imageField']);
    expect(ranked.every((r) => r.applicable)).toBe(true);
  });

  it('suggests the groupBy a kanban needs when none is declared, usable with toViewConfig', () => {
    const tasks = defineCollection(Task);
    const kanban = row(rankViews(tasks), 'kanban');
    expect(kanban).toMatchObject({ applicable: true, options: { groupBy: 'status' } });
    expect(() => toViewConfig(tasks, 'kanban')).toThrow();
    expect(toViewConfig(tasks, 'kanban', kanban.options).group?.field).toBe('status');
  });

  it('blocks a kanban with no closed vocabulary, with a reason a person can read', () => {
    const ranked = rankViews(defineCollection(Note));
    const kanban = row(ranked, 'kanban');
    expect(kanban.applicable).toBe(false);
    expect(kanban.gaps).toEqual([expect.objectContaining({ code: 'groupField', blocking: true })]);
    expect(ranked.at(-1)!.view).toBe('kanban');
  });

  it('degrades, not blocks, a kanban over an open vocabulary', () => {
    const tasks = defineCollection(Task, { affordances: { groupBy: { defaultField: 'owner' } } } as never);
    const kanban = row(rankViews(tasks), 'kanban');
    expect(kanban).toMatchObject({ applicable: true, score: VIEW_FIT.good });
    expect(kanban.gaps.map((g) => g.code)).toEqual(['closedVocabulary']);
  });

  it('prefers a grid when there is a picture field', () => {
    const ranked = rankViews(defineCollection(Photo));
    expect(ranked[0]).toMatchObject({ view: 'grid', applicable: true });
    expect(ranked[0].reasons[0]).toContain("'thumbnail'");
  });

  it('marks declared views and breaks ties toward them', () => {
    const notes = defineCollection(Note, { affordances: { views: ['grid'] } } as never);
    const ranked = rankViews(notes);
    expect(ranked.filter((r) => r.declared).map((r) => r.view)).toEqual(['grid']);
    // A text-only grid ties with the table (both fallbacks): being declared puts the grid first.
    // Both follow the list, which has a label; the blocked kanban comes last.
    expect(views(ranked)).toEqual(['list', 'grid', 'table', 'kanban']);
  });

  it('takes testers by injection: override one, add or drop views', () => {
    const notes = defineCollection(Note);
    const ranked = rankViews(notes, {
      testers: { ...DEFAULT_VIEW_TESTERS, table: () => ({ score: 10, reasons: ['house rule'], gaps: [] }), kanban: undefined },
    });
    expect(views(ranked)).toEqual(['table', 'list', 'grid']);
    for (const r of ranked) if (isItemViewMode(r.view)) expect(() => toViewConfig(notes, r.view, r.options)).not.toThrow();
  });
});
