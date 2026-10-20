/**
 * View State: the choices a person makes while looking at a collection, remembered.
 *
 * Which view they picked (list, grid...), which groups they collapsed, how they sorted, what
 * they searched and filtered: the *working* view state, one record per collection and key,
 * written through on every change so the next visit opens where they left off (last write
 * wins). Not named snapshots: those are saved views, a different thing (`savedViews`).
 *
 * Headless and framework-agnostic: a small store with `get` / `set` / `subscribe`, persisted
 * through anything shaped like a `DataProvider` (only `getOne`, `create`, `update` and an
 * optional `upsert` are used, declared here structurally so `@zodal/ui` does not depend on
 * `@zodal/store`). Mirror it into zustand, React state or anything else with `subscribe`.
 *
 * Reading the stored record is asynchronous; a choice made before it arrives wins over the
 * stored value of the same field, and nothing is written until the stored record has been
 * read (so a write never puts defaults over choices not yet read).
 */

import { z } from 'zod';
import type { CollectionDefinition, GroupByConfig } from '@zodal/core';
import { availableViews, initialView } from '../generators/view-config.js';

/** The persisted record. Every field but `id` has a default, so a partial record parses. */
export const ViewStateSchema = z.object({
  /** The record's id: the store's `key`. */
  id: z.string(),
  /** The view the person last chose (one of the collection's `views`); absent: the default. */
  viewMode: z.string().optional(),
  /** Ids of the groups the person collapsed. */
  collapsedGroups: z.array(z.string()).default([]),
  /** Ids of the groups the person expanded where the collection opens groups collapsed
   *  (`groupBy.defaultState: 'collapsed'`): a group in neither list follows the default, so a
   *  group that first appears later still opens collapsed. Absent: none. */
  expandedGroups: z.array(z.string()).optional(),
  /** TanStack Table-compatible sorting. */
  sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })).default([]),
  /** The search text. */
  globalFilter: z.string().default(''),
  /** TanStack Table-compatible column filters (facet selections). */
  columnFilters: z.array(z.object({ id: z.string(), value: z.unknown() })).default([]),
});
export type ViewState = z.infer<typeof ViewStateSchema>;

/** The fields a person changes (everything but the id). */
export type ViewStateFields = Omit<ViewState, 'id'>;
type FieldName = keyof ViewStateFields;

/** The slice of a `DataProvider` the view state is stored through. */
export interface ViewStateProvider {
  getOne(id: string): Promise<unknown>;
  create(item: ViewState): Promise<unknown>;
  update(id: string, patch: Partial<ViewState>): Promise<unknown>;
  upsert?(item: ViewState): Promise<unknown>;
}

export interface ViewStateStoreOptions {
  /** The record's id (one record per collection and key). Default: `'view-state'`. */
  key?: string;
  /** Turn a stored record of an older shape into this one, before it is parsed. */
  migrate?: (raw: unknown) => unknown;
  /** A failed write (the state in memory stays as chosen). Default: `console.warn`. */
  onError?: (error: unknown) => void;
}

export interface HydrateOptions {
  /** The ids of the collection's groups: on a first visit, all of them start collapsed when
   *  the collection declares `groupBy.defaultState: 'collapsed'`. */
  groups?: readonly string[];
}

export interface ViewStateStore {
  /** The state now (defaults until hydrated, plus any choice already made). */
  get(): ViewState;
  /** Whether the stored record has been read. */
  hydrated(): boolean;
  /** Read the stored record (idempotent: the same promise each time). A missing or unreadable
   *  record gives the collection's defaults. */
  hydrate(options?: HydrateOptions): Promise<ViewState>;
  /** Change some fields, and write the record through (once hydrated). */
  set(patch: Partial<ViewStateFields>): void;
  /** Collapse an expanded group, or expand a collapsed one (a group in neither list follows
   *  the collection's `groupBy.defaultState`). */
  toggleGroup(groupId: string): void;
  /** Called after every change, hydration included. Returns the unsubscribe. */
  subscribe(listener: (state: ViewState) => void): () => void;
}

/**
 * The view state a first visit opens on: the collection's `defaultView` (or its first view when
 * it does not offer that one, the same rule as `CollectionState.activeView`), its groups collapsed
 * only when `groupBy.defaultState` is `'collapsed'`, no sort beyond the declared default, no
 * search, no filters.
 */
export function defaultViewState(
  collection: CollectionDefinition<any>,
  { key = 'view-state', groups = [] }: { key?: string; groups?: readonly string[] } = {},
): ViewState {
  const a = collection.affordances;
  const groupBy = a.groupBy as boolean | GroupByConfig | undefined;
  const collapsed = typeof groupBy === 'object' && groupBy.defaultState === 'collapsed';
  const defaultSort = (a as { defaultSort?: { field: string; direction?: 'asc' | 'desc' } }).defaultSort;
  return ViewStateSchema.parse({
    id: key,
    viewMode: initialView(collection),
    collapsedGroups: collapsed ? [...groups] : [],
    sorting: defaultSort ? [{ id: defaultSort.field, desc: defaultSort.direction === 'desc' }] : [],
  });
}

/**
 * Create a persisted view state store for a collection.
 *
 * @example
 * ```typescript
 * const view = createViewStateStore(products, createLocalStorageProvider({ storageKey: 'app.views', idField: 'id' }), { key: 'products' });
 * await view.hydrate({ groups: categoryIds });
 * view.set({ viewMode: 'grid' });
 * view.toggleGroup('archived');
 * ```
 */
export function createViewStateStore(
  collection: CollectionDefinition<any>,
  provider: ViewStateProvider,
  { key = 'view-state', migrate = (raw) => raw, onError = (e) => console.warn('[zodal] could not save the view state', e) }: ViewStateStoreOptions = {},
): ViewStateStore {
  let state: ViewState = defaultViewState(collection, { key });
  let isHydrated = false;
  let hydrating: Promise<ViewState> | null = null;
  /** Fields changed before the stored record was read: they keep their new value. */
  const touched = new Set<FieldName>();
  /** A change made before hydration is written once the stored record has been read. */
  let writeAfterHydrate = false;
  const listeners = new Set<(s: ViewState) => void>();
  const declaredGroupBy = collection.affordances.groupBy as boolean | GroupByConfig | undefined;
  const collapsedByDefault = typeof declaredGroupBy === 'object' && declaredGroupBy.defaultState === 'collapsed';

  const emit = () => {
    for (const l of listeners) l(state);
  };
  const write = () => {
    if (!isHydrated) {
      writeAfterHydrate = true;
      return;
    }
    const record = ViewStateSchema.parse(state);
    const done = provider.upsert
      ? provider.upsert(record)
      : provider.getOne(key).then(
          () => provider.update(key, record),
          () => provider.create(record),
        );
    done.catch(onError);
  };

  const set = (patch: Partial<ViewStateFields>): void => {
    for (const f of Object.keys(patch) as FieldName[]) touched.add(f);
    state = ViewStateSchema.parse({ ...state, ...patch, id: key });
    emit();
    write();
  };
  /** A stored view the collection no longer offers opens on its default instead. */
  const views: readonly string[] = availableViews(collection);
  const offered = (s: ViewState): ViewState =>
    s.viewMode !== undefined && !views.includes(s.viewMode) ? { ...s, viewMode: initialView(collection) } : s;

  return {
    get: () => state,
    hydrated: () => isHydrated,
    hydrate({ groups = [] } = {}) {
      hydrating ??= provider
        .getOne(key)
        .then((raw) => offered(ViewStateSchema.parse({ ...(migrate(raw) as object), id: key })))
        .catch(() => defaultViewState(collection, { key, groups }))
        .then((stored) => {
          const kept = Object.fromEntries([...touched].map((f) => [f, state[f]]));
          state = { ...stored, ...kept, id: key };
          isHydrated = true;
          emit();
          if (writeAfterHydrate) write();
          return state;
        });
      return hydrating;
    },
    set,
    toggleGroup(groupId) {
      const collapsed = state.collapsedGroups;
      const expanded = state.expandedGroups ?? [];
      const isCollapsed = collapsed.includes(groupId) || (collapsedByDefault && !expanded.includes(groupId));
      if (isCollapsed) {
        set({
          collapsedGroups: collapsed.filter((g) => g !== groupId),
          ...(collapsedByDefault ? { expandedGroups: [...expanded.filter((g) => g !== groupId), groupId] } : {}),
        });
      } else {
        set({
          collapsedGroups: [...collapsed, groupId],
          ...(state.expandedGroups ? { expandedGroups: expanded.filter((g) => g !== groupId) } : {}),
        });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
