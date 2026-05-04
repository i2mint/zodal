/**
 * Collection Definition: The main entry point.
 *
 * `defineCollection` takes a Zod object schema + optional configuration and produces
 * a CollectionDefinition with resolved affordances, generators, and utilities.
 */

import { z } from 'zod';
import type {
  CollectionConfig,
  CollectionAffordances,
  FieldAffordance,
  OperationDefinition,
  PaginationConfig,
  SearchConfig,
  ResolvedFieldAffordance,
  InferenceTrace,
} from './types.js';
import {
  inferFieldAffordances,
  inferFieldAffordancesWithTrace,
  getZodBaseType,
  humanizeFieldName,
} from './inference.js';
import type { AffordanceRegistry } from './registry.js';
import { affordanceRegistry as defaultRegistry } from './registry.js';

// ============================================================================
// Default Collection Affordances
// ============================================================================

const DEFAULT_COLLECTION_AFFORDANCES: CollectionAffordances = {
  create: true,
  read: true,
  update: true,
  delete: true,
  bulkDelete: false,
  bulkEdit: false,
  search: true,
  pagination: {
    defaultPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    style: 'pages',
    serverSide: false,
  },
  multiSort: true,
  filterPanel: true,
  selectable: 'multi',
  columnVisibility: true,
  columnOrder: true,
  columnResize: true,
  refresh: true,
  defaultView: 'table',
  views: ['table'],
};

const DEFAULT_PAGINATION: Required<PaginationConfig> = {
  defaultPageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],
  style: 'pages',
  serverSide: false,
};

const DEFAULT_SEARCH: SearchConfig = {
  debounce: 300,
  minChars: 1,
  highlight: false,
  placeholder: 'Search...',
};

// ============================================================================
// CollectionDefinition
// ============================================================================

export interface CollectionDefinition<TSchema extends z.ZodObject<any>> {
  /** The source Zod schema. */
  schema: TSchema;

  /** Resolved collection-level affordances. */
  affordances: CollectionAffordances;

  /**
   * Resolved per-field affordances (after the full 6-layer inference + merge).
   *
   * Each entry is a fully-resolved affordance: the boolean affordances are
   * defaulted, `title`, `zodType`, `zodDef`, and `storageRole` are always
   * present. This is the shape `RendererRegistry.resolve()` and every tester
   * predicate expect — so the entries here can be passed directly to
   * `registry.resolve(field, context)` without a cast.
   */
  fieldAffordances: Record<string, ResolvedFieldAffordance>;

  /** Custom operations. */
  operations: OperationDefinition[];

  /** Which field is the unique identifier. */
  idField: string;

  /** Which field is the human-readable label. */
  labelField: string;

  /** Get ordered list of visible fields for the collection view. */
  getVisibleFields(): string[];

  /** Get fields that are searchable (for global search). */
  getSearchableFields(): string[];

  /** Get fields that are filterable (for filter panel). */
  getFilterableFields(): { key: string; affordance: ResolvedFieldAffordance }[];

  /** Get fields that are sortable (for sort controls). */
  getSortableFields(): { key: string; affordance: ResolvedFieldAffordance }[];

  /** Get fields that are groupable. */
  getGroupableFields(): { key: string; affordance: ResolvedFieldAffordance }[];

  /** Get operations by scope. */
  getOperations(scope: 'item' | 'selection' | 'collection'): OperationDefinition[];

  /** Generate a human-readable description of affordances. */
  describe(): string;

  /**
   * Explain how affordances were inferred for a field (or all fields).
   * Returns a trace of which inference layer set each affordance value.
   */
  explain(fieldName?: string): InferenceTrace[];

  /** Get fields classified as content (large/opaque, stored separately). */
  getContentFields(): string[];

  /** Get fields classified as metadata (small/structured, queryable). */
  getMetadataFields(): string[];

  /** Whether this collection has any content fields (needs bifurcated storage). */
  hasBifurcation(): boolean;
}

// ============================================================================
// defineCollection
// ============================================================================

/**
 * Define a collection from a Zod object schema and optional configuration.
 *
 * This is the main entry point for the collection affordance library.
 *
 * @example
 * ```typescript
 * const projectCollection = defineCollection(
 *   z.object({
 *     id: z.string().uuid(),
 *     name: z.string().min(1),
 *     status: z.enum(['draft', 'active', 'archived']),
 *     priority: z.number().int().min(1).max(5),
 *   }),
 *   {
 *     affordances: { bulkDelete: true, export: ['csv', 'json'] },
 *     fields: { name: { inlineEditable: true } },
 *     operations: [{ name: 'archive', label: 'Archive', scope: 'item' }],
 *   }
 * );
 * ```
 */
export function defineCollection<TSchema extends z.ZodObject<any>>(
  schema: TSchema,
  config?: CollectionConfig<z.infer<TSchema>>,
): CollectionDefinition<TSchema> {
  type TShape = z.infer<TSchema>;

  // 1. Resolve collection-level affordances
  const affordances = resolveCollectionAffordances(config?.affordances);

  // 2. Resolve per-field affordances
  const fieldAffordances = resolveAllFieldAffordances(schema, config?.fields);

  // 3. Resolve identity fields
  const idField = config?.idField ?? detectIdField(schema);
  const labelField = config?.labelField ?? detectLabelField(schema, fieldAffordances);

  // 4. Operations
  const operations = config?.operations ?? [];

  // 5. Build the collection definition
  const definition: CollectionDefinition<TSchema> = {
    schema,
    affordances,
    fieldAffordances,
    operations,
    idField,
    labelField,

    getVisibleFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.visible !== false && !fa.hidden && !fa.detailOnly)
        .sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999))
        .map(([key]) => key);
    },

    getSearchableFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.searchable === true)
        .map(([key]) => key);
    },

    getFilterableFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.filterable !== false)
        .map(([key, fa]) => ({ key, affordance: fa }));
    },

    getSortableFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.sortable !== false && fa.sortable !== 'none')
        .map(([key, fa]) => ({ key, affordance: fa }));
    },

    getGroupableFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.groupable === true)
        .map(([key, fa]) => ({ key, affordance: fa }));
    },

    getOperations(scope) {
      return operations.filter((op) => op.scope === scope);
    },

    describe() {
      return generateDescription(definition);
    },

    explain(fieldName?: string) {
      return generateExplanation(schema, config, fieldAffordances, fieldName);
    },

    getContentFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.storageRole === 'content')
        .map(([key]) => key);
    },

    getMetadataFields() {
      return Object.entries(fieldAffordances)
        .filter(([_, fa]) => fa.storageRole !== 'content')
        .map(([key]) => key);
    },

    hasBifurcation() {
      return Object.values(fieldAffordances).some(fa => fa.storageRole === 'content');
    },
  };

  return definition;
}

// ============================================================================
// Internals
// ============================================================================

function resolveCollectionAffordances(
  explicit?: CollectionAffordances,
): CollectionAffordances {
  const merged = { ...DEFAULT_COLLECTION_AFFORDANCES, ...explicit };

  // Normalize pagination
  if (merged.pagination === true) {
    merged.pagination = { ...DEFAULT_PAGINATION };
  } else if (merged.pagination && typeof merged.pagination === 'object') {
    merged.pagination = { ...DEFAULT_PAGINATION, ...merged.pagination };
  }

  // Normalize search
  if (merged.search === true) {
    merged.search = { ...DEFAULT_SEARCH };
  } else if (merged.search && typeof merged.search === 'object') {
    merged.search = { ...DEFAULT_SEARCH, ...merged.search };
  }

  return merged;
}

function resolveAllFieldAffordances(
  schema: z.ZodObject<any>,
  explicit?: Partial<Record<string, Partial<FieldAffordance>>>,
): Record<string, ResolvedFieldAffordance> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const result: Record<string, ResolvedFieldAffordance> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    // Layers 1-4: Infer defaults from type + name + meta
    const inferred = inferFieldAffordances(key, fieldSchema);

    // Layer 5: Affordance registry (survives .optional()/.nullable() wrapping)
    const registryOverrides = defaultRegistry.get(fieldSchema) ?? {};

    // Layer 6: Explicit config overrides
    const explicitOverrides = explicit?.[key] ?? {};
    const merged = { ...inferred, ...registryOverrides, ...explicitOverrides };

    // Build a fully-resolved affordance: title, zodType, and zodDef are always
    // populated; storageRole defaults to 'metadata' so testers like
    // `storageRoleIs('content')` can compare without an undefined check.
    // The boolean affordances (sortable, filterable, ...) come from
    // inferFieldAffordances, which always returns them set.
    result[key] = {
      ...merged,
      title: merged.title ?? humanizeFieldName(key),
      zodType: getZodBaseType(fieldSchema),
      zodDef: (fieldSchema as { _zod?: { def?: unknown } })._zod?.def,
      storageRole: merged.storageRole ?? 'metadata',
    } as ResolvedFieldAffordance;
  }

  return result;
}

/** Detect the ID field from schema. */
function detectIdField(schema: z.ZodObject<any>): string {
  const shape = schema.shape as Record<string, z.ZodType>;

  // Direct 'id' field
  if ('id' in shape) return 'id';
  if ('_id' in shape) return '_id';
  if ('uuid' in shape) return 'uuid';
  if ('key' in shape) return 'key';

  // First field ending with Id/id/_id
  for (const key of Object.keys(shape)) {
    if (/[iI]d$/.test(key) || key.endsWith('_id')) return key;
  }

  // Fallback to first field
  const keys = Object.keys(shape);
  return keys[0] ?? 'id';
}

/** Detect the label field from schema + affordances. */
function detectLabelField(
  schema: z.ZodObject<any>,
  fieldAffordances: Record<string, ResolvedFieldAffordance>,
): string {
  // Check for summaryField flag
  for (const [key, fa] of Object.entries(fieldAffordances)) {
    if (fa.summaryField) return key;
  }

  // Common label field names
  const labelNames = ['name', 'title', 'label', 'displayName', 'display_name', 'username'];
  for (const name of labelNames) {
    if (name in fieldAffordances) return name;
  }

  // First string field that's not an ID
  for (const [key, fa] of Object.entries(fieldAffordances)) {
    if (fa.zodType === 'string' && fa.editable !== false) return key;
  }

  return Object.keys(fieldAffordances)[0] ?? '';
}

/** Generate a human-readable description of the collection's affordances. */
function generateDescription(def: CollectionDefinition<any>): string {
  const lines: string[] = [];

  // Collection info
  const fieldCount = Object.keys(def.fieldAffordances).length;
  lines.push(`Collection with ${fieldCount} fields (ID: ${def.idField}, Label: ${def.labelField})`);
  lines.push('');

  // CRUD
  const crud: string[] = [];
  if (def.affordances.create) crud.push('Create');
  if (def.affordances.read) crud.push('Read');
  if (def.affordances.update) crud.push('Update');
  if (def.affordances.delete) crud.push('Delete');
  lines.push(`CRUD: ${crud.join(', ')}`);

  // Bulk operations
  const bulk: string[] = [];
  if (def.affordances.bulkDelete) bulk.push('Bulk Delete');
  if (def.affordances.bulkEdit) bulk.push('Bulk Edit');
  if (bulk.length) lines.push(`Bulk: ${bulk.join(', ')}`);

  // Search
  if (def.affordances.search) {
    const searchFields = def.getSearchableFields();
    lines.push(`Search: Yes (fields: ${searchFields.join(', ')})`);
  }

  // Pagination
  if (def.affordances.pagination && typeof def.affordances.pagination === 'object') {
    lines.push(`Pagination: ${def.affordances.pagination.style} (default: ${def.affordances.pagination.defaultPageSize})`);
  }

  lines.push('');
  lines.push('Fields:');

  // Per-field summary
  for (const [key, fa] of Object.entries(def.fieldAffordances)) {
    const caps: string[] = [];
    if (fa.sortable && fa.sortable !== 'none') caps.push(`sort:${fa.sortable}`);
    if (fa.filterable) caps.push(`filter:${fa.filterable}`);
    if (fa.searchable) caps.push('search');
    if (fa.groupable) caps.push('group');
    if (fa.editable) caps.push('edit');
    if (fa.inlineEditable) caps.push('inline-edit');
    if (!fa.visible || fa.hidden) caps.push('HIDDEN');
    if (fa.detailOnly) caps.push('detail-only');
    if (fa.storageRole === 'content') caps.push('CONTENT');

    lines.push(`  ${key} (${fa.zodType}): ${caps.join(', ') || 'display-only'}`);
  }

  // Operations
  if (def.operations.length > 0) {
    lines.push('');
    lines.push('Custom Operations:');
    for (const op of def.operations) {
      lines.push(`  ${op.name} [${op.scope}]: ${op.label}`);
    }
  }

  return lines.join('\n');
}

/** Generate explain traces showing how affordances were inferred, layer by layer. */
function generateExplanation(
  schema: z.ZodObject<any>,
  config: CollectionConfig | undefined,
  resolved: Record<string, ResolvedFieldAffordance>,
  fieldName?: string,
): InferenceTrace[] {
  const shape = schema.shape as Record<string, z.ZodType>;
  const fieldsToExplain = fieldName ? [fieldName] : Object.keys(resolved);
  const allTraces: InferenceTrace[] = [];

  for (const key of fieldsToExplain) {
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;

    const explicitOverrides = config?.fields?.[key as keyof typeof config.fields] ?? {};

    // Get layer-by-layer traces from the inference engine (including registry)
    const { traces } = inferFieldAffordancesWithTrace(key, fieldSchema, defaultRegistry);

    // Augment with config override layer (Layer 6)
    for (const trace of traces) {
      const configValue = (explicitOverrides as any)[trace.affordance];
      if (configValue !== undefined) {
        trace.layers.push({
          layer: 'config',
          value: configValue,
          reason: `explicit override in CollectionConfig.fields.${key}`,
        });
        trace.finalValue = configValue;
      }
    }

    // Also add traces for config-only overrides (props not in inference traces)
    const tracedProps = new Set(traces.map(t => t.affordance));
    for (const [prop, value] of Object.entries(explicitOverrides)) {
      if (!tracedProps.has(prop) && value !== undefined) {
        allTraces.push({
          field: key,
          affordance: prop,
          finalValue: value,
          layers: [{
            layer: 'config',
            value,
            reason: `explicit override in CollectionConfig.fields.${key}`,
          }],
        });
      }
    }

    allTraces.push(...traces);
  }

  return allTraces;
}
