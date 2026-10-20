import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import {
  toViewConfig,
  groupItems,
  availableViews,
  initialView,
  groupId,
  isItemViewMode,
  VIEW_MODE_LIMITS,
  type ViewGroupConfig,
} from '../src/generators/view-config.js';
import { createCollectionStore } from '../src/state/store.js';
import { createViewStateStore, defaultViewState, type ViewState } from '../src/state/view-state.js';

const Instrument = z.object({
  id: z.string(),
  name: z.string(),
  thumbnail: z.string().optional(),
  class: z.enum(['strings', 'winds', 'percussion']),
  tags: z.array(z.enum(['loud', 'soft', 'electric'])),
  description: z.string(),
  maker: z.string(),
  year: z.number(),
  midi: z.boolean(),
  specs: z.object({ range: z.string() }),
});

const instruments = (affordances: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  defineCollection(Instrument, {
    affordances: {
      views: ['list', 'grid'],
      defaultView: 'list',
      groupBy: { defaultField: 'class', collapsible: true, defaultState: 'expanded' },
      ...affordances,
    },
    ...extra,
  } as never);

const names = (fields: { name: string }[]) => fields.map((f) => f.name);

describe('toViewConfig: fields by role', () => {
  it('infers label, image, badges and secondary text from the schema', () => {
    const view = toViewConfig(instruments(), 'list');
    expect(view.kind).toBe('list');
    expect(view.idField).toBe('id');
    expect(view.fields.label).toMatchObject({ name: 'name', label: expect.any(String), zodType: 'string' });
    expect(view.fields.image?.name).toBe('thumbnail');
    // The group field (class) is the group header, so it is not repeated as a badge.
    expect(names(view.fields.badges)).toEqual(['tags', 'midi']);
    // Objects are not shown as text; the id is never secondary text.
    expect(names(view.fields.secondary)).toEqual(['description', 'maker', 'year']);
  });

  it('caps secondary fields per mode (a grid card shows less text than a list row)', () => {
    expect(toViewConfig(instruments(), 'grid').fields.secondary).toHaveLength(VIEW_MODE_LIMITS.grid.maxSecondary);
    expect(toViewConfig(instruments(), 'grid', { maxSecondary: 1 }).fields.secondary).toHaveLength(1);
  });

  it('puts summaryField fields first', () => {
    const c = instruments({}, { fields: { maker: { summaryField: true } } });
    expect(names(toViewConfig(c, 'list').fields.secondary)[0]).toBe('maker');
  });

  it('shows the group field as a badge when the view is not grouped', () => {
    expect(names(toViewConfig(instruments(), 'list', { groupBy: null }).fields.badges)).toContain('class');
  });

  it('takes an image from displayFormat or editWidget, not only from the name', () => {
    const c = defineCollection(z.object({ id: z.string(), title: z.string(), art: z.string() }), {
      fields: { art: { displayFormat: 'image' } },
    } as never);
    expect(toViewConfig(c, 'grid').fields.image?.name).toBe('art');
  });

  it('leaves hidden, detail-only and unreadable fields out of every role', () => {
    const c = instruments({}, { fields: { thumbnail: { detailOnly: true }, maker: { hidden: true }, year: { readable: false } } });
    const view = toViewConfig(c, 'list');
    expect(view.fields.image).toBeNull();
    expect(names(view.fields.secondary)).toEqual(['description']);
  });

  it('does not take an icon name for a picture, nor show a second picture as text', () => {
    const c = defineCollection(z.object({ id: z.string(), name: z.string(), icon: z.string(), photo: z.string(), cover: z.string() }));
    const view = toViewConfig(c, 'grid');
    expect(view.fields.image?.name).toBe('photo');
    expect(names(view.fields.secondary)).toEqual(['icon']);
  });

  it('badge-like fields past the cap fall back to secondary text', () => {
    const view = toViewConfig(instruments(), 'list', { maxBadges: 1, maxSecondary: 10 });
    expect(names(view.fields.badges)).toEqual(['tags']);
    expect(names(view.fields.secondary)).toContain('midi');
  });

  it('carries the vocabulary labels, so a numeric enum badge can show its name', () => {
    enum Level { Low, High }
    const c = defineCollection(z.object({ id: z.string(), name: z.string(), level: z.nativeEnum(Level) }));
    expect(toViewConfig(c, 'list').fields.badges[0].options).toEqual([
      { value: '0', label: 'Low', raw: 0 }, { value: '1', label: 'High', raw: 1 },
    ]);
  });

  it('takes explicit roles over inference, and names the fields when one is unknown', () => {
    const view = toViewConfig(instruments(), 'grid', {
      fields: { label: 'maker', image: null, badges: ['class'], secondary: ['year'] },
    });
    expect(view.fields.label?.name).toBe('maker');
    expect(view.fields.image).toBeNull();
    expect(names(view.fields.badges)).toEqual(['class']);
    expect(names(view.fields.secondary)).toEqual(['year']);
    // Inferred roles do not repeat the explicit ones.
    const partial = toViewConfig(instruments(), 'list', { groupBy: null, fields: { secondary: ['midi'] } });
    expect(names(partial.fields.badges)).not.toContain('midi');
    expect(() => toViewConfig(instruments(), 'list', { fields: { image: 'cover' } })).toThrow(/'cover'.*fields: id, name/);
  });

  it('refuses a mode it does not describe, pointing at toColumnDefs for a table', () => {
    expect(() => toViewConfig(instruments(), 'table' as never)).toThrow(/toColumnDefs/);
    expect(isItemViewMode('grid')).toBe(true);
    expect(isItemViewMode('kanban')).toBe(false);
  });

  it('returns plain, serializable data', () => {
    const view = toViewConfig(instruments(), 'grid');
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe('toViewConfig: grouping', () => {
  it('reads groupBy: field, collapse policy and the vocabulary order', () => {
    const group = toViewConfig(instruments(), 'list').group!;
    expect(group).toMatchObject({ field: 'class', collapsible: true, defaultState: 'expanded', multiValued: false });
    expect(group.order?.map((o) => o.value)).toEqual(['strings', 'winds', 'percussion']);
  });

  it('honours collapsible: false and defaultState: collapsed', () => {
    const c = instruments({ groupBy: { defaultField: 'class', collapsible: false, defaultState: 'collapsed' } });
    expect(toViewConfig(c, 'list').group).toMatchObject({ collapsible: false, defaultState: 'collapsed' });
  });

  it('groupBy: true picks the first groupable field; no groupBy means no group', () => {
    expect(toViewConfig(instruments({ groupBy: true }), 'list').group?.field).toBe('class');
    expect(toViewConfig(instruments({ groupBy: undefined }), 'list').group).toBeNull();
  });

  it('a multi-valued group field needs a policy: duplicate by default, primary, or forbid', () => {
    expect(toViewConfig(instruments(), 'list', { groupBy: 'tags' }).group).toMatchObject({ multiValued: true, multiValue: 'duplicate' });
    expect(toViewConfig(instruments(), 'list', { groupBy: 'tags', multiValue: 'primary' }).group?.multiValue).toBe('primary');
    expect(() => toViewConfig(instruments(), 'list', { groupBy: 'tags', multiValue: 'forbid' })).toThrow(/several values/);
  });

  it('rejects an unknown group field', () => {
    expect(() => toViewConfig(instruments(), 'list', { groupBy: 'family' })).toThrow(/'family'/);
  });
});

describe('toViewConfig: operations and selection', () => {
  it('surfaces CRUD as built-ins and declared operations by scope', () => {
    const c = instruments({ bulkDelete: true }, {
      operations: [
        { name: 'tune', label: 'Tune', scope: 'item', icon: 'wrench' },
        { name: 'export', label: 'Export', scope: 'selection' },
        { name: 'import', label: 'Import', scope: 'collection' },
      ],
    });
    const { operations, selection } = toViewConfig(c, 'list');
    expect(selection).toBe('multi');
    expect(operations.item.map((o) => o.name)).toEqual(['edit', 'delete', 'tune']);
    expect(operations.item[2]).toEqual({ name: 'tune', label: 'Tune', icon: 'wrench', builtin: false });
    expect(operations.selection.map((o) => o.name)).toEqual(['bulkDelete', 'export']);
    expect(operations.collection.map((o) => o.name)).toEqual(['create', 'import']);
  });

  it('a declared operation replaces a built-in of the same name in its place; bulkDelete needs delete', () => {
    const c = instruments({ bulkDelete: true, delete: false }, {
      operations: [{ name: 'tune', label: 'Tune', scope: 'item' }, { name: 'edit', label: 'Modify', scope: 'item' }],
    });
    const { operations } = toViewConfig(c, 'list');
    expect(operations.item.map((o) => [o.name, o.label])).toEqual([['edit', 'Modify'], ['tune', 'Tune']]);
    expect(operations.selection).toEqual([]);
  });

  it('drops what the collection does not allow', () => {
    const c = instruments({ update: false, create: false, selectable: false }, {
      operations: [{ name: 'delete', label: 'Remove', scope: 'item', confirm: true }],
    });
    const { operations, selection } = toViewConfig(c, 'grid');
    expect(selection).toBe(false);
    expect(operations.item).toEqual([{ name: 'delete', label: 'Remove', confirm: true, builtin: false }]);
    expect(operations.selection).toEqual([]);
    expect(operations.collection).toEqual([]);
  });
});

describe('groupItems', () => {
  const group: ViewGroupConfig = {
    field: 'class', label: 'Class', collapsible: true, defaultState: 'expanded', multiValued: false, multiValue: 'duplicate',
    order: [{ value: 'strings', label: 'Strings' }, { value: 'winds', label: 'Winds' }, { value: 'percussion', label: 'Percussion' }],
  };
  const items = [
    { id: 'a', class: 'percussion' },
    { id: 'b', class: 'strings' },
    { id: 'c', class: null },
    { id: 'd', class: 'strings' },
    { id: 'e', class: 'theremin' },
    { id: 'f', class: 'harp' },
  ];
  const none = groupId('class', null);

  it('follows the vocabulary order, omits empty groups, puts unknown values after (first seen) and no value last', () => {
    const groups = groupItems(items, group);
    expect(groups.map((g) => g.value)).toEqual(['strings', 'percussion', 'theremin', 'harp', null]);
    expect(groups[0]).toEqual({ id: 'class:strings', kind: 'value', value: 'strings', label: 'Strings', items: [items[1], items[3]], collapsed: false });
    expect(groups[4]).toMatchObject({ id: none, kind: 'none', label: 'None' });
    expect(groupItems(items, group, { emptyLabel: 'Unclassified' })[4].label).toBe('Unclassified');
  });

  it('ids carry the field, so collapsing a value under one field does not collapse it under another', () => {
    expect(groupId('class', 'strings')).not.toBe(groupId('owner', 'strings'));
    expect(groupItems(items, group, { collapsedGroups: ['owner:strings'] })[0].collapsed).toBe(false);
  });

  it('collapses what was collapsed, expands what was expanded, the rest follows defaultState', () => {
    expect(groupItems(items, group, { collapsedGroups: ['class:strings'] }).map((g) => g.collapsed)).toEqual([true, false, false, false, false]);
    const closed = { ...group, defaultState: 'collapsed' as const };
    expect(groupItems(items, closed, { collapsedGroups: [] }).every((g) => g.collapsed)).toBe(true);
    expect(groupItems(items, closed, { expandedGroups: ['class:winds', 'class:strings'] }).map((g) => g.collapsed)).toEqual([false, true, true, true, true]);
    expect(groupItems(items, { ...group, collapsible: false }, { collapsedGroups: ['class:strings'] })[0].collapsed).toBe(false);
  });

  it('places a multi-valued item in each group, or only its first one', () => {
    const tags: ViewGroupConfig = { ...group, field: 'tags', multiValued: true, order: undefined };
    const tagged = [{ id: 'x', tags: ['loud', 'electric', 'loud'] }, { id: 'y', tags: [] }, { id: 'z', tags: ['electric'] }];
    expect(groupItems(tagged, tags).map((g) => [g.value, g.items.map((i) => i.id)])).toEqual([
      ['loud', ['x']], ['electric', ['x', 'z']], [null, ['y']],
    ]);
    const primary = groupItems(tagged, { ...tags, multiValue: 'primary' });
    expect(primary.map((g) => [g.value, g.items.map((i) => i.id)])).toEqual([['loud', ['x']], ['electric', ['z']], [null, ['y']]]);
  });

  it('groups by a numeric enum through its vocabulary labels, and by dates as ISO strings', () => {
    enum Level { Low, High }
    const c = defineCollection(z.object({ id: z.string(), name: z.string(), level: z.nativeEnum(Level) }), {
      affordances: { groupBy: { defaultField: 'level' } },
    });
    const g = toViewConfig(c, 'list').group!;
    expect(groupItems([{ level: 1 }, { level: 0 }], g).map((x) => x.label)).toEqual(['Low', 'High']);
    const when = { ...group, field: 'at', order: undefined };
    expect(groupItems([{ at: new Date('2024-01-02T00:00:00Z') }], when)[0].value).toBe('2024-01-02T00:00:00.000Z');
  });

  it('with no group, one header-less group holds everything', () => {
    expect(groupItems(items, null)).toEqual([{ id: '', kind: 'all', value: null, label: '', items, collapsed: false }]);
  });
});

describe('view state and groups opening collapsed', () => {
  it('a defaultState: collapsed collection opens collapsed, remembers an expanded group, and a new group still opens collapsed', async () => {
    const c = instruments({ groupBy: { defaultField: 'class', collapsible: true, defaultState: 'collapsed' } });
    const rows = new Map<string, unknown>();
    const provider = {
      getOne: async (id: string) => { if (!rows.has(id)) throw new Error('missing'); return rows.get(id); },
      create: async (item: ViewState) => void rows.set(item.id, item),
      update: async (id: string, patch: Partial<ViewState>) => void rows.set(id, { ...(rows.get(id) as object), ...patch }),
    };
    const view = createViewStateStore(c, provider, { key: 'k' });
    await view.hydrate();
    const config = toViewConfig(c, 'list');
    const draw = (data: { class: string }[]) =>
      groupItems(data, config.group, { collapsedGroups: view.get().collapsedGroups, expandedGroups: view.get().expandedGroups });
    expect(draw([{ class: 'strings' }, { class: 'winds' }]).map((g) => g.collapsed)).toEqual([true, true]);
    view.toggleGroup('class:strings');
    expect(draw([{ class: 'strings' }, { class: 'winds' }, { class: 'percussion' }]).map((g) => g.collapsed)).toEqual([false, true, true]);
    view.toggleGroup('class:strings');
    expect(draw([{ class: 'strings' }]).map((g) => g.collapsed)).toEqual([true]);
  });
});

describe('the active view (one field, shared state)', () => {
  it('availableViews / initialView follow the declaration, defaultView first when offered', () => {
    expect(availableViews(instruments())).toEqual(['list', 'grid']);
    expect(initialView(instruments())).toBe('list');
    // A defaultView the collection does not offer (or none): the first view.
    expect(initialView(instruments({ defaultView: 'table' }))).toBe('list');
    expect(initialView(instruments({ defaultView: undefined }))).toBe('list');
    expect(initialView(defineCollection(Instrument))).toBe('table');
  });

  it('CollectionState.activeView switches only to offered views and keeps selection and filters', () => {
    const store = createCollectionStore(instruments());
    expect(store.initialState.activeView).toBe('list');
    const before = { ...store.initialState, rowSelection: { '0': true }, globalFilter: 'violin' };
    const grid = store.actions.setActiveView(before, 'grid');
    expect(grid).toMatchObject({ activeView: 'grid', rowSelection: { '0': true }, globalFilter: 'violin' });
    expect(store.actions.setActiveView(grid, 'kanban')).toBe(grid);
  });

  it('the persisted viewMode opens on the same view as activeView', () => {
    const c = instruments({ defaultView: 'table' });
    expect(defaultViewState(c).viewMode).toBe(createCollectionStore(c).initialState.activeView);
  });
});
