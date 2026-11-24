// @zodal/core — Schema types, affordance inference, and defineCollection

// Types
export type {
  // Field-level
  SortDirection,
  FilterType,
  AggregationFn,
  FieldAffordance,
  WidgetOptions,
  ChoiceOption,
  ChoiceData,
  FieldStorageRole,
  ContentRef,
  FieldHistorySpec,
  ResolvedFieldHistory,
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
  OperationUndo,
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

// Hand order (moves as data, for a collection the user orders by hand)
export {
  moveItem,
  moveUp,
  moveDown,
  canMoveUp,
  canMoveDown,
  insertItem,
  removeItem,
  undoRemove,
  restoreOrder,
  orderOf,
  withPositions,
  changedPositions,
} from './order.js';
export type { IdOf, Removal } from './order.js';

// Item keys (which field identifies an item; canonical serialization; detection on samples)
export {
  resolveKey,
  detectKey,
  scoreKey,
  keyOf,
  canonicalKey,
  normalizeKeyPart,
  parsePath,
  getPath,
  keyPaths,
  KEY_PRIORITY,
  SCHEMA_ID_NAMES,
} from './keys.js';
export type {
  KeySpec,
  KeySource,
  KeyResolution,
  ResolveKeyOptions,
  KeyCandidate,
  KeySuspect,
  KeyReport,
  DetectKeyOptions,
} from './keys.js';

// Affordance registry
export { affordanceRegistry, createAffordanceRegistry } from './registry.js';
export type { AffordanceRegistry } from './registry.js';

// Inference utilities
export {
  inferFieldAffordances,
  inferFieldAffordancesWithTrace,
  getZodBaseType,
  getStringFormat,
  unwrapZodSchema,
  isZodReadonly,
  hasZodCheck,
  getEnumValues,
  getVocabulary,
  getVocabularyEntries,
  getChoiceArity,
  getFieldChoices,
  getZodMeta,
  getNumericBounds,
  getNumericStep,
  getStringLength,
  getDateBounds,
  humanizeFieldName,
  isPlainObject,
} from './inference.js';

// Zod wrapper peeling (one wrapper list for inference, secrets and descriptors)
export { ZOD_WRAPPER_TYPES, peelZodWrapper, zodPipeKind } from './zod-unwrap.js';
export type { PeelZodWrapperOptions } from './zod-unwrap.js';

// Codec types
export type { Codec } from './codec-types.js';
export type { VocabularyEntry, FieldChoice, NumericBounds, StringLength } from './inference.js';
export {
  composeCodecs,
  identityCodec,
  createCodec,
  dateIsoCodec,
  dateEpochCodec,
  dateEpochMsCodec,
  jsonCodec,
} from './codec-types.js';

// Field input history and sticky fields (the shared defaults and checks)
export { DEFAULT_HISTORY_MAX, resolveFieldHistory, inferSticky, checkHistoryText, contentStartsOver, ISO_DATE_FORMATS } from './field-history.js';
export type { FieldHistoryStore, HistoryEntry, HistoryReason, StickyContext } from './field-history.js';

// Operation semantics (how long to offer Undo)
export { undoSeconds } from './operations.js';

// Operations as commands (acture-shaped, no acture dependency)
export { toCommandRecord, ok, fail, operationCommandId, operationDispatcher, normalizeKeybinding } from './commands.js';
export type {
  OperationCommand,
  OperationCommandResult,
  CommandExecutor,
  OperationDispatcherOptions,
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

// Views, selection and collections: one model (zodal#154; resolvers are in @zodal/store)
export {
  FILTER_OPERATORS,
  FilterExpressionSchema,
  QuerySchema,
  SelectionSchema,
  SortKeySchema,
  OrderingSchema,
  MembershipSchema,
  EMPTY_SELECTION,
  selectIds,
  selectMatching,
  isSelectionEmpty,
  isSelected,
  toggleSelected,
  setSelected,
  selectRange,
  forgetSelected,
  compareSortKeys,
  applyOrdering,
  filterConditions,
  missingFieldClauses,
} from './views.js';
export type { ItemId, Query, Selection, SortKey, Ordering, Membership, OrderingOptions, MissingFieldClause } from './views.js';
