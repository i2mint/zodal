// @zodal/ui — Generators, state management, renderer registry, prompt, codegen

// Column definition generator
export { toColumnDefs } from './generators/column-defs.js';
export type { ColumnConfig } from './generators/column-defs.js';

// Form configuration generator
export { toFormConfig } from './generators/form-config.js';
export type { FormFieldConfig } from './generators/form-config.js';

// Filter configuration generator
export { toFilterConfig } from './generators/filter-config.js';
export type { FilterFieldConfig } from './generators/filter-config.js';

// State management
export { createCollectionStore } from './state/store.js';
export type {
  CollectionState,
  CollectionActions,
  CollectionStore,
} from './state/store.js';

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
  and,
  or,
} from './registry/tester.js';
export type {
  RendererTester,
  RendererEntry,
  RendererContext,
} from './registry/tester.js';

// AI prompt generator
export { toPrompt } from './prompt.js';

// Code generation
export { toCode, writeIfChanged, generateAndWrite } from './codegen.js';
export type { CodegenOptions, WriteResult } from './codegen.js';
