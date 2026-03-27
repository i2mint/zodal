import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/collection.js';

// ============================================================================
// explain() — Layer-by-layer tracing
// ============================================================================

describe('explain() - basic', () => {
  it('returns traces for a specific field', () => {
    const schema = z.object({
      id: z.string(),
      name: z.string(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('name');

    expect(traces.length).toBeGreaterThan(0);
    expect(traces.every(t => t.field === 'name')).toBe(true);
  });

  it('returns traces for all fields when no fieldName given', () => {
    const schema = z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain();

    const fields = new Set(traces.map(t => t.field));
    expect(fields.has('id')).toBe(true);
    expect(fields.has('name')).toBe(true);
    expect(fields.has('count')).toBe(true);
  });
});

describe('explain() - layer separation', () => {
  it('shows type layer for basic string field', () => {
    const schema = z.object({
      color: z.string(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('color');

    const sortableTrace = traces.find(t => t.affordance === 'sortable');
    expect(sortableTrace).toBeDefined();
    expect(sortableTrace!.layers.length).toBeGreaterThan(0);
    expect(sortableTrace!.layers[0].layer).toBe('type');
    expect(sortableTrace!.layers[0].value).toBe('both');
    expect(sortableTrace!.layers[0].reason).toContain('string');
  });

  it('shows name layer overriding type layer for id field', () => {
    const schema = z.object({
      id: z.string(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('id');

    // 'id' matches the ID pattern → name heuristic overrides type defaults
    const editableTrace = traces.find(t => t.affordance === 'editable');
    expect(editableTrace).toBeDefined();
    // Should have type layer (string → editable: true) then name layer (id → editable: false)
    const typeLayers = editableTrace!.layers.filter(l => l.layer === 'type');
    const nameLayers = editableTrace!.layers.filter(l => l.layer === 'name');
    expect(typeLayers.length).toBeGreaterThan(0);
    expect(nameLayers.length).toBeGreaterThan(0);
    expect(nameLayers[0].value).toBe(false);
    expect(editableTrace!.finalValue).toBe(false);
  });

  it('shows meta layer when .meta() is used', () => {
    const schema = z.object({
      title: z.string().meta({ sortable: false }),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('title');

    const sortableTrace = traces.find(t => t.affordance === 'sortable');
    expect(sortableTrace).toBeDefined();
    const metaLayers = sortableTrace!.layers.filter(l => l.layer === 'meta');
    expect(metaLayers.length).toBe(1);
    expect(metaLayers[0].value).toBe(false);
    expect(sortableTrace!.finalValue).toBe(false);
  });

  it('shows config layer when CollectionConfig.fields overrides', () => {
    const schema = z.object({
      name: z.string(),
    });
    const collection = defineCollection(schema, {
      fields: { name: { sortable: false } },
    });
    const traces = collection.explain('name');

    const sortableTrace = traces.find(t => t.affordance === 'sortable');
    expect(sortableTrace).toBeDefined();
    const configLayers = sortableTrace!.layers.filter(l => l.layer === 'config');
    expect(configLayers.length).toBe(1);
    expect(configLayers[0].value).toBe(false);
    expect(sortableTrace!.finalValue).toBe(false);
  });
});

describe('explain() - complex scenarios', () => {
  it('traces password field through name heuristic', () => {
    const schema = z.object({
      password: z.string(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('password');

    const visibleTrace = traces.find(t => t.affordance === 'visible');
    expect(visibleTrace).toBeDefined();
    // Type layer: string → visible: true
    // Name layer: password → visible: false
    const nameLayers = visibleTrace!.layers.filter(l => l.layer === 'name');
    expect(nameLayers.length).toBe(1);
    expect(nameLayers[0].value).toBe(false);
    expect(nameLayers[0].reason).toContain('password');
  });

  it('traces description field getting textarea widget from name heuristic', () => {
    const schema = z.object({
      description: z.string(),
    });
    const collection = defineCollection(schema);
    const traces = collection.explain('description');

    const widgetTrace = traces.find(t => t.affordance === 'editWidget');
    expect(widgetTrace).toBeDefined();
    expect(widgetTrace!.finalValue).toBe('textarea');
    const nameLayers = widgetTrace!.layers.filter(l => l.layer === 'name');
    expect(nameLayers.length).toBe(1);
  });

  it('config overrides win over all other layers', () => {
    const schema = z.object({
      id: z.string().meta({ editable: true }),
    });
    // Meta says editable: true, but config says false
    const collection = defineCollection(schema, {
      fields: { id: { editable: false } },
    });
    const traces = collection.explain('id');
    const editableTrace = traces.find(t => t.affordance === 'editable');
    expect(editableTrace).toBeDefined();
    expect(editableTrace!.finalValue).toBe(false);

    // Should see config layer as last layer
    const lastLayer = editableTrace!.layers.at(-1)!;
    expect(lastLayer.layer).toBe('config');
    expect(lastLayer.value).toBe(false);
  });

  it('returns empty array for non-existent field', () => {
    const schema = z.object({ name: z.string() });
    const collection = defineCollection(schema);
    const traces = collection.explain('nonexistent');
    expect(traces).toEqual([]);
  });
});
