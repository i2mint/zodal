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
 *   paths the caller passes, each covering everything below it) are `'password'`
 *   fields, or `'code'` entries when the secret is a structured value;
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
import { numericFieldProps, toOption } from './form-config.js';
import type { FormFieldConfig, VocabularyOption } from './form-config.js';

/** One entry of an options form. */
export interface OptionsFormField extends FormFieldConfig {
  /**
   * Where the value lives in the options object: the field's identity. (`name` is this
   * path joined with `.`, for display and `id`s; a key containing a dot makes it ambiguous.)
   */
  path: string[];
  /** For a `'fieldset'` (a nested object): its fields, in order. */
  fields?: OptionsFormField[];
  /**
   * A secret, or a value holding one: never echo it, log it or prefill it. A secret
   * string or number is a `'password'` field; a structured value holding secrets is
   * a `'code'` entry (`suppliedInCode`), since no masked widget can edit it.
   */
  secret?: boolean;
  /** The value cannot be typed into a form (a function, a client instance): it is supplied in code. */
  suppliedInCode?: boolean;
}

export interface OptionsFormConfigOptions {
  /**
   * Extra secret paths, e.g. a provider descriptor's `secretOptionPaths(descriptor, options)`.
   * Added to the schema's own (`.meta({ sensitivity: 'secret' })` and secret-looking names,
   * from `@zodal/core`'s `secretPaths`). A path covers everything below it.
   */
  secretPaths?: readonly SecretPath[];
  /**
   * Extra paths to values supplied in code, e.g. a descriptor's `liveOptionPaths(descriptor)`.
   * `z.custom`, functions and `.meta({ serializable: false })` fields are found without it.
   */
  livePaths?: readonly SecretPath[];
}

/** Base types a form cannot produce: the value must come from code. */
const CODE_ONLY_TYPES = new Set(['custom', 'function', 'promise', 'symbol', 'never', 'void', 'transform']);

/** Base types with no dedicated widget but a JSON-editable value. */
const JSON_TYPES = new Set(['record', 'map', 'tuple', 'union', 'intersection', 'any', 'unknown', 'discriminatedUnion']);

/** Base types that accept `undefined` without an `.optional()`. */
const OPTIONAL_TYPES = new Set(['any', 'unknown', 'undefined', 'void']);

/** Secret types a masked text box can edit; any other secret value is supplied in code. */
const MASKABLE_TYPES = new Set(['string', 'number', 'int', 'float', 'bigint']);

/** How a path relates to a set of paths: one of them at or above it, or one strictly below it. */
interface PathIndex {
  covers(path: string[]): boolean;
  below(path: string[]): boolean;
}

/**
 * Paths from `@zodal/core` use `'*'` for an array index, a record key or an object's
 * catchall. The form only ever walks declared object keys, so `'*'` never matches here:
 * a catchall secret does not make the declared siblings secret.
 */
function pathIndex(paths: readonly SecretPath[]): PathIndex {
  const prefixMatches = (p: SecretPath, path: string[], n: number) => {
    for (let i = 0; i < n; i++) if (p[i] === '*' || String(p[i]) !== path[i]) return false;
    return true;
  };
  return {
    covers: (path) => paths.some((p) => p.length <= path.length && prefixMatches(p, path, p.length)),
    below: (path) => paths.some((p) => p.length > path.length && prefixMatches(p, path, path.length)),
  };
}

/**
 * Generate the form for a settings-like Zod object (provider options and the like).
 *
 * `schema` may be wrapped (`.optional()`, `z.lazy`, ...) but must be an object
 * underneath. Requiredness is within the field's own fieldset: a required field of an
 * optional group is needed only when the group is filled in. A self-recursive
 * `z.lazy` schema throws core's `SchemaIntrospectionError` (secret detection fails
 * closed rather than guess).
 *
 * @example
 * const fields = toOptionsFormConfig(z.object({
 *   bucket: z.string(),
 *   secretAccessKey: z.string(),
 *   retry: z.object({ attempts: z.number().default(3) }).optional(),
 *   client: z.custom<S3Client>(),
 * }));
 * // bucket: text, secretAccessKey: password, retry: fieldset [attempts: number,
 * // default 3], client: code (suppliedInCode)
 */
export function toOptionsFormConfig(schema: z.ZodType, options: OptionsFormConfigOptions = {}): OptionsFormField[] {
  const base = unwrapZodSchema(schema);
  const type = (base as any)?._zod?.def?.type;
  if (type !== 'object') {
    throw new TypeError(`toOptionsFormConfig needs a Zod object schema (an options object), got ${JSON.stringify(type)}`);
  }
  const secrets = pathIndex([...schemaSecretPaths(schema), ...(options.secretPaths ?? [])]);
  const live = pathIndex(options.livePaths ?? []);
  return fieldsOf(base, [], { secrets, live });
}

interface Context {
  secrets: PathIndex;
  live: PathIndex;
}

function fieldsOf(objectSchema: z.ZodType, parent: string[], ctx: Context): OptionsFormField[] {
  const def = (objectSchema as any)._zod.def;
  const shape: Record<string, z.ZodType> = typeof def.shape === 'function' ? def.shape() : def.shape ?? {};
  const fields = Object.entries(shape).map(([key, fieldSchema], index) =>
    fieldOf(key, fieldSchema, [...parent, key], index, ctx),
  );
  return fields.sort((a, b) => a.order - b.order);
}

function fieldOf(key: string, fieldSchema: z.ZodType, path: string[], index: number, ctx: Context): OptionsFormField {
  const base = unwrapZodSchema(fieldSchema);
  const zodType: string = (base as any)._zod?.def?.type ?? 'unknown';
  const meta = metaOf(fieldSchema);
  const isObject = zodType === 'object';
  const codeOnly = meta.serializable === false || CODE_ONLY_TYPES.has(zodType) || ctx.live.covers(path);
  // A group renders its own fields, each checked on its own; any other value is one input.
  const asFieldset = isObject && !codeOnly;
  const secret = ctx.secrets.covers(path) || (!asFieldset && ctx.secrets.below(path));
  const suppliedInCode =
    codeOnly || (!asFieldset && ctx.live.below(path)) || (secret && !asFieldset && !MASKABLE_TYPES.has(zodType));
  const vocabulary = suppliedInCode || secret ? null : getVocabularyEntries(fieldSchema);
  const options: VocabularyOption[] | undefined = vocabulary?.map(toOption);
  const isList = zodType === 'array' || zodType === 'set';
  // A secret's default would be shown in the form: leave it out.
  const defaultValue = secret ? undefined : defaultOf(fieldSchema);

  let type: string;
  if (suppliedInCode) type = 'code';
  else if (asFieldset) type = 'fieldset';
  else if (secret) type = 'password'; // never meta.editWidget: it could unmask the value
  else type = meta.editWidget ?? widgetFor(zodType, !!options);

  const field: OptionsFormField = {
    name: path.join('.'),
    path,
    label: meta.title ?? humanizeFieldName(key),
    type,
    required: (fieldSchema as any)._zod?.optin !== 'optional' && !OPTIONAL_TYPES.has(zodType),
    disabled: suppliedInCode || meta.editable === false,
    hidden: meta.hidden === true,
    placeholder: meta.editPlaceholder,
    helpText: meta.editHelp ?? meta.description ?? (fieldSchema as any).description,
    order: meta.order ?? index,
    zodType,
    ...(options ? { options } : {}),
    ...(suppliedInCode || secret ? {} : numericFieldProps(zodType, fieldSchema, typeof meta.step === 'number' ? meta.step : undefined)),
    ...(isList && !suppliedInCode && !secret ? { allowCreate: !vocabulary } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(secret ? { secret } : {}),
    ...(suppliedInCode ? { suppliedInCode } : {}),
  };
  if (asFieldset) field.fields = fieldsOf(base, path, ctx);
  return field;
}

function widgetFor(zodType: string, hasOptions: boolean): string {
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

/** Metadata from every wrapper on the way down, the outermost winning (`.optional().meta(...)` included). */
function metaOf(schema: z.ZodType): Record<string, any> {
  const layers: Record<string, any>[] = [];
  let current: any = schema;
  for (let depth = 0; current?._zod?.def && depth < 16; depth++) {
    layers.push(getZodMeta(current) ?? {});
    const def = current._zod.def;
    if (!('innerType' in def)) break;
    current = def.innerType;
  }
  layers.push(getZodMeta(unwrapZodSchema(schema)) ?? {});
  return Object.assign({}, ...layers.reverse());
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
