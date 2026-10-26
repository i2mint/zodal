// @zodal/core — Schema types, affordance inference, and defineCollection

// Types
export type {
  // Field-level
  SortDirection,
  FilterType,
  AggregationFn,
  FieldAffordance,
  FieldStorageRole,
  ContentRef,
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

export { isContentRef } from './types.js';
export type { ChoiceArity } from './types.js';

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
  isZodReadonly,
  hasZodCheck,
  getEnumValues,
  getVocabulary,
  getVocabularyEntries,
  getChoiceArity,
  getZodMeta,
  getNumericBounds,
  getNumericStep,
  humanizeFieldName,
} from './inference.js';

// Zod wrapper peeling (one wrapper list for inference, secrets and descriptors)
export { ZOD_WRAPPER_TYPES, peelZodWrapper } from './zod-unwrap.js';
export type { PeelZodWrapperOptions } from './zod-unwrap.js';

// Codec types
export type { Codec } from './codec-types.js';
export type { VocabularyEntry, NumericBounds } from './inference.js';
export {
  composeCodecs,
  identityCodec,
  createCodec,
  dateIsoCodec,
  dateEpochCodec,
  dateEpochMsCodec,
  jsonCodec,
} from './codec-types.js';

// Operations as commands (acture-shaped, no acture dependency)
export { toCommandRecord, ok, fail, operationCommandId, normalizeKeybinding } from './commands.js';
export type {
  OperationCommand,
  OperationCommandResult,
  OperationCommandError,
  OperationPatch,
  OperationEffect,
  ToCommandOptions,
} from './commands.js';

// Sensitivity: where secrets are in a schema, and how to keep them out of output
export {
  isSecretName,
  isMarkedSecret,
  isMarkedPublic,
  hasDefault,
  secretPaths,
  inspectSecrets,
  redact,
  secretValues,
  scrubSecrets,
  REDACTED,
  SchemaIntrospectionError,
} from './sensitivity.js';
export type { SecretPath, SecretInspection } from './sensitivity.js';
