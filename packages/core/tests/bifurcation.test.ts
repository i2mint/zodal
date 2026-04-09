/**
 * Tests for content-metadata bifurcation support in @zodal/core.
 *
 * Covers: storageRole inference, ContentRef type guard, collection
 * query methods (getContentFields, getMetadataFields, hasBifurcation),
 * and explain() tracing of storageRole.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection, isContentRef, inferFieldAffordances } from '../src/index.js';
import type { ContentRef } from '../src/index.js';

// ============================================================================
// Test Schemas
// ============================================================================

const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  tags: z.array(z.string()),
  attachment: z.any(),      // Name heuristic: 'attachment' → content
  createdAt: z.date(),
});

const MediaSchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.any(),             // Name heuristic: 'file' → content
  blob: z.any(),             // Name heuristic: 'blob' → content
  media: z.any(),            // Name heuristic: 'media' → content
  upload: z.any(),           // Name heuristic: 'upload' → content
  raw_data: z.any(),         // Name heuristic: 'raw_data' → content
  description: z.string(),   // NOT content (handled by DESCRIPTION_PATTERNS as textarea)
  status: z.enum(['draft', 'published']),
});

const SuffixSchema = z.object({
  id: z.string(),
  name: z.string(),
  resume_file: z.any(),      // Suffix: '_file' → content
  photo_blob: z.any(),       // Suffix: '_blob' → content
  data_upload: z.any(),      // Suffix: '_upload' → content
});

const PlainSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number(),
});

// ============================================================================
// Name Heuristic Tests
// ============================================================================

describe('storageRole inference — name heuristics', () => {
  it('infers storageRole: content for field named "attachment"', () => {
    const fa = inferFieldAffordances('attachment', z.any());
    expect(fa.storageRole).toBe('content');
    expect(fa.sortable).toBe(false);
    expect(fa.filterable).toBe(false);
    expect(fa.searchable).toBe(false);
    expect(fa.detailOnly).toBe(true);
  });

  it('infers storageRole: content for field named "file"', () => {
    const fa = inferFieldAffordances('file', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for field named "blob"', () => {
    const fa = inferFieldAffordances('blob', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for field named "upload"', () => {
    const fa = inferFieldAffordances('upload', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for field named "media"', () => {
    const fa = inferFieldAffordances('media', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for field named "raw_data"', () => {
    const fa = inferFieldAffordances('raw_data', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for suffix "_file" (resume_file)', () => {
    const fa = inferFieldAffordances('resume_file', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('infers storageRole: content for suffix "_blob" (photo_blob)', () => {
    const fa = inferFieldAffordances('photo_blob', z.any());
    expect(fa.storageRole).toBe('content');
  });

  it('does NOT infer content for "description" (text, not binary)', () => {
    const fa = inferFieldAffordances('description', z.string());
    expect(fa.storageRole).toBeUndefined();
    expect(fa.editWidget).toBe('textarea');
  });

  it('does NOT infer content for "body" (text, not binary)', () => {
    const fa = inferFieldAffordances('body', z.string());
    expect(fa.storageRole).toBeUndefined();
  });

  it('does NOT infer content for "content" (text, not binary)', () => {
    const fa = inferFieldAffordances('content', z.string());
    expect(fa.storageRole).toBeUndefined();
  });

  it('does NOT infer content for "name"', () => {
    const fa = inferFieldAffordances('name', z.string());
    expect(fa.storageRole).toBeUndefined();
  });

  it('does NOT infer content for "email"', () => {
    const fa = inferFieldAffordances('email', z.string());
    expect(fa.storageRole).toBeUndefined();
  });
});

// ============================================================================
// Explicit Override Tests
// ============================================================================

describe('storageRole — explicit overrides', () => {
  it('config override sets storageRole to content for a text field', () => {
    const collection = defineCollection(PlainSchema, {
      fields: { name: { storageRole: 'content' } },
    });
    expect(collection.fieldAffordances.name.storageRole).toBe('content');
    expect(collection.getContentFields()).toContain('name');
  });

  it('config override sets storageRole to metadata for a content-named field', () => {
    const collection = defineCollection(DocumentSchema, {
      fields: { attachment: { storageRole: 'metadata' } },
    });
    expect(collection.fieldAffordances.attachment.storageRole).toBe('metadata');
    expect(collection.getContentFields()).not.toContain('attachment');
  });
});

// ============================================================================
// Collection Query Method Tests
// ============================================================================

describe('collection bifurcation methods', () => {
  it('getContentFields returns content-classified fields', () => {
    const collection = defineCollection(DocumentSchema);
    expect(collection.getContentFields()).toEqual(['attachment']);
  });

  it('getMetadataFields returns non-content fields', () => {
    const collection = defineCollection(DocumentSchema);
    const metaFields = collection.getMetadataFields();
    expect(metaFields).toContain('id');
    expect(metaFields).toContain('title');
    expect(metaFields).toContain('tags');
    expect(metaFields).toContain('createdAt');
    expect(metaFields).not.toContain('attachment');
  });

  it('hasBifurcation returns true when content fields exist', () => {
    const collection = defineCollection(DocumentSchema);
    expect(collection.hasBifurcation()).toBe(true);
  });

  it('hasBifurcation returns false when no content fields exist', () => {
    const collection = defineCollection(PlainSchema);
    expect(collection.hasBifurcation()).toBe(false);
  });

  it('handles multiple content fields', () => {
    const collection = defineCollection(MediaSchema);
    const contentFields = collection.getContentFields();
    expect(contentFields).toContain('file');
    expect(contentFields).toContain('blob');
    expect(contentFields).toContain('media');
    expect(contentFields).toContain('upload');
    expect(contentFields).toContain('raw_data');
    expect(contentFields).not.toContain('description');
    expect(contentFields).not.toContain('name');
    expect(contentFields).not.toContain('status');
  });

  it('handles suffix-based content field detection', () => {
    const collection = defineCollection(SuffixSchema);
    const contentFields = collection.getContentFields();
    expect(contentFields).toContain('resume_file');
    expect(contentFields).toContain('photo_blob');
    expect(contentFields).toContain('data_upload');
    expect(contentFields).not.toContain('name');
  });

  it('content fields are not in visible fields (detailOnly)', () => {
    const collection = defineCollection(DocumentSchema);
    const visible = collection.getVisibleFields();
    expect(visible).not.toContain('attachment');
  });

  it('content fields are not in filterable fields', () => {
    const collection = defineCollection(DocumentSchema);
    const filterable = collection.getFilterableFields().map(f => f.key);
    expect(filterable).not.toContain('attachment');
  });

  it('content fields are not in sortable fields', () => {
    const collection = defineCollection(DocumentSchema);
    const sortable = collection.getSortableFields().map(f => f.key);
    expect(sortable).not.toContain('attachment');
  });

  it('content fields are not in searchable fields', () => {
    const collection = defineCollection(DocumentSchema);
    const searchable = collection.getSearchableFields();
    expect(searchable).not.toContain('attachment');
  });
});

// ============================================================================
// describe() Output Tests
// ============================================================================

describe('describe() includes CONTENT annotation', () => {
  it('marks content fields as CONTENT in description', () => {
    const collection = defineCollection(DocumentSchema);
    const desc = collection.describe();
    expect(desc).toContain('CONTENT');
  });
});

// ============================================================================
// explain() Trace Tests
// ============================================================================

describe('explain() traces storageRole', () => {
  it('traces storageRole set by name heuristic', () => {
    const collection = defineCollection(DocumentSchema);
    const traces = collection.explain('attachment');
    const roleTrace = traces.find(t => t.affordance === 'storageRole');
    expect(roleTrace).toBeDefined();
    expect(roleTrace!.finalValue).toBe('content');
    expect(roleTrace!.layers.some(l => l.layer === 'name')).toBe(true);
  });

  it('traces storageRole set by config override', () => {
    const collection = defineCollection(PlainSchema, {
      fields: { name: { storageRole: 'content' } },
    });
    const traces = collection.explain('name');
    const roleTrace = traces.find(t => t.affordance === 'storageRole');
    expect(roleTrace).toBeDefined();
    expect(roleTrace!.finalValue).toBe('content');
    expect(roleTrace!.layers.some(l => l.layer === 'config')).toBe(true);
  });
});

// ============================================================================
// ContentRef Type Guard Tests
// ============================================================================

describe('isContentRef', () => {
  it('returns true for a valid ContentRef', () => {
    const ref: ContentRef = {
      _tag: 'ContentRef',
      field: 'attachment',
      itemId: '123',
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    };
    expect(isContentRef(ref)).toBe(true);
  });

  it('returns true for a minimal ContentRef', () => {
    const ref = { _tag: 'ContentRef' as const, field: 'file', itemId: '1' };
    expect(isContentRef(ref)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isContentRef(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isContentRef(undefined)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isContentRef('hello')).toBe(false);
  });

  it('returns false for an object without _tag', () => {
    expect(isContentRef({ field: 'x', itemId: '1' })).toBe(false);
  });

  it('returns false for an object with wrong _tag', () => {
    expect(isContentRef({ _tag: 'Something', field: 'x', itemId: '1' })).toBe(false);
  });
});
