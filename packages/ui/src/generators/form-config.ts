/**
 * Form Configuration Generator.
 *
 * Produces form field configs for create/edit forms.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FieldAffordance } from '@zodal/core';
import { getVocabularyEntries } from '@zodal/core';

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
}

/** Infer the form widget type from Zod type + affordances. */
function inferFormWidgetType(zodType: string, fa: FieldAffordance): string {
  // Explicit override takes precedence
  if (fa.editWidget) return fa.editWidget;

  // Content fields default to file upload
  if (fa.storageRole === 'content') return 'file';

  switch (zodType) {
    case 'string': return 'text';
    case 'number':
    case 'int':
    case 'float': return 'number';
    case 'boolean': return 'checkbox';
    case 'enum': return 'select';
    case 'date': return 'date';
    case 'array': return 'tags';
    case 'object': return 'json';
    default: return 'text';
  }
}

/**
 * One selectable value. `value` is a string for widgets to key on; `raw` is the
 * value as the schema accepts it (a number for a numeric enum): write `raw` back.
 */
export interface VocabularyOption {
  label: string;
  value: string;
  raw?: string | number | boolean | bigint;
}

/**
 * A vocabulary entry as a widget option; the label is capitalized. `raw` is set
 * only when it differs from the string `value` (numbers, booleans), so string
 * vocabularies keep the plain `{ label, value }` shape.
 */
export function toOption(e: { value: string; raw: VocabularyOption['raw']; label: string }): VocabularyOption {
  const label = e.label.charAt(0).toUpperCase() + e.label.slice(1);
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
      type: inferFormWidgetType(zodType, fa),
      required: isRequired,
      disabled: fa.editable === false,
      hidden: fa.hidden ?? false,
      placeholder: fa.editPlaceholder,
      helpText: fa.editHelp ?? fa.description,
      options,
      ...(zodType === 'array' || zodType === 'set' ? { allowCreate: !enumValues } : {}),
      order: fa.order ?? orderCounter++,
      zodType,
      ...(fa.storageRole === 'content' ? { isContentField: true } : {}),
    });
  }

  return fields.sort((a, b) => a.order - b.order);
}
