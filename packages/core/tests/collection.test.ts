import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/collection.js';

// ============================================================================
// Test Schemas
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

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'editor', 'viewer']),
  isActive: z.boolean(),
  password: z.string(),
  avatarUrl: z.string().optional(),
});

// ============================================================================
// Basic defineCollection
// ============================================================================

describe('defineCollection - basic', () => {
  it('creates a collection definition from a schema', () => {
    const collection = defineCollection(ProjectSchema);
    expect(collection).toBeDefined();
    expect(collection.schema).toBe(ProjectSchema);
  });

  it('resolves all field affordances', () => {
    const collection = defineCollection(ProjectSchema);
    const keys = Object.keys(collection.fieldAffordances);
    expect(keys).toContain('id');
    expect(keys).toContain('name');
    expect(keys).toContain('status');
    expect(keys).toContain('priority');
    expect(keys).toContain('tags');
    expect(keys).toContain('description');
    expect(keys).toContain('createdAt');
    expect(keys).toContain('updatedAt');
  });

  it('detects id field automatically', () => {
    const collection = defineCollection(ProjectSchema);
    expect(collection.idField).toBe('id');
  });

  it('detects label field automatically', () => {
    const collection = defineCollection(ProjectSchema);
    expect(collection.labelField).toBe('name');
  });

  it('defaults to standard CRUD affordances', () => {
    const collection = defineCollection(ProjectSchema);
    expect(collection.affordances.create).toBe(true);
    expect(collection.affordances.read).toBe(true);
    expect(collection.affordances.update).toBe(true);
    expect(collection.affordances.delete).toBe(true);
  });
});

// ============================================================================
// Field inference in context
// ============================================================================

describe('defineCollection - field inference', () => {
  it('infers string fields as sortable and searchable', () => {
    const collection = defineCollection(ProjectSchema);
    const nameAff = collection.fieldAffordances.name;
    expect(nameAff.sortable).toBe('both');
    expect(nameAff.searchable).toBe(true);
    expect(nameAff.summaryField).toBe(true);
  });

  it('infers id field as not editable and hidden', () => {
    const collection = defineCollection(ProjectSchema);
    const idAff = collection.fieldAffordances.id;
    expect(idAff.editable).toBe(false);
    expect(idAff.visible).toBe(false);
  });

  it('infers enum fields as groupable with select filter', () => {
    const collection = defineCollection(ProjectSchema);
    const statusAff = collection.fieldAffordances.status;
    expect(statusAff.groupable).toBe(true);
    expect(statusAff.filterable).toBe('select');
  });

  it('infers number fields with range filter and aggregation', () => {
    const collection = defineCollection(ProjectSchema);
    const prioAff = collection.fieldAffordances.priority;
    expect(prioAff.filterable).toBe('range');
    expect(prioAff.aggregatable).toEqual(['sum', 'avg', 'min', 'max']);
  });

  it('infers date fields as sortable with range filter', () => {
    const collection = defineCollection(ProjectSchema);
    const createdAff = collection.fieldAffordances.createdAt;
    expect(createdAff.sortable).toBe('both');
    expect(createdAff.filterable).toBe('range');
    expect(createdAff.editable).toBe(false);
  });

  it('infers updatedAt as hidden', () => {
    const collection = defineCollection(ProjectSchema);
    const updatedAff = collection.fieldAffordances.updatedAt;
    expect(updatedAff.visible).toBe(false);
    expect(updatedAff.editable).toBe(false);
  });

  it('infers password as not readable and hidden', () => {
    const collection = defineCollection(UserSchema);
    const passAff = collection.fieldAffordances.password;
    expect(passAff.readable).toBe(false);
    expect(passAff.visible).toBe(false);
    expect(passAff.searchable).toBe(false);
  });

  it('infers avatarUrl as not sortable/filterable', () => {
    const collection = defineCollection(UserSchema);
    const avatarAff = collection.fieldAffordances.avatarUrl;
    expect(avatarAff.sortable).toBe(false);
    expect(avatarAff.filterable).toBe(false);
  });
});

// ============================================================================
// Explicit overrides
// ============================================================================

describe('defineCollection - explicit overrides', () => {
  it('overrides individual field affordances', () => {
    const collection = defineCollection(ProjectSchema, {
      fields: {
        name: { inlineEditable: true, columnWidth: 300 },
        status: { filterable: 'multiSelect' },
      },
    });

    expect(collection.fieldAffordances.name.inlineEditable).toBe(true);
    expect(collection.fieldAffordances.name.columnWidth).toBe(300);
    expect(collection.fieldAffordances.status.filterable).toBe('multiSelect');
  });

  it('overrides collection-level affordances', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: {
        create: false,
        bulkDelete: true,
        export: ['csv', 'json'],
      },
    });

    expect(collection.affordances.create).toBe(false);
    expect(collection.affordances.bulkDelete).toBe(true);
    expect(collection.affordances.export).toEqual(['csv', 'json']);
  });

  it('overrides idField and labelField', () => {
    const collection = defineCollection(ProjectSchema, {
      idField: 'name',
      labelField: 'description',
    });

    expect(collection.idField).toBe('name');
    expect(collection.labelField).toBe('description');
  });

  it('adds custom operations', () => {
    const collection = defineCollection(ProjectSchema, {
      operations: [
        { name: 'archive', label: 'Archive', scope: 'item', icon: 'Archive' },
        { name: 'bulkArchive', label: 'Archive Selected', scope: 'selection' },
        { name: 'export', label: 'Export', scope: 'collection' },
      ],
    });

    expect(collection.operations).toHaveLength(3);
    expect(collection.getOperations('item')).toHaveLength(1);
    expect(collection.getOperations('selection')).toHaveLength(1);
    expect(collection.getOperations('collection')).toHaveLength(1);
  });
});

// ============================================================================
// Query methods
// ============================================================================

describe('defineCollection - query methods', () => {
  const collection = defineCollection(ProjectSchema);

  it('getVisibleFields excludes hidden fields', () => {
    const visible = collection.getVisibleFields();
    expect(visible).not.toContain('id');       // id is hidden
    expect(visible).not.toContain('updatedAt'); // updatedAt is hidden
    expect(visible).toContain('name');
    expect(visible).toContain('status');
    expect(visible).toContain('priority');
  });

  it('getSearchableFields returns only searchable fields', () => {
    const searchable = collection.getSearchableFields();
    expect(searchable).toContain('name');
    expect(searchable).not.toContain('priority'); // numbers aren't searchable
    expect(searchable).not.toContain('id');       // id isn't searchable
  });

  it('getFilterableFields returns fields with filter types', () => {
    const filterable = collection.getFilterableFields();
    const keys = filterable.map(f => f.key);
    expect(keys).toContain('name');
    expect(keys).toContain('status');
    expect(keys).toContain('priority');
    expect(keys).toContain('createdAt');
  });

  it('getSortableFields returns sortable fields', () => {
    const sortable = collection.getSortableFields();
    const keys = sortable.map(f => f.key);
    expect(keys).toContain('name');
    expect(keys).toContain('status');
    expect(keys).toContain('priority');
    expect(keys).toContain('createdAt');
    expect(keys).not.toContain('tags'); // arrays aren't sortable
  });

  it('getGroupableFields returns groupable fields', () => {
    const groupable = collection.getGroupableFields();
    const keys = groupable.map(f => f.key);
    expect(keys).toContain('status');       // enum → groupable
    expect(keys).not.toContain('name');     // string → not groupable by default
    expect(keys).not.toContain('priority'); // number → not groupable by default
  });
});

// ============================================================================
// describe()
// ============================================================================

describe('defineCollection - describe()', () => {
  it('generates a human-readable description', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { bulkDelete: true },
      operations: [{ name: 'archive', label: 'Archive', scope: 'item' }],
    });

    const desc = collection.describe();
    expect(desc).toContain('Collection with 8 fields');
    expect(desc).toContain('ID: id');
    expect(desc).toContain('Label: name');
    expect(desc).toContain('Create, Read, Update, Delete');
    expect(desc).toContain('Bulk Delete');
    expect(desc).toContain('name (string)');
    expect(desc).toContain('sort:both');
    expect(desc).toContain('archive [item]: Archive');
  });
});

// ============================================================================
// Zod metadata integration
// ============================================================================

describe('defineCollection - Zod metadata', () => {
  it('respects .meta() annotations on fields', () => {
    const SchemaWithMeta = z.object({
      id: z.string(),
      title: z.string().meta({ sortable: false, title: 'Project Title' }),
      count: z.number().meta({ filterable: 'exact', editable: false }),
    });

    const collection = defineCollection(SchemaWithMeta);

    expect(collection.fieldAffordances.title.sortable).toBe(false);
    expect(collection.fieldAffordances.title.title).toBe('Project Title');
    expect(collection.fieldAffordances.count.filterable).toBe('exact');
    expect(collection.fieldAffordances.count.editable).toBe(false);
  });
});

// ============================================================================
// Pagination
// ============================================================================

describe('defineCollection - pagination', () => {
  it('defaults to pages with size 25', () => {
    const collection = defineCollection(ProjectSchema);
    const pagination = collection.affordances.pagination;
    expect(pagination).toEqual({
      defaultPageSize: 25,
      pageSizeOptions: [10, 25, 50, 100],
      style: 'pages',
      serverSide: false,
    });
  });

  it('merges custom pagination config', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: {
        pagination: { defaultPageSize: 50, style: 'infinite' },
      },
    });
    const pagination = collection.affordances.pagination;
    expect(pagination).toMatchObject({
      defaultPageSize: 50,
      style: 'infinite',
    });
  });

  it('allows disabling pagination', () => {
    const collection = defineCollection(ProjectSchema, {
      affordances: { pagination: false },
    });
    expect(collection.affordances.pagination).toBe(false);
  });
});

// ============================================================================
// Complex real-world schema
// ============================================================================

describe('defineCollection - real-world schema', () => {
  const BlogPostSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(300),
    slug: z.string(),
    content: z.string(),
    excerpt: z.string().optional(),
    author: z.string(),
    category: z.enum(['tech', 'design', 'business', 'lifestyle']),
    tags: z.array(z.string()),
    publishedAt: z.date().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
    viewCount: z.number().int().default(0),
    isPublished: z.boolean().default(false),
    metadata: z.object({
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
    }).optional(),
  });

  it('handles a complex real-world schema correctly', () => {
    const collection = defineCollection(BlogPostSchema, {
      affordances: {
        search: true,
        bulkDelete: true,
        export: ['csv', 'json'],
        defaultSort: { field: 'createdAt', direction: 'desc' },
      },
      fields: {
        title: { inlineEditable: true, summaryField: true },
        content: { detailOnly: true },
      },
      operations: [
        { name: 'publish', label: 'Publish', scope: 'item', variant: 'default' },
        { name: 'unpublish', label: 'Unpublish', scope: 'item', variant: 'secondary' },
        { name: 'bulkPublish', label: 'Publish Selected', scope: 'selection' },
      ],
    });

    // ID detection
    expect(collection.idField).toBe('id');

    // Label detection (title has summaryField: true)
    expect(collection.labelField).toBe('title');

    // Visible fields should exclude hidden ones
    const visible = collection.getVisibleFields();
    expect(visible).not.toContain('id');
    expect(visible).not.toContain('updatedAt');
    expect(visible).not.toContain('content'); // detailOnly
    expect(visible).toContain('title');
    expect(visible).toContain('category');

    // Search fields
    const searchable = collection.getSearchableFields();
    expect(searchable).toContain('title');
    expect(searchable).toContain('author');
    expect(searchable).not.toContain('viewCount');

    // Category should be groupable (enum)
    const groupable = collection.getGroupableFields();
    expect(groupable.some(f => f.key === 'category')).toBe(true);
    expect(groupable.some(f => f.key === 'isPublished')).toBe(true);

    // Operations
    expect(collection.getOperations('item')).toHaveLength(2);
    expect(collection.getOperations('selection')).toHaveLength(1);

    // viewCount should be aggregatable
    expect(collection.fieldAffordances.viewCount.aggregatable).toEqual(['sum', 'avg', 'min', 'max']);

    // metadata should be detailOnly
    expect(collection.fieldAffordances.metadata.detailOnly).toBe(true);

    // Description should be valid
    const desc = collection.describe();
    expect(desc).toContain('Collection with');
    expect(desc).toContain('publish [item]');
  });
});
