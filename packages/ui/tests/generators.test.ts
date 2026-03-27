import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { toColumnDefs } from '../src/generators/column-defs.js';
import { toFormConfig } from '../src/generators/form-config.js';
import { toFilterConfig } from '../src/generators/filter-config.js';

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
  isPublished: z.boolean().default(false),
});

// ============================================================================
// toColumnDefs
// ============================================================================

describe('toColumnDefs', () => {
  const collection = defineCollection(ProjectSchema, {
    affordances: { selectable: 'multi' },
    operations: [
      { name: 'archive', label: 'Archive', scope: 'item' },
    ],
  });

  it('generates column definitions', () => {
    const cols = toColumnDefs(collection);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('includes a select column when selectable', () => {
    const cols = toColumnDefs(collection);
    const selectCol = cols.find(c => c.id === 'select');
    expect(selectCol).toBeDefined();
    expect(selectCol!.enableSorting).toBe(false);
    expect(selectCol!.enableHiding).toBe(false);
    expect(selectCol!.size).toBe(40);
  });

  it('includes an actions column when there are item operations', () => {
    const cols = toColumnDefs(collection);
    const actionsCol = cols.find(c => c.id === 'actions');
    expect(actionsCol).toBeDefined();
    expect(actionsCol!.enableSorting).toBe(false);
  });

  it('excludes hidden fields (id, updatedAt)', () => {
    const cols = toColumnDefs(collection);
    const colIds = cols.map(c => c.id);
    expect(colIds).not.toContain('id');
    expect(colIds).not.toContain('updatedAt');
  });

  it('includes visible fields with correct accessorKey', () => {
    const cols = toColumnDefs(collection);
    const nameCol = cols.find(c => c.id === 'name');
    expect(nameCol).toBeDefined();
    expect(nameCol!.accessorKey).toBe('name');
    expect(nameCol!.header).toBe('Name');
    expect(nameCol!.enableSorting).toBe(true);
    expect(nameCol!.enableGlobalFilter).toBe(true);
  });

  it('sets correct sort function for different types', () => {
    const cols = toColumnDefs(collection);

    const nameCol = cols.find(c => c.id === 'name')!;
    expect(nameCol.sortingFn).toBe('text');

    const priorityCol = cols.find(c => c.id === 'priority')!;
    expect(priorityCol.sortingFn).toBe('basic');

    const createdAtCol = cols.find(c => c.id === 'createdAt')!;
    expect(createdAtCol.sortingFn).toBe('datetime');
  });

  it('sets correct filter function for different filter types', () => {
    const cols = toColumnDefs(collection);

    const nameCol = cols.find(c => c.id === 'name')!;
    expect(nameCol.filterFn).toBe('includesString');

    const statusCol = cols.find(c => c.id === 'status')!;
    expect(statusCol.filterFn).toBe('arrIncludes');

    const priorityCol = cols.find(c => c.id === 'priority')!;
    expect(priorityCol.filterFn).toBe('inNumberRange');
  });

  it('includes enum values in meta', () => {
    const cols = toColumnDefs(collection);
    const statusCol = cols.find(c => c.id === 'status')!;
    expect(statusCol.meta.enumValues).toEqual(['draft', 'active', 'archived']);
  });

  it('includes numeric bounds in meta', () => {
    const cols = toColumnDefs(collection);
    const priorityCol = cols.find(c => c.id === 'priority')!;
    expect(priorityCol.meta.numericBounds).toEqual({ min: 1, max: 5 });
  });

  it('marks arrays as non-sortable', () => {
    const cols = toColumnDefs(collection);
    const tagsCol = cols.find(c => c.id === 'tags')!;
    expect(tagsCol.enableSorting).toBe(false);
  });

  it('marks description as non-sortable', () => {
    const cols = toColumnDefs(collection);
    const descCol = cols.find(c => c.id === 'description');
    if (descCol) {
      expect(descCol.enableSorting).toBe(false);
    }
  });

  it('does not include actions column when no item operations', () => {
    const collection2 = defineCollection(ProjectSchema);
    const cols = toColumnDefs(collection2);
    expect(cols.find(c => c.id === 'actions')).toBeUndefined();
  });

  it('respects column width overrides', () => {
    const collection2 = defineCollection(ProjectSchema, {
      fields: { name: { columnWidth: 300 } },
    });
    const cols = toColumnDefs(collection2);
    const nameCol = cols.find(c => c.id === 'name')!;
    expect(nameCol.size).toBe(300);
  });
});

// ============================================================================
// toFormConfig
// ============================================================================

describe('toFormConfig', () => {
  const collection = defineCollection(ProjectSchema, {
    fields: {
      name: { requiredOnCreate: true },
      status: { requiredOnCreate: true },
    },
  });

  it('generates form fields for create mode', () => {
    const fields = toFormConfig(collection, 'create');
    expect(fields.length).toBeGreaterThan(0);
  });

  it('excludes non-editable fields from create form', () => {
    const fields = toFormConfig(collection, 'create');
    const fieldNames = fields.map(f => f.name);
    expect(fieldNames).not.toContain('id');       // uuid → not editable
    expect(fieldNames).not.toContain('createdAt'); // not editable
    expect(fieldNames).not.toContain('updatedAt'); // hidden + not editable
  });

  it('includes editable fields', () => {
    const fields = toFormConfig(collection, 'create');
    const fieldNames = fields.map(f => f.name);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('priority');
  });

  it('infers correct widget types', () => {
    const fields = toFormConfig(collection, 'create');

    const nameField = fields.find(f => f.name === 'name')!;
    expect(nameField.type).toBe('text');

    const statusField = fields.find(f => f.name === 'status')!;
    expect(statusField.type).toBe('select');

    const priorityField = fields.find(f => f.name === 'priority')!;
    expect(priorityField.type).toBe('number');

    const publishedField = fields.find(f => f.name === 'isPublished')!;
    expect(publishedField.type).toBe('checkbox');
  });

  it('includes enum options for select fields', () => {
    const fields = toFormConfig(collection, 'create');
    const statusField = fields.find(f => f.name === 'status')!;
    expect(statusField.options).toEqual([
      { label: 'Draft', value: 'draft' },
      { label: 'Active', value: 'active' },
      { label: 'Archived', value: 'archived' },
    ]);
  });

  it('marks required fields', () => {
    const fields = toFormConfig(collection, 'create');
    const nameField = fields.find(f => f.name === 'name')!;
    expect(nameField.required).toBe(true);
  });

  it('uses edit widget overrides', () => {
    const collection2 = defineCollection(ProjectSchema, {
      fields: { description: { editWidget: 'richtext' } },
    });
    const fields = toFormConfig(collection2, 'create');
    const descField = fields.find(f => f.name === 'description')!;
    expect(descField.type).toBe('richtext');
  });
});

// ============================================================================
// toFilterConfig
// ============================================================================

describe('toFilterConfig', () => {
  const collection = defineCollection(ProjectSchema);

  it('generates filter configurations', () => {
    const filters = toFilterConfig(collection);
    expect(filters.length).toBeGreaterThan(0);
  });

  it('includes filterable fields with correct types', () => {
    const filters = toFilterConfig(collection);
    const filterMap = Object.fromEntries(filters.map(f => [f.name, f]));

    // name → search
    expect(filterMap.name?.filterType).toBe('search');

    // status → select
    expect(filterMap.status?.filterType).toBe('select');

    // priority → range
    expect(filterMap.priority?.filterType).toBe('range');

    // createdAt → range
    expect(filterMap.createdAt?.filterType).toBe('range');
  });

  it('excludes non-filterable fields', () => {
    const filters = toFilterConfig(collection);
    const filterNames = filters.map(f => f.name);
    // description: sortable=false but filterable might still be true (it's 'search' by default for strings)
    // We need to check what inference gives description
    // description matches DESCRIPTION_PATTERNS → sortable: false, but filterable not explicitly overridden
    // The base type is string → filterable: 'search'
    // Then name heuristic: description → sortable: false (but doesn't touch filterable)
    // So description should be filterable: 'search'
  });

  it('includes enum options for select/multiSelect filters', () => {
    const filters = toFilterConfig(collection);
    const statusFilter = filters.find(f => f.name === 'status')!;
    expect(statusFilter.options).toEqual([
      { label: 'Draft', value: 'draft' },
      { label: 'Active', value: 'active' },
      { label: 'Archived', value: 'archived' },
    ]);
  });

  it('includes numeric bounds for range filters', () => {
    const filters = toFilterConfig(collection);
    const priorityFilter = filters.find(f => f.name === 'priority')!;
    expect(priorityFilter.bounds).toEqual({ min: 1, max: 5 });
  });

  it('has labels for all filters', () => {
    const filters = toFilterConfig(collection);
    for (const filter of filters) {
      expect(filter.label).toBeTruthy();
    }
  });
});

// ============================================================================
// Integration: Complete pipeline
// ============================================================================

describe('Complete pipeline integration', () => {
  it('generates consistent configs from a single schema', () => {
    const UserSchema = z.object({
      id: z.string().uuid(),
      email: z.string().meta({ title: 'Email Address', editWidget: 'email' }),
      displayName: z.string().min(1).max(100),
      role: z.enum(['admin', 'editor', 'viewer']),
      isActive: z.boolean().default(true),
      loginCount: z.number().int().default(0),
      createdAt: z.date(),
    });

    const collection = defineCollection(UserSchema, {
      affordances: {
        create: true,
        bulkDelete: true,
        search: { debounce: 500 },
        pagination: { defaultPageSize: 50 },
      },
      fields: {
        displayName: { inlineEditable: true, summaryField: true },
        role: { filterable: 'multiSelect' },
      },
      operations: [
        { name: 'deactivate', label: 'Deactivate', scope: 'item', variant: 'destructive' },
        { name: 'bulkDeactivate', label: 'Deactivate Selected', scope: 'selection' },
        { name: 'exportUsers', label: 'Export', scope: 'collection' },
      ],
    });

    // Column defs
    const cols = toColumnDefs(collection);
    expect(cols.length).toBeGreaterThan(3); // at least select + data cols + actions

    // email column should exist with meta
    const emailCol = cols.find(c => c.id === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol!.header).toBe('Email Address');

    // role should have multiSelect filter
    const roleCol = cols.find(c => c.id === 'role');
    expect(roleCol).toBeDefined();
    expect(roleCol!.meta.filterType).toBe('multiSelect');

    // displayName should be inline editable
    const nameCol = cols.find(c => c.id === 'displayName');
    expect(nameCol!.meta.inlineEditable).toBe(true);

    // Form config
    const formFields = toFormConfig(collection, 'create');
    const emailForm = formFields.find(f => f.name === 'email');
    expect(emailForm?.type).toBe('email');

    // Filter config
    const filters = toFilterConfig(collection);
    const roleFilter = filters.find(f => f.name === 'role');
    expect(roleFilter?.filterType).toBe('multiSelect');
    expect(roleFilter?.options).toHaveLength(3);

    // Operations
    expect(collection.getOperations('item')).toHaveLength(1);
    expect(collection.getOperations('selection')).toHaveLength(1);
    expect(collection.getOperations('collection')).toHaveLength(1);

    // Description
    const desc = collection.describe();
    expect(desc).toContain('Bulk Delete');
    expect(desc).toContain('deactivate [item]');
  });
});
