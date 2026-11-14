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

  /**
   * Per-field filter operator support (optional fine-grained discovery). Keys are
   * field names, plus `'*'` for every field without its own entry. A field's own
   * entry REPLACES the `'*'` list for that field; it does not add to it.
   */
  filterOperators?: Record<string, FilterOperator[]>;

  /** Pagination style supported */
  paginationStyle?: 'offset' | 'cursor';

  /** Whether real-time updates are available */
  realtime?: boolean;

  /** Whether this is a bifurcated provider (content + metadata). */
  bifurcated?: boolean;

  /** Content fields managed by this provider (when bifurcated). */
  contentFields?: string[];

  /**
   * `'atomic'` or `'best-effort'` when `setContent` honours `init.ifAbsent`
   * (`'best-effort'`: checked then written, so concurrent writers may race).
   * Absent: the provider predates `ContentWriteInit` and may ignore it, so callers
   * that need if-absent semantics must check `headContent` themselves.
   */
  contentIfAbsent?: 'atomic' | 'best-effort';

  /**
   * Why writes the capabilities refuse are refused, for a UI to show beside its
   * disabled controls ("Read-only: this is a published snapshot"). Set by
   * `createReadOnlyProvider`; any provider may set it.
   */
  writeRefusal?: string;
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

/**
 * Capabilities of a provider that refuses every write: all `can*` flags false,
 * queries client-side. Spread it, and add `writeRefusal`, to declare a read-only
 * provider by hand.
 */
export const READ_ONLY_CAPABILITIES: ProviderCapabilities = Object.freeze({
  ...DEFAULT_CAPABILITIES,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canBulkUpdate: false,
  canBulkDelete: false,
  canUpsert: false,
}) as ProviderCapabilities;
