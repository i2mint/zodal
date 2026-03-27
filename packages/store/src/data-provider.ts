/**
 * Data Provider: A normalized interface for CRUD operations on collections.
 *
 * Inspired by React Admin's data provider but simplified.
 * The interface is framework-agnostic — implementations can wrap REST, GraphQL,
 * Supabase, Firebase, in-memory arrays, or any data source.
 */

import type { SortingState, FilterExpression } from '@zodal/core';
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
 */
export interface DataProvider<T> {
  getList(params: GetListParams): Promise<GetListResult<T>>;
  getOne(id: string): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  updateMany(ids: string[], data: Partial<T>): Promise<T[]>;
  delete(id: string): Promise<void>;
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
}
