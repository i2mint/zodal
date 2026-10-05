/**
 * Which parts of a schema hold secrets, so they can be masked, kept out of logs,
 * share links and generated code, and never echoed in error messages.
 *
 * A field is secret when it is marked `.meta({ sensitivity: 'secret' })` (or the
 * alias `{ secret: true }`, or registered with that metadata in Zod's global
 * registry) on itself or on a schema it wraps, or when its key looks like a
 * secret (`apiKey`, `password`, `client_secret`, `serviceRoleKey`,
 * `connectionString`, `authorization`...; the zodal-dials heuristic, extended).
 *
 * {@link secretPaths} walks objects, arrays, sets, maps, records, tuples, unions,
 * intersections, pipes, lazy schemas and every wrapper, and returns each path to
 * a secret (`'*'` stands for any index or key). It fails closed: a schema it
 * cannot inspect, or one nested deeper than it will walk, throws rather than
 * reporting "no secrets".
 *
 * {@link redact} never writes into the caller's value: it copies what it walks,
 * and a value it cannot copy safely on the way to a secret (a class instance, a
 * Map, a Set) is replaced whole.
 */

import { z } from 'zod';

/** A path into a value; `'*'` matches any array index or record key. */
export type SecretPath = readonly (string | number)[];

/** Thrown when a schema cannot be inspected for secrets (not Zod v4, or too deep). */
export class SchemaIntrospectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaIntrospectionError';
  }
}

// Words are matched on the de-camelCased, separator-normalized key. Singular
// `token` only: `maxTokens` / `tokenize` are not secrets.
const SECRET_NAME = new RegExp(
  '(?:^| )(' +
    [
      'secrets?', 'secret ?(?:id|key)', 'client ?secret',
      'passwords?', 'passwd', 'pass ?phrase', 'pin',
      'credentials?',
      'token', '(?:access|auth|refresh|bearer|id|session|csrf|api) ?token',
      'api ?keys?', 'access ?keys?', 'private ?keys?', 'secret ?access ?key', 'signing ?key',
      'service ?role ?key', 'anon ?key', 'session ?key', 'encryption ?key', 'master ?key',
      'connection ?string', 'dsn', 'authorization', 'bearer', 'cookie',
    ].join('|') +
    ')(?: |$)',
);

/** Split a dotted/snake/camelCase key into lowercased, space-separated words. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[._\-/]+/g, ' ')
    .toLowerCase();
}

/**
 * Does this key name a secret? `apiKey`, `api_key`, `refreshToken`,
 * `client_secret`, `serviceRoleKey`, `connectionString`, `Authorization`,
 * `accessKeyId`, `pin` do; `keyboard`, `tokenize`, `maxTokens`, `secretary`,
 * `publicKey`, `isPrivate` do not.
 */
export function isSecretName(key: string): boolean {
  return SECRET_NAME.test(normalizeKey(key));
}

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);
/** Deepest schema nesting walked; deeper is an error, never a silent "no secrets". */
const MAX_DEPTH = 32;

function defOf(schema: unknown): any {
  const def = (schema as any)?._zod?.def;
  if (!def) {
    throw new SchemaIntrospectionError(
      'cannot inspect this schema for secrets (zodal requires Zod v4 schemas); refusing to report "no secrets"',
    );
  }
  return def;
}

function metaOf(schema: unknown): Record<string, unknown> | undefined {
  try {
    const own = typeof (schema as any)?.meta === 'function' ? (schema as any).meta() : undefined;
    const registered = (z as any).globalRegistry?.get?.(schema);
    const m = own ?? registered;
    return m && typeof m === 'object' ? m : undefined;
  } catch {
    return undefined;
  }
}

function markedHere(schema: unknown): boolean {
  const meta = metaOf(schema);
  return Boolean(meta && (meta.sensitivity === 'secret' || meta.secret === true));
}

/** Is this schema (or a wrapper around it, or a schema it wraps) explicitly marked secret? */
export function isMarkedSecret(schema: unknown): boolean {
  let s: any = schema;
  for (let i = 0; s && i < MAX_DEPTH; i++) {
    if (markedHere(s)) return true;
    const def = s?._zod?.def;
    if (!def) return false;
    if (WRAPPERS.has(def.type)) s = def.innerType;
    else if (def.type === 'pipe') s = def.in;
    else if (def.type === 'lazy') s = def.getter?.();
    else return false;
  }
  return false;
}

/** A default, a catch value or examples on this schema or any wrapper of it: what would be published with it. */
function publishedValues(schema: unknown): unknown[] {
  const found: unknown[] = [];
  let s: any = schema;
  for (let i = 0; s?._zod?.def && i < MAX_DEPTH; i++) {
    const def = s._zod.def;
    const meta = metaOf(s);
    if (Array.isArray(meta?.examples)) found.push(...meta.examples);
    if (meta && 'example' in meta) found.push(meta.example);
    if (def.type === 'default' || def.type === 'prefault') {
      found.push(typeof def.defaultValue === 'function' ? safeCall(def.defaultValue) : def.defaultValue);
    }
    if (def.type === 'catch') found.push(typeof def.catchValue === 'function' ? safeCall(def.catchValue) : def.catchValue);
    if (WRAPPERS.has(def.type)) s = def.innerType;
    else if (def.type === 'pipe') s = def.in;
    else break;
  }
  return found;
}

function safeCall(f: () => unknown): unknown {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/** Does any wrapper on the way down give this schema a default value? */
export function hasDefault(schema: unknown): boolean {
  return publishedValues(schema).length > 0;
}

/** What {@link inspectSecrets} reports. */
export interface SecretInspection {
  /** Every path to a secret. `[]` alone means the whole value is secret. */
  paths: SecretPath[];
  /**
   * Secrets whose value would be published with the schema (a default, a catch
   * value, examples; on the field or on a container above it): explicitly
   * marked secrets always, name-matched ones when the published value is a
   * non-empty string.
   */
  published: SecretPath[];
}

/** {@link secretPaths}, plus which secrets would leak through the schema itself. */
export function inspectSecrets(schema: unknown): SecretInspection {
  const paths = new Map<string, SecretPath>();
  const published = new Map<string, SecretPath>();

  const leaks = (s: unknown, marked: boolean, above: unknown[]): boolean => {
    const values = [...above, ...publishedValues(s)];
    return marked ? values.some((v) => v !== undefined) : values.some((v) => typeof v === 'string' && v.length > 0);
  };

  const walk = (s: unknown, path: (string | number)[], depth: number, above: unknown[], byName: boolean): void => {
    if (depth > MAX_DEPTH) {
      throw new SchemaIntrospectionError(`schema nested deeper than ${MAX_DEPTH} levels at "${path.join('.')}"; refusing to report "no secrets"`);
    }
    const def = defOf(s);
    const marked = isMarkedSecret(s);
    if (marked || byName) {
      paths.set(JSON.stringify(path), path);
      if (leaks(s, marked, above)) published.set(JSON.stringify(path), path);
      return;
    }
    // A container's own default would publish the secrets inside it.
    const here = [...above, ...publishedValues(s).filter((v) => v !== null && typeof v === 'object')];
    switch (def.type) {
      case 'optional': case 'nullable': case 'default': case 'prefault':
      case 'readonly': case 'catch': case 'nonoptional':
        return walk(def.innerType, path, depth + 1, here, false);
      case 'pipe':
        walk(def.in, path, depth + 1, here, false);
        return walk(def.out, path, depth + 1, here, false);
      case 'lazy':
        return walk(def.getter(), path, depth + 1, here, false);
      case 'object': {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        for (const [key, field] of Object.entries(shape ?? {})) {
          const nested = here.map((v) => (v && typeof v === 'object' ? (v as any)[key] : undefined)).filter((v) => v !== undefined);
          walk(field, [...path, key], depth + 1, nested, isSecretName(key));
        }
        if (def.catchall) walk(def.catchall, [...path, '*'], depth + 1, [], false);
        return;
      }
      case 'array': case 'set':
        return walk(def.element ?? def.valueType, [...path, '*'], depth + 1, [], false);
      case 'record': case 'map':
        return walk(def.valueType, [...path, '*'], depth + 1, [], false);
      case 'tuple':
        (def.items ?? []).forEach((item: unknown, i: number) => walk(item, [...path, i], depth + 1, [], false));
        if (def.rest) walk(def.rest, [...path, '*'], depth + 1, [], false);
        return;
      case 'union':
        for (const option of def.options ?? []) walk(option, path, depth + 1, here, false);
        return;
      case 'intersection':
        walk(def.left, path, depth + 1, here, false);
        return walk(def.right, path, depth + 1, here, false);
      default:
        return; // leaves: string, number, custom, enum, literal...
    }
  };

  walk(schema, [], 0, [], false);
  return { paths: [...paths.values()], published: [...published.values()] };
}

/** Every path to a secret inside `schema`. `[]` (the empty path) means the whole value is secret. */
export function secretPaths(schema: unknown): SecretPath[] {
  return inspectSecrets(schema).paths;
}

/** The redaction marker written in place of a secret value. */
export const REDACTED = '[secret]';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/**
 * A copy of `value` with every value at a secret path replaced by
 * {@link REDACTED}, and every key that looks like a secret replaced too (the
 * runtime keys of records and loose objects are checked by name). Never writes
 * into `value`. A non-plain object (class instance, Map, Set, null-prototype
 * object) that a secret path enters, or that holds secret-named keys, is replaced
 * whole: it cannot be copied safely, so it is not shown.
 */
export function redact<V>(value: V, paths: readonly SecretPath[]): V {
  return redactNode(value, paths, 0) as V;
}

function redactNode(node: unknown, paths: readonly SecretPath[], depth: number): unknown {
  if (paths.some((p) => p.length === 0)) return node === undefined ? node : REDACTED;
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(node)) {
    return node.map((item, i) => redactNode(item, childPaths(paths, i), depth + 1));
  }
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(node)) {
      out[key] = isSecretName(key) && v !== undefined ? REDACTED : redactNode(v, childPaths(paths, key), depth + 1);
    }
    return out;
  }
  if (node !== null && typeof node === 'object') {
    // Not safely copyable: hide it if any secret could be inside.
    if (paths.length > 0 || containsSecretNamedKey(node, 0)) return REDACTED;
  }
  return node;
}

function childPaths(paths: readonly SecretPath[], key: string | number): SecretPath[] {
  const out: SecretPath[] = [];
  for (const p of paths) {
    if (p.length === 0) continue;
    if (p[0] === '*' || String(p[0]) === String(key)) out.push(p.slice(1));
  }
  return out;
}

function containsSecretNamedKey(node: unknown, depth: number): boolean {
  if (node === null || typeof node !== 'object' || depth > 8) return false;
  if (node instanceof Map) return [...node.entries()].some(([k, v]) => (typeof k === 'string' && isSecretName(k)) || containsSecretNamedKey(v, depth + 1));
  if (node instanceof Set) return [...node.values()].some((v) => containsSecretNamedKey(v, depth + 1));
  try {
    return Object.entries(node).some(([k, v]) => isSecretName(k) || containsSecretNamedKey(v, depth + 1));
  } catch {
    return true;
  }
}

/** Every primitive at a secret path in `value` (strings and numbers, any length): used to scrub them out of text. */
export function secretValues(value: unknown, paths: readonly SecretPath[]): string[] {
  const found = new Set<string>();
  const visit = (node: any, path: SecretPath, i: number): void => {
    if (i === path.length) {
      collectPrimitives(node, found, 0);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const seg = path[i];
    const keys = seg === '*' ? Object.keys(node) : [String(seg)];
    for (const k of keys) if (k in node) visit(node[k], path, i + 1);
  };
  for (const p of paths) visit(value, p, 0);
  return [...found].filter((s) => s.length > 0);
}

function collectPrimitives(node: unknown, into: Set<string>, depth: number): void {
  if (depth > 8) return;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') into.add(String(node));
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectPrimitives(v, into, depth + 1);
}

/**
 * Replace every occurrence of any of `secrets` (and their URL-encoded and
 * JSON-escaped forms) in `text` with {@link REDACTED}. Best effort only: callers
 * that can avoid putting secret-bearing text in a message at all should.
 */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  const variants = new Set<string>();
  for (const s of secrets) {
    variants.add(s);
    variants.add(encodeURIComponent(s));
    variants.add(JSON.stringify(s).slice(1, -1));
  }
  let out = text;
  for (const v of [...variants].filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(v).join(REDACTED);
  return out;
}
