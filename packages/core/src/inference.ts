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
import { peelZodWrapper, zodPipeKind } from './zod-unwrap.js';
import type { ChoiceArity, FieldAffordance, FilterType, SortDirection, AggregationFn, InferenceTrace, InferenceStep } from './types.js';
import type { AffordanceRegistry } from './registry.js';

// ============================================================================
// Schema Introspection Helpers
// ============================================================================

/** How many wrapper layers `unwrapZodSchema` peels before giving up (guards a self-referencing `z.lazy`). */
const MAX_UNWRAP_DEPTH = 16;

/**
 * Get the underlying type name from a Zod schema, unwrapping every wrapper
 * `unwrapZodSchema` does (so `z.string().readonly()` is `'string'`, not `'readonly'`).
 */
export function getZodBaseType(schema: z.ZodType): string {
  const def = (unwrapZodSchema(schema) as any)._zod?.def;
  if (!def) return 'unknown';
  return def.type ?? 'unknown';
}

/**
 * Get the inner schema, unwrapping optional, nullable, default, prefault, readonly,
 * catch and nonoptional wrappers, `z.lazy` (its resolved schema) and pipes (their
 * output side, or the input side of a `.transform()`) and a union of `T` with `null` /
 * `undefined` (`z.union([z.string(), z.null()])` is `z.string()`, like `.nullable()`).
 * Gives up after {@link MAX_UNWRAP_DEPTH} layers (see {@link peelZodWrapper}), returning
 * the schema it reached.
 */
export function unwrapZodSchema(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (let i = 0; i < MAX_UNWRAP_DEPTH; i++) {
    const next = peelZodWrapper(current) ?? soleNonEmptyMember(current);
    if (!next) return current;
    current = next;
  }
  return current;
}

/**
 * The schemas whose limits (bounds, length) a value must meet, through wrappers: the
 * unwrapped schema, and across a plain `.pipe()`, which passes the value on unchanged,
 * both of its sides (`z.string().max(10).pipe(z.string().trim())` keeps the `max(10)`).
 * A codec or a `.transform()` changes the value, so there only the side `unwrapZodSchema`
 * picks counts (a codec's input limits are in other units than the value a form edits),
 * and a side feeding a plain pipe through a `.transform()` adds nothing: its limits are in other units.
 */
function limitSchemas(schema: z.ZodType, depth = 0, feedsPipe = false): z.ZodType[] {
  if (!(schema as any)?._zod?.def || depth >= MAX_UNWRAP_DEPTH) return [schema];
  if (feedsPipe && transformsValue(schema)) return [];
  if (zodPipeKind(schema) === 'plain') {
    const def = (schema as any)._zod.def;
    return [...limitSchemas(def.in, depth + 1, true), ...limitSchemas(def.out, depth + 1, feedsPipe)];
  }
  const next = peelZodWrapper(schema) ?? soleNonEmptyMember(schema);
  return next ? limitSchemas(next, depth + 1, feedsPipe) : [schema];
}

/** Does a `.transform()` change the value somewhere in `schema` (through wrappers and plain pipes)? */
function transformsValue(schema: z.ZodType, depth = 0): boolean {
  if (!(schema as any)?._zod?.def || depth >= MAX_UNWRAP_DEPTH) return false;
  const kind = zodPipeKind(schema);
  if (kind === 'transform') return true;
  if (kind === 'plain') {
    const def = (schema as any)._zod.def;
    return transformsValue(def.in, depth + 1) || transformsValue(def.out, depth + 1);
  }
  const next = peelZodWrapper(schema) ?? soleNonEmptyMember(schema);
  return next ? transformsValue(next, depth + 1) : false;
}

/** Is this union member only `null` / `undefined` (through wrappers, never resolving a union)? */
function isEmptyZodMember(schema: z.ZodType): boolean {
  let current: z.ZodType | undefined = schema;
  for (let i = 0; current && i < MAX_UNWRAP_DEPTH; i++) {
    const def = (current as any)._zod?.def;
    if (def?.type === 'null' || def?.type === 'undefined') return true;
    if (def?.type === 'literal') return (def.values ?? [def.value]).every((v: unknown) => v === null || v === undefined);
    current = peelZodWrapper(current);
  }
  return false;
}

/** The one member of a union once its empty members are dropped, else `undefined`. */
function soleNonEmptyMember(schema: z.ZodType): z.ZodType | undefined {
  const def = (schema as any)._zod?.def;
  if (def?.type !== 'union') return undefined;
  const members = (def.options ?? []).filter((m: z.ZodType) => !isEmptyZodMember(m));
  return members.length === 1 ? members[0] : undefined;
}

/** Is any layer of this schema's wrapper chain a `.readonly()`? */
export function isZodReadonly(schema: z.ZodType): boolean {
  let current: z.ZodType | undefined = schema;
  for (let i = 0; current && i < MAX_UNWRAP_DEPTH; i++) {
    if ((current as any)._zod?.def?.type === 'readonly') return true;
    current = peelZodWrapper(current);
  }
  return false;
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

/** One value of a closed vocabulary. */
export interface VocabularyEntry {
  /** The value as a string (what a widget shows and keys on). */
  value: string;
  /** The value as the schema accepts it (a number for a numeric enum): send this back. */
  raw: string | number | boolean | bigint;
  /** A label: the enum member name when there is one, else the value. */
  label: string;
}

/**
 * The closed vocabulary of a field, or null when it is open.
 *
 * Covers an enum (string, numeric or mixed TS enums, without TypeScript's
 * reverse mappings), a literal or a union of literals, and an array or set of any
 * of those (a tag field with allowed values), through every wrapper. `null` /
 * `undefined` members of a union mean "may be empty", not "open". Duplicates (by
 * string value) are dropped.
 */
export function getVocabularyEntries(schema: z.ZodType): VocabularyEntry[] | null {
  const leaf = (s: any, depth: number): VocabularyEntry[] | null => {
    if (!s || depth > MAX_UNWRAP_DEPTH) return null;
    const def = s._zod?.def;
    if (!def) return null;
    const inner = peelZodWrapper(s);
    if (inner) return leaf(inner, depth + 1);
    switch (def.type) {
      case 'enum': {
        const entries: Record<string, unknown> = def.entries ?? {};
        const out: VocabularyEntry[] = [];
        for (const [key, value] of Object.entries(entries)) {
          // TypeScript's reverse mapping of a numeric member: { "0": "A" } beside { A: 0 }.
          const forward = typeof value === 'string' ? entries[value] : undefined;
          if (typeof forward === 'number' && String(forward) === key) continue;
          if (typeof value === 'string' || typeof value === 'number') {
            // The member name labels a numeric member (0 → "A"); a string member keeps its value as label.
            out.push({ value: String(value), raw: value, label: typeof value === 'number' ? key : String(value) });
          }
        }
        return out.length ? out : null;
      }
      case 'literal': {
        const values: unknown[] = def.values ?? (def.value !== undefined ? [def.value] : []);
        const out = values
          .filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
          .map((v) => ({ value: String(v), raw: v as VocabularyEntry['raw'], label: String(v) }));
        return out.length ? out : null;
      }
      case 'null':
      case 'undefined':
        return [];
      case 'union': {
        const out: VocabularyEntry[] = [];
        for (const option of def.options ?? []) {
          const v = leaf(option, depth + 1);
          if (!v) return null; // an open member makes the vocabulary open
          out.push(...v);
        }
        return out.length ? out : null;
      }
      default:
        return null;
    }
  };
  const unwrapped: any = unwrapZodSchema(schema);
  const def = unwrapped?._zod?.def;
  const entries = def?.type === 'array' || def?.type === 'set' ? leaf(def.element ?? def.valueType, 0) : leaf(unwrapped, 0);
  if (!entries) return null;
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.value) ? false : (seen.add(e.value), true)));
}

/**
 * How many of a closed vocabulary a field takes (see {@link ChoiceArity}), or `null` when the
 * field is not a closed choice. The one place "is this a closed choice" is decided.
 */
export function getChoiceArity(schema: z.ZodType): ChoiceArity | null {
  if (!getVocabularyEntries(schema)) return null;
  const type = (unwrapZodSchema(schema) as any)?._zod?.def?.type;
  return type === 'array' || type === 'set' ? 'multi' : 'single';
}

/** The closed vocabulary's values as strings (see {@link getVocabularyEntries}), or null when open. */
export function getVocabulary(schema: z.ZodType): string[] | null {
  return getVocabularyEntries(schema)?.map((e) => e.value) ?? null;
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

/** A number schema's bounds. An `exclusive*` flag is set when that bound itself is excluded (`.gt()`, `.positive()`). */
export interface NumericBounds {
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
}

/**
 * Get the bounds of a number schema (through wrappers). Unbounded sides are absent: an
 * infinite limit, and the ±`Number.MAX_SAFE_INTEGER` that `z.int()` sets, are not bounds.
 */
export function getNumericBounds(schema: z.ZodType): NumericBounds {
  return limitSchemas(schema).map(numericBoundsOf).reduce(tighterBounds, {});
}

/** The bounds one (unwrapped) schema declares. */
function numericBoundsOf(unwrapped: any): NumericBounds {
  const bag = unwrapped._zod?.bag ?? {};
  const result: NumericBounds = {};
  const isBound = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) !== Number.MAX_SAFE_INTEGER;

  // Zod v4: the effective min/max are instance properties on the schema
  if (isBound(unwrapped.minValue)) {
    result.min = unwrapped.minValue;
    if (bag.exclusiveMinimum === unwrapped.minValue) result.exclusiveMin = true;
  }
  if (isBound(unwrapped.maxValue)) {
    result.max = unwrapped.maxValue;
    if (bag.exclusiveMaximum === unwrapped.maxValue) result.exclusiveMax = true;
  }
  return result;
}

/** One side of a bound: its value and whether it is exclusive. */
interface BoundSide {
  value?: number;
  exclusive?: boolean;
}

/** The tighter of two sides (`pick` is `Math.max` for a min, `Math.min` for a max); exclusive wins a tie. */
function tighterSide(x: BoundSide, y: BoundSide, pick: (p: number, q: number) => number): BoundSide {
  if (x.value === undefined) return y;
  if (y.value === undefined) return x;
  const value = pick(x.value, y.value);
  return { value, exclusive: (x.value === value && x.exclusive) || (y.value === value && y.exclusive) };
}

/** The bounds a value meets when it must meet both `a` and `b`. */
function tighterBounds(a: NumericBounds, b: NumericBounds): NumericBounds {
  const min = tighterSide({ value: a.min, exclusive: a.exclusiveMin }, { value: b.min, exclusive: b.exclusiveMin }, Math.max);
  const max = tighterSide({ value: a.max, exclusive: a.exclusiveMax }, { value: b.max, exclusive: b.exclusiveMax }, Math.min);
  return {
    ...(min.value !== undefined ? { min: min.value } : {}),
    ...(min.exclusive ? { exclusiveMin: true } : {}),
    ...(max.value !== undefined ? { max: max.value } : {}),
    ...(max.exclusive ? { exclusiveMax: true } : {}),
  };
}

/** A string schema's length limits (see {@link getStringLength}). */
export interface StringLength {
  minLength?: number;
  maxLength?: number;
}

/**
 * The length limits of a string schema (through wrappers): `.min()`, `.max()`, `.length()`,
 * `.nonempty()`, on any string format (`z.email()`, `z.url()`, ...). Unlimited sides are
 * absent; a non-string schema has none.
 */
export function getStringLength(schema: z.ZodType): StringLength {
  const result: StringLength = {};
  if (getZodBaseType(schema) !== 'string') return result; // a string coerced to a number or a date is not a string field
  for (const side of limitSchemas(schema) as any[]) {
    if (side?._zod?.def?.type !== 'string') continue;
    if (typeof side.minLength === 'number') result.minLength = Math.max(result.minLength ?? 0, side.minLength);
    if (typeof side.maxLength === 'number') result.maxLength = Math.min(result.maxLength ?? Infinity, side.maxLength);
  }
  return result;
}

/**
 * The increment a numeric input should step by: the schema's `.multipleOf()`, else `1`
 * for an integer (`z.int()`, `.int()`), else `undefined` (any number). Across a plain pipe,
 * the step that meets both sides (see `commonStep`).
 */
export function getNumericStep(schema: z.ZodType): number | undefined {
  return limitSchemas(schema).map(numericStepOf).reduce(commonStep, undefined) ?? undefined;
}

/**
 * A step: `undefined` when nothing constrains it, `null` when the constraints have no exact
 * common step (a wrong step is worse than none: it would turn an exclusive bound into a wrong
 * inclusive one).
 */
type Step = number | undefined | null;

/**
 * The step one (unwrapped) schema declares: every usable `.multipleOf()` it carries (Zod's
 * bag keeps only one of a chain, so the checks are read), combined with `1` if it is an integer.
 */
function numericStepOf(unwrapped: any): Step {
  const checks: any[] = unwrapped._zod?.def?.checks ?? [];
  const declared = checks.filter((c) => c?._zod?.def?.check === 'multiple_of').map((c) => c._zod.def.value);
  const usable = declared.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0).map(Math.abs);
  return [...usable, unwrapped.isInt === true ? 1 : undefined].reduce<Step>(commonStep, undefined);
}

/**
 * The step a value meeting both steps moves by: their least common multiple, computed exactly
 * on the decimal digits (0.1 and 0.25: 0.5; 1 and 2.5: 5; 4 and 6: 12). `null` when it has no
 * exact safe form.
 */
function commonStep(a: Step, b: Step): Step {
  if (a === null || b === null) return null;
  if (a === undefined) return b;
  if (b === undefined) return a;
  const scale = 10 ** Math.max(decimalsOf(a), decimalsOf(b));
  const x = Math.round(a * scale);
  const y = Math.round(b * scale);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  const lcm = (x / gcd(x, y)) * y;
  return Number.isSafeInteger(lcm) ? lcm / scale : null;
}

/** How many decimal places `x` is written with (0.25: 2, 1e-7: 7, 100: 0). */
function decimalsOf(x: number): number {
  const [mantissa, exponent] = x.toExponential().split('e');
  return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
}

function gcd(x: number, y: number): number {
  return y === 0 ? x : gcd(y, x % y);
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

/** An open or mixed union (`string | number`, a discriminated union) or an intersection: shown as is, edited as JSON. */
const UNION_FIELD_DEFAULTS: FieldAffordance = {
  sortable: false,
  filterable: false,
  searchable: false,
  groupable: false,
  editable: true,
  visible: true,
};

const UNKNOWN_FIELD_DEFAULTS: FieldAffordance = {
  sortable: false,
  filterable: false,
  searchable: false,
  groupable: false,
  editable: false,
  visible: true,
};

/**
 * The type whose defaults a field gets: a literal or a union of literals
 * (`z.literal([2, 4])`) is a closed choice, so it behaves like an enum.
 */
function defaultsType(schema: z.ZodType, baseType: string): string {
  return getChoiceArity(schema) === 'single' ? 'enum' : baseType;
}

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
    case 'union': // includes z.discriminatedUnion, which reports 'union' in Zod 4
    case 'intersection':
      return { ...UNION_FIELD_DEFAULTS };
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

  // Layer 1: Type-based defaults (a `.readonly()` field is not editable)
  let affordances = getTypeDefaults(defaultsType(schema, baseType));
  if (isZodReadonly(schema)) affordances = { ...affordances, editable: false };

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

/** A plain object (`{}` or `Object.create(null)`): not null, an array, or a class instance. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
    'tooltip', 'editWidget', 'filterWidget', 'editPlaceholder', 'editHelp', 'editWidgetOptions', 'step',
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

  // Plain data only: a string, an array or a class instance is not a widget's options.
  if ('editWidgetOptions' in result && !isPlainObject(result.editWidgetOptions)) delete result.editWidgetOptions;

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
  'readable', 'inlineEditable', 'editWidget', 'filterWidget', 'editWidgetOptions', 'truncate', 'tooltip',
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

  // Layer 1: Type-based defaults (a `.readonly()` field is not editable)
  const typeForDefaults = defaultsType(schema, baseType);
  const afterType = getTypeDefaults(typeForDefaults);
  if (isZodReadonly(schema)) afterType.editable = false;

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
        reason: typeForDefaults === baseType ? `${baseType} type defaults` : `${baseType} is a closed choice: ${typeForDefaults} defaults`,
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
