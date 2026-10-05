/**
 * Data Provider: A normalized interface for CRUD operations on collections.
 *
 * Inspired by React Admin's data provider but simplified.
 * The interface is framework-agnostic — implementations can wrap REST, GraphQL,
 * Supabase, Firebase, in-memory arrays, or any data source.
 */

import type { SortingState, FilterExpression, ContentRef } from '@zodal/core';
import type { ProviderCapabilities } from './capabilities.js';

// ============================================================================
// DataProvider Interface
// ============================================================================

export interface GetListParams {
  sort?: SortingState[];
  filter?: FilterExpression;
  search?: string;
  pagination?: { page: number; pageSize: number };
}

export interface GetListResult<T> {
  data: T[];
  total: number;
}

/** Event emitted when data changes (for real-time support). */
export type DataChangeEvent<T> =
  | { type: 'created'; item: T }
  | { type: 'updated'; id: string; item: T }
  | { type: 'deleted'; id: string };

/**
 * Normalized data access interface for collection CRUD operations.
 *
 * All methods return Promises to support both sync and async data sources.
 * The semantics below are the contract every adapter is tested against with
 * `providerContract` from `@zodal/store/testing`.
 *
 * Items returned by any method are the caller's to mutate: changing one (or an
 * array inside it) never changes what the provider stores.
 */
export interface DataProvider<T> {
  /** Filter, search, sort, then paginate (1-based); `total` counts every match. */
  getList(params: GetListParams): Promise<GetListResult<T>>;
  /** Rejects when no item has this id. */
  getOne(id: string): Promise<T>;
  /**
   * Store a new item. Assigns an id when `data` has none. Rejects when an item
   * with the given id already exists (use `upsert` to overwrite).
   */
  create(data: Partial<T>): Promise<T>;
  /** Shallow-merge `data` into the item. Rejects when no item has this id. */
  update(id: string, data: Partial<T>): Promise<T>;
  /**
   * Shallow-merge the same `data` into each listed item. Ids with no item are
   * skipped; resolves with the items that were updated.
   */
  updateMany(ids: string[], data: Partial<T>): Promise<T[]>;
  /** Rejects when no item has this id. */
  delete(id: string): Promise<void>;
  /** Delete each listed item; ids with no item are skipped. */
  deleteMany(ids: string[]): Promise<void>;

  /**
   * Insert or update a complete item.
   * Optional — not all providers need to implement this.
   */
  upsert?(data: T): Promise<T>;

  /**
   * Report what this provider supports.
   * Optional — when absent, DEFAULT_CAPABILITIES is assumed.
   */
  getCapabilities?(): ProviderCapabilities;

  /**
   * Subscribe to real-time data changes.
   * Returns an unsubscribe function.
   * Optional — for future real-time support.
   */
  subscribe?(callback: (event: DataChangeEvent<T>) => void): () => void;

  /**
   * Retrieve content for a specific field of an item.
   * Only available on bifurcated providers (see createBifurcatedProvider).
   */
  getContent?(id: string, field: string): Promise<unknown>;

  /**
   * Upload/replace content for a specific field of an item.
   * Only available on bifurcated providers (see createBifurcatedProvider).
   */
  setContent?(id: string, field: string, content: unknown): Promise<ContentRef>;

  /**
   * Resolve a directly-fetchable URL for an item's content field — a public URL,
   * a pre-signed URL, or a backend endpoint that streams the bytes.
   *
   * Prefer this over `getContent()` for anything a browser consumes by URL
   * (`<video src>`, `<img src>`, `<a download>`). `getContent()` returns *bytes*,
   * which for media is the wrong currency: it defeats HTTP range requests, so you
   * lose streaming and seeking, and the whole file is held in memory.
   *
   * This is also the seam that survives a storage migration. The same call returns
   * `/api/app/clips/x.mp4` while the bytes sit behind your backend, and
   * `https://bucket.s3.../x.mp4` once they live in S3 — so consuming code does not
   * change when the backend does.
   *
   * Returns `null` when the provider cannot produce a URL (e.g. a purely in-memory
   * or IndexedDB-backed store). Callers should fall back to `getContent()` then.
   *
   * Optional — absent on providers that only hand back bytes.
   */
  getUrl?(id: string, field: string): Promise<string | null>;
}
