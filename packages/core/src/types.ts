/**
 * Collection Affordance Schema — Core Types
 *
 * Defines the vocabulary for declaring what operations a collection of typed items
 * supports, both at the collection level and per-field level.
 *
 * Terminology (following Gibson/Norman affordance theory):
 * - Affordance: a declared capability (what the system CAN do)
 * - Signifier: a UI element that communicates an affordance (what the user SEES)
 * - Collection: a typed, queryable set of items
 * - Item: a single member of a collection
 * - Field: a named property of an item's type
 * - Operation: a concrete action invokable on items/selection/collection
 */

// ============================================================================
// Field-Level Affordances
// ============================================================================

/** How a field can be sorted */
export type SortDirection = 'asc' | 'desc' | 'both' | 'none';

/** What kind of filter UI is appropriate for a field */
export type FilterType =
  | 'exact'        // Dropdown or exact-match text field (OData SingleValue)
  | 'search'       // Text search with contains/startsWith (OData SearchExpression)
  | 'select'       // Single-select from enumerated values (OData SingleValue with enum)
  | 'multiSelect'  // Multi-select from enumerated values (OData MultiValue)
  | 'range'        // Numeric/date range slider or min/max (OData SingleRange)
  | 'contains'     // Array containment — "tags contain X"
  | 'boolean'      // True/false toggle
  | 'fuzzy';       // Fuzzy text matching

/** Aggregation functions applicable to a field */
export type AggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'median' | 'uniqueCount';

/**
 * Declares what operations are meaningful on a single field of an item.
 *
 * Design principle: exclusion-based (OData pattern).
 * If not specified, defaults are inferred from the Zod type.
 */
export interface FieldAffordance {
  // --- Query capabilities (OData-inspired) ---
  /** Can items be ordered by this field? Default: inferred from type. */
  sortable?: boolean | SortDirection;
  /** Can items be narrowed by this field? Default: inferred from type. */
  filterable?: boolean | FilterType;
  /** Is this field included in full-text search? Default: true for strings. */
  searchable?: boolean;
  /** Can items be grouped by this field's values? Default: true for enums. */
  groupable?: boolean;
  /** Aggregate functions applicable to this field. Default: inferred from numeric types. */
  aggregatable?: boolean | AggregationFn[];

  // --- CRUD capabilities (Hydra-inspired) ---
  /** Is this field returned in responses? Default: true. */
  readable?: boolean;
  /** Can this field be modified? Default: inferred from field name/type. */
  editable?: boolean;
  /** Can be edited directly in the collection view (click-to-edit)? */
  inlineEditable?: boolean;
  /** Required when creating a new item (but not on update)? */
  requiredOnCreate?: boolean;
  /** Required when updating an item? */
  requiredOnUpdate?: boolean;
  /** Editable on create but read-only on update? */
  immutableAfterCreate?: boolean;

  // --- Visibility & Layout ---
  /** Whether this field appears in the collection view. Default: true. */
  visible?: boolean;
  /** Explicitly hidden (stronger than visible: false — cannot be toggled by user). */
  hidden?: boolean;
  /** Only shown in detail/edit view, never in list/table. */
  detailOnly?: boolean;
  /** Appears in compact/summary views. */
  summaryField?: boolean;
  /** Default column width in pixels. */
  columnWidth?: number;
  /** Minimum column width. */
  minWidth?: number;
  /** Maximum column width. */
  maxWidth?: number;
  /** Can the user resize this column? Default: true. */
  resizable?: boolean;
  /** Pin to left or right edge. */
  pinned?: 'left' | 'right' | false;
  /** Position in field/column order (lower = earlier). */
  order?: number;

  // --- Display ---
  /** Human-readable label for this field. Default: humanized from key. */
  title?: string;
  /** Description/help text for this field. */
  description?: string;
  /** Format string or function for display. */
  displayFormat?: string;
  /** Map enum values to badge variant names. */
  badge?: Record<string, string>;
  /** Make the value copyable with a clipboard button. */
  copyable?: boolean;
  /** Max characters before truncation. */
  truncate?: number;
  /** Show full value on hover when truncated. */
  tooltip?: boolean;

  // --- Edit widget override ---
  /** Override the default edit widget type. */
  editWidget?: string;
  /** Placeholder text for edit widget. */
  editPlaceholder?: string;
  /** Help text shown below edit widget. */
  editHelp?: string;
}

// ============================================================================
// Collection-Level Affordances
// ============================================================================

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  style?: 'pages' | 'loadMore' | 'infinite';
  serverSide?: boolean;
}

export interface SearchConfig {
  debounce?: number;
  minChars?: number;
  highlight?: boolean;
  placeholder?: string;
}

export interface MultiSortConfig {
  maxColumns?: number;
}

export interface GroupByConfig {
  defaultField?: string;
  collapsible?: boolean;
  defaultState?: 'collapsed' | 'expanded';
}

export interface FilterPreset {
  name: string;
  label: string;
  filters: Record<string, unknown>;
  icon?: string;
}

export type ViewMode = 'table' | 'grid' | 'list' | 'kanban';

/**
 * Declares what operations the collection as a whole supports.
 *
 * Design principle: opt-in for operations (create, delete, export),
 * opt-out for query capabilities (filtering, sorting default to true).
 */
export interface CollectionAffordances {
  // --- CRUD operations ---
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;

  // --- Bulk operations ---
  bulkDelete?: boolean;
  /** true = all editable fields, string[] = specific fields */
  bulkEdit?: boolean | string[];
  bulkArchive?: boolean;

  // --- Search ---
  search?: boolean | SearchConfig;

  // --- Pagination ---
  pagination?: boolean | PaginationConfig;

  // --- Sorting ---
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
  multiSort?: boolean | MultiSortConfig;

  // --- Filtering ---
  filterPanel?: boolean;
  filterPresets?: FilterPreset[];
  savedFilters?: boolean;

  // --- Grouping ---
  groupBy?: boolean | GroupByConfig;

  // --- Views ---
  defaultView?: ViewMode;
  views?: ViewMode[];
  savedViews?: boolean;

  // --- Export/Import ---
  export?: boolean | string[];
  import?: boolean | string[];

  // --- Selection ---
  selectable?: boolean | 'single' | 'multi';

  // --- Refresh ---
  refresh?: boolean;
  autoRefresh?: number;

  // --- Column configuration ---
  columnVisibility?: boolean;
  columnOrder?: boolean;
  columnResize?: boolean;
  columnPin?: boolean;

  // --- Other ---
  reorder?: boolean;
  undo?: boolean;
}

// ============================================================================
// Operations (Siren-inspired custom actions)
// ============================================================================

export type OperationScope = 'item' | 'selection' | 'collection';

export interface OperationConfirmation {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

export interface OperationDefinition<TParams = unknown> {
  /** Unique identifier for this operation. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** What the operation acts on. */
  scope: OperationScope;
  /** Icon name (from icon library). */
  icon?: string;
  /** Visual style. */
  variant?: 'default' | 'destructive' | 'secondary' | 'ghost';
  /** Confirmation dialog before execution. */
  confirm?: boolean | OperationConfirmation;
  /** Keyboard shortcut (e.g., "ctrl+d", "delete"). */
  keyboardShortcut?: string;
}

// ============================================================================
// Collection Definition (top-level config)
// ============================================================================

export interface CollectionConfig<TShape extends Record<string, unknown> = Record<string, unknown>> {
  /** Collection-level affordances. */
  affordances?: CollectionAffordances;
  /** Per-field affordance overrides (merged with Zod .meta()). */
  fields?: Partial<Record<keyof TShape, Partial<FieldAffordance>>>;
  /** Custom operations beyond CRUD. */
  operations?: OperationDefinition[];
  /** Which field uniquely identifies items. Default: 'id'. */
  idField?: string;
  /** Which field is the human-readable label. Default: first string field. */
  labelField?: string;
}

// ============================================================================
// Resolved Types (after inference + merge)
// ============================================================================

export interface ResolvedFieldAffordance extends Required<
  Pick<FieldAffordance, 'sortable' | 'filterable' | 'searchable' | 'groupable' | 'editable' | 'visible'>
> {
  // All optional fields from FieldAffordance, plus:
  title: string;
  zodType: string;
  zodDef: unknown;
  [key: string]: unknown;
}

export interface ResolvedCollectionAffordances extends Required<
  Pick<CollectionAffordances, 'create' | 'read' | 'update' | 'delete' | 'selectable'>
> {
  search: false | SearchConfig;
  pagination: false | Required<PaginationConfig>;
  [key: string]: unknown;
}

// ============================================================================
// Shared State Types (used by both @zodal/store and @zodal/ui)
// ============================================================================

/** Sort state for a single column. TanStack Table compatible. */
export interface SortingState {
  id: string;
  desc: boolean;
}

/** A column filter value. TanStack Table compatible. */
export interface ColumnFilter {
  id: string;
  value: unknown;
}

/** Pagination state. TanStack Table compatible. */
export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

// ============================================================================
// Filter Expression Types (structured, serializable filters)
// ============================================================================

/** Available filter operators (Prisma-style). */
export type FilterOperator =
  // Equality
  | 'eq' | 'ne'
  // Comparison
  | 'gt' | 'gte' | 'lt' | 'lte'
  // String
  | 'contains' | 'startsWith' | 'endsWith'
  // Set
  | 'in' | 'notIn'
  // Array
  | 'arrayContains' | 'arrayContainsAny'
  // Existence
  | 'isNull' | 'isNotNull';

/** A single filter condition. */
export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/** Compound filter with AND/OR/NOT logic. */
export type FilterExpression =
  | FilterCondition
  | { and: FilterExpression[] }
  | { or: FilterExpression[] }
  | { not: FilterExpression };

// ============================================================================
// Inference Trace Types (for explain())
// ============================================================================

/** A single inference step showing which layer set which value. */
export interface InferenceStep {
  layer: 'type' | 'refinement' | 'name' | 'meta' | 'registry' | 'config';
  value: unknown;
  reason: string;
}

/** Full trace of how a field's affordances were resolved. */
export interface InferenceTrace {
  field: string;
  affordance: string;
  finalValue: unknown;
  layers: InferenceStep[];
}
