// @zodal/core — Schema types, affordance inference, and defineCollection

// Types
export type {
  // Field-level
  SortDirection,
  FilterType,
  AggregationFn,
  FieldAffordance,
  // Collection-level
  PaginationConfig,
  SearchConfig,
  MultiSortConfig,
  GroupByConfig,
  FilterPreset,
  ViewMode,
  CollectionAffordances,
  // Operations
  OperationScope,
  OperationConfirmation,
  OperationDefinition,
  // Config
  CollectionConfig,
  // Resolved
  ResolvedFieldAffordance,
  ResolvedCollectionAffordances,
  // Shared state types
  SortingState,
  ColumnFilter,
  PaginationState,
  // Filter expressions
  FilterOperator,
  FilterCondition,
  FilterExpression,
  // Inference trace
  InferenceStep,
  InferenceTrace,
} from './types.js';

// Collection definition
export { defineCollection } from './collection.js';
export type { CollectionDefinition } from './collection.js';

// Affordance registry
export { affordanceRegistry, createAffordanceRegistry } from './registry.js';
export type { AffordanceRegistry } from './registry.js';

// Inference utilities
export {
  inferFieldAffordances,
  inferFieldAffordancesWithTrace,
  getZodBaseType,
  unwrapZodSchema,
  hasZodCheck,
  getEnumValues,
  getZodMeta,
  getNumericBounds,
  humanizeFieldName,
} from './inference.js';

// Codec types
export type { Codec } from './codec-types.js';
export {
  composeCodecs,
  identityCodec,
  createCodec,
  dateIsoCodec,
  dateEpochCodec,
  dateEpochMsCodec,
  jsonCodec,
} from './codec-types.js';
