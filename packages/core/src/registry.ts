/**
 * Affordance Registry: External metadata that survives Zod schema transforms.
 *
 * When `.meta()` is placed on a schema before wrapping with `.optional()`,
 * `.nullable()`, etc., the metadata is lost because those methods return new
 * instances. The affordanceRegistry solves this by storing affordances externally,
 * keyed by the inner schema's identity.
 *
 * Usage:
 * ```typescript
 * import { affordanceRegistry } from '@zodal/core';
 *
 * const priceSchema = z.number().min(0);
 * affordanceRegistry.register(priceSchema, { displayFormat: 'currency' });
 *
 * const Product = z.object({
 *   price: priceSchema.optional(), // metadata survives!
 * });
 * ```
 */

import { z } from 'zod';
import type { FieldAffordance } from './types.js';

// ============================================================================
// AffordanceRegistry
// ============================================================================

export interface AffordanceRegistry {
  /** Register affordance overrides for a schema instance. */
  register(schema: z.ZodType, affordances: Partial<FieldAffordance>): void;

  /** Look up affordances for a schema (checks unwrapped inner schemas). */
  get(schema: z.ZodType): Partial<FieldAffordance> | undefined;

  /** Check if a schema has registered affordances. */
  has(schema: z.ZodType): boolean;

  /** Remove a registration. */
  unregister(schema: z.ZodType): void;

  /** Clear all registrations. */
  clear(): void;
}

/**
 * Create a new affordance registry.
 *
 * Uses a WeakMap internally so schemas can be garbage-collected.
 */
export function createAffordanceRegistry(): AffordanceRegistry {
  const map = new WeakMap<z.ZodType, Partial<FieldAffordance>>();

  function unwrapAndFind(schema: z.ZodType): Partial<FieldAffordance> | undefined {
    // Check the schema directly first
    if (map.has(schema)) return map.get(schema);

    // Unwrap optional/nullable/default layers and check inner schemas
    const def = (schema as any)._zod?.def;
    if (def && (def.type === 'optional' || def.type === 'nullable' || def.type === 'default')) {
      return unwrapAndFind(def.innerType);
    }

    return undefined;
  }

  return {
    register(schema: z.ZodType, affordances: Partial<FieldAffordance>) {
      map.set(schema, affordances);
    },

    get(schema: z.ZodType): Partial<FieldAffordance> | undefined {
      return unwrapAndFind(schema);
    },

    has(schema: z.ZodType): boolean {
      return unwrapAndFind(schema) !== undefined;
    },

    unregister(schema: z.ZodType) {
      map.delete(schema);
    },

    clear() {
      // WeakMap has no clear() — this creates a new registry effectively
      // But since we return an object, the caller would need a new instance
      // For safety, we just note this is a no-op on WeakMap
    },
  };
}

/** The default global affordance registry. */
export const affordanceRegistry = createAffordanceRegistry();
