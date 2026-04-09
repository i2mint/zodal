/**
 * Inference Engine: Zod Type → Default Affordances
 *
 * Given a Zod schema field (with no .meta() annotations), infers sensible
 * default affordances based on:
 * 1. The Zod type (string, number, boolean, enum, date, array, object)
 * 2. Zod validations/checks (email, url, uuid, min, max, etc.)
 * 3. Field name heuristics (id, createdAt, password, etc.)
 * 4. Zod v4 metadata (if present via .meta())
 */

import { z } from 'zod';
import type { FieldAffordance, FilterType, SortDirection, AggregationFn, InferenceTrace, InferenceStep } from './types.js';
import type { AffordanceRegistry } from './registry.js';

// ============================================================================
// Schema Introspection Helpers
// ============================================================================

/** Get the underlying type name from a Zod schema, unwrapping optionals/nullables/defaults. */
export function getZodBaseType(schema: z.ZodType): string {
  const def = (schema as any)._zod?.def;
  if (!def) return 'unknown';

  // Unwrap wrapper types
  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') {
    return getZodBaseType(def.innerType);
  }

  return def.type ?? 'unknown';
}

/** Get the inner schema, unwrapping optionals/nullables/defaults. */
export function unwrapZodSchema(schema: z.ZodType): z.ZodType {
  const def = (schema as any)._zod?.def;
  if (!def) return schema;

  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') {
    return unwrapZodSchema(def.innerType);
  }

  return schema;
}

/** Check if a Zod schema has a specific check/validation. */
export function hasZodCheck(schema: z.ZodType, kind: string): boolean {
  const unwrapped = unwrapZodSchema(schema);
  const def = (unwrapped as any)._zod?.def;
  if (!def) return false;

  // Zod v4: checks are on the def
  if (def.checks) {
    return def.checks.some((c: any) => c.kind === kind);
  }

  // Zod v4: format checks might be on the type itself
  if (def.format === kind) return true;
  if (def.type === kind) return true;

  return false;
}

/** Get enum values from a Zod enum schema. */
export function getEnumValues(schema: z.ZodType): string[] | null {
  const unwrapped = unwrapZodSchema(schema);
  const def = (unwrapped as any)._zod?.def;
  if (!def) return null;

  if (def.type === 'enum') {
    // Zod v4 uses `entries` (object { a: 'a', b: 'b' }) not `values` (array)
    if (def.entries) {
      return Object.values(def.entries) as string[];
    }
    return def.values ?? null;
  }

  return null;
}

/** Read Zod v4 metadata from the global registry. */
export function getZodMeta(schema: z.ZodType): Record<string, unknown> | undefined {
  try {
    // Zod v4: .meta() without args returns the metadata
    const meta = (schema as any).meta?.();
    return meta ?? undefined;
  } catch {
    return undefined;
  }
}

/** Get the numeric min/max from Zod checks. */
export function getNumericBounds(schema: z.ZodType): { min?: number; max?: number } {
  const unwrapped = unwrapZodSchema(schema);
  const result: { min?: number; max?: number } = {};

  // Zod v4: min/max are instance properties on the schema
  const asAny = unwrapped as any;
  if (typeof asAny.minValue === 'number' && asAny.minValue !== -Number.MAX_SAFE_INTEGER) {
    result.min = asAny.minValue;
  }
  if (typeof asAny.maxValue === 'number' && asAny.maxValue !== Number.MAX_SAFE_INTEGER) {
    result.max = asAny.maxValue;
  }

  // Fallback: check the checks array (Zod v3 style)
  const def = (unwrapped as any)._zod?.def;
  if (def?.checks) {
    for (const check of def.checks) {
      if (check.kind === 'min' && result.min === undefined) result.min = check.value;
      if (check.kind === 'max' && result.max === undefined) result.max = check.value;
    }
  }

  return result;
}

// ============================================================================
// Type-Based Inference
// ============================================================================

const STRING_FIELD_DEFAULTS: FieldAffordance = {
  sortable: 'both',
  filterable: 'search',
  searchable: true,
  groupable: false,
  editable: true,
  visible: true,
};

const NUMBER_FIELD_DEFAULTS: FieldAffordance = {
  sortable: 'both',
  filterable: 'range',
  searchable: false,
  groupable: false,
  editable: true,
  visible: true,
  aggregatable: ['sum', 'avg', 'min', 'max'],
};

const BOOLEAN_FIELD_DEFAULTS: FieldAffordance = {
  sortable: 'both',
  filterable: 'boolean',
  searchable: false,
  groupable: true,
  editable: true,
  visible: true,
};

const ENUM_FIELD_DEFAULTS: FieldAffordance = {
  sortable: 'both',
  filterable: 'select',
  searchable: false,
  groupable: true,
  editable: true,
  visible: true,
};

const DATE_FIELD_DEFAULTS: FieldAffordance = {
  sortable: 'both',
  filterable: 'range',
  searchable: false,
  groupable: false,
  editable: true,
  visible: true,
};

const ARRAY_FIELD_DEFAULTS: FieldAffordance = {
  sortable: false,
  filterable: 'contains',
  searchable: false,
  groupable: false,
  editable: true,
  visible: true,
};

const OBJECT_FIELD_DEFAULTS: FieldAffordance = {
  sortable: false,
  filterable: false,
  searchable: false,
  groupable: false,
  editable: true,
  visible: true,
  detailOnly: true,
};

const UNKNOWN_FIELD_DEFAULTS: FieldAffordance = {
  sortable: false,
  filterable: false,
  searchable: false,
  groupable: false,
  editable: false,
  visible: true,
};

/** Map Zod base type to default affordances. */
function getTypeDefaults(zodType: string): FieldAffordance {
  switch (zodType) {
    case 'string':
      return { ...STRING_FIELD_DEFAULTS };
    case 'number':
    case 'int':
    case 'float':
    case 'bigint':
      return { ...NUMBER_FIELD_DEFAULTS };
    case 'boolean':
      return { ...BOOLEAN_FIELD_DEFAULTS };
    case 'enum':
    case 'nativeEnum':
      return { ...ENUM_FIELD_DEFAULTS };
    case 'date':
      return { ...DATE_FIELD_DEFAULTS };
    case 'array':
    case 'set':
    case 'tuple':
      return { ...ARRAY_FIELD_DEFAULTS };
    case 'object':
    case 'record':
    case 'map':
      return { ...OBJECT_FIELD_DEFAULTS };
    default:
      return { ...UNKNOWN_FIELD_DEFAULTS };
  }
}

// ============================================================================
// Validation-Based Refinements
// ============================================================================

/** Refine defaults based on Zod validations/checks. */
function refineByValidations(schema: z.ZodType, defaults: FieldAffordance): FieldAffordance {
  const unwrapped = unwrapZodSchema(schema);
  const def = (unwrapped as any)._zod?.def;
  if (!def) return defaults;

  const refined = { ...defaults };

  // String format checks
  if (def.type === 'string') {
    // Check for format-specific strings
    if (def.checks) {
      for (const check of def.checks) {
        if (check.kind === 'email') {
          refined.editWidget = 'email';
          refined.filterable = 'search';
        }
        if (check.kind === 'url' || check.kind === 'uri') {
          refined.editWidget = 'url';
          refined.searchable = false;
          refined.filterable = 'exact';
        }
        if (check.kind === 'uuid' || check.kind === 'ulid' || check.kind === 'cuid') {
          refined.editable = false;
          refined.filterable = 'exact';
          refined.searchable = false;
        }
        if (check.kind === 'regex') {
          // Has a pattern validation
        }
      }
    }
    // Check for format property (Zod v4 uses this for email, url, etc.)
    if (def.format === 'email') {
      refined.editWidget = 'email';
    }
    if (def.format === 'uri' || def.format === 'url') {
      refined.editWidget = 'url';
      refined.searchable = false;
    }
    if (def.format === 'uuid') {
      refined.editable = false;
      refined.filterable = 'exact';
      refined.searchable = false;
    }
  }

  // Boolean with default → might be a toggle
  if (def.type === 'boolean' && 'defaultValue' in def) {
    refined.editWidget = 'switch';
  }

  return refined;
}

// ============================================================================
// Name-Based Heuristics
// ============================================================================

const ID_PATTERNS = /^(id|_id|uuid|uid|key|pk)$/i;
const ID_SUFFIX_PATTERNS = /(_id|Id|ID|_key|Key)$/;
const CREATED_PATTERNS = /^(created_?at|creation_?date|date_?created|ctime)$/i;
const UPDATED_PATTERNS = /^(updated_?at|modified_?at|last_?modified|mtime|changed_?at)$/i;
const DELETED_PATTERNS = /^(deleted_?at|removed_?at)$/i;
const SECRET_PATTERNS = /^(password|secret|token|api_?key|access_?key|private_?key|hash|salt)$/i;
const EMAIL_PATTERNS = /^(email|e_?mail)$/i;
const NAME_PATTERNS = /^(name|title|label|display_?name|full_?name|username)$/i;
const DESCRIPTION_PATTERNS = /^(description|summary|body|content|text|bio|about|notes)$/i;
const IMAGE_PATTERNS = /^(image|photo|avatar|thumbnail|picture|icon|logo)(_?url)?$/i;
const STATUS_PATTERNS = /^(status|state|phase|stage)$/i;
const CONTENT_ROLE_PATTERNS = /^(attachment|file|blob|binary|payload|raw_?data|media|document_?content|source_?file|upload)$/i;
const CONTENT_ROLE_SUFFIX = /_(attachment|file|blob|binary|upload)$/i;

/** Refine defaults based on field name heuristics. */
function refineByFieldName(key: string, defaults: FieldAffordance): FieldAffordance {
  const refined = { ...defaults };

  if (ID_PATTERNS.test(key) || ID_SUFFIX_PATTERNS.test(key)) {
    refined.editable = false;
    refined.visible = key === 'id' ? false : refined.visible;
    refined.filterable = 'exact';
    refined.searchable = false;
  }

  if (CREATED_PATTERNS.test(key)) {
    refined.editable = false;
    refined.sortable = 'both';
    refined.filterable = 'range';
  }

  if (UPDATED_PATTERNS.test(key)) {
    refined.editable = false;
    refined.visible = false;
    refined.sortable = 'both';
  }

  if (DELETED_PATTERNS.test(key)) {
    refined.editable = false;
    refined.visible = false;
  }

  if (SECRET_PATTERNS.test(key)) {
    refined.readable = false;
    refined.searchable = false;
    refined.sortable = false;
    refined.filterable = false;
    refined.visible = false;
  }

  if (EMAIL_PATTERNS.test(key)) {
    refined.editWidget = refined.editWidget ?? 'email';
    refined.filterable = 'search';
    refined.searchable = true;
  }

  if (NAME_PATTERNS.test(key)) {
    refined.searchable = true;
    refined.summaryField = true;
    refined.sortable = 'both';
  }

  if (DESCRIPTION_PATTERNS.test(key)) {
    refined.editWidget = refined.editWidget ?? 'textarea';
    refined.truncate = refined.truncate ?? 100;
    refined.tooltip = true;
    refined.sortable = false;
  }

  if (IMAGE_PATTERNS.test(key)) {
    refined.sortable = false;
    refined.filterable = false;
    refined.searchable = false;
  }

  if (STATUS_PATTERNS.test(key)) {
    refined.groupable = true;
    refined.filterable = 'select';
  }

  if (CONTENT_ROLE_PATTERNS.test(key) || CONTENT_ROLE_SUFFIX.test(key)) {
    refined.storageRole = 'content';
    refined.sortable = false;
    refined.filterable = false;
    refined.searchable = false;
    refined.detailOnly = true;
  }

  return refined;
}

// ============================================================================
// Public API: inferFieldAffordances
// ============================================================================

/**
 * Given a field name and its Zod schema, infer sensible default affordances.
 *
 * Inference layers (later layers override earlier):
 * 1. Type-based defaults (string → searchable, number → range filterable, etc.)
 * 2. Validation-based refinements (email → email widget, uuid → not editable)
 * 3. Name-based heuristics (id → hidden, createdAt → not editable, password → not readable)
 * 4. Zod .meta() annotations (explicit overrides from the developer)
 */
export function inferFieldAffordances(key: string, schema: z.ZodType): FieldAffordance {
  const baseType = getZodBaseType(schema);

  // Layer 1: Type-based defaults
  let affordances = getTypeDefaults(baseType);

  // Layer 2: Validation-based refinements
  affordances = refineByValidations(schema, affordances);

  // Layer 3: Name-based heuristics
  affordances = refineByFieldName(key, affordances);

  // Layer 4: Zod .meta() annotations (if any)
  const meta = getZodMeta(schema);
  if (meta) {
    affordances = { ...affordances, ...extractAffordancesFromMeta(meta) };
  }

  // Always set the title if not explicitly provided
  if (!affordances.title) {
    affordances.title = humanizeFieldName(key);
  }

  return affordances;
}

/** Extract affordance-relevant fields from Zod metadata. */
function extractAffordancesFromMeta(meta: Record<string, unknown>): Partial<FieldAffordance> {
  const result: Partial<FieldAffordance> = {};

  // Direct affordance fields
  const affordanceKeys: (keyof FieldAffordance)[] = [
    'sortable', 'filterable', 'searchable', 'groupable', 'aggregatable',
    'readable', 'editable', 'inlineEditable', 'requiredOnCreate', 'requiredOnUpdate',
    'immutableAfterCreate', 'visible', 'hidden', 'detailOnly', 'summaryField',
    'columnWidth', 'minWidth', 'maxWidth', 'resizable', 'pinned', 'order',
    'title', 'description', 'displayFormat', 'badge', 'copyable', 'truncate',
    'tooltip', 'editWidget', 'editPlaceholder', 'editHelp',
    'storageRole',
  ];

  for (const key of affordanceKeys) {
    if (key in meta) {
      (result as any)[key] = meta[key];
    }
  }

  // Support nested affordance object from .meta({ affordances: { ... } })
  if (meta.affordances && typeof meta.affordances === 'object') {
    Object.assign(result, meta.affordances);
  }

  // Map standard Zod meta fields
  if (meta.title && !result.title) result.title = meta.title as string;
  if (meta.description && !result.description) result.description = meta.description as string;

  return result;
}

/** Convert a camelCase or snake_case field name to a human-readable label. */
export function humanizeFieldName(key: string): string {
  return key
    // Insert space before uppercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace underscores and hyphens with spaces
    .replace(/[_-]+/g, ' ')
    // Capitalize first letter of each word
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ============================================================================
// Traced Inference (for explain())
// ============================================================================

/** Properties tracked by explain(). */
const TRACED_PROPS: (keyof FieldAffordance)[] = [
  'sortable', 'filterable', 'searchable', 'groupable', 'aggregatable',
  'editable', 'visible', 'hidden', 'detailOnly', 'summaryField',
  'readable', 'inlineEditable', 'editWidget', 'truncate', 'tooltip',
  'storageRole',
];

/**
 * Run the inference engine with full layer-by-layer trace recording.
 * Returns both the final affordances and traces for every tracked property.
 *
 * @param registry - Optional affordance registry (Layer 5)
 */
export function inferFieldAffordancesWithTrace(
  key: string,
  schema: z.ZodType,
  registry?: AffordanceRegistry,
): { affordances: FieldAffordance; traces: InferenceTrace[] } {
  const baseType = getZodBaseType(schema);

  // Layer 1: Type-based defaults
  const afterType = getTypeDefaults(baseType);

  // Layer 2: Validation-based refinements
  const afterValidation = refineByValidations(schema, { ...afterType });

  // Layer 3: Name-based heuristics
  const afterName = refineByFieldName(key, { ...afterValidation });

  // Layer 4: Zod .meta() annotations
  let afterMeta = { ...afterName };
  const meta = getZodMeta(schema);
  if (meta) {
    afterMeta = { ...afterMeta, ...extractAffordancesFromMeta(meta) };
  }

  // Layer 5: Affordance registry
  let afterRegistry = { ...afterMeta };
  const registryAffordances = registry?.get(schema);
  if (registryAffordances) {
    afterRegistry = { ...afterRegistry, ...registryAffordances };
  }

  // Set title
  if (!afterRegistry.title) {
    afterRegistry.title = humanizeFieldName(key);
  }

  // Build traces
  const traces: InferenceTrace[] = [];
  for (const prop of TRACED_PROPS) {
    const finalValue = (afterRegistry as any)[prop];
    if (finalValue === undefined) continue;

    const layers: InferenceStep[] = [];
    const typeVal = (afterType as any)[prop];
    const valVal = (afterValidation as any)[prop];
    const nameVal = (afterName as any)[prop];
    const metaVal = (afterMeta as any)[prop];
    const regVal = (afterRegistry as any)[prop];

    if (typeVal !== undefined) {
      layers.push({
        layer: 'type',
        value: typeVal,
        reason: `${baseType} type defaults`,
      });
    }

    if (valVal !== undefined && !valueEqual(valVal, typeVal)) {
      layers.push({
        layer: 'refinement',
        value: valVal,
        reason: `Zod validation/check refinement`,
      });
    }

    if (nameVal !== undefined && !valueEqual(nameVal, valVal ?? typeVal)) {
      layers.push({
        layer: 'name',
        value: nameVal,
        reason: `field name '${key}' matched heuristic pattern`,
      });
    }

    if (meta && metaVal !== undefined && !valueEqual(metaVal, nameVal ?? valVal ?? typeVal)) {
      layers.push({
        layer: 'meta',
        value: metaVal,
        reason: `.meta() annotation on schema`,
      });
    }

    if (registryAffordances && regVal !== undefined && !valueEqual(regVal, metaVal ?? nameVal ?? valVal ?? typeVal)) {
      layers.push({
        layer: 'registry',
        value: regVal,
        reason: `affordanceRegistry.register() on schema`,
      });
    }

    traces.push({
      field: key,
      affordance: prop,
      finalValue,
      layers,
    });
  }

  return { affordances: afterRegistry, traces };
}

function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
