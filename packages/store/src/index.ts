// @zodal/store — DataProvider interface, capability discovery, and adapters

// DataProvider
export type {
  DataProvider,
  ContentWriteInit,
  GetListParams,
  GetListResult,
  DataChangeEvent,
} from './data-provider.js';

// Capabilities
export type { ProviderCapabilities } from './capabilities.js';
export { DEFAULT_CAPABILITIES, READ_ONLY_CAPABILITIES } from './capabilities.js';

// Read-only providers (refuse writes, with the reason in the capabilities)
export { createReadOnlyProvider, ReadOnlyError } from './read-only.js';
export type { ReadOnlyOptions } from './read-only.js';

// Safe store ids (refuse or reversibly encode ids that are unsafe as paths/keys)
export {
  DEFAULT_MAX_ID_LENGTH,
  unsafeIdReason,
  isSafeId,
  assertSafeId,
  encodeId,
  decodeId,
  tryDecodeId,
  UnsafeIdError,
} from './ids.js';
export type { SafeIdOptions, EncodeIdOptions } from './ids.js';

// Conditional writes (opaque versions, WriteConflict)
export { WriteConflict, isWriteConflict } from './versioning.js';
export type { Version, Versioned } from './versioning.js';

// Filters
export { filterToFunction } from '@zodal/core';

// Client-side query evaluation (shared by adapters)
export { applyQuery, compareValues, compareBinary, matchesSearch } from './query.js';
export type { ApplyQueryOptions } from './query.js';

// Resolving a selection against a provider (zodal#154; the types and in-memory resolvers are in @zodal/core)
export { resolveSelectionIds, RESOLVE_PAGE_SIZE } from './views.js';
export type { ResolveIdsOptions, ResolvedSelectionIds } from './views.js';

// In-memory adapter
export { createInMemoryProvider } from './in-memory.js';
export type { InMemoryProviderOptions } from './in-memory.js';

// In-memory blob provider (records + content, no backend)
export { createInMemoryBlobProvider } from './in-memory-blob.js';
export type {
  InMemoryBlobProvider,
  InMemoryBlobProviderOptions,
  BlobUrlStrategy,
  StoredBlob,
} from './in-memory-blob.js';

// Provider wrapping
export { wrapProvider } from './wrap-provider.js';

// Auth-aware provider (local signed out, remote signed in, merge up on first sign-in)
export { createAuthAwareProvider, mergeByUpdatedAt, defaultTimeOf } from './auth-aware-provider.js';
export type {
  AuthAwareProvider,
  AuthAwareProviderOptions,
  AuthSource,
  AuthSwitchEvent,
  MergeResult,
  MergeUp,
  MergeStateRecord,
  RemoteAccount,
} from './auth-aware-provider.js';

// Tiered provider (bounded local cache over a remote source)
export { createTieredProvider, isUnreachable, leastRecentlyUsed } from './tiered-provider.js';
export type {
  TieredProvider,
  TieredProviderOptions,
  ResidencyRecord,
  Resident,
  AdmitVia,
  FallbackInfo,
} from './tiered-provider.js';

// Field input history (a field's past values, offered back)
export { createFieldHistory } from './field-history.js';
export type { HistoryEntry, HistoryReason, FieldHistoryStore, CreateFieldHistoryOptions } from './field-history.js';

// Bifurcated provider (content-metadata split)
export { createBifurcatedProvider, splitFields } from './bifurcated-provider.js';
export type { BifurcatedProviderOptions } from './bifurcated-provider.js';
