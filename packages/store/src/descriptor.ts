/**
 * Provider descriptors: a backend described as data, so it can be listed,
 * configured and created by name.
 *
 * Each adapter package exports a descriptor for its own provider (a satellite
 * describes itself; no satellite imports another). An app, a playground or an
 * agent aggregates the descriptors it cares about into a menu, renders each
 * one's `options` schema as a form (zodal's own form generator works), checks
 * `supports()` at runtime, and calls `create`. `@zodal/store` defines the shape
 * and the helpers only; the aggregating catalog lives in the app.
 *
 * Imported from the `@zodal/store/descriptor` subpath, so the main entry keeps no
 * runtime dependency on zod. Requires Zod v4 (`.meta()`).
 *
 * Options that hold credentials are marked `.meta({ sensitivity: 'secret' })`
 * (the zodal-dials convention): {@link secretOptionKeys} finds them, so a form can
 * mask them and a code exporter can emit an environment reference instead.
 */

import { z, type ZodType } from 'zod';
import type { DataProvider } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';
import { createBifurcatedProvider } from './bifurcated-provider.js';

/** Where a provider can run. */
export type ProviderRuntime = 'browser' | 'node' | 'any';

export interface ProviderDescriptor<O = any, T extends Record<string, any> = any> {
  /** Stable machine name, unique within a menu: `'localStorage'`, `'fs'`, `'s3'`... */
  name: string;
  /** Human label for a menu. */
  label: string;
  /** One sentence: what it stores and where. */
  description?: string;
  /** The npm package that provides it. */
  package: string;
  /** Static runtime requirement. Pair with {@link ProviderDescriptor.supports} for the real check. */
  runtime: ProviderRuntime;
  /**
   * The options `create` takes, as a Zod schema: validated before `create`, and
   * renderable as a configuration form. Mark credential fields with
   * `.meta({ sensitivity: 'secret' })`. Non-serializable options (a client
   * instance, a `fetch`) are `z.custom()`.
   */
  options: ZodType<O>;
  /** What the created provider does server-side, for a menu (the provider's own `getCapabilities()` is authoritative). */
  capabilities?: Partial<ProviderCapabilities>;
  /**
   * Can this provider run here, now? A feature-detecting check (e.g. try a
   * localStorage write: private browsing exposes the API and then throws).
   * Absent means "if the runtime matches, yes".
   */
  supports?(): boolean | Promise<boolean>;
  /** Build the provider from validated options. */
  create(options: O): DataProvider<T> | Promise<DataProvider<T>>;
}

/** Identity helper that checks the descriptor's shape and keeps its types. */
export function defineProviderDescriptor<O, T extends Record<string, any> = any>(
  descriptor: ProviderDescriptor<O, T>,
): ProviderDescriptor<O, T> {
  if (!/^[A-Za-z][\w.-]*$/.test(descriptor.name)) {
    throw new Error(`Provider descriptor name must be an identifier-like string, got "${descriptor.name}"`);
  }
  if (typeof descriptor.create !== 'function') {
    throw new Error(`Provider descriptor "${descriptor.name}" has no create function`);
  }
  return descriptor;
}

/** Is `descriptor` usable in this environment? `runtime` first, then `supports()`. */
export async function isProviderSupported(
  descriptor: ProviderDescriptor,
  here: ProviderRuntime = typeof window === 'undefined' ? 'node' : 'browser',
): Promise<boolean> {
  if (descriptor.runtime !== 'any' && here !== 'any' && descriptor.runtime !== here) return false;
  if (!descriptor.supports) return true;
  try {
    return await descriptor.supports();
  } catch {
    return false;
  }
}

/**
 * Validate `options` against the descriptor's schema, then create the provider.
 * Throws the schema's error (naming the descriptor) when options are invalid.
 */
export async function createFromDescriptor<O, T extends Record<string, any>>(
  descriptor: ProviderDescriptor<O, T>,
  options: unknown,
): Promise<DataProvider<T>> {
  const parsed = descriptor.options.safeParse(options);
  if (!parsed.success) {
    throw new Error(`Invalid options for provider "${descriptor.name}": ${parsed.error.message}`);
  }
  return descriptor.create(parsed.data);
}

/**
 * Top-level option keys marked `.meta({ sensitivity: 'secret' })` (or
 * `.meta({ secret: true })`, the zodal-dials alias): mask them in forms, never
 * print them, export them as environment references.
 */
export function secretOptionKeys(descriptor: ProviderDescriptor): string[] {
  const def = (descriptor.options as any)?._zod?.def;
  const shape: Record<string, ZodType> | undefined = def?.shape;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, field]) => isSecret(field))
    .map(([key]) => key);
}

function isSecret(schema: any): boolean {
  // Metadata may sit on a wrapper (`.optional()`) or on the schema it wraps.
  for (let s = schema, depth = 0; s && depth < 8; depth++) {
    const meta = typeof s.meta === 'function' ? s.meta() : undefined;
    if (meta && (meta.sensitivity === 'secret' || meta.secret === true)) return true;
    s = s?._zod?.def?.innerType;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The two descriptors @zodal/store itself provides
// ---------------------------------------------------------------------------

/**
 * In-memory: always available, nothing persists. The right default for tests,
 * demos and a playground. Options are a plain-data subset of
 * {@link createInMemoryProvider}'s.
 */
export const inMemoryDescriptor: ProviderDescriptor<{
  data?: Record<string, any>[];
  idField?: string;
  searchFields?: string[];
}> = defineProviderDescriptor({
  name: 'inMemory',
  label: 'In memory',
  description: 'Items live in this page or process only; nothing persists.',
  package: '@zodal/store',
  runtime: 'any',
  options: z.object({
    data: z.array(z.record(z.string(), z.any())).optional(),
    idField: z.string().optional(),
    searchFields: z.array(z.string()).optional(),
  }),
  capabilities: { serverSort: false, serverFilter: false, serverSearch: false, serverPagination: false },
  create: ({ data = [], idField, searchFields }) =>
    createInMemoryProvider(data, { idField, searchFields }),
});

export interface BifurcatedDescriptorOptions {
  metadata: { name: string; options?: unknown };
  content: { name: string; options?: unknown };
  contentFields: string[];
  idField?: string;
}

/**
 * Metadata × content: one provider composed of two, where queryable fields
 * (including tags) live in the metadata provider and the `contentFields` in the
 * content provider (see `createBifurcatedProvider`). The children are named, and
 * resolved through `resolve`, so this descriptor needs no registry of its own:
 * the app passes its catalog's lookup.
 */
export function bifurcatedDescriptor(
  resolve: (name: string) => ProviderDescriptor | undefined,
): ProviderDescriptor<BifurcatedDescriptorOptions> {
  const child = z.object({ name: z.string(), options: z.unknown().optional() });
  return defineProviderDescriptor({
    name: 'bifurcated',
    label: 'Metadata + content',
    description: 'Queryable fields in one provider, large content fields in another.',
    package: '@zodal/store',
    runtime: 'any',
    options: z.object({
      metadata: child,
      content: child,
      contentFields: z.array(z.string()).min(1),
      idField: z.string().optional(),
    }) as ZodType<BifurcatedDescriptorOptions>,
    capabilities: { bifurcated: true },
    async create({ metadata, content, contentFields, idField }) {
      const lookup = (which: string, name: string) => {
        const d = resolve(name);
        if (!d) throw new Error(`bifurcated: unknown ${which} provider "${name}"`);
        if (d.name === 'bifurcated') throw new Error(`bifurcated: the ${which} provider cannot itself be bifurcated`);
        return d;
      };
      const metadataProvider = await createFromDescriptor(lookup('metadata', metadata.name), metadata.options ?? {});
      const contentProvider = await createFromDescriptor(lookup('content', content.name), content.options ?? {});
      return createBifurcatedProvider({ metadataProvider, contentProvider, contentFields, idField });
    },
  });
}
