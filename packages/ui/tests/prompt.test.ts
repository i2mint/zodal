import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toPrompt } from '../src/prompt.js';

// ============================================================================
// Test Schema
// ============================================================================

const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  status: z.enum(['draft', 'active', 'archived']),
  priority: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// toPrompt
// ============================================================================

describe('toPrompt', () => {
  it('generates a non-empty prompt string', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('includes collection header', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toContain('# Collection Definition');
  });

  it('includes identity fields', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toContain('**ID field**: `id`');
    expect(prompt).toContain('**Label field**: `name`');
  });

  it('includes data shape table', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toContain('## Data Shape');
    expect(prompt).toContain('| Field | Type |');
    expect(prompt).toContain('| `name` |');
    expect(prompt).toContain('| `status` |');
    expect(prompt).toContain('| `priority` |');
  });

  it('includes collection capabilities', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { bulkDelete: true, export: ['csv', 'json'] },
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('## Collection Capabilities');
    expect(prompt).toContain('Create new items');
    expect(prompt).toContain('Bulk delete selected items');
    expect(prompt).toContain('Export (csv, json)');
  });

  it('includes searchable fields', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toContain('**Searchable fields**');
    expect(prompt).toContain('`name`');
  });

  it('includes filter configuration', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    expect(prompt).toContain('## Filter Configuration');
    expect(prompt).toContain('`status` (select)');
    expect(prompt).toContain('`priority` (range)');
  });

  it('includes custom operations', () => {
    const collection = defineCollection(ProjectSchema, {
      operations: [
        { name: 'archive', label: 'Archive', scope: 'item', confirm: true, variant: 'destructive' },
        { name: 'bulkPublish', label: 'Publish Selected', scope: 'selection' },
      ],
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('## Custom Operations');
    expect(prompt).toContain('`archive`');
    expect(prompt).toContain('item');
    expect(prompt).toContain('yes'); // confirm
    expect(prompt).toContain('destructive');
    expect(prompt).toContain('`bulkPublish`');
  });

  it('includes UI generation hints', () => {
    const collection = defineCollection(ProjectSchema, {
      fields: {
        name: { inlineEditable: true },
        status: { badge: { draft: 'secondary', active: 'default', archived: 'outline' } },
      },
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('## UI Generation Hints');
    expect(prompt).toContain('Inline-editable');
    expect(prompt).toContain('`name`');
    expect(prompt).toContain('Render as badges');
    expect(prompt).toContain('`status`');
  });

  it('includes visible field list in hints', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt = toPrompt(collection);
    // name should be visible, id should not
    expect(prompt).toContain('Show these fields in the table');
    expect(prompt).toMatch(/`name`/);
  });

  it('marks detail-only fields', () => {
    const collection = defineCollection(ProjectSchema, {
      fields: { description: { detailOnly: true } },
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('Show only in detail view');
    expect(prompt).toContain('`description`');
  });

  it('includes default sort info', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { defaultSort: { field: 'createdAt', direction: 'desc' } },
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('**Default sort**: `createdAt` desc');
  });

  it('includes pagination info', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { pagination: { defaultPageSize: 50, style: 'infinite', serverSide: true } },
    });
    const prompt = toPrompt(collection);
    expect(prompt).toContain('Pagination');
    expect(prompt).toContain('50/page');
  });

  it('generates consistent output for the same input', () => {
    const collection = defineCollection(ProjectSchema);
    const prompt1 = toPrompt(collection);
    const prompt2 = toPrompt(collection);
    expect(prompt1).toBe(prompt2);
  });
});

// ============================================================================
// Full integration: complex schema
// ============================================================================

describe('toPrompt - complex schema', () => {
  it('handles a fully-configured collection', () => {
    const EcommerceSchema = z.object({
      id: z.string().uuid(),
      sku: z.string(),
      name: z.string().min(1),
      description: z.string(),
      price: z.number().min(0),
      category: z.enum(['electronics', 'clothing', 'food', 'books']),
      inStock: z.boolean().default(true),
      imageUrl: z.string().optional(),
      tags: z.array(z.string()),
      createdAt: z.date(),
    });

    const collection = defineCollection(EcommerceSchema, {
      affordances: {
        create: true,
        bulkDelete: true,
        bulkEdit: true,
        search: { debounce: 300 },
        export: ['csv', 'json', 'xlsx'],
        pagination: { defaultPageSize: 50, style: 'infinite' },
        defaultSort: { field: 'createdAt', direction: 'desc' },
        selectable: 'multi',
      },
      fields: {
        sku: { copyable: true, immutableAfterCreate: true },
        name: { inlineEditable: true, summaryField: true },
        description: { detailOnly: true },
        price: { displayFormat: 'currency' },
        category: { badge: { electronics: 'blue', clothing: 'green', food: 'orange', books: 'purple' } },
      },
      operations: [
        { name: 'discount', label: 'Apply Discount', scope: 'selection' },
        { name: 'restock', label: 'Restock', scope: 'item' },
        { name: 'generateReport', label: 'Generate Report', scope: 'collection' },
      ],
    });

    const prompt = toPrompt(collection);

    // Verify structure
    expect(prompt).toContain('# Collection Definition');
    expect(prompt).toContain('## Data Shape');
    expect(prompt).toContain('## Collection Capabilities');
    expect(prompt).toContain('## Filter Configuration');
    expect(prompt).toContain('## Custom Operations');
    expect(prompt).toContain('## UI Generation Hints');

    // Verify specific content
    expect(prompt).toContain('`sku`');
    expect(prompt).toContain('`price`');
    expect(prompt).toContain('`category`');
    expect(prompt).toContain('Bulk delete');
    expect(prompt).toContain('Bulk edit');
    expect(prompt).toContain('Export (csv, json, xlsx)');
    expect(prompt).toContain('`discount`');
    expect(prompt).toContain('`restock`');
    expect(prompt).toContain('`generateReport`');
  });
});
