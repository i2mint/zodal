/**
 * Bifurcated Provider: Composes two DataProviders into one.
 *
 * Routes metadata fields (small/structured/queryable) to one provider
 * and content fields (large/opaque/non-queryable) to another.
 * Consumers see a single unified DataProvider<T>.
 */

import type { ContentRef } from '@zodal/core';
import type { DataProvider, GetListParams, GetListResult } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';

// ============================================================================
// Types
// ============================================================================

export interface BifurcatedProviderOptions<T> {
  /** Provider for metadata fields (queryable, small). */
  metadataProvider: DataProvider<Record<string, any>>;
  /** Provider for content fields (large, opaque). */
  contentProvider: DataProvider<Record<string, any>>;
  /** Field names classified as content. */
  contentFields: string[];
  /** Field used as unique identifier. Default: 'id'. */
  idField?: string;
  /** How content fields appear in getList. Default: 'reference'. */
  listStrategy?: 'reference' | 'omit';
  /** How content fields appear in getOne. Default: 'reference'. */
  detailStrategy?: 'eager' | 'reference';
  /** Custom function to build ContentRef from item data. */
  toContentRef?: (itemId: string, field: string) => ContentRef;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Split an object's properties into metadata and content portions.
 */
export function splitFields<T extends Record<string, any>>(
  data: Partial<T>,
  contentFields: string[],
): { metadata: Partial<T>; content: Partial<T> } {
  const contentSet = new Set(contentFields);
  const metadata: Record<string, any> = {};
  const content: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (contentSet.has(key)) {
      content[key] = value;
    } else {
      metadata[key] = value;
    }
  }

  return { metadata: metadata as Partial<T>, content: content as Partial<T> };
}

function defaultContentRef(itemId: string, field: string): ContentRef {
  return { _tag: 'ContentRef', field, itemId };
}

function hasContentData(obj: Record<string, any>): boolean {
  return Object.keys(obj).length > 0;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a bifurcated provider that routes metadata fields to one provider
 * and content fields to another, presenting a unified DataProvider<T>.
 *
 * @example
 * ```typescript
 * const provider = createBifurcatedProvider({
 *   metadataProvider: createSupabaseProvider({ client, table: 'docs' }),
 *   contentProvider: createS3Provider({ client: s3, bucket: 'content' }),
 *   contentFields: collection.getContentFields(),
 * });
 * ```
 */
export function createBifurcatedProvider<T extends Record<string, any>>(
  options: BifurcatedProviderOptions<T>,
): DataProvider<T> {
  const {
    metadataProvider,
    contentProvider,
    contentFields,
    idField = 'id',
    listStrategy = 'reference',
    detailStrategy = 'reference',
    toContentRef = defaultContentRef,
  } = options;

  const contentSet = new Set(contentFields);

  function replaceContentWithRefs(item: Record<string, any>): Record<string, any> {
    const result = { ...item };
    for (const field of contentFields) {
      result[field] = toContentRef(String(item[idField]), field);
    }
    return result;
  }

  function omitContentFields(item: Record<string, any>): Record<string, any> {
    const result = { ...item };
    for (const field of contentFields) {
      delete result[field];
    }
    return result;
  }

  const provider: DataProvider<T> = {
    // ---- Reads ----

    async getList(params: GetListParams): Promise<GetListResult<T>> {
      // Queries go to metadata provider only — content is not queryable
      const result = await metadataProvider.getList(params);

      let data: Record<string, any>[];
      if (listStrategy === 'omit') {
        data = result.data.map(omitContentFields);
      } else {
        data = result.data.map(replaceContentWithRefs);
      }

      return { data: data as T[], total: result.total };
    },

    async getOne(id: string): Promise<T> {
      const metaItem = await metadataProvider.getOne(id);

      if (detailStrategy === 'eager') {
        try {
          const contentItem = await contentProvider.getOne(id);
          return { ...metaItem, ...contentItem } as T;
        } catch {
          // Content may not exist yet; return metadata with refs
          return replaceContentWithRefs(metaItem as Record<string, any>) as T;
        }
      }

      return replaceContentWithRefs(metaItem as Record<string, any>) as T;
    },

    // ---- Writes ----

    async create(data: Partial<T>): Promise<T> {
      const { metadata, content } = splitFields(data as Record<string, any>, contentFields);

      // Metadata first — this is the "commit point"
      const created = await metadataProvider.create(metadata);
      const createdId = String((created as Record<string, any>)[idField]);

      // Then content (if any)
      if (hasContentData(content)) {
        try {
          const contentWithId = { ...content, [idField]: createdId };
          await contentProvider.create(contentWithId);
        } catch (err) {
          // Compensate: delete the metadata record
          try { await metadataProvider.delete(createdId); } catch { /* swallow */ }
          throw err;
        }
      }

      return created as T;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      const { metadata, content } = splitFields(data as Record<string, any>, contentFields);

      let result: Record<string, any> = {};

      // Only touch providers with changed fields
      if (hasContentData(metadata)) {
        result = await metadataProvider.update(id, metadata) as Record<string, any>;
      }
      if (hasContentData(content)) {
        try {
          await contentProvider.update(id, content);
        } catch {
          // Content update failed — metadata already updated.
          // This is acceptable: old content + new metadata is recoverable.
        }
      }

      // If only content was updated, fetch metadata for a full result
      if (!hasContentData(metadata)) {
        result = await metadataProvider.getOne(id) as Record<string, any>;
      }

      return result as T;
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      return Promise.all(ids.map((id) => provider.update(id, data)));
    },

    async delete(id: string): Promise<void> {
      // Content first — orphaned content is less harmful than dangling metadata
      try { await contentProvider.delete(id); } catch { /* swallow */ }
      await metadataProvider.delete(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      await Promise.all(ids.map((id) => provider.delete(id)));
    },

    // ---- Optional methods ----

    getCapabilities(): ProviderCapabilities {
      const metaCaps = metadataProvider.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
      const contentCaps = contentProvider.getCapabilities?.() ?? DEFAULT_CAPABILITIES;

      return {
        // Query capabilities come from the metadata provider
        serverSort: metaCaps.serverSort,
        serverFilter: metaCaps.serverFilter,
        serverSearch: metaCaps.serverSearch,
        serverPagination: metaCaps.serverPagination,
        filterOperators: metaCaps.filterOperators,
        paginationStyle: metaCaps.paginationStyle,

        // CRUD: both must support them
        canCreate: metaCaps.canCreate && contentCaps.canCreate,
        canUpdate: metaCaps.canUpdate && contentCaps.canUpdate,
        canDelete: metaCaps.canDelete && contentCaps.canDelete,
        canBulkUpdate: metaCaps.canBulkUpdate && contentCaps.canBulkUpdate,
        canBulkDelete: metaCaps.canBulkDelete && contentCaps.canBulkDelete,
        canUpsert: (metaCaps.canUpsert ?? false) && (contentCaps.canUpsert ?? false),

        // Bifurcation metadata
        bifurcated: true,
        contentFields,

        // Realtime: only if both support it
        realtime: (metaCaps.realtime ?? false) && (contentCaps.realtime ?? false),
      };
    },

    async getContent(id: string, field: string): Promise<unknown> {
      if (!contentSet.has(field)) {
        throw new Error(`Field '${field}' is not a content field. Content fields: ${contentFields.join(', ')}`);
      }
      const item = await contentProvider.getOne(id);
      return (item as Record<string, any>)[field];
    },

    async setContent(id: string, field: string, content: unknown): Promise<ContentRef> {
      if (!contentSet.has(field)) {
        throw new Error(`Field '${field}' is not a content field. Content fields: ${contentFields.join(', ')}`);
      }
      await contentProvider.update(id, { [field]: content } as any);
      return toContentRef(id, field);
    },
  };

  return provider;
}
