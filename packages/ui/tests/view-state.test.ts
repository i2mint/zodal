import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createViewStateStore, defaultViewState, type ViewState, type ViewStateProvider } from '../src/state/view-state.js';

const Item = z.object({ id: z.string(), name: z.string(), kind: z.string() });

const grouped = (defaultState: 'collapsed' | 'expanded' = 'expanded') =>
  defineCollection(Item, {
    affordances: { views: ['list', 'grid'], defaultView: 'list', groupBy: { defaultField: 'kind', collapsible: true, defaultState } },
  } as never);

/** An in-memory provider, with every call recorded. */
function memory(initial: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(initial));
  const p = {
    rows,
    getOne: vi.fn(async (id: string) => {
      if (!rows.has(id)) throw new Error('not found');
      return rows.get(id);
    }),
    create: vi.fn(async (item: ViewState) => void rows.set(item.id, item)),
    update: vi.fn(async (id: string, patch: Partial<ViewState>) => void rows.set(id, { ...(rows.get(id) as object), ...patch })),
  };
  return p satisfies ViewStateProvider;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('defaultViewState', () => {
  it('opens on the declared default view, groups expanded unless declared collapsed', () => {
    expect(defaultViewState(grouped(), { key: 'k', groups: ['a', 'b'] })).toEqual({ id: 'k', viewMode: 'list', collapsedGroups: [], sorting: [], globalFilter: '', columnFilters: [] });
    expect(defaultViewState(grouped('collapsed'), { key: 'k', groups: ['a', 'b'] }).collapsedGroups).toEqual(['a', 'b']);
  });
});

describe('createViewStateStore', () => {
  it('a first visit: the defaults, nothing written until a choice is made', async () => {
    const p = memory();
    const view = createViewStateStore(grouped('collapsed'), p, { key: 'things' });
    const s = await view.hydrate({ groups: ['a', 'b'] });
    expect(s).toMatchObject({ id: 'things', viewMode: 'list', collapsedGroups: ['a', 'b'] });
    expect(view.hydrated()).toBe(true);
    expect(p.create).not.toHaveBeenCalled();
  });

  it('remembers a choice across visits (the next store reads it back)', async () => {
    const p = memory();
    const a = createViewStateStore(grouped(), p, { key: 'things' });
    await a.hydrate();
    a.set({ viewMode: 'grid', globalFilter: 'bell' });
    a.toggleGroup('air');
    await flush();
    const b = createViewStateStore(grouped(), p, { key: 'things' });
    expect(await b.hydrate()).toMatchObject({ viewMode: 'grid', globalFilter: 'bell', collapsedGroups: ['air'] });
    b.toggleGroup('air');
    expect(b.get().collapsedGroups).toEqual([]);
  });

  it('a choice made before the stored record arrives wins for its field; the others are read; written once read', async () => {
    const p = memory({ things: { id: 'things', viewMode: 'grid', collapsedGroups: ['x'] } });
    const view = createViewStateStore(grouped(), p, { key: 'things' });
    view.toggleGroup('y');
    expect(p.create).not.toHaveBeenCalled();
    expect(p.update).not.toHaveBeenCalled();
    await view.hydrate();
    expect(view.get()).toMatchObject({ viewMode: 'grid', collapsedGroups: ['y'] });
    await flush();
    expect(p.rows.get('things')).toMatchObject({ viewMode: 'grid', collapsedGroups: ['y'] });
  });

  it('uses upsert where the provider has it', async () => {
    const p = { ...memory(), upsert: vi.fn(async () => {}) };
    const view = createViewStateStore(grouped(), p, { key: 'things' });
    await view.hydrate();
    view.set({ sorting: [{ id: 'name', desc: true }] });
    expect(p.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'things', sorting: [{ id: 'name', desc: true }] }));
    expect(p.create).not.toHaveBeenCalled();
  });

  it('migrates an older record; a view no longer offered opens on the default; a bad record gives the defaults', async () => {
    const old = memory({ things: { id: 'things', view: 'grid', collapsed: ['air'] } });
    const migrate = (raw: unknown) => {
      const r = raw as { view?: string; collapsed?: string[] };
      return { viewMode: r.view, collapsedGroups: r.collapsed };
    };
    expect(await createViewStateStore(grouped(), old, { key: 'things', migrate }).hydrate()).toMatchObject({ viewMode: 'grid', collapsedGroups: ['air'] });
    const gone = memory({ things: { id: 'things', viewMode: 'kanban' } });
    expect((await createViewStateStore(grouped(), gone, { key: 'things' }).hydrate()).viewMode).toBe('list');
    const bad = memory({ things: { id: 'things', collapsedGroups: 'nope' } });
    expect(await createViewStateStore(grouped(), bad, { key: 'things' }).hydrate()).toMatchObject({ viewMode: 'list', collapsedGroups: [] });
  });

  it('tells subscribers of every change, hydration included; unsubscribes', async () => {
    const view = createViewStateStore(grouped(), memory(), { key: 'things' });
    const seen: string[] = [];
    const off = view.subscribe((s) => seen.push(s.viewMode ?? ''));
    await view.hydrate();
    view.set({ viewMode: 'grid' });
    off();
    view.set({ viewMode: 'list' });
    expect(seen).toEqual(['list', 'grid']);
  });

  it('a failed write is reported, the choice kept in memory', async () => {
    const onError = vi.fn();
    const p = { ...memory(), upsert: vi.fn(async () => Promise.reject(new Error('full'))) };
    const view = createViewStateStore(grouped(), p, { key: 'things', onError });
    await view.hydrate();
    view.set({ viewMode: 'grid' });
    await flush();
    expect(onError).toHaveBeenCalled();
    expect(view.get().viewMode).toBe('grid');
  });
});
