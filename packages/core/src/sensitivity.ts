/**
 * Which parts of a schema hold secrets, so they can be masked, kept out of logs,
 * share links and generated code, and never echoed in error messages.
 *
 * A field is secret when it is marked `.meta({ sensitivity: 'secret' })` (or the
 * alias `.meta({ secret: true })`) on itself or on a schema it wraps, or when its
 * key looks like a secret (`apiKey`, `password`, `client_secret`, `accessToken`,
 * `privateKeyPath`...; the heuristic zodal-dials uses, errs toward secret).
 *
 * {@link secretPaths} walks objects, arrays, sets, records, tuples, unions,
 * intersections, pipes, lazy schemas and the optional/nullable/default/readonly
 * wrappers, and returns every path to a secret. `'*'` in a path stands for any
 * array index or record key. It fails closed: a schema it cannot introspect throws
 * rather than reporting "no secrets".
 */

/** A path into a value; `'*'` matches any array index or record key. */
export type SecretPath = readonly (string | number)[];

/** Thrown when a schema cannot be inspected (not a Zod v4 schema). */
export class SchemaIntrospectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaIntrospectionError';
  }
}

const SECRET_NAME =
  /(?:^| )(secret|secrets|secret ?id|passwords?|passwd|credentials?|tokens?|api ?keys?|access ?keys?|private ?keys?|client ?secret|refresh ?token|access ?token|auth ?token)(?: |$)/;

/** Split a dotted/snake/camelCase key into lowercased, space-separated words. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[._\-/]+/g, ' ')
    .toLowerCase();
}

/**
 * Does this key name a secret? `apiKey`, `api_key`, `refreshToken`, `client_secret`,
 * `passwordHash`, `secretAccessKey`, `accessKeyId` do; `keyboard`, `tokenize`,
 * `secretary` do not.
 */
export function isSecretName(key: string): boolean {
  return SECRET_NAME.test(normalizeKey(key));
}

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);
const MAX_DEPTH = 12;

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
    const m = (schema as any)?.meta?.();
    return m && typeof m === 'object' ? m : undefined;
  } catch {
    return undefined;
  }
}

/** Is this schema (or a wrapper around it, or a schema it wraps) marked secret? */
export function isMarkedSecret(schema: unknown): boolean {
  let s: any = schema;
  for (let i = 0; s && i < MAX_DEPTH; i++) {
    const meta = metaOf(s);
    if (meta && (meta.sensitivity === 'secret' || meta.secret === true)) return true;
    const def = s?._zod?.def;
    if (!def) return false;
    if (WRAPPERS.has(def.type)) s = def.innerType;
    else if (def.type === 'pipe') s = def.in;
    else if (def.type === 'lazy') s = def.getter?.();
    else return false;
  }
  return false;
}

/** Does any wrapper on the way down give this schema a default value? */
export function hasDefault(schema: unknown): boolean {
  let s: any = schema;
  for (let i = 0; s && i < MAX_DEPTH; i++) {
    const def = s?._zod?.def;
    if (!def) return false;
    if (def.type === 'default' || def.type === 'prefault') return true;
    if (WRAPPERS.has(def.type)) s = def.innerType;
    else if (def.type === 'pipe') s = def.in;
    else return false;
  }
  return false;
}

/**
 * Every path to a secret inside `schema`. `[]` (the empty path) means the whole
 * value is secret. Paths are de-duplicated; `'*'` stands for any index or key.
 */
export function secretPaths(schema: unknown): SecretPath[] {
  const out = new Map<string, SecretPath>();
  const add = (p: SecretPath) => out.set(JSON.stringify(p), p);

  const walk = (s: unknown, path: (string | number)[], depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const def = defOf(s);
    if (isMarkedSecret(s)) {
      add(path);
      return;
    }
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'readonly':
      case 'catch':
      case 'nonoptional':
        return walk(def.innerType, path, depth + 1);
      case 'pipe':
        walk(def.in, path, depth + 1);
        return walk(def.out, path, depth + 1);
      case 'lazy':
        return walk(def.getter(), path, depth + 1);
      case 'object': {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        for (const [key, field] of Object.entries(shape ?? {})) {
          if (isSecretName(key)) add([...path, key]);
          else walk(field, [...path, key], depth + 1);
        }
        if (def.catchall) walk(def.catchall, [...path, '*'], depth + 1);
        return;
      }
      case 'array':
      case 'set':
        return walk(def.element ?? def.valueType, [...path, '*'], depth + 1);
      case 'record':
      case 'map':
        return walk(def.valueType, [...path, '*'], depth + 1);
      case 'tuple':
        (def.items ?? []).forEach((item: unknown, i: number) => walk(item, [...path, i], depth + 1));
        if (def.rest) walk(def.rest, [...path, '*'], depth + 1);
        return;
      case 'union':
        for (const option of def.options ?? []) walk(option, path, depth + 1);
        return;
      case 'intersection':
        walk(def.left, path, depth + 1);
        return walk(def.right, path, depth + 1);
      default:
        return; // leaves: string, number, custom, enum, literal...
    }
  };

  walk(schema, [], 0);
  return [...out.values()];
}

/** The redaction marker written in place of a secret value. */
export const REDACTED = '[secret]';

/**
 * A deep copy of `value` with every value at a secret path replaced by
 * {@link REDACTED}. Safe to log, display, put in a share link or a code exporter.
 */
export function redact<V>(value: V, paths: readonly SecretPath[]): V {
  if (paths.some((p) => p.length === 0)) return (value === undefined ? value : REDACTED) as V;
  const copy = structuredCloneLoose(value);
  for (const path of paths) redactAt(copy, path, 0);
  return copy;
}

function redactAt(node: any, path: SecretPath, i: number): void {
  if (node === null || typeof node !== 'object') return;
  const seg = path[i];
  const keys = seg === '*' ? Object.keys(node) : [String(seg)];
  for (const k of keys) {
    if (!(k in node)) continue;
    if (i === path.length - 1) {
      if (node[k] !== undefined) node[k] = REDACTED;
    } else {
      redactAt(node[k], path, i + 1);
    }
  }
}

/** Every string at a secret path in `value`: used to scrub them out of error messages. */
export function secretValues(value: unknown, paths: readonly SecretPath[]): string[] {
  const found: string[] = [];
  const visit = (node: any, path: SecretPath, i: number): void => {
    if (i === path.length) {
      collectStrings(node, found);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const seg = path[i];
    const keys = seg === '*' ? Object.keys(node) : [String(seg)];
    for (const k of keys) if (k in node) visit(node[k], path, i + 1);
  };
  for (const p of paths) visit(value, p, 0);
  return found.filter((s) => s.length >= 4);
}

function collectStrings(node: unknown, into: string[]): void {
  if (typeof node === 'string') into.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectStrings(v, into);
}

/** Replace every occurrence of any of `secrets` in `text` with {@link REDACTED}. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join(REDACTED);
  return out;
}

/** Plain-data deep copy that leaves non-plain objects (class instances, functions) by reference. */
function structuredCloneLoose<V>(value: V): V {
  if (Array.isArray(value)) return value.map((v) => structuredCloneLoose(v)) as V;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = structuredCloneLoose(v);
    return out as V;
  }
  return value;
}
