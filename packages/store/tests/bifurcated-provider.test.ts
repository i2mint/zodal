/**
 * Tests for createBifurcatedProvider.
 *
 * Uses two in-memory providers (metadata + content) to test
 * field splitting, content references, CRUD routing, getContent/setContent,
 * and capability reporting.
 */

import { describe, it, expect } from 'vitest';
import { isContentRef } from '@zodal/core';
import { createInMemoryProvider } from '../src/in-memory.js';
import { createBifurcatedProvider, splitFields } from '../src/bifurcated-provider.js';

// ============================================================================
// Test Data
// ============================================================================

interface Doc {
  id: string;
  title: string;
  tags: string[];
  attachment: string;  // content field
}

const contentFields = ['attachment'];

function createProviders(initialMeta: any[] = [], initialContent: any[] = []) {
  return {
    metadataProvider: createInMemoryProvider<Record<string, any>>(initialMeta),
    contentProvider: createInMemoryProvider<Record<string, any>>(initialContent),
  };
}

// ============================================================================
// splitFields Tests
// ============================================================================

describe('splitFields', () => {
  it('splits object into metadata and content portions', () => {
    const data = { id: '1', title: 'Doc', attachment: 'binary-data' };
    const { metadata, content } = splitFields(data, ['attachment']);
    expect(metadata).toEqual({ id: '1', title: 'Doc' });
    expect(content).toEqual({ attachment: 'binary-data' });
  });

  it('handles empty content portion', () => {
    const data = { id: '1', title: 'Doc' };
    const { metadata, content } = splitFields(data, ['attachment']);
    expect(metadata).toEqual({ id: '1', title: 'Doc' });
    expect(content).toEqual({});
  });

  it('handles empty metadata portion', () => {
    const data = { attachment: 'binary-data' };
    const { metadata, content } = splitFields(data, ['attachment']);
    expect(metadata).toEqual({});
    expect(content).toEqual({ attachment: 'binary-data' });
  });

  it('skips undefined values', () => {
    const data = { id: '1', title: undefined, attachment: 'data' };
    const { metadata, content } = splitFields(data, ['attachment']);
    expect(metadata).toEqual({ id: '1' });
    expect(content).toEqual({ attachment: 'data' });
  });
});

// ============================================================================
// getList Tests
// ============================================================================

describe('BifurcatedProvider — getList', () => {
  it('returns items with ContentRef for content fields (reference strategy)', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc A' }, { id: '2', title: 'Doc B' }],
      [{ id: '1', attachment: 'binary-1' }, { id: '2', attachment: 'binary-2' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const result = await provider.getList({});
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);

    // Content fields should be ContentRef, not actual content
    expect(isContentRef(result.data[0].attachment)).toBe(true);
    expect((result.data[0].attachment as any).field).toBe('attachment');
    expect((result.data[0].attachment as any).itemId).toBe('1');

    // Metadata fields are preserved
    expect(result.data[0].title).toBe('Doc A');
  });

  it('omits content fields with omit strategy', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc A' }],
      [{ id: '1', attachment: 'binary-1' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
      listStrategy: 'omit',
    });

    const result = await provider.getList({});
    expect(result.data[0]).not.toHaveProperty('attachment');
    expect(result.data[0].title).toBe('Doc A');
  });

  it('passes query params to metadata provider only', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [
        { id: '1', title: 'Alpha' },
        { id: '2', title: 'Beta' },
        { id: '3', title: 'Gamma' },
      ],
      [],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const result = await provider.getList({
      pagination: { page: 1, pageSize: 2 },
    });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
  });
});

// ============================================================================
// create Tests
// ============================================================================

describe('BifurcatedProvider — create', () => {
  it('splits data across metadata and content providers', async () => {
    const { metadataProvider, contentProvider } = createProviders();
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const created = await provider.create({
      id: '1',
      title: 'New Doc',
      tags: ['a'],
      attachment: 'file-bytes',
    });

    expect(created.id).toBe('1');
    expect(created.title).toBe('New Doc');

    // Verify metadata provider got metadata
    const metaItem = await metadataProvider.getOne('1');
    expect(metaItem.title).toBe('New Doc');
    expect(metaItem).not.toHaveProperty('attachment');

    // Verify content provider got content
    const contentItem = await contentProvider.getOne('1');
    expect(contentItem.attachment).toBe('file-bytes');
  });

  it('creates metadata only when no content provided', async () => {
    const { metadataProvider, contentProvider } = createProviders();
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    await provider.create({ id: '1', title: 'No attachment' });

    const metaItem = await metadataProvider.getOne('1');
    expect(metaItem.title).toBe('No attachment');

    // Content provider should have nothing
    const contentList = await contentProvider.getList({});
    expect(contentList.data).toHaveLength(0);
  });
});

// ============================================================================
// update Tests
// ============================================================================

describe('BifurcatedProvider — update', () => {
  it('updates only metadata when content fields not included', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Old Title' }],
      [{ id: '1', attachment: 'old-content' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    await provider.update('1', { title: 'New Title' });

    const metaItem = await metadataProvider.getOne('1');
    expect(metaItem.title).toBe('New Title');

    // Content should be unchanged
    const contentItem = await contentProvider.getOne('1');
    expect(contentItem.attachment).toBe('old-content');
  });

  it('updates only content when metadata fields not included', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Title' }],
      [{ id: '1', attachment: 'old-content' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    await provider.update('1', { attachment: 'new-content' } as Partial<Doc>);

    // Metadata unchanged
    const metaItem = await metadataProvider.getOne('1');
    expect(metaItem.title).toBe('Title');

    // Content updated
    const contentItem = await contentProvider.getOne('1');
    expect(contentItem.attachment).toBe('new-content');
  });
});

// ============================================================================
// delete Tests
// ============================================================================

describe('BifurcatedProvider — delete', () => {
  it('removes from both providers', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [{ id: '1', attachment: 'data' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    await provider.delete('1');

    const metaList = await metadataProvider.getList({});
    expect(metaList.data).toHaveLength(0);

    const contentList = await contentProvider.getList({});
    expect(contentList.data).toHaveLength(0);
  });

  it('succeeds even if content provider has no record (graceful)', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [], // No content record
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    // Should not throw
    await provider.delete('1');

    const metaList = await metadataProvider.getList({});
    expect(metaList.data).toHaveLength(0);
  });
});

// ============================================================================
// getContent / setContent Tests
// ============================================================================

describe('BifurcatedProvider — getContent / setContent', () => {
  it('getContent retrieves content for a specific field', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [{ id: '1', attachment: 'file-bytes-here' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const content = await provider.getContent!('1', 'attachment');
    expect(content).toBe('file-bytes-here');
  });

  it('getContent throws for non-content field', async () => {
    const { metadataProvider, contentProvider } = createProviders();
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    await expect(provider.getContent!('1', 'title')).rejects.toThrow('not a content field');
  });

  it('setContent updates content and returns ContentRef', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [{ id: '1', attachment: 'old' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const ref = await provider.setContent!('1', 'attachment', 'new-content');
    expect(isContentRef(ref)).toBe(true);
    expect(ref.field).toBe('attachment');
    expect(ref.itemId).toBe('1');

    // Verify content was actually updated
    const updated = await contentProvider.getOne('1');
    expect(updated.attachment).toBe('new-content');
  });
});

// ============================================================================
// getCapabilities Tests
// ============================================================================

describe('BifurcatedProvider — getCapabilities', () => {
  it('reports bifurcated: true with contentFields', () => {
    const { metadataProvider, contentProvider } = createProviders();
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const caps = provider.getCapabilities!();
    expect(caps.bifurcated).toBe(true);
    expect(caps.contentFields).toEqual(['attachment']);
  });

  it('merges capabilities from both providers', () => {
    const { metadataProvider, contentProvider } = createProviders();
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
    });

    const caps = provider.getCapabilities!();
    expect(caps.canCreate).toBe(true);
    expect(caps.canUpdate).toBe(true);
    expect(caps.canDelete).toBe(true);
  });
});

// ============================================================================
// getOne with eager strategy Tests
// ============================================================================

describe('BifurcatedProvider — getOne eager', () => {
  it('merges metadata and content when detailStrategy is eager', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [{ id: '1', attachment: 'actual-bytes' }],
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
      detailStrategy: 'eager',
    });

    const item = await provider.getOne('1');
    expect(item.title).toBe('Doc');
    expect(item.attachment).toBe('actual-bytes');
    // NOT a ContentRef — actual content
    expect(isContentRef(item.attachment)).toBe(false);
  });

  it('falls back to reference when content not found in eager mode', async () => {
    const { metadataProvider, contentProvider } = createProviders(
      [{ id: '1', title: 'Doc' }],
      [], // No content
    );
    const provider = createBifurcatedProvider<Doc>({
      metadataProvider,
      contentProvider,
      contentFields,
      detailStrategy: 'eager',
    });

    const item = await provider.getOne('1');
    expect(item.title).toBe('Doc');
    // Falls back to ContentRef
    expect(isContentRef(item.attachment)).toBe(true);
  });
});
