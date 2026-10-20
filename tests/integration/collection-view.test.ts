/**
 * Integration: a collection drawn as a list or a grid (#14).
 *
 * Schema -> defineCollection -> DataProvider query -> toViewConfig -> groupItems, with the
 * persisted view state (collapsed groups, chosen view) and CollectionState.activeView shared
 * across the list and grid lenses.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import { createCollectionStore, createViewStateStore, groupItems, isItemViewMode, toViewConfig, type ViewState } from '@zodal/ui';

const InstrumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().optional(),
  class: z.enum(['strings', 'winds', 'percussion']),
  electric: z.boolean(),
  maker: z.string(),
});
type Instrument = z.infer<typeof InstrumentSchema>;

const instruments = defineCollection(InstrumentSchema, {
  affordances: {
    views: ['list', 'grid'],
    defaultView: 'list',
    groupBy: { defaultField: 'class', collapsible: true, defaultState: 'expanded' },
  },
  operations: [{ name: 'play', label: 'Play', scope: 'item', icon: 'play' }],
});

const data: Instrument[] = [
  { id: 'i1', name: 'Violin', image: 'violin.png', class: 'strings', electric: false, maker: 'Stradivari' },
  { id: 'i2', name: 'Flute', class: 'winds', electric: false, maker: 'Yamaha' },
  { id: 'i3', name: 'Theremin', class: 'strings', electric: true, maker: 'Moog' },
  { id: 'i4', name: 'Snare', class: 'percussion', electric: false, maker: 'Ludwig' },
];

describe('A collection as a list or a grid, grouped and collapsible', () => {
  it('draws the queried items in declared group order, with persisted collapsed groups', async () => {
    const provider = createInMemoryProvider(data);
    const { data: items } = await provider.getList({ sort: [{ id: 'name', desc: false }] });

    const views = createInMemoryProvider<ViewState>([]);
    const viewState = createViewStateStore(instruments, views, { key: 'instruments' });
    await viewState.hydrate();
    viewState.toggleGroup('class:winds');

    const mode = viewState.get().viewMode;
    if (!isItemViewMode(mode)) throw new Error(`not an item view: ${mode}`);
    const list = toViewConfig(instruments, mode);
    expect(list.kind).toBe('list');
    expect(list.fields.label?.name).toBe('name');
    expect(list.fields.image?.name).toBe('image');
    expect(list.fields.badges.map((f) => f.name)).toEqual(['electric']);
    expect(list.operations.item.map((o) => o.name)).toEqual(['edit', 'delete', 'play']);

    const groups = groupItems(items, list.group, { collapsedGroups: viewState.get().collapsedGroups });
    expect(groups.map((g) => [g.value, g.collapsed, g.items.map((i) => i.name)])).toEqual([
      ['strings', false, ['Theremin', 'Violin']],
      ['winds', true, ['Flute']],
      ['percussion', false, ['Snare']],
    ]);

    // The collapse is written through: a second visit opens with the same group collapsed.
    const again = createViewStateStore(instruments, views, { key: 'instruments' });
    expect((await again.hydrate()).collapsedGroups).toEqual(['class:winds']);
  });

  it('switches list -> grid through one activeView field, keeping selection and search', () => {
    const store = createCollectionStore<Instrument>(instruments);
    let state = store.actions.setItems(store.initialState, data);
    state = store.actions.setRowSelection(state, { '2': true });
    state = store.actions.setGlobalFilter(state, 'mo');
    state = store.actions.setActiveView(state, 'grid');

    expect(state.activeView).toBe('grid');
    expect(store.selectors.getSelectedItems(state).map((i) => i.name)).toEqual(['Theremin']);
    expect(state.globalFilter).toBe('mo');

    if (!isItemViewMode(state.activeView)) throw new Error('not an item view');
    const grid = toViewConfig(instruments, state.activeView);
    expect(grid.kind).toBe('grid');
    expect(grid.group?.field).toBe('class');
    // A view the collection does not declare is refused.
    expect(store.actions.setActiveView(state, 'table')).toBe(state);
  });
});
