/**
 * Zod wrapper peeling: the one definition of which Zod schemas merely wrap another.
 *
 * Inference, secret detection (`sensitivity.ts`) and the store's provider
 * descriptors all walk through wrappers to reach the schema that says what a
 * value is. They differ in which side of a pipe they want and in what a
 * `z.lazy` whose getter throws means, so those are options here, not copies
 * of the wrapper list (divergent lists are how zodal#35 happened).
 */

import type { z } from 'zod';

/** Zod wrappers that hold a single `innerType` and do not change the value's type. */
export const ZOD_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'catch',
  'nonoptional',
]);

/** How {@link peelZodWrapper} treats the wrappers that are not plain `innerType` holders. */
export interface PeelZodWrapperOptions {
  /**
   * Which side of a pipe to step into. `'output'` (the default) is what a parsed
   * value holds: a `z.codec(z.string(), z.date())` is a date; a `.transform()`
   * output carries no type, so there the input side is used. `'input'` is what a
   * caller writes, which is what secret detection and option snapshots inspect.
   */
  pipe?: 'output' | 'input';
  /**
   * What to do with a `z.lazy`. `'resolve'` (the default) steps into its schema, and
   * stops (returns `undefined`) when the getter throws, as a forward reference not yet
   * initialised does. `'strict'` steps in and lets a throwing getter throw, for callers
   * that must not read "nothing here" off a schema they could not inspect. `'keep'`
   * treats a lazy as not a wrapper.
   */
  lazy?: 'resolve' | 'strict' | 'keep';
}

/**
 * One unwrapping step: the schema a wrapper stands for, or `undefined` when `schema` is
 * not a wrapper. Peels the {@link ZOD_WRAPPER_TYPES}, a pipe and (by default) a `z.lazy`.
 */
export function peelZodWrapper(
  schema: unknown,
  { pipe = 'output', lazy = 'resolve' }: PeelZodWrapperOptions = {},
): z.ZodType | undefined {
  const zod = (schema as any)?._zod;
  const def = zod?.def;
  if (!def) return undefined;
  if (ZOD_WRAPPER_TYPES.has(def.type)) return def.innerType;
  if (def.type === 'pipe') {
    if (pipe === 'input') return def.in;
    return def.out?._zod?.def?.type === 'transform' ? def.in : def.out;
  }
  if (def.type === 'lazy' && lazy !== 'keep') {
    // Zod caches the resolved schema on `_zod.innerType`.
    if (lazy === 'strict') return zod.innerType ?? def.getter();
    try {
      return zod.innerType ?? def.getter();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
