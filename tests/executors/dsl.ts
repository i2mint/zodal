/**
 * BDD Story DSL for zodal.
 *
 * Stories are declarative specs that describe user workflows.
 * They execute via executor backends (store-level, component-level, E2E).
 */

import { z } from 'zod';
import { expect } from 'vitest';
import { defineCollection, type CollectionConfig, type CollectionDefinition } from '@zodal/core';

// ============================================================================
// Schema Shorthand
// ============================================================================

type FieldShorthand =
  | 'string' | 'string.uuid' | 'string.email' | 'string.url'
  | 'number' | 'number.int' | 'boolean' | 'date'
  | `enum:${string}`
  | `array:${string}`;

/** Convert shorthand notation to a Zod schema field */
function parseFieldShorthand(shorthand: string): z.ZodType {
  // Handle parametrized types
  if (shorthand.startsWith('enum:')) {
    const values = shorthand.slice(5).split(',').map(v => v.trim());
    return z.enum(values as [string, ...string[]]);
  }
  if (shorthand.startsWith('array:')) {
    const inner = parseFieldShorthand(shorthand.slice(6));
    return z.array(inner);
  }

  // Handle chained modifiers like 'number.int.min(1).max(5)'
  const parts = shorthand.split('.');
  const base = parts[0];

  let schema: any;
  switch (base) {
    case 'string': schema = z.string(); break;
    case 'number': schema = z.number(); break;
    case 'boolean': schema = z.boolean(); break;
    case 'date': schema = z.date(); break;
    default: schema = z.string(); break;
  }

  // Apply modifiers
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const match = part.match(/^(\w+)(?:\(([^)]*)\))?$/);
    if (!match) continue;
    const [, method, arg] = match;

    if (method === 'uuid') schema = schema.uuid?.() ?? schema;
    else if (method === 'email') schema = schema.email?.() ?? schema;
    else if (method === 'url') schema = schema.url?.() ?? schema;
    else if (method === 'int') schema = schema.int?.() ?? schema;
    else if (method === 'min' && arg) schema = schema.min(Number(arg));
    else if (method === 'max' && arg) schema = schema.max(Number(arg));
    else if (method === 'optional') schema = schema.optional();
    else if (method === 'default' && arg) {
      // Try to parse as number or boolean
      const val = arg === 'true' ? true : arg === 'false' ? false : isNaN(Number(arg)) ? arg : Number(arg);
      schema = schema.default(val);
    }
  }

  return schema;
}

/** Build a Zod object schema from a shorthand field map */
function buildSchema(fields: Record<string, string>): z.ZodObject<any> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, shorthand] of Object.entries(fields)) {
    shape[key] = parseFieldShorthand(shorthand);
  }
  return z.object(shape);
}

// ============================================================================
// Story Context (shared state during execution)
// ============================================================================

export interface StoryContext {
  schemas: Record<string, z.ZodObject<any>>;
  collections: Record<string, CollectionDefinition<any>>;
  configs: Record<string, CollectionConfig>;
  results: Record<string, unknown>;
}

function createContext(): StoryContext {
  return { schemas: {}, collections: {}, configs: {}, results: {} };
}

// ============================================================================
// Given / When / Then builders
// ============================================================================

export type StoryStep = (ctx: StoryContext) => void;

export const given = {
  /** Define a schema with shorthand notation */
  schema(name: string, fields: Record<string, string>): StoryStep {
    return (ctx) => {
      ctx.schemas[name] = buildSchema(fields);
    };
  },

  /** Define a collection config to apply */
  config(name: string, config: CollectionConfig): StoryStep {
    return (ctx) => {
      ctx.configs[name] = config;
    };
  },

  /** Provide sample data */
  data(name: string, items: Record<string, unknown>[]): StoryStep {
    return (ctx) => {
      ctx.results[`data:${name}`] = items;
    };
  },
};

export const when = {
  /** Define a collection (uses latest schema and optional config) */
  defineCollection(schemaName?: string, configName?: string): StoryStep {
    return (ctx) => {
      const name = schemaName ?? Object.keys(ctx.schemas).at(-1)!;
      const schema = ctx.schemas[name];
      if (!schema) throw new Error(`Schema '${name}' not found`);
      const config = configName ? ctx.configs[configName] : undefined;
      ctx.collections[name] = defineCollection(schema, config);
    };
  },
};

export const then = {
  /** Assert the id field */
  idFieldIs(expected: string): StoryStep {
    return (ctx) => {
      const collection = lastCollection(ctx);
      expect(collection.idField).toBe(expected);
    };
  },

  /** Assert the label field */
  labelFieldIs(expected: string): StoryStep {
    return (ctx) => {
      const collection = lastCollection(ctx);
      expect(collection.labelField).toBe(expected);
    };
  },

  /** Assert a field's affordances */
  fieldIs(fieldName: string, expected: Record<string, unknown>): StoryStep {
    return (ctx) => {
      const collection = lastCollection(ctx);
      const fa = collection.fieldAffordances[fieldName];
      expect(fa).toBeDefined();
      for (const [key, value] of Object.entries(expected)) {
        expect((fa as any)[key]).toEqual(value);
      }
    };
  },

  /** Assert visible fields exclude certain fields */
  visibleFieldsExclude(...excluded: string[]): StoryStep {
    return (ctx) => {
      const visible = lastCollection(ctx).getVisibleFields();
      for (const field of excluded) {
        expect(visible).not.toContain(field);
      }
    };
  },

  /** Assert visible fields include certain fields */
  visibleFieldsInclude(...included: string[]): StoryStep {
    return (ctx) => {
      const visible = lastCollection(ctx).getVisibleFields();
      for (const field of included) {
        expect(visible).toContain(field);
      }
    };
  },

  /** Assert searchable fields */
  searchableFieldsInclude(...fields: string[]): StoryStep {
    return (ctx) => {
      const searchable = lastCollection(ctx).getSearchableFields();
      for (const field of fields) {
        expect(searchable).toContain(field);
      }
    };
  },

  /** Assert collection-level affordance */
  affordanceIs(key: string, expected: unknown): StoryStep {
    return (ctx) => {
      const collection = lastCollection(ctx);
      expect((collection.affordances as any)[key]).toEqual(expected);
    };
  },

  /** Assert operations by scope */
  operationCount(scope: 'item' | 'selection' | 'collection', count: number): StoryStep {
    return (ctx) => {
      expect(lastCollection(ctx).getOperations(scope)).toHaveLength(count);
    };
  },

  /** Assert total field count */
  fieldCount(count: number): StoryStep {
    return (ctx) => {
      expect(Object.keys(lastCollection(ctx).fieldAffordances)).toHaveLength(count);
    };
  },
};

function lastCollection(ctx: StoryContext): CollectionDefinition<any> {
  const names = Object.keys(ctx.collections);
  if (names.length === 0) throw new Error('No collections defined');
  return ctx.collections[names.at(-1)!];
}

// ============================================================================
// Story runner
// ============================================================================

export interface StoryDef {
  name: string;
  given: StoryStep[];
  when: StoryStep[];
  then: StoryStep[];
}

/** Define a story */
export function story(name: string, def: Omit<StoryDef, 'name'>): StoryDef {
  return { name, ...def };
}

/** Execute a story (called by test runner) */
export function runStory(storyDef: StoryDef): void {
  const ctx = createContext();
  for (const step of storyDef.given) step(ctx);
  for (const step of storyDef.when) step(ctx);
  for (const step of storyDef.then) step(ctx);
}
