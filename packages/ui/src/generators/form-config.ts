/**
 * Form Configuration Generator.
 *
 * Produces form field configs for create/edit forms.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { ChoiceData, CollectionDefinition, FieldAffordance, FieldChoice, NumericBounds, ResolvedFieldHistory, WidgetOptions } from '@zodal/core';
import { getDateBounds, getFieldChoices, getNumericBounds, getNumericStep, getStringLength, inferSticky, resolveFieldHistory } from '@zodal/core';
import type { ChoiceArity } from '@zodal/core';

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
   * A numeric field's bounds (from `.min()` / `.max()` and friends), or a date field's in epoch
   * milliseconds (`new Date(bounds.min)` is the earliest date). An exclusive bound
   * (`.positive()`, `.lt()`) is moved in by one `step` when there is one; otherwise it
   * keeps its `exclusiveMin` / `exclusiveMax` flag for the renderer.
   */
  bounds?: NumericBounds;
  /** A numeric field's increment: a declared `step` affordance, else `.multipleOf()`, else `1` for an integer. */
  step?: number;
  /** A string field's fewest characters (`.min()`, `.length()`, `.nonempty()`), for the input's `minLength`. */
  minLength?: number;
  /** A string field's most characters (`.max()`, `.length()`), for the input's `maxLength`. */
  maxLength?: number;
  /** The field's `editWidgetOptions` affordance: the widget's own options, a shallow copy per config. */
  editWidgetOptions?: Readonly<WidgetOptions>;
  /** Keeps its value when the form starts a new item (the resolved `sticky` affordance; see `startNewItem`). */
  sticky: boolean;
  /** The resolved history settings, or absent when the field has no history (see `RendererContext.history`). */
  history?: ResolvedFieldHistory;
}

/** The Zod types whose values are plain numbers (a bigint is not: `Number()` would round it). */
export const NUMERIC_TYPES: ReadonlySet<string> = new Set(['number', 'int', 'float']);

/** The `bounds` and `step` of a numeric field, the `bounds` of a date field (epoch ms); none for any other type. `step` overrides the inferred step. */
export function numericFieldProps(
  zodType: string,
  schema: z.ZodType,
  step?: number,
): Pick<FormFieldConfig, 'bounds' | 'step'> {
  if (zodType === 'date') {
    const bounds = getDateBounds(schema);
    return Object.keys(bounds).length ? { bounds } : {};
  }
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

/**
 * The `minLength` and `maxLength` of a string field (none for any other type, or when the
 * widget edits it as JSON text, where quotes and escapes would make the limits wrong).
 */
export function stringFieldProps(schema: z.ZodType, widget: string): Pick<FormFieldConfig, 'minLength' | 'maxLength'> {
  return widget === 'json' ? {} : getStringLength(schema);
}

/** A field's resolved `history`, as a spread: none when the field has no history. */
export function historyProps(name: string, history: unknown): Pick<FormFieldConfig, 'history'> {
  const resolved = resolveFieldHistory(name, history);
  return resolved ? { history: resolved } : {};
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
  /** A curated choice's line of explanation (see `FieldAffordance.choices`). */
  hint?: string;
  /** A curated choice's own data (a tone, an icon). */
  data?: Readonly<ChoiceData>;
}

/**
 * A field choice as a widget option, its label as `getFieldChoices` gives it. `raw` is set
 * only when it differs from the string `value` (numbers, booleans), so string choices keep
 * the plain `{ label, value }` shape; `hint` and `data` only when the choice has them.
 */
export function toOption({ value, raw, label, hint, data }: FieldChoice): VocabularyOption {
  // A bigint is not JSON-safe: its string `value` is the portable form.
  const option: VocabularyOption = typeof raw === 'bigint' ? { label, value, kind: 'bigint' }
    : typeof raw === 'string' ? { label, value } : { label, value, raw };
  if (hint !== undefined) option.hint = hint;
  if (data !== undefined) option.data = data;
  return option;
}

/**
 * The value an option stands for, as the schema accepts it: a bigint choice as a bigint,
 * else its `raw` when present, else its string value. Takes any `{ value }` option, so a
 * suggestion (which has no `raw`) decodes to its string.
 */
export function optionRaw(option: Pick<VocabularyOption, 'value'> & Partial<VocabularyOption>): string | number | boolean | bigint {
  if (option.kind === 'bigint') return BigInt(option.value);
  return option.raw !== undefined ? option.raw : option.value;
}

/**
 * A field's choices as widget options (see `getFieldChoices` in `@zodal/core`): its curated
 * `choices` when declared (labels as given, else the value capitalised; with hint and data),
 * else its closed vocabulary's (an enum, literals, or an array of them); `undefined` when the
 * field is open. Pass `{}` as the affordance to read the schema's vocabulary only.
 */
export function fieldOptions(schema: z.ZodType, affordance: Pick<FieldAffordance, 'choices'>): VocabularyOption[] | undefined {
  return getFieldChoices(schema, affordance)?.map(toOption);
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

    // Closed choices (curated, or a vocabulary: an enum, literals, or an array of them,
    // a 'tags' widget with allowed values). Open array fields accept new values (allowCreate).
    const options = fieldOptions(fieldSchema, fa);
    const type = inferFormWidgetType(zodType, fa, fa.choice);

    fields.push({
      name: key,
      label: fa.title,
      type,
      required: isRequired,
      disabled: fa.editable === false,
      hidden: fa.hidden ?? false,
      placeholder: fa.editPlaceholder,
      helpText: fa.editHelp ?? fa.description,
      ...(fa.editWidgetOptions ? { editWidgetOptions: { ...fa.editWidgetOptions } } : {}),
      options,
      ...(zodType === 'array' || zodType === 'set' ? { allowCreate: !options } : {}),
      order: fa.order ?? orderCounter++,
      zodType,
      ...numericFieldProps(zodType, fieldSchema, fa.step),
      ...stringFieldProps(fieldSchema, type),
      ...(fa.storageRole === 'content' ? { isContentField: true } : {}),
      sticky: fa.sticky ?? inferSticky(zodType, fa.choice === 'single' || fa.choice === 'multi'),
      ...historyProps(key, fa.history),
    });
  }

  return fields.sort((a, b) => a.order - b.order);
}
