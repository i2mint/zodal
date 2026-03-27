/**
 * Integration tests: Full pipeline from schema -> collection -> generators -> store -> data provider.
 *
 * These tests verify that @zodal/core, @zodal/store, and @zodal/ui work together correctly.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider } from '@zodal/store';
import { toColumnDefs, toFormConfig, toFilterConfig, createCollectionStore, toPrompt, toCode } from '@zodal/ui';

// ============================================================================
// Shared test schema
// ============================================================================

const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  sku: z.string(),
  price: z.number().min(0),
  category: z.enum(['electronics', 'clothing', 'food', 'books']),
  inStock: z.boolean().default(true),
  tags: z.array(z.string()),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Product = z.infer<typeof ProductSchema>;

const sampleProducts: Product[] = [
  { id: 'p1', name: 'Laptop', sku: 'ELEC-001', price: 999, category: 'electronics', inStock: true, tags: ['tech', 'portable'], description: 'A powerful laptop', createdAt: new Date('2024-01-15'), updatedAt: new Date('2024-06-01') },
  { id: 'p2', name: 'T-Shirt', sku: 'CLTH-001', price: 25, category: 'clothing', inStock: true, tags: ['casual'], createdAt: new Date('2024-02-10'), updatedAt: new Date('2024-05-15') },
  { id: 'p3', name: 'Novel', sku: 'BOOK-001', price: 15, category: 'books', inStock: false, tags: ['fiction', 'bestseller'], createdAt: new Date('2024-03-01'), updatedAt: new Date('2024-04-20') },
  { id: 'p4', name: 'Rice', sku: 'FOOD-001', price: 5, category: 'food', inStock: true, tags: ['staple'], createdAt: new Date('2024-04-01'), updatedAt: new Date('2024-07-01') },
  { id: 'p5', name: 'Headphones', sku: 'ELEC-002', price: 150, category: 'electronics', inStock: true, tags: ['tech', 'audio'], description: 'Noise cancelling', createdAt: new Date('2024-05-01'), updatedAt: new Date('2024-08-01') },
];

// ============================================================================
// Full pipeline: schema -> collection -> generators
// ============================================================================

describe('Full pipeline: defineCollection -> generators', () => {
  const collection = defineCollection(ProductSchema, {
    affordances: {
      bulkDelete: true,
      export: ['csv', 'json'],
      defaultSort: { field: 'createdAt', direction: 'desc' },
    },
    fields: {
      name: { inlineEditable: true, summaryField: true },
      description: { detailOnly: true },
      price: { displayFormat: 'currency' },
      category: { badge: { electronics: 'blue', clothing: 'green', food: 'orange', books: 'purple' } },
    },
    operations: [
      { name: 'discount', label: 'Apply Discount', scope: 'selection' },
      { name: 'restock', label: 'Restock', scope: 'item' },
    ],
  });

  it('produces column defs that match collection affordances', () => {
    const cols = toColumnDefs(collection);

    // Select column exists (selectable is 'multi' by default)
    expect(cols.find(c => c.id === 'select')).toBeDefined();

    // Actions column exists (we have item-level operations)
    expect(cols.find(c => c.id === 'actions')).toBeDefined();

    // Hidden fields not present
    const colIds = cols.map(c => c.id);
    expect(colIds).not.toContain('id');
    expect(colIds).not.toContain('updatedAt');
    expect(colIds).not.toContain('description'); // detailOnly

    // Name column has inline edit metadata
    const nameCol = cols.find(c => c.id === 'name')!;
    expect(nameCol.meta.inlineEditable).toBe(true);

    // Category has badge metadata
    const catCol = cols.find(c => c.id === 'category')!;
    expect(catCol.meta.badge).toBeDefined();

    // Price has correct filter
    const priceCol = cols.find(c => c.id === 'price')!;
    expect(priceCol.filterFn).toBe('inNumberRange');
  });

  it('produces form config that respects field modes', () => {
    const createFields = toFormConfig(collection, 'create');
    const editFields = toFormConfig(collection, 'edit');

    // ID excluded from both (uuid -> not editable)
    expect(createFields.find(f => f.name === 'id')).toBeUndefined();
    expect(editFields.find(f => f.name === 'id')).toBeUndefined();

    // Category has select type with options
    const catField = createFields.find(f => f.name === 'category')!;
    expect(catField.type).toBe('select');
    expect(catField.options).toHaveLength(4);

    // Both modes include editable fields
    expect(createFields.find(f => f.name === 'name')).toBeDefined();
    expect(editFields.find(f => f.name === 'name')).toBeDefined();
  });

  it('produces filter config with correct operator types', () => {
    const filters = toFilterConfig(collection);

    const priceFilter = filters.find(f => f.name === 'price')!;
    expect(priceFilter.filterType).toBe('range');
    expect(priceFilter.bounds).toBeDefined();

    const catFilter = filters.find(f => f.name === 'category')!;
    expect(catFilter.filterType).toBe('select');
    expect(catFilter.options).toHaveLength(4);
  });

  it('produces a store that reflects collection affordances', () => {
    const store = createCollectionStore<Product>(collection);

    // Default sort applied
    expect(store.initialState.sorting).toEqual([{ id: 'createdAt', desc: true }]);

    // Hidden fields in visibility
    expect(store.initialState.columnVisibility.id).toBe(false);
    expect(store.initialState.columnVisibility.updatedAt).toBe(false);

    // Actions work
    let state = store.actions.setItems(store.initialState, sampleProducts, sampleProducts.length);
    expect(state.items).toHaveLength(5);
    expect(state.totalCount).toBe(5);

    state = store.actions.selectAll(state);
    expect(store.selectors.getSelectedCount(state)).toBe(5);
  });

  it('produces consistent toPrompt and toCode outputs', () => {
    const prompt = toPrompt(collection);
    expect(prompt).toContain('# Collection Definition');
    expect(prompt).toContain('`name`');
    expect(prompt).toContain('Apply Discount');

    const code = toCode(collection);
    expect(code).toContain('export const config: CollectionConfig');
    expect(code).toContain("idField: 'id'");
  });
});

// ============================================================================
// Pipeline: collection -> data provider -> store round-trip
// ============================================================================

describe('Pipeline: collection -> data provider -> store', () => {
  const collection = defineCollection(ProductSchema);

  it('data provider works with FilterExpression format', async () => {
    const provider = createInMemoryProvider(sampleProducts, { idField: 'id' });

    // Filter by category
    const electronics = await provider.getList({
      filter: { field: 'category', operator: 'eq', value: 'electronics' },
    });
    expect(electronics.data).toHaveLength(2);

    // Compound filter: electronics AND price > 100
    const expensiveElectronics = await provider.getList({
      filter: {
        and: [
          { field: 'category', operator: 'eq', value: 'electronics' },
          { field: 'price', operator: 'gt', value: 100 },
        ],
      },
    });
    expect(expensiveElectronics.data).toHaveLength(2); // Laptop (999) + Headphones (150)

    // Sort + paginate
    const sorted = await provider.getList({
      sort: [{ id: 'price', desc: true }],
      pagination: { page: 1, pageSize: 2 },
    });
    expect(sorted.data[0].name).toBe('Laptop');
    expect(sorted.data[1].name).toBe('Headphones');
    expect(sorted.total).toBe(5);
  });

  it('store state round-trips correctly with data provider', async () => {
    const store = createCollectionStore<Product>(collection);
    const provider = createInMemoryProvider(sampleProducts, { idField: 'id' });

    // Simulate: fetch data -> set items -> apply filter -> reset pagination
    const { data, total } = await provider.getList({});
    let state = store.actions.setItems(store.initialState, data, total);
    expect(state.totalCount).toBe(5);

    // Select some items
    state = store.actions.setRowSelection(state, { '0': true, '2': true });
    const selected = store.selectors.getSelectedItems(state);
    expect(selected).toHaveLength(2);

    // Reset
    state = store.actions.reset(state);
    expect(store.selectors.hasSelection(state)).toBe(false);
    expect(state.items).toHaveLength(5); // items preserved after reset
  });

  it('provider capabilities report correctly', () => {
    const provider = createInMemoryProvider(sampleProducts);
    const caps = provider.getCapabilities!();

    expect(caps.canCreate).toBe(true);
    expect(caps.canUpsert).toBe(true);
    expect(caps.serverSort).toBe(false); // in-memory is client-side
    expect(caps.serverFilter).toBe(false);
  });
});
