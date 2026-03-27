// @zodal/store — DataProvider interface, capability discovery, and adapters

// DataProvider
export type {
  DataProvider,
  GetListParams,
  GetListResult,
  DataChangeEvent,
} from './data-provider.js';

// Capabilities
export type { ProviderCapabilities } from './capabilities.js';
export { DEFAULT_CAPABILITIES } from './capabilities.js';

// Filters
export { filterToFunction } from './filters.js';

// In-memory adapter
export { createInMemoryProvider } from './in-memory.js';
export type { InMemoryProviderOptions } from './in-memory.js';

// Provider wrapping
export { wrapProvider } from './wrap-provider.js';
