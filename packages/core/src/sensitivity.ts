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
      'token', 'tokens', '(?:access|auth|refresh|bearer|id|session|csrf|api|personal ?access) ?tokens?', 'jwt', 'otp', 'passcode',
      'pwd', 'auth', 'creds', 'account ?key',
      '(?:database|db|redis|mongo|mongodb|postgres|postgresql|mysql|amqp|connection) ?(?:url|uri|string)',
      'api ?keys?', 'access ?keys?', 'private ?keys?', 'secret ?access ?key', 'signing ?key',
      'service ?role ?key', 'anon ?key', 'session ?key', 'encryption ?key', 'master ?key',
      'connection ?string', 'dsn', 'authorization', 'bearer', 'cookie',
    ].join('|') +
    ')(?: |$)',
);

/** Split a dotted/snake/camelCase key into lowercased, space-separated words. */
const NOT_SECRET = /(?:^| )(?:max|min|num|count|total|limit) ?tokens?(?: |$)|tokens? ?(?:count|limit|budget|usage|used)(?: |$)/;

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
  const k = normalizeKey(key);
  return SECRET_NAME.test(k) && !NOT_SECRET.test(k);
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
    if (meta && 'default' in meta) found.push(meta.default);
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
  /** The subset of `paths` marked explicitly (`.meta({ sensitivity: 'secret' })`), not matched by name. */
  marked: SecretPath[];
  /**
   * Secrets whose value would be published with the schema: a default, catch
   * value, example or `meta.default` on the field or on any container above it
   * holds a value at that secret's path. Marked secrets: any value; name-matched
   * ones: a non-empty string.
   */
  published: SecretPath[];
}

const key = (p: SecretPath) => JSON.stringify(p);

/** {@link secretPaths}, plus which are marked, and which would leak through the schema itself. */
export function inspectSecrets(schema: unknown): SecretInspection {
  const paths = new Map<string, SecretPath>();
  const marked = new Map<string, SecretPath>();
  const containers: { path: SecretPath; values: unknown[] }[] = [];

  const walk = (s: unknown, path: (string | number)[], depth: number, byName: boolean): void => {
    if (depth > MAX_DEPTH) {
      throw new SchemaIntrospectionError(`schema nested deeper than ${MAX_DEPTH} levels at "${path.join('.')}"; refusing to report "no secrets"`);
    }
    const def = defOf(s);
    const isMarked = isMarkedSecret(s);
    const published = publishedValues(s);
    if (published.length) containers.push({ path: [...path], values: published });
    if (isMarked || byName) {
      paths.set(key(path), path);
      if (isMarked) marked.set(key(path), path);
      return;
    }
    switch (def.type) {
      case 'optional': case 'nullable': case 'default': case 'prefault':
      case 'readonly': case 'catch': case 'nonoptional':
        return walk(def.innerType, path, depth + 1, false);
      case 'pipe':
        walk(def.in, path, depth + 1, false);
        return walk(def.out, path, depth + 1, false);
      case 'lazy':
        return walk(def.getter(), path, depth + 1, false);
      case 'object': {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        for (const [k, field] of Object.entries(shape ?? {})) walk(field, [...path, k], depth + 1, isSecretName(k));
        if (def.catchall) walk(def.catchall, [...path, '*'], depth + 1, false);
        return;
      }
      case 'array': case 'set':
        return walk(def.element ?? def.valueType, [...path, '*'], depth + 1, false);
      case 'record': case 'map':
        // A secret key (a token used as a record key) makes the whole record secret.
        if (def.keyType && secretPaths(def.keyType).length) {
          paths.set(key(path), path);
          if (isMarkedSecret(def.keyType)) marked.set(key(path), path);
          return;
        }
        return walk(def.valueType, [...path, '*'], depth + 1, false);
      case 'tuple':
        (def.items ?? []).forEach((item: unknown, i: number) => walk(item, [...path, i], depth + 1, false));
        if (def.rest) walk(def.rest, [...path, '*'], depth + 1, false);
        return;
      case 'union':
        for (const option of def.options ?? []) walk(option, path, depth + 1, false);
        return;
      case 'intersection':
        walk(def.left, path, depth + 1, false);
        return walk(def.right, path, depth + 1, false);
      default:
        return; // leaves: string, number, custom, enum, literal...
    }
  };

  walk(schema, [], 0, false);

  // A published value (default, catch, example) on a node leaks every secret beneath it.
  const published = new Map<string, SecretPath>();
  for (const c of containers) {
    for (const p of paths.values()) {
      if (p.length < c.path.length || !c.path.every((seg, i) => seg === p[i] || p[i] === '*' || seg === '*')) continue;
      const rel = p.slice(c.path.length);
      const isMarked = marked.has(key(p));
      for (const v of c.values) {
        const found = rel.length === 0 ? [v] : valuesAt(v, rel);
        if (found.some((x) => (isMarked ? x !== undefined && x !== null : containsNonEmptyString(x)))) {
          published.set(key(p), p);
        }
      }
    }
  }
  return { paths: [...paths.values()], marked: [...marked.values()], published: [...published.values()] };
}

/** A non-empty string anywhere inside `x` (a name-matched secret only leaks text, not a numeric setting). */
function containsNonEmptyString(x: unknown, depth = 0): boolean {
  if (typeof x === 'string') return x.length > 0;
  if (!x || typeof x !== 'object' || depth > 8) return false;
  return childrenOf(x).some((v) => containsNonEmptyString(v, depth + 1));
}

/** Every value found at `path` inside `value` (`'*'` fans out over arrays, objects, Maps and Sets). */
function valuesAt(value: unknown, path: SecretPath): unknown[] {
  let frontier: unknown[] = [value];
  for (const seg of path) {
    const next: unknown[] = [];
    for (const node of frontier) {
      if (node === null || typeof node !== 'object') continue;
      if (seg === '*') next.push(...childrenOf(node));
      else if (node instanceof Map) next.push(node.get(seg));
      else next.push((node as any)[seg]);
    }
    frontier = next;
  }
  return frontier;
}

function childrenOf(node: object): unknown[] {
  if (node instanceof Map) return [...node.values()];
  if (node instanceof Set) return [...node.values()];
  return Object.values(node);
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
 * runtime keys of records and loose objects, and `[name, value]` header pairs,
 * are checked by name). Never writes into `value`. Objects that cannot be copied
 * safely (class instances, Maps, Sets, `Headers`, null-prototype objects) are
 * replaced whole, except `Date`s; an object met twice (shared or circular) is
 * replaced by the marker the second time.
 */
export function redact<V>(value: V, paths: readonly SecretPath[]): V {
  return redactNode(value, paths, 0, new WeakSet()) as V;
}

function redactNode(node: unknown, paths: readonly SecretPath[], depth: number, seen: WeakSet<object>): unknown {
  if (paths.some((p) => p.length === 0)) return node === undefined ? node : REDACTED;
  if (node === null || typeof node !== 'object') return node;
  if (node instanceof Date) return new Date(node.getTime());
  if (depth > MAX_DEPTH || seen.has(node)) return REDACTED;
  seen.add(node);
  if (Array.isArray(node)) {
    // A [name, value] pair whose name looks like a secret (HTTP header tuples).
    if (node.length === 2 && typeof node[0] === 'string' && isSecretName(node[0])) return [node[0], REDACTED];
    return node.map((item, i) => redactNode(item, childPaths(paths, i), depth + 1, seen));
  }
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = isSecretName(k) && v !== undefined ? REDACTED : redactNode(v, childPaths(paths, k), depth + 1, seen);
    }
    return out;
  }
  return REDACTED; // not plain data: it cannot be copied or inspected safely, so it is not shown
}

function childPaths(paths: readonly SecretPath[], k: string | number): SecretPath[] {
  const out: SecretPath[] = [];
  for (const p of paths) {
    if (p.length === 0) continue;
    if (p[0] === '*' || String(p[0]) === String(k)) out.push(p.slice(1));
  }
  return out;
}

/** Every primitive at a secret path in `value` (strings and numbers, any length; Map and Set contents too): used to scrub text. */
export function secretValues(value: unknown, paths: readonly SecretPath[]): string[] {
  const found = new Set<string>();
  for (const p of paths) for (const v of valuesAt(value, p)) collectPrimitives(v, found, 0, new WeakSet());
  return [...found].filter((s) => s.length > 0);
}

function collectPrimitives(node: unknown, into: Set<string>, depth: number, seen: WeakSet<object>): void {
  if (depth > MAX_DEPTH) return;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    into.add(String(node));
    return;
  }
  if (node && typeof node === 'object') {
    if (seen.has(node)) return;
    seen.add(node);
    const kids = node instanceof Map ? [...node.keys(), ...node.values()] : childrenOf(node);
    for (const v of kids) collectPrimitives(v, into, depth + 1, seen);
  }
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
