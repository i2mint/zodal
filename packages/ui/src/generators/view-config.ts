/**
 * Collection View Generator: the whole collection drawn as a list, a grid (gallery) or a kanban board.
 *
 * `toViewConfig(collection, mode)` reads what `defineCollection` already declares (the
 * `labelField`, field affordances, `groupBy`, `selectable`, CRUD flags and operations) and
 * returns a plain, serializable description of one *view* of the collection:
 *
 * - which fields each item shows, by role: `label`, `image`, `badges`, `secondary`;
 * - the group field and its collapse policy (`groupBy.collapsible` / `defaultState`), plus
 *   the policy for grouping by a multi-valued field;
 * - the operations to surface on an item, on a selection and on the collection.
 *
 * Headless: renderers (`@zodal/ui-vanilla`, `@zodal/ui-shadcn`, ...) map this to a list row
 * and a grid card. Which view is showing is not part of this config: it is the one
 * `activeView` field of `CollectionState` (see `availableViews` / `setActiveView`), so
 * selection, sort and filters are shared by every view of the same collection.
 *
 * `groupItems(items, config.group, { collapsedGroups, expandedGroups })` is the matching pure
 * helper that buckets items into the ordered groups a renderer draws.
 *
 * `ViewConfig` is a union discriminated on `kind` (`'list' | 'grid' | 'kanban'`), so a later kind
 * with its own required config (a kanban's group field, a calendar's date field) is additive.
 */

import { z } from 'zod';
import type {
  CollectionDefinition,
  GroupByConfig,
  OperationConfirmation,
  OperationDefinition,
  ResolvedFieldAffordance,
  ViewMode,
} from '@zodal/core';
import { getVocabularyEntries, getZodBaseType, unwrapZodSchema } from '@zodal/core';
import { toOption, type VocabularyOption } from './form-config.js';

// ============================================================================
// Types
// ============================================================================

/** The collection layouts `toViewConfig` describes. `'table'` is `toColumnDefs`. */
export type ItemViewMode = Extract<ViewMode, 'list' | 'grid' | 'kanban'>;

/** The item-view modes, in declaration order. */
export const ITEM_VIEW_MODES: readonly ItemViewMode[] = ['list', 'grid', 'kanban'];

/** Is this view one `toViewConfig` describes? Narrows `CollectionState.activeView`. */
export function isItemViewMode(view: unknown): view is ItemViewMode {
  return (ITEM_VIEW_MODES as readonly unknown[]).includes(view);
}

/** One field as an item view shows it. */
export interface ViewFieldConfig {
  /** Field key (the item property to read). */
  name: string;
  /** Display label. */
  label: string;
  /** Zod type (`'string'`, `'enum'`, `'array'`...), for picking a cell renderer. */
  zodType: string;
  /** Display format hint (`'currency'`, `'image'`...). */
  displayFormat?: string;
  /** Enum value to badge variant. */
  badge?: Record<string, string>;
  /** Max characters before truncation. */
  truncate?: number;
  /** The value may be a `ContentRef` (a content-role field). */
  isContentRef?: boolean;
  /** The closed vocabulary (value to label), when there is one: a badge shows the label. */
  options?: VocabularyOption[];
}

/** The fields an item shows, by role. */
export interface ViewFieldRoles {
  /** The item's name: the collection's `labelField`. */
  label: ViewFieldConfig | null;
  /** The item's picture (a thumbnail in a list row, the card's cover in a grid). */
  image: ViewFieldConfig | null;
  /** Short categorical values drawn as badges (enums, booleans, closed-vocabulary tags). */
  badges: ViewFieldConfig[];
  /** Other values, drawn as secondary text, in order. */
  secondary: ViewFieldConfig[];
}

/**
 * How to group by a field that holds several values (an array or a set of tags):
 * - `'duplicate'`: the item appears in the group of each of its values;
 * - `'primary'`: the item appears only in the group of its first value;
 * - `'forbid'`: grouping by a multi-valued field is an error (`toViewConfig` throws).
 */
export type MultiValueGrouping = 'duplicate' | 'primary' | 'forbid';

/** The group field and its collapse policy. */
export interface ViewGroupConfig {
  /** The field whose values name the groups. */
  field: string;
  /** Its display label. */
  label: string;
  /** Can a person collapse and expand a group? */
  collapsible: boolean;
  /** How a group opens on a first visit (persisted choices live in `ViewState.collapsedGroups`). */
  defaultState: 'collapsed' | 'expanded';
  /** The field holds several values per item (array or set). */
  multiValued: boolean;
  /** The Zod type of one value (an array's element type): how `moveToGroup` writes a group's
   *  string value back (`'number'`, `'boolean'`, `'date'`, `'bigint'`; anything else as text). */
  valueType?: string;
  /** How an item with several values is placed (meaningful when `multiValued`). */
  multiValue: Exclude<MultiValueGrouping, 'forbid'>;
  /** The closed vocabulary, in declared order: groups are drawn in this order. Absent: open
   *  vocabulary, groups in first-seen order. */
  order?: VocabularyOption[];
}

/** An operation an item view surfaces. */
export interface ViewOperationConfig {
  /** Operation id (`'edit'`, `'delete'`, `'create'`, `'bulkDelete'`, or a declared one). */
  name: string;
  /** Button label. */
  label: string;
  /** Icon name. */
  icon?: string;
  /** Visual style. */
  variant?: OperationDefinition['variant'];
  /** Confirm before running it. */
  confirm?: boolean | OperationConfirmation;
  /** Keyboard shortcut. */
  keyboardShortcut?: string;
  /** Derived from a CRUD affordance (`update`, `delete`, `create`, `bulkDelete`), not declared. */
  builtin: boolean;
}

/** What every collection view shares: plain data, serializable. */
export interface BaseViewConfig {
  /** The field that identifies an item (keys, selection). */
  idField: string;
  /** The fields each item shows, by role. */
  fields: ViewFieldRoles;
  /** The grouping, or null for an ungrouped view. */
  group: ViewGroupConfig | null;
  /** Whether items can be selected, and how many. */
  selection: false | 'single' | 'multi';
  /** The operations to surface, by scope. */
  operations: {
    item: ViewOperationConfig[];
    selection: ViewOperationConfig[];
    collection: ViewOperationConfig[];
  };
}

/** The collection as a list of rows. */
export interface ListViewConfig extends BaseViewConfig {
  kind: 'list';
}

/** The collection as a grid of cards (a gallery). */
export interface GridViewConfig extends BaseViewConfig {
  kind: 'grid';
}

/**
 * The collection as a board: one column per value of the group field, which a kanban
 * requires. With a closed vocabulary every value is a column, empty ones included
 * (`groupItems(items, view.group, { includeEmpty: true })`); dragging a card to another
 * column is an update of the group field (`moveToGroup`).
 */
export interface KanbanViewConfig extends BaseViewConfig {
  kind: 'kanban';
  group: ViewGroupConfig;
  /** Can a card be moved between columns? False when the group field is not editable. */
  movable: boolean;
}

/** A collection view, discriminated on `kind`. */
export type ViewConfig = ListViewConfig | GridViewConfig | KanbanViewConfig;

/** Per-mode caps on how many fields an item shows. */
export interface ViewModeLimits {
  /** Max `badges`. */
  maxBadges: number;
  /** Max `secondary` fields. */
  maxSecondary: number;
}

/** The default caps: a list row has room for more text than a grid card. */
export const VIEW_MODE_LIMITS: Readonly<Record<ItemViewMode, ViewModeLimits>> = {
  list: { maxBadges: 3, maxSecondary: 3 },
  grid: { maxBadges: 3, maxSecondary: 2 },
  kanban: { maxBadges: 2, maxSecondary: 1 },
};

export interface ViewConfigOptions extends Partial<ViewModeLimits> {
  /** Explicit roles: a field key per role (`null`: no image), replacing what is inferred. */
  fields?: {
    label?: string | null;
    image?: string | null;
    badges?: string[];
    secondary?: string[];
  };
  /** Group by this field, or `null` for no grouping. Default: the collection's `groupBy`. */
  groupBy?: string | null;
  /** How to group by a multi-valued field. Default: `'duplicate'`; `'primary'` for a kanban,
   *  where one card should be one card on the board. */
  multiValue?: MultiValueGrouping;
}

// ============================================================================
// toViewConfig
// ============================================================================

/** Field names that read as a picture: `@zodal/core`'s image name heuristic, plus `cover`, minus
 *  `icon` (often an icon *name*, not a URL). Declare `displayFormat: 'image'` for anything else. */
const IMAGE_NAME = /^(image|photo|avatar|thumbnail|picture|logo|cover)(_?url)?$/i;
/** Zod types that read as a category, drawn as a badge. */
const BADGE_TYPES = new Set(['enum', 'boolean', 'literal']);
/** Zod types an item view cannot show as text. */
const UNSHOWABLE_TYPES = new Set(['object', 'record', 'map', 'function', 'custom', 'unknown', 'any']);
/** Zod types that hold several values. */
const MULTI_VALUED_TYPES = new Set(['array', 'set']);

/**
 * Describe the collection drawn as a list, a grid or a kanban board. A kanban needs a group
 * field (its columns): without one (no `groupBy` declared or passed) it throws, so check
 * `isItemViewMode(activeView)` and a group before rendering a collection that offers one.
 *
 * @example
 * ```typescript
 * const view = toViewConfig(instruments, 'grid');
 * view.fields.label?.name;   // 'name'
 * view.fields.image?.name;   // 'thumbnail'
 * view.group;                // { field: 'class', collapsible: true, defaultState: 'expanded', ... }
 * const groups = groupItems(items, view.group);
 * ```
 *
 * @param collection - the collection definition
 * @param mode - `'list'` or `'grid'` (for `'table'` use `toColumnDefs`); becomes `config.kind`
 * @param options - explicit roles, grouping and caps, overriding what is inferred
 */
export function toViewConfig<T extends z.ZodObject<any>, M extends ItemViewMode>(
  collection: CollectionDefinition<T>,
  mode: M,
  options: ViewConfigOptions = {},
): Extract<ViewConfig, { kind: M }> {
  if (!isItemViewMode(mode)) {
    const hint = mode === ('table' as string) ? ' (a table is `toColumnDefs(collection)`)' : '';
    throw new Error(`toViewConfig: mode must be one of ${ITEM_VIEW_MODES.join(', ')}, got '${String(mode)}'${hint}`);
  }
  const shape = collection.schema.shape as Record<string, z.ZodType>;
  const fa = collection.fieldAffordances;
  const known = (key: string, role: string): string => {
    if (!(key in shape)) {
      throw new Error(`toViewConfig: ${role} field '${key}' is not a field of the collection (fields: ${Object.keys(shape).join(', ')})`);
    }
    return key;
  };
  const limits = { ...VIEW_MODE_LIMITS[mode], ...pickDefined(options, ['maxBadges', 'maxSecondary']) };

  const group = resolveGroup(collection, mode === 'kanban' ? { ...options, multiValue: options.multiValue ?? 'primary' } : options, known);
  if (mode === 'kanban' && !group) {
    throw new Error(
      `toViewConfig: a kanban needs a group field (its columns); declare affordances.groupBy or pass { groupBy: '<field>' }`,
    );
  }
  const roles = resolveRoles(collection, options.fields ?? {}, { known, limits, groupField: group?.field });

  const fc = (k: string) => fieldConfig(k, fa[k], shape[k]);
  const config: BaseViewConfig & { kind: ItemViewMode } = {
    kind: mode,
    idField: collection.idField,
    fields: {
      label: roles.label === null ? null : fc(roles.label),
      image: roles.image === null ? null : fc(roles.image),
      badges: roles.badges.map(fc),
      secondary: roles.secondary.map(fc),
    },
    group,
    selection: resolveSelection(collection.affordances.selectable),
    operations: resolveOperations(collection),
  };
  if (mode === 'kanban') (config as KanbanViewConfig).movable = fa[group!.field].editable !== false && Boolean(collection.affordances.update);
  return config as Extract<ViewConfig, { kind: M }>;
}

/**
 * The views a collection offers: its declared `views`, else its `defaultView`, else `'table'`.
 * Same contract as zodal-graphs' `availableViews`: the declared lenses, in declared order.
 */
export function availableViews(collection: CollectionDefinition<any>): ViewMode[] {
  const { views, defaultView } = collection.affordances;
  if (views && views.length > 0) return [...views];
  return [defaultView ?? 'table'];
}

/** The view a collection opens on: its `defaultView` when it offers it, else its first view. */
export function initialView(collection: CollectionDefinition<any>): ViewMode {
  const offered = availableViews(collection);
  const declared = collection.affordances.defaultView;
  return declared && offered.includes(declared) ? declared : offered[0];
}

// ============================================================================
// rankViews: which views this schema can offer, and why not
// ============================================================================

/** Every view mode, in the order `rankViews` breaks ties. */
export const VIEW_MODES: readonly ViewMode[] = ['table', 'list', 'grid', 'kanban'];

/**
 * Something a view wants that the collection does not give it. A `blocking` gap makes the view
 * inapplicable (a kanban with no field to make columns of); any other gap only degrades it (a
 * grid with no picture field draws text-only cards).
 */
export interface ViewGap {
  /** Stable id (`'groupField'`, `'imageField'`...), for code that reacts to a gap. */
  code: string;
  /** One sentence for a person. */
  reason: string;
  blocking: boolean;
}

/** One tester's verdict on one view of one collection. */
export interface ViewAssessment {
  /** How well the view fits (higher is better). Compared across views, so a tester that adds a
   *  view should stay on the scale of `VIEW_FIT`. */
  score: number;
  /** Why it fits, one sentence each. */
  reasons: string[];
  /** Why it does not, or fits less well. */
  gaps: ViewGap[];
  /** Options to pass to `toViewConfig` for this view (a kanban's inferred `groupBy`). */
  options?: ViewConfigOptions;
}

/** Judges one view against a collection. Must be pure. */
export type ViewTester = (collection: CollectionDefinition<any>) => ViewAssessment;

/** One row of `rankViews`. */
export interface ViewApplicability extends ViewAssessment {
  view: ViewMode;
  /** No blocking gap. */
  applicable: boolean;
  /** The collection declares this view (`availableViews`). */
  declared: boolean;
}

/** The score scale the default testers use: a fallback that works, a good fit, a strong fit. */
export const VIEW_FIT = { none: 0, fallback: 1, good: 2, strong: 3 } as const;

const tableTester: ViewTester = () => ({
  score: VIEW_FIT.fallback,
  reasons: ['every collection can be drawn as a table'],
  gaps: [],
});

const listTester: ViewTester = (collection) => {
  const { label } = toViewConfig(collection, 'list', { groupBy: null }).fields;
  return label
    ? { score: VIEW_FIT.good, reasons: [`each row is named by '${label.name}'`], gaps: [] }
    : {
        score: VIEW_FIT.fallback,
        reasons: [],
        gaps: [{ code: 'labelField', reason: 'no showable label field to name each row', blocking: false }],
      };
};

const gridTester: ViewTester = (collection) => {
  const { image } = toViewConfig(collection, 'grid', { groupBy: null }).fields;
  return image
    ? { score: VIEW_FIT.strong, reasons: [`'${image.name}' gives each card a picture`], gaps: [] }
    : {
        score: VIEW_FIT.fallback,
        reasons: [],
        gaps: [{ code: 'imageField', reason: 'no picture field, so cards would be text only', blocking: false }],
      };
};

const kanbanTester: ViewTester = (collection) => {
  const shape = collection.schema.shape as Record<string, z.ZodType>;
  const closed = (field: string) => getVocabularyEntries(shape[field]) !== null;
  const declared = collection.affordances.groupBy
    ? (toViewConfig(collection, 'list').group?.field ?? null)
    : null;
  if (declared !== null) {
    return closed(declared)
      ? { score: VIEW_FIT.strong, reasons: [`columns are the values of '${declared}'`], gaps: [] }
      : {
          score: VIEW_FIT.good,
          reasons: [`columns are the values of '${declared}'`],
          gaps: [{ code: 'closedVocabulary', reason: `'${declared}' has an open vocabulary: columns are the values present, and an empty column cannot be shown`, blocking: false }],
        };
  }
  const candidate = collection.getGroupableFields().map((f) => f.key).find(closed);
  if (candidate) {
    return {
      score: VIEW_FIT.good,
      reasons: [`'${candidate}' has a closed vocabulary to make columns of (groupBy is not declared)`],
      gaps: [],
      options: { groupBy: candidate },
    };
  }
  return {
    score: VIEW_FIT.none,
    reasons: [],
    gaps: [{ code: 'groupField', reason: 'no groupable field with a closed vocabulary to make columns of; declare affordances.groupBy', blocking: true }],
  };
};

/** The built-in testers, one per view mode. Spread and override to change one or add a view. */
export const DEFAULT_VIEW_TESTERS: Readonly<Record<ViewMode, ViewTester>> = {
  table: tableTester,
  list: listTester,
  grid: gridTester,
  kanban: kanbanTester,
};

export interface RankViewsOptions {
  /** One tester per view to rank. Default: `DEFAULT_VIEW_TESTERS`. */
  testers?: Partial<Record<ViewMode, ViewTester>>;
}

/**
 * Which views this collection's schema can offer, best first, each with the reasons it fits and
 * the gaps that degrade or block it. Unlike `availableViews` (the declared views), this reads the
 * schema: a kanban needs a groupable field with a closed vocabulary, a grid prefers a picture
 * field. Ranked applicable first, then by score, then declared views first, then `VIEW_MODES`
 * order.
 *
 * @example
 * ```typescript
 * rankViews(tasks).filter((v) => v.applicable).map((v) => v.view); // ['kanban', 'list', 'table', 'grid']
 * rankViews(notes).find((v) => v.view === 'kanban')?.gaps[0].reason;
 * // "no groupable field with a closed vocabulary to make columns of; declare affordances.groupBy"
 * const best = rankViews(tasks)[0];
 * if (isItemViewMode(best.view)) toViewConfig(tasks, best.view, best.options);
 * ```
 */
export function rankViews(collection: CollectionDefinition<any>, options: RankViewsOptions = {}): ViewApplicability[] {
  const testers = options.testers ?? DEFAULT_VIEW_TESTERS;
  const declared = availableViews(collection);
  const order = (view: ViewMode) => {
    const i = VIEW_MODES.indexOf(view);
    return i === -1 ? VIEW_MODES.length : i;
  };
  return (Object.entries(testers) as [ViewMode, ViewTester | undefined][])
    .filter((entry): entry is [ViewMode, ViewTester] => typeof entry[1] === 'function')
    .map(([view, tester]) => {
      const assessment = tester(collection);
      return {
        view,
        ...assessment,
        applicable: !assessment.gaps.some((g) => g.blocking),
        declared: declared.includes(view),
      };
    })
    .sort(
      (a, b) =>
        Number(b.applicable) - Number(a.applicable) ||
        b.score - a.score ||
        Number(b.declared) - Number(a.declared) ||
        order(a.view) - order(b.view),
    );
}

// ============================================================================
// groupItems
// ============================================================================

/**
 * A group's id: the group field and the value, so a collapsed `class:strings` stays apart from
 * an `owner:strings` when the group field changes. `value === null`: the items with no value.
 */
export function groupId(field: string, value: string | null): string {
  return value === null ? `${field}:` : `${field}:${value}`;
}

/** One group of items, as a renderer draws it. */
export interface ItemGroup<T> {
  /** Stable id (`groupId(field, value)`; `''` for the single group of an ungrouped view): what
   *  `ViewState.collapsedGroups` / `expandedGroups` hold. */
  id: string;
  /** `'value'`: items sharing a value; `'none'`: items with no value; `'all'`: an ungrouped
   *  view's single group (draw no header). */
  kind: 'value' | 'none' | 'all';
  /** The group's value as a string (null for `'none'` and `'all'`). */
  value: string | null;
  /** Header text. */
  label: string;
  /** The items in the group, in input order. With `multiValue: 'duplicate'` an item can be in
   *  several groups: key rendered items by group id and item id together. */
  items: T[];
  /** Is the group collapsed now? */
  collapsed: boolean;
}

export interface GroupItemsOptions {
  /** Ids of the groups a person collapsed (`ViewState.collapsedGroups`): always collapsed. */
  collapsedGroups?: readonly string[];
  /** Ids of the groups a person expanded (`ViewState.expandedGroups`): expanded unless also in
   *  `collapsedGroups`. Any other group follows the config's `defaultState`. */
  expandedGroups?: readonly string[];
  /** Header of the group of items with no value. Default: `'None'`. */
  emptyLabel?: string;
  /** Draw every value of a closed vocabulary, empty groups included, and the no-value group
   *  (a kanban's columns, each a drop target). Default: `false`, empty groups are omitted. */
  includeEmpty?: boolean;
}

/**
 * Bucket items into the ordered groups a view draws. With no group config, one group
 * (`kind: 'all'`) holds every item. Groups follow the closed vocabulary's order when there is
 * one (empty groups omitted, values outside it after), else first-seen order; the group of
 * items with no value comes last.
 */
export function groupItems<T>(
  items: readonly T[],
  group: ViewGroupConfig | null,
  { collapsedGroups = [], expandedGroups = [], emptyLabel = 'None', includeEmpty = false }: GroupItemsOptions = {},
): ItemGroup<T>[] {
  if (!group) return [{ id: '', kind: 'all', value: null, label: '', items: [...items], collapsed: false }];
  const isCollapsed = (id: string): boolean =>
    group.collapsible &&
    (collapsedGroups.includes(id) || (!expandedGroups.includes(id) && group.defaultState === 'collapsed'));
  const labels = new Map((group.order ?? []).map((o) => [o.value, o.label]));
  const buckets = new Map<string | null, T[]>();
  const add = (value: string | null, item: T) => {
    const bucket = buckets.get(value);
    if (bucket) bucket.push(item);
    else buckets.set(value, [item]);
  };
  for (const item of items) {
    const raw = (item as Record<string, unknown>)?.[group.field];
    const values = groupValues(raw, group);
    if (values.length === 0) add(null, item);
    for (const v of values) add(v, item);
  }
  if (includeEmpty) for (const o of group.order ?? []) if (!buckets.has(o.value)) buckets.set(o.value, []);
  const values = [...buckets.keys()].filter((v): v is string => v !== null);
  if (group.order) {
    // Values outside the vocabulary (stale data) rank after it, keeping first-seen order (stable sort).
    const rank = new Map(group.order.map((o, i) => [o.value, i]));
    const outside = group.order.length;
    values.sort((a, b) => (rank.get(a) ?? outside) - (rank.get(b) ?? outside));
  }
  const out: ItemGroup<T>[] = values.map((value) => {
    const id = groupId(group.field, value);
    return { id, kind: 'value', value, label: labels.get(value) ?? value, items: buckets.get(value)!, collapsed: isCollapsed(id) };
  });
  if (buckets.has(null) || (includeEmpty && group.order)) {
    const id = groupId(group.field, null);
    out.push({ id, kind: 'none', value: null, label: emptyLabel, items: buckets.get(null) ?? [], collapsed: isCollapsed(id) });
  }
  return out;
}

/**
 * The update that moves an item from one group to another (a kanban card dragged between
 * columns), for `DataProvider.update(id, patch)`. A single-valued field is set to `to`; a
 * multi-valued one gets `from` replaced by `to` (to the no-value group: emptied). The group's
 * string value is written back as the field's type (`group.order`'s raw value, else by
 * `group.valueType`). Returns `{}` when there is nothing to change.
 */
export function moveToGroup(
  item: Record<string, unknown>,
  group: ViewGroupConfig,
  from: string | null,
  to: string | null,
): Record<string, unknown> {
  if (from === to) return {};
  const rawOf = (v: string | null): unknown => {
    if (v === null) return null;
    const option = group.order?.find((o) => o.value === v);
    if (option) return option.raw !== undefined ? option.raw : v;
    switch (group.valueType) {
      case 'number': return Number(v);
      case 'boolean': return v === 'true';
      case 'bigint': return BigInt(v);
      case 'date': return new Date(v);
      default: return v;
    }
  };
  if (!group.multiValued) return { [group.field]: rawOf(to) };
  const current = item[group.field];
  const list = current instanceof Set || Array.isArray(current) ? [...current] : [];
  let next: unknown[];
  if (to === null) next = [];
  else {
    const kept = list.filter((v) => from === null || groupValueOf(v) !== from);
    next = kept.some((v) => groupValueOf(v) === to) ? kept : [rawOf(to), ...kept];
  }
  return { [group.field]: current instanceof Set ? new Set(next) : next };
}

/** A value as a group key: what `groupItems` buckets by (`null`: no value). */
function groupValueOf(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

/** The element schema of an array or set field. */
function elementOf(schema: z.ZodType): z.ZodType {
  const def = (unwrapZodSchema(schema) as any)._zod?.def;
  return def?.element ?? def?.valueType ?? schema;
}

/** The group values an item belongs to (empty: the no-value group). */
function groupValues(raw: unknown, group: ViewGroupConfig): string[] {
  const asValue = groupValueOf;
  if (raw instanceof Set || Array.isArray(raw)) {
    const unique = [...new Set([...raw].map(asValue).filter((v): v is string => v !== null))];
    return group.multiValue === 'primary' ? unique.slice(0, 1) : unique;
  }
  const value = asValue(raw);
  return value === null ? [] : [value];
}

// ============================================================================
// Internals
// ============================================================================

type Known = (key: string, role: string) => string;

function pickDefined<O extends object, K extends keyof O>(o: O, keys: K[]): Partial<Pick<O, K>> {
  const out: Partial<Pick<O, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function fieldConfig(name: string, fa: ResolvedFieldAffordance, schema: z.ZodType | undefined): ViewFieldConfig {
  const out: ViewFieldConfig = { name, label: fa.title, zodType: fa.zodType };
  const vocabulary = schema ? getVocabularyEntries(schema) : null;
  if (vocabulary) out.options = vocabulary.map(toOption);
  if (fa.displayFormat !== undefined) out.displayFormat = fa.displayFormat;
  if (fa.badge !== undefined) out.badge = fa.badge;
  if (fa.truncate !== undefined) out.truncate = fa.truncate;
  if (fa.storageRole === 'content') out.isContentRef = true;
  return out;
}

/** A field an item view may show: the rule of `getVisibleFields()`, and readable. */
const showable = (fa: ResolvedFieldAffordance): boolean =>
  fa.visible !== false && !fa.hidden && !fa.detailOnly && fa.readable !== false;

function isImageField(key: string, fa: ResolvedFieldAffordance): boolean {
  if (fa.displayFormat === 'image' || fa.editWidget === 'image') return true;
  return IMAGE_NAME.test(key) && (fa.zodType === 'string' || fa.storageRole === 'content');
}

function isBadgeField(key: string, fa: ResolvedFieldAffordance, shape: Record<string, z.ZodType>): boolean {
  if (fa.badge) return true;
  if (BADGE_TYPES.has(fa.zodType)) return true;
  // Tags: a collection field with a closed vocabulary.
  return MULTI_VALUED_TYPES.has(fa.zodType) && getVocabularyEntries(shape[key]) !== null;
}

function resolveRoles(
  collection: CollectionDefinition<any>,
  explicit: NonNullable<ViewConfigOptions['fields']>,
  { known, limits, groupField }: { known: Known; limits: ViewModeLimits; groupField?: string },
): { label: string | null; image: string | null; badges: string[]; secondary: string[] } {
  const fa = collection.fieldAffordances;
  const shape = collection.schema.shape as Record<string, z.ZodType>;

  const label =
    explicit.label !== undefined
      ? explicit.label === null ? null : known(explicit.label, 'label')
      : collection.labelField in shape && showable(fa[collection.labelField]) ? collection.labelField : null;

  const image =
    explicit.image !== undefined
      ? explicit.image === null ? null : known(explicit.image, 'image')
      : (collection.getVisibleFields().find((k) => k !== label && showable(fa[k]) && isImageField(k, fa[k])) ?? null);

  // Explicit badges and secondary fields are taken as given; inferred ones come from the
  // visible fields, minus those shown in another role (explicit ones included), the group field
  // (its value is the group's header), the id, content fields and other picture fields.
  const taken = new Set(
    [label, image, groupField, collection.idField, ...(explicit.badges ?? []), ...(explicit.secondary ?? [])]
      .filter((k): k is string => !!k),
  );
  const rest = collection
    .getVisibleFields()
    .filter((k) => !taken.has(k) && showable(fa[k]) && fa[k].storageRole !== 'content' && !isImageField(k, fa[k]));

  const badgeLike = rest.filter((k) => isBadgeField(k, fa[k], shape));
  const badges = explicit.badges
    ? explicit.badges.map((k) => known(k, 'badge'))
    : badgeLike.slice(0, limits.maxBadges);

  let secondary: string[];
  if (explicit.secondary) {
    secondary = explicit.secondary.map((k) => known(k, 'secondary'));
  } else {
    // Badge-like fields past the badge cap fall back to secondary text rather than vanish.
    const candidates = rest.filter((k) => !badges.includes(k) && !UNSHOWABLE_TYPES.has(fa[k].zodType));
    // Fields declared `summaryField` come first; the rest follow in field order.
    const summary = candidates.filter((k) => fa[k].summaryField);
    const others = candidates.filter((k) => !fa[k].summaryField);
    secondary = [...summary, ...others].slice(0, limits.maxSecondary);
  }
  return { label, image, badges, secondary };
}

function resolveGroup(
  collection: CollectionDefinition<any>,
  options: ViewConfigOptions,
  known: Known,
): ViewGroupConfig | null {
  const declared = collection.affordances.groupBy as boolean | GroupByConfig | undefined;
  const config: GroupByConfig = typeof declared === 'object' ? declared : {};
  let field: string | null;
  if (options.groupBy !== undefined) {
    field = options.groupBy === null ? null : known(options.groupBy, 'groupBy');
  } else if (!declared) {
    field = null;
  } else {
    // `groupBy: true` with no default field: the first groupable field.
    field = config.defaultField ?? collection.getGroupableFields()[0]?.key ?? null;
    if (field !== null) known(field, 'groupBy.defaultField');
  }
  if (field === null) return null;

  const fa = collection.fieldAffordances[field];
  const multiValued = MULTI_VALUED_TYPES.has(fa.zodType);
  const policy = options.multiValue ?? 'duplicate';
  if (multiValued && policy === 'forbid') {
    throw new Error(`toViewConfig: '${field}' holds several values and multiValue is 'forbid'; pick 'duplicate' or 'primary', or group by another field`);
  }
  const fieldSchema = (collection.schema.shape as Record<string, z.ZodType>)[field];
  const vocabulary = getVocabularyEntries(fieldSchema);
  const group: ViewGroupConfig = {
    field,
    label: fa.title,
    collapsible: config.collapsible ?? true,
    defaultState: config.defaultState ?? 'expanded',
    multiValued,
    multiValue: policy === 'primary' ? 'primary' : 'duplicate',
    valueType: getZodBaseType(multiValued ? elementOf(fieldSchema) : fieldSchema),
  };
  if (vocabulary) group.order = vocabulary.map(toOption);
  return group;
}

function resolveSelection(selectable: unknown): ViewConfig['selection'] {
  if (selectable === 'single' || selectable === 'multi') return selectable;
  return selectable ? 'multi' : false;
}

function fromDefinition(op: OperationDefinition): ViewOperationConfig {
  const out: ViewOperationConfig = { name: op.name, label: op.label, builtin: false };
  if (op.icon !== undefined) out.icon = op.icon;
  if (op.variant !== undefined) out.variant = op.variant;
  if (op.confirm !== undefined) out.confirm = op.confirm;
  if (op.keyboardShortcut !== undefined) out.keyboardShortcut = op.keyboardShortcut;
  return out;
}

function resolveOperations(collection: CollectionDefinition<any>): ViewConfig['operations'] {
  const a = collection.affordances;
  const builtin = (name: string, label: string, extra: Partial<ViewOperationConfig> = {}): ViewOperationConfig =>
    ({ name, label, builtin: true, ...extra });
  const declared = (scope: 'item' | 'selection' | 'collection') => collection.getOperations(scope).map(fromDefinition);
  const item = [
    ...(a.update ? [builtin('edit', 'Edit')] : []),
    ...(a.delete ? [builtin('delete', 'Delete', { variant: 'destructive', confirm: true })] : []),
    ...declared('item'),
  ];
  const selection = a.selectable
    ? [...(a.bulkDelete && a.delete ? [builtin('bulkDelete', 'Delete selected', { variant: 'destructive', confirm: true })] : []), ...declared('selection')]
    : [];
  const collectionOps = [...(a.create ? [builtin('create', 'New')] : []), ...declared('collection')];
  // A declared operation with a built-in's name replaces the built-in, in the built-in's place.
  const dedupe = (ops: ViewOperationConfig[]) => {
    const declaredByName = new Map(ops.filter((o) => !o.builtin).map((o) => [o.name, o]));
    const replaced = new Set<string>();
    const out: ViewOperationConfig[] = [];
    for (const op of ops) {
      if (op.builtin && declaredByName.has(op.name)) {
        out.push(declaredByName.get(op.name)!);
        replaced.add(op.name);
      } else if (op.builtin || !replaced.has(op.name)) {
        out.push(op);
      }
    }
    return out;
  };
  return { item: dedupe(item), selection: dedupe(selection), collection: dedupe(collectionOps) };
}
