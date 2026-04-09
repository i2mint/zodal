/**
 * Tests for content-metadata bifurcation awareness in UI generators.
 *
 * Covers: toColumnDefs content meta, toFormConfig file widget, toFilterConfig exclusion,
 * storageRoleIs tester, and contentLoading state.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import {
  toColumnDefs,
  toFormConfig,
  toFilterConfig,
  createCollectionStore,
  storageRoleIs,
  PRIORITY,
} from '../src/index.js';

// ============================================================================
// Test Schema
// ============================================================================

const DocSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(['draft', 'published']),
  attachment: z.any(),  // name heuristic → content
});

const collection = defineCollection(DocSchema);

// ============================================================================
// Column Definitions
// ============================================================================

describe('toColumnDefs — content awareness', () => {
  it('content fields are excluded from visible columns (detailOnly)', () => {
    const cols = toColumnDefs(collection);
    const colIds = cols.map(c => c.id);
    // attachment is detailOnly, so not in visible columns
    expect(colIds).not.toContain('attachment');
  });

  it('if content field is overridden to visible, meta carries storageRole', () => {
    const visibleCollection = defineCollection(DocSchema, {
      fields: { attachment: { detailOnly: false, visible: true } },
    });
    const cols = toColumnDefs(visibleCollection);
    const attachCol = cols.find(c => c.id === 'attachment');
    expect(attachCol).toBeDefined();
    expect(attachCol!.meta.storageRole).toBe('content');
    expect(attachCol!.meta.isContentRef).toBe(true);
    expect(attachCol!.enableSorting).toBe(false);
    expect(attachCol!.enableColumnFilter).toBe(false);
    expect(attachCol!.enableGlobalFilter).toBe(false);
  });

  it('metadata columns do not have storageRole set', () => {
    const cols = toColumnDefs(collection);
    const titleCol = cols.find(c => c.id === 'title');
    expect(titleCol).toBeDefined();
    expect(titleCol!.meta.storageRole).toBeUndefined();
    expect(titleCol!.meta.isContentRef).toBeUndefined();
  });
});

// ============================================================================
// Form Configuration
// ============================================================================

describe('toFormConfig — content awareness', () => {
  it('content fields produce file widget type', () => {
    const editableCollection = defineCollection(DocSchema, {
      fields: { attachment: { editable: true } },
    });
    const form = toFormConfig(editableCollection, 'create');
    const attachField = form.find(f => f.name === 'attachment');
    expect(attachField).toBeDefined();
    expect(attachField!.type).toBe('file');
    expect(attachField!.isContentField).toBe(true);
  });

  it('metadata fields do not have isContentField', () => {
    const form = toFormConfig(collection, 'create');
    const titleField = form.find(f => f.name === 'title');
    expect(titleField).toBeDefined();
    expect(titleField!.isContentField).toBeUndefined();
  });
});

// ============================================================================
// Filter Configuration
// ============================================================================

describe('toFilterConfig — content exclusion', () => {
  it('content fields are not included in filter config', () => {
    const filters = toFilterConfig(collection);
    const filterNames = filters.map(f => f.name);
    expect(filterNames).not.toContain('attachment');
  });

  it('metadata fields are included in filter config', () => {
    const filters = toFilterConfig(collection);
    const filterNames = filters.map(f => f.name);
    expect(filterNames).toContain('status');
  });
});

// ============================================================================
// storageRoleIs Tester
// ============================================================================

describe('storageRoleIs tester', () => {
  it('returns LIBRARY priority for matching storage role', () => {
    const tester = storageRoleIs('content');
    const field = { storageRole: 'content', zodType: 'unknown' } as any;
    const score = tester(field, { mode: 'cell' });
    expect(score).toBe(PRIORITY.LIBRARY);
  });

  it('returns -1 for non-matching storage role', () => {
    const tester = storageRoleIs('content');
    const field = { storageRole: 'metadata', zodType: 'string' } as any;
    const score = tester(field, { mode: 'cell' });
    expect(score).toBe(-1);
  });

  it('returns -1 when storageRole is undefined', () => {
    const tester = storageRoleIs('content');
    const field = { zodType: 'string' } as any;
    const score = tester(field, { mode: 'cell' });
    expect(score).toBe(-1);
  });
});

// ============================================================================
// Collection State — contentLoading
// ============================================================================

describe('CollectionState — contentLoading', () => {
  it('initializes with empty contentLoading', () => {
    const store = createCollectionStore(collection);
    expect(store.initialState.contentLoading).toEqual({});
  });

  it('setContentLoading sets loading for a specific item+field', () => {
    const store = createCollectionStore(collection);
    let state = store.initialState;
    state = store.actions.setContentLoading(state, 'item-1', 'attachment', true);
    expect(state.contentLoading['item-1']?.attachment).toBe(true);
  });

  it('setContentLoading can clear loading', () => {
    const store = createCollectionStore(collection);
    let state = store.initialState;
    state = store.actions.setContentLoading(state, 'item-1', 'attachment', true);
    state = store.actions.setContentLoading(state, 'item-1', 'attachment', false);
    expect(state.contentLoading['item-1']?.attachment).toBe(false);
  });

  it('reset clears contentLoading', () => {
    const store = createCollectionStore(collection);
    let state = store.initialState;
    state = store.actions.setContentLoading(state, 'item-1', 'attachment', true);
    state = store.actions.reset(state);
    expect(state.contentLoading).toEqual({});
  });
});
