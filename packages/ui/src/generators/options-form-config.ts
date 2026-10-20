/**
 * Options-form generator: a form for a Zod object that is NOT a collection record.
 *
 * Provider options, connection settings and other settings-like objects have no
 * id, no timestamps and no rows, so the record-oriented inference behind
 * `toFormConfig` gets them wrong: name heuristics hide `accessKeyId` and
 * `storageKey` (anything ending in `Id`/`Key` reads as an identifier), and secrets
 * get a plain text box. `toOptionsFormConfig` reads the schema directly:
 *
 * - no name heuristics: every field is editable unless its metadata says otherwise;
 * - secrets (marked `.meta({ sensitivity: 'secret' })`, secret-looking names, or
 *   paths the caller passes) are `'password'` fields;
 * - nested objects are `'fieldset'` entries carrying their own `fields`;
 * - values a form cannot produce (`z.custom`, functions, `.meta({ serializable: false })`)
 *   are disabled `'code'` entries marked `suppliedInCode`, so a UI can say
 *   "supplied in code" instead of offering an input.
 *
 * Headless, like the other generators: it returns data, not components.
 */

import { z } from 'zod';
import {
  getVocabularyEntries,
  getZodMeta,
  humanizeFieldName,
  secretPaths as schemaSecretPaths,
  unwrapZodSchema,
} from '@zodal/core';
import type { SecretPath } from '@zodal/core';
import { toOption } from './form-config.js';
import type { FormFieldConfig, VocabularyOption } from './form-config.js';

/** One entry of an options form. */
export interface OptionsFormField extends FormFieldConfig {
  /** Where the value lives in the options object (`name` is this path joined with `.`). */
  path: string[];
  /** For a `'fieldset'` (a nested object): its fields, in order. */
  fields?: OptionsFormField[];
  /** A secret: rendered as `'password'`, and never to be echoed back. */
  secret?: boolean;
  /** The value cannot be typed into a form (a function, a client instance): it is supplied in code. */
  suppliedInCode?: boolean;
}

export interface OptionsFormConfigOptions {
  /**
   * Extra secret paths, e.g. a provider descriptor's `secretOptionPaths`. Added to
   * the schema's own (marked or secret-looking names). `'*'` matches any key.
   */
  secretPaths?: readonly SecretPath[];
}

/** Base types a form cannot produce: the value must come from code. */
const CODE_ONLY_TYPES = new Set(['custom', 'function', 'promise', 'symbol', 'never', 'void', 'undefined', 'transform']);

/** Base types with no dedicated widget but a JSON-editable value. */
const JSON_TYPES = new Set(['record', 'map', 'tuple', 'union', 'intersection', 'any', 'unknown', 'discriminatedUnion']);

/**
 * Generate the form for a settings-like Zod object (provider options and the like).
 *
 * @example
 * const fields = toOptionsFormConfig(z.object({
 *   bucket: z.string(),
 *   accessKeyId: z.string(),
 *   secretAccessKey: z.string(),
 *   retry: z.object({ attempts: z.number().default(3) }).optional(),
 *   client: z.custom<S3Client>(),
 * }));
 * // bucket: text, accessKeyId: text (editable), secretAccessKey: password,
 * // retry: fieldset [attempts: number, default 3], client: code (suppliedInCode)
 */
export function toOptionsFormConfig<T extends z.ZodObject<any>>(
  schema: T,
  options: OptionsFormConfigOptions = {},
): OptionsFormField[] {
  const secrets = [...schemaSecretPaths(schema), ...(options.secretPaths ?? [])];
  const isSecretPath = (path: string[]) =>
    secrets.some((s) => s.length === path.length && s.every((seg, i) => seg === '*' || String(seg) === path[i]));
  return fieldsOf(schema, [], isSecretPath);
}

function fieldsOf(
  objectSchema: z.ZodType,
  parent: string[],
  isSecretPath: (path: string[]) => boolean,
): OptionsFormField[] {
  const def = (objectSchema as any)._zod.def;
  const shape: Record<string, z.ZodType> = typeof def.shape === 'function' ? def.shape() : def.shape ?? {};
  const fields = Object.entries(shape).map(([key, fieldSchema], index) =>
    fieldOf(key, fieldSchema, [...parent, key], index, isSecretPath),
  );
  return fields.sort((a, b) => a.order - b.order);
}

function fieldOf(
  key: string,
  fieldSchema: z.ZodType,
  path: string[],
  index: number,
  isSecretPath: (path: string[]) => boolean,
): OptionsFormField {
  const base = unwrapZodSchema(fieldSchema);
  const zodType: string = (base as any)._zod?.def?.type ?? 'unknown';
  // Metadata may sit on the wrapper (`.optional().meta(...)`) or on the inner schema.
  const meta: Record<string, any> = { ...getZodMeta(base), ...getZodMeta(fieldSchema) };
  const secret = isSecretPath(path);
  const suppliedInCode = meta.serializable === false || CODE_ONLY_TYPES.has(zodType);
  const vocabulary = suppliedInCode ? null : getVocabularyEntries(fieldSchema);
  const options: VocabularyOption[] | undefined = vocabulary?.map(toOption);
  const isList = zodType === 'array' || zodType === 'set';
  const defaultValue = defaultOf(fieldSchema);

  const field: OptionsFormField = {
    name: path.join('.'),
    path,
    label: meta.title ?? humanizeFieldName(key),
    type: meta.editWidget ?? widgetFor(zodType, { secret, suppliedInCode, hasOptions: !!options }),
    required: (fieldSchema as any)._zod?.optin !== 'optional',
    disabled: suppliedInCode || meta.editable === false,
    hidden: meta.hidden === true,
    placeholder: meta.editPlaceholder,
    helpText: meta.editHelp ?? meta.description ?? (fieldSchema as any).description,
    order: meta.order ?? index,
    zodType,
    ...(options ? { options } : {}),
    ...(isList ? { allowCreate: !vocabulary } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(secret ? { secret } : {}),
    ...(suppliedInCode ? { suppliedInCode } : {}),
  };
  if (zodType === 'object' && !suppliedInCode) field.fields = fieldsOf(base, path, isSecretPath);
  return field;
}

function widgetFor(
  zodType: string,
  { secret, suppliedInCode, hasOptions }: { secret: boolean; suppliedInCode: boolean; hasOptions: boolean },
): string {
  if (suppliedInCode) return 'code';
  if (zodType === 'object') return 'fieldset';
  if (secret) return 'password';
  if (zodType === 'array' || zodType === 'set') return 'tags';
  if (hasOptions) return 'select';
  switch (zodType) {
    case 'string': return 'text';
    case 'number':
    case 'int':
    case 'float':
    case 'bigint': return 'number';
    case 'boolean': return 'checkbox';
    case 'date': return 'date';
    default: return JSON_TYPES.has(zodType) ? 'json' : 'text';
  }
}

/** The value a `.default()` / `.prefault()` on the way down gives this field, if any. */
function defaultOf(schema: z.ZodType): unknown {
  let current: any = schema;
  for (let depth = 0; current && depth < 16; depth++) {
    const def = current._zod?.def;
    if (!def) return undefined;
    if (def.type === 'default' || def.type === 'prefault') return def.defaultValue;
    if (!('innerType' in def)) return undefined;
    current = def.innerType;
  }
  return undefined;
}
