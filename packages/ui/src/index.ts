// @zodal/ui — Generators, state management, renderer registry, prompt, codegen

// Re-export the core types every UI consumer needs alongside the generators.
// Without these, app code that uses `toFormConfig`, `toColumnDefs`, or
// `RendererRegistry.resolve()` has to import from both `@zodal/core` and
// `@zodal/ui` just to type the values it's already passing in.
export type {
  CollectionDefinition,
  CollectionConfig,
  FieldAffordance,
  ResolvedFieldAffordance,
} from '@zodal/core';

// Column definition generator
export { toColumnDefs } from './generators/column-defs.js';
export type { ColumnConfig } from './generators/column-defs.js';

// Form configuration generator
export { toFormConfig } from './generators/form-config.js';
export type { FormFieldConfig, VocabularyOption } from './generators/form-config.js';
export { toOptionsFormConfig } from './generators/options-form-config.js';
export type { OptionsFormField, OptionsFormConfigOptions } from './generators/options-form-config.js';

// Filter configuration generator
export { toFilterConfig } from './generators/filter-config.js';
export type { FilterFieldConfig } from './generators/filter-config.js';

// Collection view generator (list / grid / kanban, grouped and collapsible) and view ranking
export {
  toViewConfig,
  groupItems,
  moveToGroup,
  availableViews,
  initialView,
  isItemViewMode,
  groupId,
  ITEM_VIEW_MODES,
  VIEW_MODE_LIMITS,
  rankViews,
  VIEW_MODES,
  VIEW_FIT,
  DEFAULT_VIEW_TESTERS,
} from './generators/view-config.js';
export type {
  ViewConfig,
  BaseViewConfig,
  ListViewConfig,
  GridViewConfig,
  KanbanViewConfig,
  ViewConfigOptions,
  ViewGap,
  ViewAssessment,
  ViewTester,
  ViewApplicability,
  RankViewsOptions,
  ViewFieldConfig,
  ViewFieldRoles,
  ViewGroupConfig,
  ViewOperationConfig,
  ViewModeLimits,
  ItemViewMode,
  MultiValueGrouping,
  ItemGroup,
  GroupItemsOptions,
} from './generators/view-config.js';

// State management
export { createCollectionStore } from './state/store.js';
export type {
  CollectionState,
  CollectionActions,
  CollectionStore,
} from './state/store.js';

// Persisted view state (view mode, collapsed groups, sort, search, filters)
export { ViewStateSchema, SavedViewSchema, VIEW_FIELDS, createViewStateStore, defaultViewState } from './state/view-state.js';
export type {
  ViewState,
  ViewStateFields,
  ViewFields,
  SavedView,
  ViewStateProvider,
  ViewStateStore,
  ViewStateStoreOptions,
  HydrateOptions,
} from './state/view-state.js';

// Zustand adapter
export { createZustandStoreSlice } from './state/zustand.js';
export type { BoundCollectionActions, ZustandCollectionState } from './state/zustand.js';

// State slices
export {
  createSortingSlice,
  createFilterSlice,
  createPaginationSlice,
  createSelectionSlice,
  createColumnSlice,
} from './state/slices.js';
export type {
  SortingSlice, SortingSliceState, SortingSliceActions,
  FilterSlice, FilterSliceState, FilterSliceActions,
  PaginationSlice, PaginationSliceState, PaginationSliceActions,
  SelectionSlice, SelectionSliceState, SelectionSliceActions,
  ColumnSlice, ColumnSliceState, ColumnSliceActions,
} from './state/slices.js';

// Renderer registry
export { createRendererRegistry } from './registry/registry.js';
export type { RendererRegistry } from './registry/registry.js';

// Renderer tester predicates
export {
  PRIORITY,
  zodTypeIs,
  hasRefinement,
  fieldNameMatches,
  metaMatches,
  editWidgetIs,
  storageRoleIs,
  and,
  or,
} from './registry/tester.js';
export type {
  RendererTester,
  RendererEntry,
  RendererContext,
  Suggestion,
  SuggestionSource,
  SuggestOptions,
  FieldRenderProps,
  FieldBinding,
  FilterFieldProps,
} from './registry/tester.js';

// Tag widget logic (framework-free; renderers draw their tag input, chip filter and chip cell over it)
export {
  DEFAULT_TAG_MESSAGES,
  DEFAULT_TAG_SETTINGS,
  resolveTagSettings,
  tagKey,
  toValueList,
  optionRaw,
  findOption,
  labelOf,
  matchOptions,
  resolveDraft,
  resolveChoice,
  splitTags,
  suggestionToOption,
  toContainsFilter,
  fromContainsFilter,
  createSuggestionController,
} from './tag-logic.js';
export type {
  TagMessages,
  TagSettings,
  TagValue,
  TagOption,
  DraftResolution,
  SuggestionState,
  SuggestionController,
} from './tag-logic.js';

// AI prompt generator
export { toPrompt } from './prompt.js';

// Code generation (pure, no Node.js deps — for Node.js file I/O use '@zodal/ui/node')
export { toCode } from './codegen.js';
export type { CodegenOptions, WriteResult } from './codegen.js';
