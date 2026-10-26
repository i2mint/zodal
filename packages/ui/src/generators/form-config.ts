/**
 * Form Configuration Generator.
 *
 * Produces form field configs for create/edit forms.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FieldAffordance, NumericBounds } from '@zodal/core';
import { getChoiceArity, getNumericBounds, getNumericStep, getVocabularyEntries } from '@zodal/core';
import type { ChoiceArity, VocabularyEntry } from '@zodal/core';

export interface FormFieldConfig {
  /** Field key. */
  name: string;
  /** Display label. */
  label: string;
  /** Input widget type. */
  type: string;
  /** Whether this field is required. */
  required: boolean;
  /** Whether this field is disabled (read-only). */
  disabled: boolean;
  /** Whether this field is hidden. */
  hidden: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** Help text. */
  helpText?: string;
  /** Default value. */
  defaultValue?: unknown;
  /** Options for select/multiselect fields, and the allowed values of a closed tag vocabulary. */
  options?: VocabularyOption[];
  /** For a `'tags'` field: may the user add values not in `options`? (False when the vocabulary is closed.) */
  allowCreate?: boolean;
  /** Display order. */
  order: number;
  /** Zod type for the underlying schema. */
  zodType: string;
  /** Whether this field accepts file/content uploads. */
  isContentField?: boolean;
  /** Accepted MIME types for file upload. */
  acceptMimeTypes?: string[];
  /** Max file size in bytes. */
  maxSize?: number;
  /**
   * A numeric field's bounds (from `.min()` / `.max()` and friends). An exclusive bound
   * (`.positive()`, `.lt()`) is moved in by one `step` when there is one; otherwise it
   * keeps its `exclusiveMin` / `exclusiveMax` flag for the renderer.
   */
  bounds?: NumericBounds;
  /** A numeric field's increment: a declared `step` affordance, else `.multipleOf()`, else `1` for an integer. */
  step?: number;
}

const NUMERIC_TYPES = new Set(['number', 'int', 'float']);

/** The `bounds` and `step` of a numeric field (none for any other type); `step` overrides the inferred step. */
export function numericFieldProps(
  zodType: string,
  schema: z.ZodType,
  step?: number,
): Pick<FormFieldConfig, 'bounds' | 'step'> {
  if (!NUMERIC_TYPES.has(zodType)) return {};
  const declared = step !== undefined && Number.isFinite(step) && step > 0 ? step : undefined;
  const inferredStep = declared ?? getNumericStep(schema);
  const bounds = getNumericBounds(schema);
  if (inferredStep !== undefined) {
    if (bounds.exclusiveMin && bounds.min !== undefined) {
      bounds.min += inferredStep;
      delete bounds.exclusiveMin;
    }
    if (bounds.exclusiveMax && bounds.max !== undefined) {
      bounds.max -= inferredStep;
      delete bounds.exclusiveMax;
    }
  }
  return {
    ...(Object.keys(bounds).length ? { bounds } : {}),
    ...(inferredStep !== undefined ? { step: inferredStep } : {}),
  };
}

/** Zod types a form has no dedicated widget for: edited as JSON text. */
const JSON_TYPES = new Set([
  'object', 'record', 'map', 'tuple', 'union', 'intersection', 'any', 'unknown', 'discriminatedUnion',
]);

/**
 * The widget type for a field: a closed choice is a `'select'` (one value) or
 * `'tags'` (several), whatever its Zod type; otherwise the Zod type decides.
 * The one rule behind both `toFormConfig` and `toOptionsFormConfig`.
 */
export function widgetTypeFor(zodType: string, choice: ChoiceArity | null): string {
  if (choice) return choice === 'multi' ? 'tags' : 'select';
  switch (zodType) {
    case 'string': return 'text';
    case 'number':
    case 'int':
    case 'float': return 'number';
    case 'boolean': return 'checkbox';
    case 'date': return 'date';
    case 'array':
    case 'set': return 'tags';
    default: return JSON_TYPES.has(zodType) ? 'json' : 'text';
  }
}

/** Infer the form widget type from Zod type + affordances. */
function inferFormWidgetType(zodType: string, fa: FieldAffordance, choice: ChoiceArity | null): string {
  // Explicit override takes precedence
  if (fa.editWidget) return fa.editWidget;

  // Content fields default to file upload
  if (fa.storageRole === 'content') return 'file';

  return widgetTypeFor(zodType, choice);
}

/**
 * One selectable value. `value` is a string for widgets to key on; `raw` is the
 * value as the schema accepts it (a number for a numeric enum): write `raw` back.
 * Absent for strings and bigints (the string `value` is then the portable form). `kind: 'bigint'`
 * marks a bigint choice so a widget can coerce with `BigInt(value)` (see `selectedValue`, which does).
 */
export interface VocabularyOption {
  label: string;
  value: string;
  raw?: string | number | boolean;
  /** Set when the choice is a bigint (not JSON-safe, so it has no `raw`): coerce `value` with `BigInt`. */
  kind?: 'bigint';
}

/**
 * A vocabulary entry as a widget option; the label is capitalized. `raw` is set
 * only when it differs from the string `value` (numbers, booleans), so string
 * vocabularies keep the plain `{ label, value }` shape.
 */
export function toOption(e: VocabularyEntry): VocabularyOption {
  const label = e.label.charAt(0).toUpperCase() + e.label.slice(1);
  // A bigint is not JSON-safe: its string `value` is the portable form.
  if (typeof e.raw === 'bigint') return { label, value: e.value, kind: 'bigint' };
  return typeof e.raw === 'string' ? { label, value: e.value } : { label, value: e.value, raw: e.raw };
}

/**
 * Generate form field configurations for create or edit forms.
 */
export function toFormConfig<T extends z.ZodObject<any>>(
  collection: CollectionDefinition<T>,
  mode: 'create' | 'edit' = 'create',
): FormFieldConfig[] {
  const fields: FormFieldConfig[] = [];
  const shape = collection.schema.shape as Record<string, z.ZodType>;
  let orderCounter = 0;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fa = collection.fieldAffordances[key];

    // Skip fields that are not relevant for this mode
    if (fa.readable === false && mode === 'edit') continue;
    if (fa.editable === false && mode === 'create' && !fa.requiredOnCreate) continue;
    if (fa.editable === false && mode === 'edit') continue;
    if (fa.hidden) continue;

    // Skip immutable fields on edit
    if (mode === 'edit' && fa.immutableAfterCreate) continue;

    const zodType = fa.zodType;
    const isRequired = mode === 'create'
      ? (fa.requiredOnCreate ?? false)
      : (fa.requiredOnUpdate ?? false);

    // Closed vocabulary (an enum, literals, or an array of them: a 'tags' widget
    // with allowed values). Open array fields accept new values (allowCreate).
    let options: VocabularyOption[] | undefined;
    const vocabulary = getVocabularyEntries(fieldSchema);
    const enumValues = vocabulary?.map((e) => e.value) ?? null;
    if (vocabulary) options = vocabulary.map(toOption);

    fields.push({
      name: key,
      label: fa.title,
      type: inferFormWidgetType(zodType, fa, getChoiceArity(fieldSchema)),
      required: isRequired,
      disabled: fa.editable === false,
      hidden: fa.hidden ?? false,
      placeholder: fa.editPlaceholder,
      helpText: fa.editHelp ?? fa.description,
      options,
      ...(zodType === 'array' || zodType === 'set' ? { allowCreate: !enumValues } : {}),
      order: fa.order ?? orderCounter++,
      zodType,
      ...numericFieldProps(zodType, fieldSchema, fa.step),
      ...(fa.storageRole === 'content' ? { isContentField: true } : {}),
    });
  }

  return fields.sort((a, b) => a.order - b.order);
}
