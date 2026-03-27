import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';

// ============================================================================
// Test Data
// ============================================================================

interface Project {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  priority: number;
  tags: string[];
}

const sampleData: Project[] = [
  { id: '1', name: 'Alpha Project', status: 'active', priority: 3, tags: ['web', 'frontend'] },
  { id: '2', name: 'Beta API', status: 'draft', priority: 1, tags: ['api'] },
  { id: '3', name: 'Gamma Platform', status: 'archived', priority: 5, tags: ['web', 'api', 'backend'] },
  { id: '4', name: 'Delta Service', status: 'active', priority: 2, tags: ['api', 'microservice'] },
  { id: '5', name: 'Epsilon UI', status: 'draft', priority: 4, tags: ['web', 'frontend', 'design'] },
];

function freshProvider() {
  return createInMemoryProvider<Project>([...sampleData.map(d => ({ ...d }))]);
}

// ============================================================================
// getList - basic
// ============================================================================

describe('createInMemoryProvider - getList', () => {
  it('returns all items when no params', async () => {
    const provider = freshProvider();
    const result = await provider.getList({});
    expect(result.data).toHaveLength(5);
    expect(result.total).toBe(5);
  });

  it('supports pagination', async () => {
    const provider = freshProvider();
    const page1 = await provider.getList({ pagination: { page: 1, pageSize: 2 } });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.data[0].name).toBe('Alpha Project');

    const page2 = await provider.getList({ pagination: { page: 2, pageSize: 2 } });
    expect(page2.data).toHaveLength(2);
    expect(page2.data[0].name).toBe('Gamma Platform');

    const page3 = await provider.getList({ pagination: { page: 3, pageSize: 2 } });
    expect(page3.data).toHaveLength(1);
  });

  it('supports sorting ascending', async () => {
    const provider = freshProvider();
    const result = await provider.getList({ sort: [{ id: 'priority', desc: false }] });
    const priorities = result.data.map(d => d.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5]);
  });

  it('supports sorting descending', async () => {
    const provider = freshProvider();
    const result = await provider.getList({ sort: [{ id: 'priority', desc: true }] });
    const priorities = result.data.map(d => d.priority);
    expect(priorities).toEqual([5, 4, 3, 2, 1]);
  });

  it('supports multi-column sorting', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      sort: [
        { id: 'status', desc: false },
        { id: 'priority', desc: false },
      ],
    });
    const statuses = result.data.map(d => d.status);
    expect(statuses).toEqual(['active', 'active', 'archived', 'draft', 'draft']);
    expect(result.data[0].priority).toBe(2);
    expect(result.data[1].priority).toBe(3);
  });
});

// ============================================================================
// getList - filtering (using FilterExpression)
// ============================================================================

describe('createInMemoryProvider - filtering', () => {
  it('filters by string contains (case-insensitive)', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: { field: 'name', operator: 'contains', value: 'alpha' },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Alpha Project');
    expect(result.total).toBe(1);
  });

  it('filters by exact enum value via in operator', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: { field: 'status', operator: 'in', value: ['active'] },
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.every(d => d.status === 'active')).toBe(true);
  });

  it('filters by multiple enum values', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: { field: 'status', operator: 'in', value: ['active', 'draft'] },
    });
    expect(result.data).toHaveLength(4);
  });

  it('filters by numeric range', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: {
        and: [
          { field: 'priority', operator: 'gte', value: 2 },
          { field: 'priority', operator: 'lte', value: 4 },
        ],
      },
    });
    expect(result.data).toHaveLength(3);
    expect(result.data.every(d => d.priority >= 2 && d.priority <= 4)).toBe(true);
  });

  it('filters by boolean value', async () => {
    const data = [
      { id: '1', name: 'A', active: true },
      { id: '2', name: 'B', active: false },
      { id: '3', name: 'C', active: true },
    ];
    const provider = createInMemoryProvider(data);
    const result = await provider.getList({
      filter: { field: 'active', operator: 'eq', value: true },
    });
    expect(result.data).toHaveLength(2);
  });

  it('filters by array containment', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: { field: 'tags', operator: 'arrayContainsAny', value: ['api'] },
    });
    expect(result.data).toHaveLength(3);
  });

  it('combines multiple filters with AND', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: {
        and: [
          { field: 'status', operator: 'in', value: ['active'] },
          { field: 'priority', operator: 'gte', value: 3 },
        ],
      },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Alpha Project');
  });

  it('supports OR filters', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: {
        or: [
          { field: 'status', operator: 'eq', value: 'archived' },
          { field: 'priority', operator: 'eq', value: 1 },
        ],
      },
    });
    expect(result.data).toHaveLength(2);
  });

  it('supports NOT filters', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      filter: {
        not: { field: 'status', operator: 'eq', value: 'active' },
      },
    });
    expect(result.data).toHaveLength(3);
  });
});

// ============================================================================
// getList - search
// ============================================================================

describe('createInMemoryProvider - search', () => {
  it('searches across string fields (case-insensitive)', async () => {
    const provider = freshProvider();
    const result = await provider.getList({ search: 'api' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Beta API');
  });

  it('searches with custom searchFields', async () => {
    const provider = createInMemoryProvider(sampleData, { searchFields: ['name', 'status'] });
    const result = await provider.getList({ search: 'active' });
    expect(result.data).toHaveLength(2);
  });

  it('combines search with filters', async () => {
    const provider = freshProvider();
    const result = await provider.getList({
      search: 'project',
      filter: { field: 'status', operator: 'in', value: ['active'] },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Alpha Project');
  });

  it('search + sort + pagination work together', async () => {
    const provider = createInMemoryProvider(sampleData, { searchFields: ['name'] });
    const result = await provider.getList({
      search: 'platform',
      sort: [{ id: 'priority', desc: false }],
      pagination: { page: 1, pageSize: 10 },
    });
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Gamma Platform');
  });
});

// ============================================================================
// CRUD operations
// ============================================================================

describe('createInMemoryProvider - CRUD', () => {
  it('getOne returns a single item by id', async () => {
    const provider = freshProvider();
    const item = await provider.getOne('3');
    expect(item.name).toBe('Gamma Platform');
    expect(item.priority).toBe(5);
  });

  it('getOne throws for missing item', async () => {
    const provider = freshProvider();
    await expect(provider.getOne('999')).rejects.toThrow('Item not found');
  });

  it('create adds a new item', async () => {
    const provider = freshProvider();
    const created = await provider.create({ name: 'Zeta New', status: 'draft', priority: 1, tags: [] });
    expect(created.name).toBe('Zeta New');
    expect(created.id).toBeDefined();

    const { data } = await provider.getList({});
    expect(data).toHaveLength(6);
  });

  it('create uses provided id if given', async () => {
    const provider = freshProvider();
    const created = await provider.create({ id: 'custom-id', name: 'Custom', status: 'draft', priority: 1, tags: [] });
    expect(created.id).toBe('custom-id');
  });

  it('update modifies an existing item', async () => {
    const provider = freshProvider();
    const updated = await provider.update('2', { priority: 10, status: 'active' });
    expect(updated.priority).toBe(10);
    expect(updated.status).toBe('active');
    expect(updated.name).toBe('Beta API');

    const item = await provider.getOne('2');
    expect(item.priority).toBe(10);
  });

  it('update throws for missing item', async () => {
    const provider = freshProvider();
    await expect(provider.update('999', { name: 'x' })).rejects.toThrow('Item not found');
  });

  it('updateMany updates multiple items', async () => {
    const provider = freshProvider();
    const updated = await provider.updateMany(['1', '3'], { status: 'archived' });
    expect(updated).toHaveLength(2);
    expect(updated[0].status).toBe('archived');
    expect(updated[1].status).toBe('archived');
  });

  it('updateMany skips missing items', async () => {
    const provider = freshProvider();
    const updated = await provider.updateMany(['1', '999'], { status: 'archived' });
    expect(updated).toHaveLength(1);
  });

  it('delete removes an item', async () => {
    const provider = freshProvider();
    await provider.delete('2');
    const { data } = await provider.getList({});
    expect(data).toHaveLength(4);
    expect(data.find(d => d.id === '2')).toBeUndefined();
  });

  it('delete throws for missing item', async () => {
    const provider = freshProvider();
    await expect(provider.delete('999')).rejects.toThrow('Item not found');
  });

  it('deleteMany removes multiple items', async () => {
    const provider = freshProvider();
    await provider.deleteMany(['1', '3', '5']);
    const { data } = await provider.getList({});
    expect(data).toHaveLength(2);
    expect(data.map(d => d.id).sort()).toEqual(['2', '4']);
  });
});

// ============================================================================
// Upsert
// ============================================================================

describe('createInMemoryProvider - upsert', () => {
  it('inserts a new item when id does not exist', async () => {
    const provider = freshProvider();
    const result = await provider.upsert!({
      id: 'new-1', name: 'New Item', status: 'draft', priority: 1, tags: [],
    });
    expect(result.id).toBe('new-1');
    expect(result.name).toBe('New Item');

    const { data } = await provider.getList({});
    expect(data).toHaveLength(6);
    expect(data.find(d => d.id === 'new-1')).toBeDefined();
  });

  it('replaces an existing item when id exists', async () => {
    const provider = freshProvider();
    const result = await provider.upsert!({
      id: '2', name: 'Updated Beta', status: 'archived', priority: 99, tags: ['replaced'],
    });
    expect(result.name).toBe('Updated Beta');
    expect(result.priority).toBe(99);

    const { data } = await provider.getList({});
    expect(data).toHaveLength(5);
    const item = data.find(d => d.id === '2');
    expect(item!.name).toBe('Updated Beta');
    expect(item!.tags).toEqual(['replaced']);
  });

  it('replaces the entire item, not merging', async () => {
    const provider = freshProvider();
    await provider.upsert!({
      id: '1', name: 'Replaced', status: 'draft', priority: 0, tags: [],
    });
    const item = await provider.getOne('1');
    expect(item.tags).toEqual([]);
  });
});

// ============================================================================
// Options
// ============================================================================

describe('createInMemoryProvider - options', () => {
  it('supports custom idField', async () => {
    const data = [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ];
    const provider = createInMemoryProvider(data, { idField: 'key' });
    const item = await provider.getOne('b');
    expect(item.value).toBe(2);
  });

  it('supports simulated delay', async () => {
    const provider = createInMemoryProvider(sampleData, { simulateDelay: 50 });
    const start = Date.now();
    await provider.getList({});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

// ============================================================================
// Capabilities
// ============================================================================

describe('createInMemoryProvider - capabilities', () => {
  it('reports capabilities', () => {
    const provider = freshProvider();
    const caps = provider.getCapabilities!();
    expect(caps.canCreate).toBe(true);
    expect(caps.canUpdate).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.serverSort).toBe(false);
    expect(caps.serverFilter).toBe(false);
    expect(caps.canUpsert).toBe(true);
  });
});
