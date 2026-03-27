/**
 * Form Configuration Generator.
 *
 * Produces form field configs for create/edit forms.
 * Headless — produces data, not React components.
 */

import { z } from 'zod';
import type { CollectionDefinition, FieldAffordance } from '@zodal/core';
import { getEnumValues } from '@zodal/core';

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
  /** Options for select/multiselect fields. */
  options?: { label: string; value: string }[];
  /** Display order. */
  order: number;
  /** Zod type for the underlying schema. */
  zodType: string;
}

/** Infer the form widget type from Zod type + affordances. */
function inferFormWidgetType(zodType: string, fa: FieldAffordance): string {
  // Explicit override takes precedence
  if (fa.editWidget) return fa.editWidget;

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

    // Get enum options if applicable
    let options: { label: string; value: string }[] | undefined;
    const enumValues = getEnumValues(fieldSchema);
    if (enumValues) {
      options = enumValues.map(v => ({
        label: v.charAt(0).toUpperCase() + v.slice(1),
        value: v,
      }));
    }

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
      order: fa.order ?? orderCounter++,
      zodType,
    });
  }

  return fields.sort((a, b) => a.order - b.order);
}
