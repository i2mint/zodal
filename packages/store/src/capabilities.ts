/**
 * Capability Discovery: Runtime introspection of DataProvider capabilities.
 *
 * zodal's novel contribution over react-admin/Refine.
 * The same collection definition works with both a fully-capable server backend
 * and a simple in-memory store, with the UI automatically adjusting.
 */

import type { FilterOperator } from '@zodal/core';

export interface ProviderCapabilities {
  // CRUD capabilities
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canBulkUpdate: boolean;
  canBulkDelete: boolean;
  canUpsert: boolean;

  // Query capabilities
  /** true = all fields, string[] = specific fields only */
  serverSort: boolean | string[];
  /** true = all fields, string[] = specific fields only */
  serverFilter: boolean | string[];
  serverSearch: boolean;
  serverPagination: boolean;

  /** Per-field filter operator support (optional fine-grained discovery) */
  filterOperators?: Record<string, FilterOperator[]>;

  /** Pagination style supported */
  paginationStyle?: 'offset' | 'cursor';

  /** Whether real-time updates are available */
  realtime?: boolean;

  /** Whether this is a bifurcated provider (content + metadata). */
  bifurcated?: boolean;

  /** Content fields managed by this provider (when bifurcated). */
  contentFields?: string[];
}

/** Default capabilities (when getCapabilities is not implemented). */
export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canBulkUpdate: true,
  canBulkDelete: true,
  canUpsert: false,
  serverSort: false,
  serverFilter: false,
  serverSearch: false,
  serverPagination: false,
};
