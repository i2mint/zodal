/**
 * Provider descriptors: a backend described as data, so it can be listed,
 * configured and created by name.
 *
 * Each adapter package exports a descriptor for its own provider (a satellite
 * describes itself; no satellite imports another). An app, a playground or an
 * agent aggregates the descriptors it cares about into a menu, shows each one's
 * `options`, checks it can run here, and calls
 * `createFromDescriptor`. `@zodal/store` defines the shape and the helpers; the
 * aggregating catalog lives in the app. (A form generator for options schemas is
 * not part of zodal yet; `toFormConfig` targets collection records.)
 *
 * Imported from the `@zodal/store/descriptor` subpath, so the main entry keeps no
 * runtime dependency on zod. Requires Zod v4 (`defineProviderDescriptor` refuses
 * anything else, because secret detection needs v4's introspection).
 *
 * **Secrets.** Options that hold credentials are found by
 * {@link secretOptionPaths}: fields marked `.meta({ sensitivity: 'secret' })`, and
 * fields whose names look like secrets (`apiKey`, `password`, `token`...), at
 * any depth. Every display, log, share link or code export of options goes
 * through {@link redactOptions}; validation and creation errors are scrubbed of
 * secret values before they are thrown.
 *
 * **Scope.** These guarantees cover the descriptor helpers: once a provider is
 * created, errors it throws later (from `getList`, ...) are its own; adapters
 * should not put option values in their messages.
 *
 * **Live options.** Options that are not data (a client instance, a `fetch`, a
 * callback) are declared `z.custom()` (or marked `.meta({ serializable: false })`);
 * {@link splitOptions} separates them from the shareable part.
 */

import { z, type ZodType } from 'zod';
import {
  secretPaths,
  inspectSecrets,
  redact,
  secretValues,
  type SecretPath,
} from '@zodal/core';
import type { DataProvider } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';
import { createBifurcatedProvider } from './bifurcated-provider.js';

/** Where a provider can run. */
export type ProviderRuntime = 'browser' | 'node' | 'any';

const RUNTIMES: readonly ProviderRuntime[] = ['browser', 'node', 'any'];

/** Where to import a descriptor from: what a code exporter or a lazy loader needs. */
export interface DescriptorSource {
  /** Import specifier, e.g. `'@zodal/store-fs'` or `'@zodal/store/descriptor'`. */
  module: string;
  /** Exported name of the descriptor (or of the factory that builds it). */
  export: string;
}

export interface ProviderDescriptor<O = any, T extends Record<string, any> = any> {
  /** Stable machine name, unique within a menu: `'localStorage'`, `'fs'`, `'s3'`... */
  name: string;
  /** Human label for a menu. */
  label: string;
  /** One sentence: what it stores and where. */
  description?: string;
  /** Where this descriptor is imported from. */
  source: DescriptorSource;
  /**
   * Where it can run. Advisory when {@link ProviderDescriptor.supports} exists
   * (the feature check decides); otherwise a hard filter.
   */
  runtime: ProviderRuntime;
  /**
   * The options `create` takes, as a Zod v4 schema: validated before `create`,
   * renderable as a configuration form. Mark credentials
   * `.meta({ sensitivity: 'secret' })` (secret-looking names are caught anyway);
   * declare non-data options (instances, functions) as `z.custom()`. Unknown
   * keys are stripped by validation, so declare every option `create` reads.
   */
  options: ZodType<O>;
  /**
   * What the provider does server-side, for a menu. A function when it depends on
   * the options (e.g. search only when search columns are configured). The
   * created provider's own `getCapabilities()` stays authoritative.
   */
  capabilities?: Partial<ProviderCapabilities> | ((options: O) => Partial<ProviderCapabilities>);
  /**
   * Can this provider run here, now? A feature-detecting check (e.g. try a
   * localStorage write: private browsing exposes the API and then throws).
   */
  supports?(): boolean | Promise<boolean>;
  /**
   * Secret paths that depend on the options (a composite's children). Absent:
   * the static {@link secretOptionPaths} of `options`.
   */
  secretPaths?(options: unknown): SecretPath[];
  /** True for a descriptor composed of other descriptors (e.g. bifurcated); composites cannot be children. */
  composite?: boolean;
  /** Build the provider from validated options. */
  create(options: O): DataProvider<T> | Promise<DataProvider<T>>;
}

/** Checks a descriptor's shape and keeps its types. Fails closed on what secret handling needs. */
export function defineProviderDescriptor<O, T extends Record<string, any> = any>(
  descriptor: ProviderDescriptor<O, T>,
): ProviderDescriptor<O, T> {
  const { name } = descriptor;
  if (!/^[A-Za-z][\w.-]*$/.test(name)) {
    throw new Error(`Provider descriptor name must be an identifier-like string, got "${name}"`);
  }
  if (typeof descriptor.create !== 'function') {
    throw new Error(`Provider descriptor "${name}" has no create function`);
  }
  if (!RUNTIMES.includes(descriptor.runtime)) {
    throw new Error(`Provider descriptor "${name}": runtime must be one of ${RUNTIMES.join(', ')}`);
  }
  if (!descriptor.source?.module || !descriptor.source?.export) {
    throw new Error(`Provider descriptor "${name}": source { module, export } is required`);
  }
  if (!(descriptor.options as any)?._zod) {
    throw new Error(`Provider descriptor "${name}": options must be a Zod v4 schema (secret detection needs it)`);
  }
  const { published } = inspectSecrets(descriptor.options);
  if (published.length) {
    throw new Error(
      `Provider descriptor "${name}": secret option(s) ${published.map((p) => `"${p.join('.') || '(options)'}"`).join(', ')} ` +
        'would be published with the schema (a default, catch value or example); remove it',
    );
  }
  return descriptor;
}

/** The runtime this code is executing in, by feature rather than by `window`. */
export function currentRuntime(): Exclude<ProviderRuntime, 'any'> {
  const g = globalThis as any;
  // Node (also under jsdom/happy-dom test environments, which define `window`).
  if (g.process?.versions?.node) return 'node';
  // Browsers, web workers, and fetch-only edge runtimes: no filesystem, browser-like APIs.
  return 'browser';
}

/**
 * Is `descriptor` usable here? With a `supports()` check, that check decides (a
 * throwing check counts as no). Without one, `runtime` must match.
 */
export async function isProviderSupported(
  descriptor: ProviderDescriptor,
  here: ProviderRuntime = currentRuntime(),
): Promise<boolean> {
  if (descriptor.supports) {
    try {
      return Boolean(await descriptor.supports());
    } catch {
      return false;
    }
  }
  return descriptor.runtime === 'any' || here === 'any' || descriptor.runtime === here;
}

/** Every path to a secret in `options` (static, or the descriptor's own when it depends on the options). */
export function secretOptionPaths(descriptor: ProviderDescriptor, options?: unknown): SecretPath[] {
  const own = secretPaths(descriptor.options);
  if (!descriptor.secretPaths || options === undefined) return own;
  const extra = descriptor.secretPaths(options);
  const seen = new Set(own.map((p) => JSON.stringify(p)));
  return [...own, ...extra.filter((p) => !seen.has(JSON.stringify(p)))];
}

/** The marker written in place of a live (non-data) option by {@link redactOptions}. */
export const LIVE = '[live]';

/**
 * Paths to options that are not data: `z.custom()` / `z.function()` fields, or
 * fields marked `.meta({ serializable: false })`, at any depth (`'*'` for any
 * index or key). They are supplied in code, never shared, logged or exported.
 */
export function liveOptionPaths(descriptor: ProviderDescriptor): SecretPath[] {
  const out = new Map<string, SecretPath>();
  const walk = (s: any, path: (string | number)[], depth: number): void => {
    const def = s?._zod?.def;
    if (!def || depth > 32) return;
    const meta = typeof s.meta === 'function' ? s.meta() : undefined;
    if (meta?.serializable === false || def.type === 'custom' || def.type === 'function') {
      out.set(JSON.stringify(path), path);
      return;
    }
    switch (def.type) {
      case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly': case 'catch': case 'nonoptional':
        return walk(def.innerType, path, depth + 1);
      case 'pipe':
        walk(def.in, path, depth + 1);
        return walk(def.out, path, depth + 1);
      case 'lazy':
        return walk(def.getter(), path, depth + 1);
      case 'object': {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        for (const [k, f] of Object.entries(shape ?? {})) walk(f, [...path, k], depth + 1);
        if (def.catchall) walk(def.catchall, [...path, '*'], depth + 1);
        return;
      }
      case 'tuple':
        (def.items ?? []).forEach((item: unknown, i: number) => walk(item, [...path, i], depth + 1));
        if (def.rest) walk(def.rest, [...path, '*'], depth + 1);
        return;
      case 'intersection':
        walk(def.left, path, depth + 1);
        return walk(def.right, path, depth + 1);
      case 'array': case 'set':
        return walk(def.element ?? def.valueType, [...path, '*'], depth + 1);
      case 'record': case 'map':
        return walk(def.valueType, [...path, '*'], depth + 1);
      case 'union':
        for (const o of def.options ?? []) walk(o, path, depth + 1);
        return;
      default:
        return;
    }
  };
  walk(descriptor.options, [], 0);
  return [...out.values()];
}

function replaceAt(value: unknown, path: SecretPath, replacement: unknown, i = 0): unknown {
  if (i === path.length) return replacement;
  if (Array.isArray(value)) {
    return value.map((v, idx) => (path[i] === '*' || String(path[i]) === String(idx) ? replaceAt(v, path, replacement, i + 1) : v));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = path[i] === '*' || String(path[i]) === k ? replaceAt(v, path, replacement, i + 1) : v;
    }
    return out;
  }
  return value;
}

/**
 * A copy of `options` that is safe to display, log, share or export: secrets
 * replaced by `'[secret]'`, live options (clients, functions) by `'[live]'`.
 * Never writes into `options`.
 */
export function redactOptions<O>(descriptor: ProviderDescriptor<O>, options: O): O {
  let out: unknown = redact(options, secretOptionPaths(descriptor, options), inspectSecrets(descriptor.options).publicPaths);
  for (const path of liveOptionPaths(descriptor)) out = replaceAt(out, path, LIVE);
  return out as O;
}

/**
 * Split options into what can be shared and what cannot: `data` (redacted, live
 * options removed: safe for a share link, a saved view, a code exporter),
 * `secretPaths` (to read from the environment instead), and `live` (paths the
 * app must supply in code: clients, functions).
 */
export function splitOptions<O extends Record<string, unknown>>(
  descriptor: ProviderDescriptor<O>,
  options: O,
): { data: Partial<O>; secretPaths: SecretPath[]; live: SecretPath[] } {
  const live = liveOptionPaths(descriptor);
  let data: unknown = redact(options, secretOptionPaths(descriptor, options), inspectSecrets(descriptor.options).publicPaths);
  for (const path of live) data = replaceAt(data, path, undefined);
  data = dropUndefined(data);
  return { data: data as Partial<O>, secretPaths: secretOptionPaths(descriptor, options), live };
}

function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = dropUndefined(v);
    return out;
  }
  return value;
}

/** The menu-time capability summary, resolved against `options` when it depends on them. */
export function describedCapabilities<O>(
  descriptor: ProviderDescriptor<O>,
  options?: O,
): Partial<ProviderCapabilities> {
  const caps = descriptor.capabilities;
  if (typeof caps === 'function') return options === undefined ? {} : caps(options);
  return caps ?? {};
}

/** A Zod issue described from its structure only: never its message text, which can echo input. */
function describeIssue(issue: any, schema: unknown): string {
  const where = issue.path?.length ? safePath(schema, issue.path).join('.') : '(options)';
  const parts: string[] = [issue.code];
  if (issue.expected !== undefined) parts.push(`expected ${String(issue.expected)}`);
  if (issue.minimum !== undefined) parts.push(`minimum ${String(issue.minimum)}`);
  if (issue.maximum !== undefined) parts.push(`maximum ${String(issue.maximum)}`);
  if (issue.format !== undefined) parts.push(`format ${String(issue.format)}`);
  // Unrecognized keys are user data (a pasted token can be a key): count them, never print them.
  if (Array.isArray(issue.keys)) parts.push(`${issue.keys.length} unrecognized key(s)`);
  return `${where}: ${parts.join(', ')}`;
}


/**
 * An issue path with every segment that is not a schema-declared object key (a
 * record or map key, which is user data) replaced by `*`. Array indexes stay.
 */
function safePath(schema: unknown, path: readonly PropertyKey[]): string[] {
  const out: string[] = [];
  let nodes: any[] = [schema];
  for (const seg of path) {
    const next: any[] = [];
    let declared = false;
    for (let n of nodes) {
      for (let i = 0; i < 32 && n?._zod?.def; i++) {
        const t = n._zod.def.type;
        if (['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional'].includes(t)) n = n._zod.def.innerType;
        else if (t === 'pipe') n = n._zod.def.in;
        else if (t === 'lazy') n = n._zod.def.getter();
        else break;
      }
      const def = n?._zod?.def;
      if (!def) continue;
      if (def.type === 'object') {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
        if (typeof seg === 'string' && shape && Object.prototype.hasOwnProperty.call(shape, seg)) {
          declared = true;
          next.push(shape[seg]);
        } else if (def.catchall) next.push(def.catchall);
      } else if (def.type === 'array' || def.type === 'set') next.push(def.element ?? def.valueType);
      else if (def.type === 'tuple') next.push(...(def.items ?? []), ...(def.rest ? [def.rest] : []));
      else if (def.type === 'record' || def.type === 'map') next.push(def.valueType);
      else if (def.type === 'union') nodes.push(...(def.options ?? []));
      else if (def.type === 'intersection') nodes.push(def.left, def.right);
    }
    const indexed = nodes.some((n: any) => {
      let s = n;
      for (let i = 0; i < 32 && s?._zod?.def && ['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional'].includes(s._zod.def.type); i++) s = s._zod.def.innerType;
      const ty = s?._zod?.def?.type;
      return ty === 'array' || ty === 'tuple' || ty === 'set';
    });
    out.push(declared ? String(seg) : typeof seg === 'number' && indexed ? String(seg) : '*');
    nodes = next;
  }
  return out;
}

/** A plain-data snapshot of the options, read once (getters run once; live objects kept by reference). */
function snapshot<V>(value: V, depth = 0, seen = new WeakSet<object>()): V {
  if (value === null || typeof value !== 'object' || depth > 32) return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => snapshot(v, depth + 1, seen)) as V;
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) out[k] = snapshot(v, depth + 1, seen);
    return out as V;
  }
  return value;
}

/**
 * What to say about an error thrown while validating or creating: its message
 * only when the options hold no secret values (so nothing can be echoed,
 * encoded or not), else just its type.
 */
function safeErrorText(err: unknown, hasSecrets: boolean): string {
  // Not even the error's name: a custom name can be built from a value.
  if (hasSecrets) return 'an error (message withheld: these options contain secrets)';
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Do these options hold any secret value? Any non-null value at a secret path
 * counts, not only text: a `URL` or a credentials object can be rendered into an
 * error message just as well.
 */
function hasSecretsIn(descriptor: ProviderDescriptor, options: unknown): boolean {
  let paths: SecretPath[];
  try {
    paths = secretOptionPaths(descriptor, options);
  } catch {
    try {
      paths = secretPaths(descriptor.options);
    } catch {
      return true; // cannot tell: assume secrets
    }
  }
  return paths.some((p) => valuesAtPath(options, p).some((v) => v !== undefined && v !== null && v !== ''))
    || secretValues(options, paths).length > 0;
}

function valuesAtPath(value: unknown, path: SecretPath): unknown[] {
  let frontier: unknown[] = [value];
  for (const seg of path) {
    const next: unknown[] = [];
    for (const n of frontier) {
      if (n === null || typeof n !== 'object') continue;
      if (seg === '*') next.push(...(n instanceof Map || n instanceof Set ? [...n.values()] : Object.values(n)));
      else next.push(n instanceof Map ? n.get(seg) : (n as any)[seg]);
    }
    frontier = next;
  }
  return frontier;
}

/** `create` with an error that never carries secret values. */
async function createSafely<O, T extends Record<string, any>>(
  descriptor: ProviderDescriptor<O, T>,
  parsed: O,
  hasSecrets: boolean,
): Promise<DataProvider<T>> {
  try {
    return await descriptor.create(parsed);
  } catch (err) {
    throw new Error(`Provider "${descriptor.name}" could not be created: ${safeErrorText(err, hasSecrets)}`);
  }
}

/**
 * Validate `options` against the descriptor's schema, then create the provider.
 *
 * Errors name the descriptor and never contain option values: validation issues
 * are described from their structure (path, code, expected type, bounds), never
 * from Zod's message text; an error thrown by a transform, a refinement or
 * `create` keeps its message only when the options hold no secrets.
 */
export async function createFromDescriptor<O, T extends Record<string, any>>(
  descriptor: ProviderDescriptor<O, T>,
  options: unknown,
): Promise<DataProvider<T>> {
  const input = snapshot(options);
  const rawSecrets = hasSecretsIn(descriptor, input);
  let parsed: ReturnType<typeof descriptor.options.safeParse>;
  try {
    parsed = descriptor.options.safeParse(input);
  } catch (err) {
    throw new Error(`Invalid options for provider "${descriptor.name}": ${safeErrorText(err, rawSecrets)}`);
  }
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => describeIssue(issue, descriptor.options));
    throw new Error(`Invalid options for provider "${descriptor.name}": ${lines.join('; ')}`);
  }
  // A secret may appear only after parsing (a transform falling back to an environment variable).
  const secrets = rawSecrets || hasSecretsIn(descriptor, parsed.data);
  return createSafely(descriptor, parsed.data as O, secrets);
}

// ---------------------------------------------------------------------------
// The two descriptors @zodal/store itself provides
// ---------------------------------------------------------------------------

/** In-memory: always available, nothing persists. The default for tests, demos and a playground. */
export const inMemoryDescriptor: ProviderDescriptor<{
  data?: Record<string, any>[];
  idField?: string;
  searchFields?: string[];
}> = defineProviderDescriptor({
  name: 'inMemory',
  label: 'In memory',
  description: 'Items live in this page or process only; nothing persists.',
  source: { module: '@zodal/store/descriptor', export: 'inMemoryDescriptor' },
  runtime: 'any',
  options: z.object({
    data: z.array(z.record(z.string(), z.any())).optional(),
    idField: z.string().optional(),
    searchFields: z.array(z.string()).optional(),
  }),
  capabilities: { serverSort: false, serverFilter: false, serverSearch: false, serverPagination: false, canUpsert: true },
  create: ({ data = [], idField, searchFields }) =>
    createInMemoryProvider(data, { idField, searchFields }),
});

export interface BifurcatedDescriptorOptions {
  metadata: { name: string; options?: unknown };
  content: { name: string; options?: unknown };
  contentFields: string[];
  idField?: string;
  listStrategy?: 'reference' | 'omit';
  detailStrategy?: 'eager' | 'reference';
}

/**
 * Metadata × content: one provider composed of two, where queryable fields
 * (including tags) live in the metadata provider and the `contentFields` in the
 * content provider (see `createBifurcatedProvider`).
 *
 * `children` are the descriptors a user may pick for either side (the app's
 * catalog, minus other composites). Because the list is concrete, the options
 * schema is a real discriminated union over the children's own schemas: forms
 * render, validation is complete, and the children's secrets are found.
 * Composites are not allowed as children.
 */
export function bifurcatedDescriptor(
  children: readonly ProviderDescriptor[],
  { name = 'bifurcated', label = 'Metadata + content' }: { name?: string; label?: string } = {},
): ProviderDescriptor<BifurcatedDescriptorOptions> {
  const leaves = children.filter((d) => !d.composite && !(typeof d.capabilities === 'object' && d.capabilities?.bifurcated));
  if (leaves.length === 0) throw new Error(`${name}: needs at least one non-composite child descriptor`);
  const dup = leaves.find((d, i) => leaves.findIndex((e) => e.name === d.name) !== i);
  if (dup) throw new Error(`${name}: two child descriptors are named "${dup.name}"`);
  const byName = new Map(leaves.map((d) => [d.name, d]));
  const childSchema = z.discriminatedUnion(
    'name',
    // prefault({}): omitted child options are validated as {} (required fields still fail here, not at create).
    leaves.map((d) => z.object({ name: z.literal(d.name), options: (d.options as any).prefault({}) })) as any,
  );
  const childSecretPaths = (side: 'metadata' | 'content', choice: any): SecretPath[] => {
    const d = byName.get(choice?.name);
    if (!d) return [];
    return secretOptionPaths(d, choice?.options).map((p) => [side, 'options', ...p]);
  };

  return defineProviderDescriptor<BifurcatedDescriptorOptions>({
    name,
    label,
    description: 'Queryable fields in one provider, large content fields in another.',
    source: { module: '@zodal/store/descriptor', export: 'bifurcatedDescriptor' },
    runtime: 'any',
    options: z.object({
      metadata: childSchema,
      content: childSchema,
      contentFields: z.array(z.string()).min(1),
      idField: z.string().optional(),
      listStrategy: z.enum(['reference', 'omit']).optional(),
      detailStrategy: z.enum(['eager', 'reference']).optional(),
    }) as unknown as ZodType<BifurcatedDescriptorOptions>,
    capabilities: { bifurcated: true },
    composite: true,
    secretPaths: (options: any) => [
      ...childSecretPaths('metadata', options?.metadata),
      ...childSecretPaths('content', options?.content),
    ],
    async create({ metadata, content, contentFields, idField, listStrategy, detailStrategy }) {
      const build = async (side: string, choice: { name: string; options?: unknown }) => {
        const d = byName.get(choice.name)!; // the union already restricted names to known children
        if (!(await isProviderSupported(d))) {
          throw new Error(`${side} provider "${d.name}" cannot run here`);
        }
        // Already parsed by the union: create directly (a second parse would re-run transforms).
        return createSafely(d, choice.options as any, hasSecretsIn(d, choice.options));
      };
      const metadataProvider = await build('metadata', metadata);
      const contentProvider = await build('content', content);
      return createBifurcatedProvider({ metadataProvider, contentProvider, contentFields, idField, listStrategy, detailStrategy });
    },
  });
}
