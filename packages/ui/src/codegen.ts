/**
 * Code Generation: Materialize inferred affordances as TypeScript source code.
 */

import type { CollectionDefinition, FieldAffordance, OperationDefinition } from '@zodal/core';
import { inferFieldAffordances, humanizeFieldName, isPlainObject } from '@zodal/core';

// ============================================================================
// Types
// ============================================================================

export interface CodegenOptions {
  /** Include a header comment with generation metadata. Default: true. */
  header?: boolean;
  /** Include TypeScript import statement. Default: true. */
  imports?: boolean;
  /** Export name for the config object. Default: 'config'. */
  exportName?: string;
  /** Number of spaces for indentation. Default: 2. */
  indent?: number;
  /** Only include field affordances that differ from inference. Default: false. */
  diffOnly?: boolean;
  /** Module path for the import statement. Default: '@zodal/core'. */
  importFrom?: string;
}

export interface WriteResult {
  /** Whether the file was written to disk. */
  written: boolean;
  /** Why the file was or wasn't written. */
  reason: 'created' | 'updated' | 'unchanged';
  /** The absolute or relative file path. */
  filePath: string;
}

// ============================================================================
// Field property ordering for clean, consistent output
// ============================================================================

const FIELD_PROP_ORDER: (keyof FieldAffordance)[] = [
  'title', 'description',
  'sortable', 'filterable', 'searchable', 'groupable', 'aggregatable',
  'readable', 'editable', 'inlineEditable',
  'requiredOnCreate', 'requiredOnUpdate', 'immutableAfterCreate',
  'visible', 'hidden', 'detailOnly', 'summaryField',
  'columnWidth', 'minWidth', 'maxWidth', 'resizable', 'pinned', 'order',
  'displayFormat', 'badge', 'copyable', 'truncate', 'tooltip',
  'editWidget', 'filterWidget', 'editPlaceholder', 'editHelp', 'editWidgetOptions', 'choices', 'step',
];

/** Resolved by `defineCollection` from the schema, not declared: never written back (`choice` is not a `FieldAffordance` key). */
const COMPUTED_PROPS = new Set(['zodType', 'zodDef', 'choice']);

// ============================================================================
// Core: toCode
// ============================================================================

/**
 * Generate TypeScript source code that captures a collection's configuration.
 */
export function toCode(
  collection: CollectionDefinition<any>,
  options?: CodegenOptions,
): string {
  const opts = {
    header: true,
    imports: true,
    exportName: 'config',
    indent: 2,
    diffOnly: false,
    importFrom: '@zodal/core',
    ...options,
  };

  const sections: string[] = [];

  // Header comment
  if (opts.header) {
    const fieldNames = Object.keys(collection.fieldAffordances).join(', ');
    sections.push(
      '/**',
      ' * Auto-generated collection configuration.',
      ' *',
      ` * Captures the result of the inference engine for fields:`,
      ` * ${fieldNames}`,
      ' *',
      ' * Usage:',
      ` *   import { ${opts.exportName} } from './this-file';`,
      ` *   const collection = defineCollection(YourSchema, ${opts.exportName});`,
      ' */',
      '',
    );
  }

  // Import statement
  if (opts.imports) {
    sections.push(
      `import type { CollectionConfig } from '${opts.importFrom}';`,
      '',
    );
  }

  // Build and serialize the config object
  const configObj = buildConfigObject(collection, opts.diffOnly);
  const serialized = serialize(configObj, { depth: 0, indent: opts.indent, path: 'config' });

  sections.push(`export const ${opts.exportName}: CollectionConfig = ${serialized};`);
  sections.push('');

  return sections.join('\n');
}


// ============================================================================
// Config object builders
// ============================================================================

function buildConfigObject(
  collection: CollectionDefinition<any>,
  diffOnly: boolean,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  config.idField = collection.idField;
  config.labelField = collection.labelField;

  const affordances = filterUndefined(collection.affordances as Record<string, unknown>);
  if (Object.keys(affordances).length > 0) {
    config.affordances = affordances;
  }

  const fields = buildFieldsObject(collection, diffOnly);
  if (Object.keys(fields).length > 0) {
    config.fields = fields;
  }

  if (collection.operations.length > 0) {
    config.operations = collection.operations.map(buildOperationObject);
  }

  return config;
}

function buildFieldsObject(
  collection: CollectionDefinition<any>,
  diffOnly: boolean,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const shape = collection.schema.shape as Record<string, any>;

  for (const [key, fa] of Object.entries(collection.fieldAffordances)) {
    const props: Record<string, unknown> = {};

    if (diffOnly) {
      const fieldSchema = shape[key];
      if (!fieldSchema) continue;
      const inferred = inferFieldAffordances(key, fieldSchema);
      const inferredTitle = inferred.title ?? humanizeFieldName(key);

      for (const prop of FIELD_PROP_ORDER) {
        const resolved = (fa as any)[prop];
        if (resolved === undefined) continue;
        const baseline = prop === 'title' ? inferredTitle : (inferred as any)[prop];
        if (!valueEqual(resolved, baseline, `config.fields.${key}.${prop}`)) {
          props[prop] = resolved;
        }
      }
    } else {
      for (const prop of FIELD_PROP_ORDER) {
        const value = (fa as any)[prop];
        if (value !== undefined) {
          props[prop] = value;
        }
      }
      for (const [prop, value] of Object.entries(fa)) {
        if (
          value !== undefined &&
          !COMPUTED_PROPS.has(prop) &&
          !FIELD_PROP_ORDER.includes(prop as keyof FieldAffordance)
        ) {
          props[prop] = value;
        }
      }
    }

    if (Object.keys(props).length > 0) {
      result[key] = props;
    }
  }

  return result;
}

function buildOperationObject(op: OperationDefinition): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.name = op.name;
  result.label = op.label;
  result.scope = op.scope;
  if (op.icon !== undefined) result.icon = op.icon;
  if (op.variant !== undefined) result.variant = op.variant;
  if (op.confirm !== undefined) result.confirm = op.confirm;
  if (op.keyboardShortcut !== undefined) result.keyboardShortcut = op.keyboardShortcut;
  return result;
}

// ============================================================================
// Serialization
// ============================================================================

/** How {@link serialize} lays a value out. */
interface SerializeOptions {
  depth: number;
  indent: number;
  /** Where the value sits, for error messages. */
  path: string;
  /** Sort object keys, so two equal values serialize the same whatever their key order (for diffs). */
  sortKeys?: boolean;
  /** The objects being written, outermost first (a cycle has no source form). */
  seen?: ReadonlySet<object>;
}

/**
 * A value as TypeScript source. Plain data only: strings, numbers (`NaN`, `Infinity`, `-0`
 * included), booleans, bigints (`10n`), `null`, `undefined`, dates (`new Date('…')`), arrays and
 * plain objects. Anything else (a function, a symbol, a Map, a class instance, a cycle) has no
 * source form, so it throws, naming where it was found, rather than emit code that does not compile.
 */
function serialize(value: unknown, opts: SerializeOptions): string {
  const { path } = opts;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`toCode: ${path} is an invalid Date, which has no source form`);
    return `new Date(${quote(value.toISOString())})`;
  }
  if (typeof value === 'object' && opts.seen?.has(value)) throw new Error(`toCode: ${path} is circular, which has no source form`);
  const inner = (v: unknown, at: string): string =>
    serialize(v, { ...opts, depth: opts.depth + 1, path: at, seen: new Set([...(opts.seen ?? []), value as object]) });
  if (Array.isArray(value)) return layOut('[', ']', value.map((v, i) => inner(v, `${path}[${i}]`)), opts, ', ');
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (opts.sortKeys) keys.sort();
    return layOut('{', '}', keys.map((k) => `${objectKey(k)}: ${inner(value[k], `${path}.${k}`)}`), opts, ', ', ' ');
  }
  const what = typeof value === 'object' ? `a ${value.constructor?.name ?? 'non-plain object'}` : `a ${typeof value}`;
  throw new Error(`toCode: ${path} is ${what}, which has no source form; affordance values must be plain data`);
}

/** Items between brackets: on one line when short, else one per line. */
function layOut(open: string, close: string, items: string[], { depth, indent }: SerializeOptions, sep: string, pad = ''): string {
  if (items.length === 0) return `${open}${close}`;
  const oneLine = `${open}${pad}${items.join(sep)}${pad}${close}`;
  if (oneLine.length <= 60 && !oneLine.includes('\n')) return oneLine;
  const itemPad = ' '.repeat((depth + 1) * indent);
  return `${open}\n${items.map((item) => `${itemPad}${item},`).join('\n')}\n${' '.repeat(depth * indent)}${close}`;
}

/** An object key as source: bare when an identifier, quoted otherwise; `__proto__` computed, so it stays a property. */
function objectKey(k: string): string {
  if (k === '__proto__') return `['__proto__']`;
  return isValidIdentifier(k) ? k : quote(k);
}

/** A single-quoted string literal: JSON's escapes (newlines, tabs, control characters), with `'` escaped instead of `"`. */
function quote(s: string): string {
  const escaped = JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function isValidIdentifier(s: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);
}

// ============================================================================
// Utility helpers
// ============================================================================

function valueEqual(a: unknown, b: unknown, path = 'value'): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  // The same walker that writes the code, with sorted keys: equal values write the same source.
  const source = (v: unknown) => serialize(v, { depth: 0, indent: 0, path, sortKeys: true });
  return source(a) === source(b);
}

function filterUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}
