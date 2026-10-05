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
 * **Live options.** Options that are not data (a client instance, a `fetch`, a
 * callback) are declared `z.custom()` (or marked `.meta({ serializable: false })`);
 * {@link splitOptions} separates them from the shareable part.
 */

import { z, type ZodType } from 'zod';
import {
  secretPaths,
  hasDefault,
  redact,
  secretValues,
  scrubSecrets,
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
  for (const path of secretPaths(descriptor.options)) {
    if (hasDefault(schemaAt(descriptor.options, path))) {
      throw new Error(
        `Provider descriptor "${name}": secret option "${path.join('.')}" has a default value, which would be published with the schema`,
      );
    }
  }
  return descriptor;
}

/** The schema at a path (following objects, wrappers and `'*'`), or undefined. Used for the default check. */
function schemaAt(schema: unknown, path: SecretPath): unknown {
  let s: any = schema;
  for (const seg of path) {
    for (let i = 0; i < 12 && s?._zod?.def; i++) {
      const t = s._zod.def.type;
      if (t === 'optional' || t === 'nullable' || t === 'default' || t === 'readonly') s = s._zod.def.innerType;
      else if (t === 'pipe') s = s._zod.def.in;
      else break;
    }
    const def = s?._zod?.def;
    if (!def) return undefined;
    if (def.type === 'object') s = (typeof def.shape === 'function' ? def.shape() : def.shape)?.[seg];
    else if (seg === '*') s = def.element ?? def.valueType;
    else return undefined;
  }
  return s;
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

/** A copy of `options` with every secret replaced by `'[secret]'`: the only form to display, log, share or export. */
export function redactOptions<O>(descriptor: ProviderDescriptor<O>, options: O): O {
  return redact(options, secretOptionPaths(descriptor, options));
}

/** Top-level keys whose schema is not data (`z.custom()`, or `.meta({ serializable: false })`). */
export function liveOptionKeys(descriptor: ProviderDescriptor): string[] {
  const def = (descriptor.options as any)?._zod?.def;
  const shape = def?.type === 'object' ? (typeof def.shape === 'function' ? def.shape() : def.shape) : undefined;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, field]) => isLive(field))
    .map(([key]) => key);
}

function isLive(schema: any): boolean {
  for (let s = schema, i = 0; s?._zod?.def && i < 12; i++) {
    const meta = typeof s.meta === 'function' ? s.meta() : undefined;
    if (meta?.serializable === false) return true;
    const t = s._zod.def.type;
    if (t === 'custom' || t === 'function') return true;
    if (t === 'optional' || t === 'nullable' || t === 'default' || t === 'readonly') s = s._zod.def.innerType;
    else return false;
  }
  return false;
}

/**
 * Split options into what can be shared and what cannot: `data` (redacted, live
 * keys removed: safe for a share link, a saved view, a code exporter),
 * `secretPaths` (to read from the environment instead), and `live` (keys the app
 * must supply in code: clients, functions).
 */
export function splitOptions<O extends Record<string, unknown>>(
  descriptor: ProviderDescriptor<O>,
  options: O,
): { data: Partial<O>; secretPaths: SecretPath[]; live: string[] } {
  const live = liveOptionKeys(descriptor);
  const data = redactOptions(descriptor, options) as Record<string, unknown>;
  for (const key of live) delete data[key];
  return { data: data as Partial<O>, secretPaths: secretOptionPaths(descriptor, options), live };
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

/**
 * Validate `options` against the descriptor's schema, then create the provider.
 *
 * Errors name the descriptor and never contain secret values: validation issues
 * on secret paths are reported by path and code only, and any message (from
 * validation or from `create`) is scrubbed of the secret strings in `options`.
 */
export async function createFromDescriptor<O, T extends Record<string, any>>(
  descriptor: ProviderDescriptor<O, T>,
  options: unknown,
): Promise<DataProvider<T>> {
  let paths: SecretPath[];
  try {
    paths = secretOptionPaths(descriptor, options);
  } catch {
    paths = secretOptionPaths(descriptor);
  }
  const secrets = secretValues(options, paths);
  const scrub = (text: string) => scrubSecrets(text, secrets);

  const parsed = descriptor.options.safeParse(options);
  if (!parsed.success) {
    const onSecret = (issuePath: readonly PropertyKey[]) =>
      paths.some((p) => p.length <= issuePath.length && p.every((seg, i) => seg === '*' || String(seg) === String(issuePath[i])));
    const lines = parsed.error.issues.map((issue) => {
      const where = issue.path.length ? issue.path.join('.') : '(options)';
      return onSecret(issue.path) ? `${where}: ${issue.code}` : `${where}: ${scrub(issue.message)}`;
    });
    throw new Error(`Invalid options for provider "${descriptor.name}": ${lines.join('; ')}`);
  }
  try {
    return await descriptor.create(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Provider "${descriptor.name}" could not be created: ${scrub(message)}`);
  }
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
  const leaves = children.filter((d) => !describedCapabilities(d).bifurcated);
  if (leaves.length === 0) throw new Error(`${name}: needs at least one non-composite child descriptor`);
  const byName = new Map(leaves.map((d) => [d.name, d]));
  const childSchema = z.discriminatedUnion(
    'name',
    leaves.map((d) => z.object({ name: z.literal(d.name), options: (d.options as ZodType).optional() })) as any,
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
        return createFromDescriptor(d, choice.options ?? {});
      };
      const metadataProvider = await build('metadata', metadata);
      const contentProvider = await build('content', content);
      return createBifurcatedProvider({ metadataProvider, contentProvider, contentFields, idField, listStrategy, detailStrategy });
    },
  });
}
