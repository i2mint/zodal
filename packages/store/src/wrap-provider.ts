/**
 * Provider Wrapping: Apply codecs to a DataProvider.
 *
 * Inspired by dol's wrap_kvs pattern — composable transform layers
 * that wrap a DataProvider with encoding/decoding.
 */

import type { DataProvider, GetListParams, GetListResult } from './data-provider.js';
import type { Codec } from '@zodal/core';

/**
 * Wrap a DataProvider with a value codec.
 *
 * The codec transforms items between the provider's storage format (TStored)
 * and the application format (TApp).
 *
 * @example
 * ```typescript
 * // Provider stores dates as ISO strings, app uses Date objects
 * const rawProvider = createInMemoryProvider(rawData);
 * const typedProvider = wrapProvider(rawProvider, {
 *   decode: (raw) => ({ ...raw, createdAt: new Date(raw.createdAt) }),
 *   encode: (typed) => ({ ...typed, createdAt: typed.createdAt.toISOString() }),
 * });
 * ```
 */
export function wrapProvider<TStored extends Record<string, any>, TApp extends Record<string, any>>(
  provider: DataProvider<TStored>,
  codec: Codec<TStored, TApp>,
): DataProvider<TApp> {
  return {
    async getList(params: GetListParams): Promise<GetListResult<TApp>> {
      const result = await provider.getList(params);
      return {
        data: result.data.map(codec.decode),
        total: result.total,
      };
    },

    async getOne(id: string): Promise<TApp> {
      const item = await provider.getOne(id);
      return codec.decode(item);
    },

    async create(data: Partial<TApp>): Promise<TApp> {
      const stored = codec.encode(data as TApp);
      const created = await provider.create(stored);
      return codec.decode(created);
    },

    async update(id: string, data: Partial<TApp>): Promise<TApp> {
      // For partial updates, we encode the full partial
      const stored = codec.encode(data as TApp);
      const updated = await provider.update(id, stored);
      return codec.decode(updated);
    },

    async updateMany(ids: string[], data: Partial<TApp>): Promise<TApp[]> {
      const stored = codec.encode(data as TApp);
      const updated = await provider.updateMany(ids, stored);
      return updated.map(codec.decode);
    },

    async delete(id: string): Promise<void> {
      return provider.delete(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      return provider.deleteMany(ids);
    },

    // Pass through optional methods
    ...(provider.upsert ? {
      async upsert(data: TApp): Promise<TApp> {
        const stored = codec.encode(data);
        const result = await provider.upsert!(stored);
        return codec.decode(result);
      },
    } : {}),

    ...(provider.getCapabilities ? {
      getCapabilities: () => provider.getCapabilities!(),
    } : {}),

    ...(provider.subscribe ? {
      subscribe: (callback: any) => provider.subscribe!(callback),
    } : {}),
  };
}
