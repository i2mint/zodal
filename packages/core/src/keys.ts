/**
 * Item keys: which field (or nested path, or ordered set of fields) identifies an
 * item, how its value is serialized canonically, and how good a key it is on data.
 *
 * - {@link canonicalKey} turns an ordered list of key parts into one string. One part
 *   stays readable (the NFC-normalized, trimmed value); several parts become a JSON
 *   array of strings, so no separator can collide with content.
 * - {@link resolveKey} decides the key of a collection, layer by layer (explicit
 *   spec, identifier-like names in the schema, nested identifier-like names, sample
 *   data, then the first field as a flagged fallback) and records each decision as
 *   an {@link InferenceTrace}, so `explain()` can say why.
 * - {@link detectKey} scores candidates on sample data: completeness, uniqueness,
 *   and suspects (display text, timestamps, locators, low cardinality), and finds
 *   the smallest unique composite when no single field will do.
 *
 * Detection runs when a collection is defined (or at setup time on samples), never
 * per item: once resolved, the spec is applied as-is, so a key cannot shift silently.
 */

import type { z } from 'zod';
import type { InferenceStep, InferenceTrace } from './types.js';
import { peelZodWrapper } from './zod-unwrap.js';

// ============================================================================
// Paths and parts
// ============================================================================

/**
 * What identifies an item: a field name or nested path (`'meta.uuid'`), an ordered
 * list of paths (a composite key: `['artist', 'title', 'year']`), or a function.
 */
export type KeySpec = string | readonly string[] | ((item: unknown) => unknown);

/** Split `a.b`, `a["b.c"]` and `a[0]` into path segments. */
export function parsePath(path: string): string[] {
  const out: string[] = [];
  const re = /([^.[\]]+)|\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    out.push(m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]!));
  }
  return out;
}

/** Read a (possibly nested) field; `undefined` when any step is missing. */
export function getPath(item: unknown, path: string): unknown {
  let cur: unknown = item;
  for (const seg of parsePath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Normalize one key part to a string, or `undefined` when it is missing (`null`,
 * `undefined`, an empty or blank string, a non-finite number, an invalid date).
 * Strings are NFC-normalized and trimmed; dates become ISO strings; other objects
 * become JSON.
 */
export function normalizeKeyPart(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const s = value.normalize('NFC').trim();
    return s === '' ? undefined : s;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return stableJson(value);
}

/** JSON with object keys sorted (so key order does not change a key) and bigints as strings. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

/**
 * The canonical string for an ordered list of key parts.
 *
 * One part: the normalized value itself, so readable ids stay readable. Several
 * parts: a JSON array of normalized strings (a missing part is `""`). JSON escaping
 * makes this unambiguous: `["a","b c"]` and `["a b","c"]` never collide.
 */
export function canonicalKey(parts: readonly unknown[]): string {
  const norm = parts.map((p) => normalizeKeyPart(p) ?? '');
  return norm.length === 1 ? norm[0]! : JSON.stringify(norm);
}

/** The paths a spec reads (empty for a function spec). */
export function keyPaths(spec: KeySpec): string[] {
  if (typeof spec === 'function') return [];
  return typeof spec === 'string' ? [spec] : [...spec];
}

/**
 * The key of `item` under `spec`, or `undefined` when a key part is missing
 * (a composite key needs every part).
 */
export function keyOf(item: unknown, spec: KeySpec): string | undefined {
  if (typeof spec === 'function') {
    const out = spec(item);
    if (!Array.isArray(out)) return normalizeKeyPart(out);
    const parts = out.map(normalizeKeyPart);
    return parts.length === 0 || parts.some((p) => p === undefined) ? undefined : canonicalKey(parts);
  }
  const values = keyPaths(spec).map((p) => normalizeKeyPart(getPath(item, p)));
  if (values.length === 0 || values.some((v) => v === undefined)) return undefined;
  return canonicalKey(values);
}

// ============================================================================
// Detection on sample data
// ============================================================================

/**
 * Field names that identify an item, in priority order: explicit identifiers, then
 * natural keys unique by an external standard (ISRC, ISBN, DOI), then locators,
 * which are unique but move when the thing moves (so they rank last and are flagged).
 */
export const KEY_PRIORITY: readonly string[] = [
  'id', '_id', 'uuid', 'uid', 'guid', 'key', 'slug',
  'isrc', 'isbn', 'doi',
  'url', 'href', 'path', 'filepath', 'file',
];

/** Names like `userId`, `user_id`, `USER_ID` (not `paid`, `valid`, `grid`). */
const ID_SUFFIX_RE = /^(?:[a-z][A-Za-z0-9]*Id|[A-Za-z0-9]+_id|[A-Za-z0-9]+_ID)$/;
const DISPLAY_RE = /^(title|name|label|display_?name|caption|heading|subject|summary|description)$/i;
const TIME_RE = /(^|_)(date|time|created|updated|modified|timestamp)|At$|_at$|Date$|Time$/;
const LOCATOR_RE = /^(url|href|path|filepath|file|uri|link)$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

/** Why a key candidate may not be stable. */
export interface KeySuspect {
  reason: 'display-text' | 'timestamp' | 'locator' | 'low-cardinality';
  detail: string;
}

/** How one key spec fares on sample data. */
export interface KeyCandidate {
  /** A path, or an ordered list of paths. */
  spec: string | string[];
  /** Fraction of samples with every key part present (1 = all). */
  completeness: number;
  /** Distinct keys / samples with a key (1 = no duplicates). */
  uniqueness: number;
  /** Samples with a key. */
  present: number;
  /** Up to five groups of sample indexes sharing a key. */
  duplicates: number[][];
  suspects: KeySuspect[];
  /** Lower is preferred. */
  rank: number;
  why: string;
}

/** The result of checking or detecting a key on sample data. */
export interface KeyReport {
  total: number;
  candidates: KeyCandidate[];
  /** The best complete and unique candidate, or `null`. */
  chosen: KeyCandidate | null;
  warnings: string[];
}

/** A path segment, quoted (`["a.b"]`) when the name has `.`, `[`, `]` or `"`. */
function pathSegment(name: string, first: boolean): string {
  if (/[.[\]"]/.test(name)) return `["${name.replace(/(["\\])/g, '\\$1')}"]`;
  return first ? name : `.${name}`;
}

function sampleFields(samples: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const it of samples.slice(0, 200)) {
    if (!it || typeof it !== 'object') continue;
    for (const [k, v] of Object.entries(it)) {
      seen.add(pathSegment(k, true));
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        for (const k2 of Object.keys(v as object)) seen.add(`${pathSegment(k, true)}${pathSegment(k2, false)}`);
      }
    }
  }
  return [...seen];
}

/** Score one spec on samples. */
export function scoreKey(
  samples: readonly unknown[],
  spec: KeySpec,
  { rank = 0, why = '' }: { rank?: number; why?: string } = {},
): KeyCandidate {
  const keys = samples.map((it) => keyOf(it, spec));
  const groups = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k === undefined) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const present = keys.filter((k) => k !== undefined).length;
  const duplicates = [...groups.values()].filter((g) => g.length > 1).slice(0, 5);
  const paths = keyPaths(spec);
  const suspects: KeySuspect[] = [];
  for (const p of paths) {
    const leaf = parsePath(p).pop() ?? p;
    const vals = samples.map((it) => normalizeKeyPart(getPath(it, p))).filter((v): v is string => v !== undefined);
    const spaced = vals.length > 0 && vals.filter((v) => /\s/.test(v)).length / vals.length > 0.5;
    if (DISPLAY_RE.test(leaf) || spaced) {
      suspects.push({ reason: 'display-text', detail: `\`${p}\` looks like display text; renaming an item would change its key` });
    }
    if (TIME_RE.test(leaf) || (vals.length > 0 && vals.every((v) => ISO_DATE_RE.test(v)))) {
      suspects.push({ reason: 'timestamp', detail: `\`${p}\` looks like a timestamp` });
    }
    if (LOCATOR_RE.test(leaf)) {
      suspects.push({ reason: 'locator', detail: `\`${p}\` is a locator; it changes when the item moves` });
    }
  }
  if (paths.length === 1 && present > 3 && groups.size <= Math.max(2, present / 10)) {
    suspects.push({ reason: 'low-cardinality', detail: `\`${paths[0]}\` has only ${groups.size} distinct values` });
  }
  return {
    spec: typeof spec === 'function' ? '<function>' : paths.length === 1 && typeof spec === 'string' ? spec : paths,
    completeness: samples.length ? present / samples.length : 0,
    uniqueness: present ? groups.size / present : 0,
    present,
    duplicates,
    suspects,
    rank,
    why,
  };
}

const isComplete = (c: KeyCandidate) => c.completeness === 1 && c.uniqueness === 1;

/** Options for {@link detectKey}. */
export interface DetectKeyOptions {
  /** Field names in priority order. Default: {@link KEY_PRIORITY}. */
  priority?: readonly string[];
  /** Largest composite tried. Default: 4. */
  maxComposite?: number;
  /** Most composites scored before giving up (with a warning). Default: 500. */
  maxCombinations?: number;
}

/**
 * Which field, nested path or smallest composite identifies the samples.
 *
 * Order: names in `priority`, then names ending in `Id`/`_id`, then priority names
 * one level down (`meta.uuid`); a candidate must be complete and unique, and not
 * flagged as display text, a timestamp or low-cardinality (a locator is allowed,
 * with a warning). Failing that, the smallest unique composite of complete,
 * non-timestamp fields; failing that, any complete and unique field, with a warning.
 */
export function detectKey(samples: readonly unknown[], options: DetectKeyOptions = {}): KeyReport {
  const { priority = KEY_PRIORITY, maxComposite = 4, maxCombinations = 500 } = options;
  const fields = sampleFields(samples);
  const warnings: string[] = [];
  const candidates: KeyCandidate[] = [];
  const has = (spec: string | string[]) =>
    candidates.some((c) => JSON.stringify(c.spec) === JSON.stringify(spec));
  const add = (f: string, rank: number, why: string) => {
    if (!has(f)) candidates.push(scoreKey(samples, f, { rank, why }));
  };
  priority.forEach((p, i) => fields.includes(p) && add(p, i, `priority list position ${i + 1}`));
  fields.filter((f) => !f.includes('.') && ID_SUFFIX_RE.test(f)).forEach((f) => add(f, 100, 'name ends in Id/_id'));
  fields
    .filter((f) => f.includes('.') && priority.includes(f.split('.').pop()!))
    .forEach((f) => add(f, 200 + priority.indexOf(f.split('.').pop()!), 'nested identifier-like field'));

  const stable = (c: KeyCandidate) => isComplete(c) && !c.suspects.some((s) => s.reason !== 'locator');
  let chosen = candidates.filter(stable).sort((a, b) => a.rank - b.rank)[0] ?? null;

  if (!chosen) {
    const complete = fields
      .filter((f) => !f.includes('.'))
      .map((f) => scoreKey(samples, f))
      .filter((c) => c.completeness === 1 && !c.suspects.some((s) => s.reason === 'timestamp'))
      .sort((a, b) => b.uniqueness - a.uniqueness)
      .map((c) => c.spec as string);
    function* combos(size: number, start = 0, acc: string[] = []): Generator<string[]> {
      if (acc.length === size) {
        yield acc;
        return;
      }
      for (let i = start; i < complete.length; i++) yield* combos(size, i + 1, [...acc, complete[i]!]);
    }
    let tried = 0;
    outer: for (let size = 2; size <= Math.min(maxComposite, complete.length); size++) {
      for (const combo of combos(size)) {
        if (++tried > maxCombinations) {
          warnings.push(`stopped the composite search after ${maxCombinations} combinations; pass an explicit key`);
          break outer;
        }
        const c = scoreKey(samples, combo, { rank: 300 + size, why: `smallest unique composite (${size} fields)` });
        if (isComplete(c)) {
          candidates.push(c);
          chosen = c;
          break outer;
        }
      }
    }
  }
  if (!chosen) {
    fields.filter((f) => !f.includes('.')).forEach((f) => add(f, 400, 'complete and unique, but not an identifier by name'));
    chosen = candidates.filter(isComplete).sort((a, b) => a.rank - b.rank)[0] ?? null;
    if (chosen) warnings.push('only unstable keys are complete and unique; the chosen key may change over time');
  }
  if (!chosen) warnings.push('no field or small composite is complete and unique across the samples');
  if (chosen) for (const s of chosen.suspects) warnings.push(s.detail);
  return { total: samples.length, candidates: candidates.sort((a, b) => a.rank - b.rank), chosen, warnings };
}

// ============================================================================
// resolveKey: the key of a collection
// ============================================================================

/** Where a collection's key came from. */
export type KeySource = 'config' | 'schema' | 'samples' | 'fallback';

/**
 * Identifier names tried on a schema, in order, before any `*Id` / `*_id` name.
 * These are the names `defineCollection` has always used; changing them would
 * change the inferred key of existing collections.
 */
export const SCHEMA_ID_NAMES: readonly string[] = ['id', '_id', 'uuid', 'key'];

/** The `*Id` rule `defineCollection` has always applied after {@link SCHEMA_ID_NAMES}. */
const SCHEMA_ID_SUFFIX = (name: string) => /[iI]d$/.test(name) || name.endsWith('_id');

/** Options for {@link resolveKey}. */
export interface ResolveKeyOptions {
  /**
   * An explicit key; wins over every other layer. A string naming a top-level
   * field of the schema is that field (even if it contains a dot); any other string
   * is a path (`'meta.uuid'`).
   */
  key?: KeySpec;
  /** Identifier names tried on the schema, in order. Default: {@link SCHEMA_ID_NAMES}. */
  candidates?: readonly string[];
  /** Sample items: used to detect a key when the schema names none, and checked against. */
  samples?: readonly unknown[];
  /** Throw instead of falling back to the first field of the schema. */
  strict?: boolean;
  /**
   * Where a nested, composite or function key is kept on a stored item (see
   * {@link KeyResolution.stamp}). Default: `'id'`. Refused when the schema has this
   * field and it is not the key itself, so a real field is never overwritten.
   */
  keyField?: string;
}

/** A collection's resolved key. */
export interface KeyResolution {
  spec: KeySpec;
  /** The paths the key reads (empty for a function spec). */
  paths: string[];
  source: KeySource;
  /**
   * The top-level field a store keeps the key in: the spec itself when it is one
   * top-level field, else `keyField` (default `'id'`), which {@link stamp} fills.
   */
  idField: string;
  /** Whether the key is derived (nested, composite or a function) and must be stamped. */
  derived: boolean;
  /** Warnings about this key (a fallback, an unstable field, duplicates in the samples). */
  warnings: string[];
  /** The key of an item, or `undefined` when a part is missing. */
  keyOf(item: unknown): string | undefined;
  /**
   * The item with its key written into `idField`, ready to store. Identity for a
   * plain field key; for a derived key, a shallow copy with `idField` set (throws
   * when a key part is missing).
   */
  stamp<T extends object>(item: T): T;
  /** How the key was decided, as an inference trace. */
  explain(): InferenceTrace[];
  /** Score this key on sample data. */
  check(samples: readonly unknown[]): KeyReport;
}

function objectShape(schema: unknown): Record<string, unknown> | undefined {
  let s: unknown = schema;
  for (let i = 0; i < 16 && s; i++) {
    const def = (s as any)?._zod?.def;
    if (def?.type === 'object') return def.shape as Record<string, unknown>;
    s = peelZodWrapper(s);
  }
  return undefined;
}

function specLabel(spec: KeySpec): unknown {
  return typeof spec === 'function' ? '<function>' : spec;
}

/**
 * Decide the key of a collection, layer by layer, and record why.
 *
 * Layers: an explicit `key` (config); an identifier-like top-level name
 * (`candidates`, then any `*Id` / `*_id`); a key detected on `samples`; finally the
 * first field of the schema, kept for compatibility but recorded as a fallback
 * (with a hint when that field holds a nested identifier), or refused with `strict`.
 * A schema with no fields keys on `'id'`.
 */
export function resolveKey(schema: z.ZodObject<any> | z.ZodType, options: ResolveKeyOptions = {}): KeyResolution {
  const { key, candidates = SCHEMA_ID_NAMES, samples, strict = false, keyField = 'id' } = options;
  const shape = objectShape(schema) ?? {};
  const names = Object.keys(shape);
  const steps: InferenceStep[] = [];
  const warnings: string[] = [];
  let spec: KeySpec | undefined;
  let source: KeySource = 'fallback';

  if (key !== undefined) {
    spec = typeof key === 'string' || typeof key === 'function' ? key : [...key];
    source = 'config';
    steps.push({ layer: 'config', value: specLabel(spec), reason: 'explicit key in the collection config' });
  }
  if (spec === undefined) {
    const named = candidates.find((c) => c in shape) ?? names.find(SCHEMA_ID_SUFFIX);
    if (named) {
      spec = named;
      source = 'schema';
      steps.push({ layer: 'name', value: named, reason: `\`${named}\` is named like an identifier` });
    }
  }
  if (spec === undefined && samples && samples.length > 0) {
    const report = detectKey(samples);
    if (report.chosen) {
      spec = report.chosen.spec;
      source = 'samples';
      steps.push({ layer: 'samples', value: spec, reason: `detected on ${report.total} samples: ${report.chosen.why}` });
      warnings.push(...report.warnings);
    }
  }
  if (spec === undefined) {
    const first = names[0];
    const nested = names
      .map((n) => {
        const inner = objectShape(shape[n]);
        const c = inner && candidates.find((x) => x in inner);
        return c ? `${n}.${c}` : undefined;
      })
      .find((x) => x !== undefined);
    const hint = nested ? ` (\`${nested}\` looks like an identifier: pass idField: '${nested}')` : '';
    if (strict) {
      throw new Error(
        `resolveKey: no field identifies an item (no ${candidates.join('/')} or *Id field${
          samples ? ', nothing unique in the samples' : ''
        })${hint}; pass an explicit key, e.g. idField: ['artist', 'title']`,
      );
    }
    spec = first ?? keyField;
    source = 'fallback';
    const msg =
      first === undefined
        ? `the schema has no fields; keyed on \`${keyField}\``
        : `no identifier-like field; fell back to the first field \`${first}\`, which may not be unique or stable${hint}. Set idField explicitly`;
    warnings.push(msg);
    steps.push({ layer: 'name', value: spec, reason: `fallback: ${msg}` });
  }

  const resolved = spec;
  const flat = typeof resolved === 'string' && (resolved in shape || parsePath(resolved).length === 1 || names.length === 0);
  const paths = typeof resolved === 'string' && flat ? [resolved] : keyPaths(resolved);
  const idField = flat ? (resolved as string) : keyField;
  if (!flat && keyField in shape) {
    throw new Error(
      `resolveKey: the key ${JSON.stringify(specLabel(resolved))} is derived and would be stored in \`${keyField}\`, ` +
        `which is already a field of the schema; pass keyField: '<an unused field>'`,
    );
  }
  const keyOfItem = (item: unknown): string | undefined => {
    if (flat) return normalizeKeyPart((item as Record<string, unknown> | null | undefined)?.[resolved as string]);
    return keyOf(item, resolved);
  };
  if (samples && samples.length > 0 && source !== 'samples') {
    const c = scoreKey(samples, flat ? (item: unknown) => keyOfItem(item) : resolved);
    if (c.completeness < 1) warnings.push(`the key is missing on ${samples.length - c.present} of ${samples.length} samples`);
    if (c.uniqueness < 1) warnings.push(`the key is not unique across the samples (${c.duplicates.length} duplicate group(s))`);
    for (const s of c.suspects) warnings.push(s.detail);
  }

  return {
    spec: resolved,
    paths,
    source,
    idField,
    derived: !flat,
    warnings,
    keyOf: keyOfItem,
    stamp(item) {
      if (flat) return item;
      const k = keyOfItem(item);
      if (k === undefined) {
        throw new Error(`resolveKey: cannot stamp an item missing part of its key ${JSON.stringify(specLabel(resolved))}`);
      }
      return { ...item, [idField]: k };
    },
    explain: () => [
      {
        field: idField,
        affordance: 'key',
        finalValue: specLabel(resolved),
        layers: [...steps],
      },
    ],
    check(s) {
      const c = scoreKey(s, flat ? (item: unknown) => keyOfItem(item) : resolved, { why: `the ${source} key` });
      if (flat) c.spec = resolved as string;
      const ok = isComplete(c);
      const out: string[] = c.suspects.map((x) => x.detail);
      if (c.completeness < 1) out.unshift(`the key is missing on ${s.length - c.present} of ${s.length} samples`);
      if (c.uniqueness < 1) out.unshift(`the key is not unique (${c.duplicates.length} duplicate group(s))`);
      return { total: s.length, candidates: [c], chosen: ok ? c : null, warnings: out };
    },
  };
}
