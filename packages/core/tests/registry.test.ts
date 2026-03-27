import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/collection.js';
import { createAffordanceRegistry, affordanceRegistry } from '../src/registry.js';

// ============================================================================
// createAffordanceRegistry — Unit tests
// ============================================================================

describe('createAffordanceRegistry', () => {
  it('registers and retrieves affordances for a schema', () => {
    const registry = createAffordanceRegistry();
    const schema = z.string();
    registry.register(schema, { sortable: false, displayFormat: 'currency' });

    expect(registry.has(schema)).toBe(true);
    expect(registry.get(schema)).toEqual({ sortable: false, displayFormat: 'currency' });
  });

  it('returns undefined for unregistered schemas', () => {
    const registry = createAffordanceRegistry();
    expect(registry.get(z.string())).toBeUndefined();
    expect(registry.has(z.string())).toBe(false);
  });

  it('survives .optional() wrapping', () => {
    const registry = createAffordanceRegistry();
    const inner = z.number().min(0);
    registry.register(inner, { displayFormat: 'currency' });

    const wrapped = inner.optional();
    expect(registry.get(wrapped)).toEqual({ displayFormat: 'currency' });
  });

  it('survives .nullable() wrapping', () => {
    const registry = createAffordanceRegistry();
    const inner = z.string();
    registry.register(inner, { editWidget: 'richtext' });

    const wrapped = inner.nullable();
    expect(registry.get(wrapped)).toEqual({ editWidget: 'richtext' });
  });

  it('survives .default() wrapping', () => {
    const registry = createAffordanceRegistry();
    const inner = z.boolean();
    registry.register(inner, { filterable: 'boolean' });

    const wrapped = inner.default(false);
    expect(registry.get(wrapped)).toEqual({ filterable: 'boolean' });
  });

  it('survives multiple layers of wrapping', () => {
    const registry = createAffordanceRegistry();
    const inner = z.number();
    registry.register(inner, { aggregatable: ['sum', 'avg'] });

    const wrapped = inner.optional().nullable().default(0);
    expect(registry.get(wrapped)).toEqual({ aggregatable: ['sum', 'avg'] });
  });

  it('unregister removes the entry', () => {
    const registry = createAffordanceRegistry();
    const schema = z.string();
    registry.register(schema, { sortable: false });
    expect(registry.has(schema)).toBe(true);

    registry.unregister(schema);
    expect(registry.has(schema)).toBe(false);
  });

  it('different registries are independent', () => {
    const reg1 = createAffordanceRegistry();
    const reg2 = createAffordanceRegistry();
    const schema = z.string();

    reg1.register(schema, { sortable: false });
    expect(reg1.has(schema)).toBe(true);
    expect(reg2.has(schema)).toBe(false);
  });
});

// ============================================================================
// Integration: affordanceRegistry + defineCollection
// ============================================================================

describe('affordanceRegistry + defineCollection', () => {
  beforeEach(() => {
    // Note: WeakMap-based registry doesn't have clear(), but we create
    // fresh schemas each test so old entries won't match
  });

  it('registry overrides are applied during defineCollection', () => {
    const priceSchema = z.number().min(0);
    affordanceRegistry.register(priceSchema, {
      displayFormat: 'currency',
      filterable: 'range',
    });

    const ProductSchema = z.object({
      id: z.string(),
      price: priceSchema,
    });

    const collection = defineCollection(ProductSchema);
    expect(collection.fieldAffordances.price.displayFormat).toBe('currency');
  });

  it('registry overrides survive .optional() in schema', () => {
    const priceSchema = z.number().min(0);
    affordanceRegistry.register(priceSchema, {
      displayFormat: 'currency',
    });

    const ProductSchema = z.object({
      id: z.string(),
      price: priceSchema.optional(), // wrapped!
    });

    const collection = defineCollection(ProductSchema);
    expect(collection.fieldAffordances.price.displayFormat).toBe('currency');
  });

  it('config overrides (Layer 6) win over registry (Layer 5)', () => {
    const priceSchema = z.number();
    affordanceRegistry.register(priceSchema, {
      sortable: false,
    });

    const ProductSchema = z.object({
      id: z.string(),
      price: priceSchema,
    });

    const collection = defineCollection(ProductSchema, {
      fields: { price: { sortable: 'both' } },
    });

    // Config (Layer 6) wins over registry (Layer 5)
    expect(collection.fieldAffordances.price.sortable).toBe('both');
  });

  it('explain() shows registry layer', () => {
    const tagSchema = z.string();
    affordanceRegistry.register(tagSchema, {
      sortable: false,
    });

    const Schema = z.object({
      tag: tagSchema,
    });

    const collection = defineCollection(Schema);
    const traces = collection.explain('tag');

    const sortableTrace = traces.find(t => t.affordance === 'sortable');
    expect(sortableTrace).toBeDefined();
    const registryLayers = sortableTrace!.layers.filter(l => l.layer === 'registry');
    expect(registryLayers.length).toBe(1);
    expect(registryLayers[0].value).toBe(false);
  });
});
