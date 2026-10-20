/**
 * Saved views (#50): named records with their own view mode, filter, sort and group, kept in the
 * view-state record; the shared working state stays the default when none is active.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createViewStateStore, toViewConfig, type ViewState } from '../src/index.js';

const Task = z.object({ id: z.string(), title: z.string(), status: z.enum(['todo', 'done']), owner: z.string() });
const tasks = defineCollection(Task, {
  affordances: { views: ['table', 'list', 'kanban'], defaultView: 'table', savedViews: true, groupBy: { defaultField: 'status' } },
} as never);

const memory = () => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    getOne: async (id: string) => {
      if (!rows.has(id)) throw new Error('missing');
      return rows.get(id);
    },
    create: async (item: ViewState) => void rows.set(item.id, item),
    update: async (id: string, patch: Partial<ViewState>) => void rows.set(id, { ...(rows.get(id) as object), ...patch }),
  };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('saved views', () => {
  it('each saved view keeps its own filter, sort and group; switching restores them', async () => {
    const view = createViewStateStore(tasks, memory(), { key: 'tasks' });
    await view.hydrate();

    view.set({ viewMode: 'kanban', columnFilters: [{ id: 'owner', value: 'ana' }] });
    const board = view.saveView('My board');
    expect(board).toMatchObject({ id: 'my-board', name: 'My board', viewMode: 'kanban' });

    view.leaveSavedView();
    view.set({ viewMode: 'list', columnFilters: [], sorting: [{ id: 'title', desc: false }], groupBy: null });
    view.saveView('By title');

    view.applySavedView('my-board');
    expect(view.get()).toMatchObject({ activeSavedView: 'my-board', viewMode: 'kanban', columnFilters: [{ id: 'owner', value: 'ana' }], sorting: [] });
    expect(view.get().groupBy).toBeUndefined();

    view.applySavedView('by-title');
    expect(view.get()).toMatchObject({ viewMode: 'list', columnFilters: [], sorting: [{ id: 'title', desc: false }], groupBy: null });
    expect(toViewConfig(tasks, 'list', { groupBy: view.get().groupBy }).group).toBeNull();
  });

  it('a change while a saved view is active is written into it; none active, the state is shared', async () => {
    const view = createViewStateStore(tasks, memory());
    await view.hydrate();
    view.saveView('Mine');
    view.set({ globalFilter: 'urgent' });
    expect(view.get().savedViews[0]).toMatchObject({ globalFilter: 'urgent' });

    view.leaveSavedView();
    view.set({ globalFilter: 'other' });
    expect(view.get().savedViews[0]).toMatchObject({ globalFilter: 'urgent' });
    view.applySavedView('mine');
    expect(view.get().globalFilter).toBe('urgent');
  });

  it('persists saved views and the active one, and reads them back', async () => {
    const provider = memory();
    const first = createViewStateStore(tasks, provider, { key: 'tasks' });
    await first.hydrate();
    first.set({ sorting: [{ id: 'owner', desc: true }] });
    first.saveView('Owners');
    await flush();

    const again = createViewStateStore(tasks, provider, { key: 'tasks' });
    await again.hydrate();
    expect(again.get()).toMatchObject({ activeSavedView: 'owners', savedViews: [{ id: 'owners', sorting: [{ id: 'owner', desc: true }] }] });
  });

  it('a saved view whose mode the collection no longer offers opens on the default', async () => {
    const provider = memory();
    provider.rows.set('view-state', { id: 'view-state', savedViews: [{ id: 'old', name: 'Old', viewMode: 'grid' }] });
    const view = createViewStateStore(tasks, provider);
    await view.hydrate();
    view.applySavedView('old');
    expect(view.get().viewMode).toBe('table');
  });

  it('names, ids and errors', async () => {
    const view = createViewStateStore(tasks, memory());
    expect(() => view.saveView('Early')).toThrow(/hydrate/);
    await view.hydrate();
    expect(view.saveView('Q3 review').id).toBe('q3-review');
    expect(view.saveView('Q3 review').id).toBe('q3-review-2');
    expect(() => view.saveView('x', { id: 'q3-review' })).toThrow(/already exists/);
    expect(() => view.applySavedView('nope')).toThrow(/no saved view 'nope'/);

    view.renameSavedView('q3-review', 'Q3');
    expect(view.get().savedViews[0]!.name).toBe('Q3');
    view.deleteSavedView('q3-review-2'); // the active one
    expect(view.get()).toMatchObject({ activeSavedView: undefined });
    expect(view.get().savedViews.map((v) => v.id)).toEqual(['q3-review']);
    view.deleteSavedView('unknown');
  });

  it('a cleared field is cleared in the active saved view too', async () => {
    const view = createViewStateStore(tasks, memory());
    await view.hydrate();
    view.set({ groupBy: 'owner' });
    view.saveView('V');
    view.set({ groupBy: undefined });
    view.leaveSavedView();
    view.set({ groupBy: 'title' });
    view.applySavedView('v');
    expect(view.get().groupBy).toBeUndefined();
  });

  it('a mode substituted on apply is not written back into the saved view', async () => {
    const provider = memory();
    provider.rows.set('view-state', { id: 'view-state', savedViews: [{ id: 'old', name: 'Old', viewMode: 'grid' }] });
    const view = createViewStateStore(tasks, provider);
    await view.hydrate();
    view.applySavedView('old');
    view.set({ globalFilter: 'x' });
    expect(view.get().savedViews[0]).toMatchObject({ viewMode: 'grid', globalFilter: 'x' });
  });

  it('a choice made before the read leaves the stored active saved view instead of overwriting it', async () => {
    const provider = memory();
    provider.rows.set('view-state', {
      id: 'view-state',
      activeSavedView: 'board',
      viewMode: 'kanban',
      savedViews: [{ id: 'board', name: 'Board', viewMode: 'kanban' }],
    });
    const view = createViewStateStore(tasks, provider);
    view.set({ viewMode: 'list' });
    await view.hydrate();
    expect(view.get()).toMatchObject({ viewMode: 'list', activeSavedView: undefined });
    view.set({ globalFilter: 'x' });
    expect(view.get().savedViews[0]).toMatchObject({ viewMode: 'kanban', globalFilter: '' });
  });

  it('drops only a stored saved view that does not parse, and a dangling active id', async () => {
    const provider = memory();
    provider.rows.set('view-state', {
      id: 'view-state',
      globalFilter: 'kept',
      activeSavedView: 'gone',
      savedViews: [{ id: 'ok', name: 'Ok' }, { id: 'broken' }],
    });
    const view = createViewStateStore(tasks, provider);
    await view.hydrate();
    expect(view.get()).toMatchObject({ globalFilter: 'kept', activeSavedView: undefined });
    expect(view.get().savedViews.map((v) => v.id)).toEqual(['ok']);
  });

  it('a saved view with no mode opens on the default mode and the declared default sort', async () => {
    const sorted = defineCollection(Task, { affordances: { views: ['table', 'list'], savedViews: true, defaultSort: { field: 'title' } } } as never);
    const provider = memory();
    provider.rows.set('view-state', { id: 'view-state', viewMode: 'list', savedViews: [{ id: 'bare', name: 'Bare', globalFilter: 'q' }] });
    const view = createViewStateStore(sorted, provider);
    await view.hydrate();
    view.applySavedView('bare');
    expect(view.get()).toMatchObject({ viewMode: 'table', globalFilter: 'q' });
  });

  it('ids from non-ASCII names, and no empty id', async () => {
    const view = createViewStateStore(tasks, memory());
    await view.hydrate();
    expect(view.saveView('Café 日本').id).toBe('café-日本');
    expect(() => view.saveView('x', { id: ' ' })).toThrow(/empty/);
  });
});
