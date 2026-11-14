/**
 * Read-only providers: refuse every write, and say why in the capabilities.
 *
 * A UI derives disabled controls from `getCapabilities()` (never from a parallel
 * read-only flag), and shows `writeRefusal` as the reason. Writes reject with an
 * error carrying the same reason, so a caller that ignores the capabilities still
 * learns why.
 */

import type { DataProvider } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES, READ_ONLY_CAPABILITIES } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';
import type { InMemoryProviderOptions } from './in-memory.js';

export interface ReadOnlyOptions extends InMemoryProviderOptions {
  /** Why writes are refused. Default: `'This collection is read-only.'` */
  reason?: string;
}

/** Thrown (as a rejection) by every write on a read-only provider. */
export class ReadOnlyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ReadOnlyError';
  }
}

const DEFAULT_REASON = 'This collection is read-only.';

/**
 * A provider that serves `source` and refuses every write.
 *
 * `source` is an array of items (served by an in-memory provider, so filtering,
 * search, sorting and pagination work; omit it for an empty collection) or an
 * existing provider, whose reads and content reads pass through and whose writes
 * are refused.
 *
 * @example
 * ```ts
 * const snapshot = createReadOnlyProvider(rows, { reason: 'Published snapshot; edit the draft instead.' });
 * snapshot.getCapabilities().canCreate;   // false
 * snapshot.getCapabilities().writeRefusal; // 'Published snapshot; edit the draft instead.'
 * ```
 */
export function createReadOnlyProvider<T extends Record<string, any>>(
  source: readonly T[] | DataProvider<T> = [],
  options: ReadOnlyOptions = {},
): DataProvider<T> & { getCapabilities(): ProviderCapabilities } {
  const { reason = DEFAULT_REASON, ...memoryOptions } = options;
  const inner: DataProvider<T> = Array.isArray(source)
    ? createInMemoryProvider<T>([...source], memoryOptions)
    : (source as DataProvider<T>);
  const refuse = () => Promise.reject(new ReadOnlyError(reason));
  const innerCaps = inner.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
  const caps: ProviderCapabilities = {
    ...innerCaps,
    ...pickWriteFlags(READ_ONLY_CAPABILITIES),
    writeRefusal: reason,
  };
  delete caps.contentIfAbsent; // it refuses every content write

  const provider: DataProvider<T> & { getCapabilities(): ProviderCapabilities } = {
    getList: (params) => inner.getList(params),
    getOne: (id) => inner.getOne(id),
    create: refuse,
    update: refuse,
    updateMany: refuse,
    delete: refuse,
    deleteMany: refuse,
    upsert: refuse,
    getCapabilities: () => ({ ...caps }),
  };
  if (inner.subscribe) provider.subscribe = inner.subscribe.bind(inner);
  if (inner.getContent) provider.getContent = inner.getContent.bind(inner);
  if (inner.getUrl) provider.getUrl = inner.getUrl.bind(inner);
  if (inner.headContent) provider.headContent = inner.headContent.bind(inner);
  if (inner.setContent) provider.setContent = refuse;
  return provider;
}

function pickWriteFlags(c: ProviderCapabilities): Partial<ProviderCapabilities> {
  const { canCreate, canUpdate, canDelete, canBulkUpdate, canBulkDelete, canUpsert } = c;
  return { canCreate, canUpdate, canDelete, canBulkUpdate, canBulkDelete, canUpsert };
}
