/**
 * Tiered Provider: a bounded local cache (the hot tier) in front of a remote
 * source of truth (the cold tier), both plain DataProviders.
 *
 * The browser pattern of "the library lives in S3, the recent part lives on this
 * device": `cold` is, say, an HTTP or S3 provider, `hot` a localStorage or
 * IndexedDB one. Reads are served from the hot tier when it holds a fresh copy and
 * fall back to it when the cold tier is unreachable, so recent items stay
 * browsable offline. Writes go to the cold tier first (write-through) and are
 * mirrored into the hot tier only once the cold tier accepted them.
 *
 * The hot tier is bounded by `maxItems` and evicts the least recently used items.
 * Access times live in their own provider (`accessLog`), so recency survives a
 * reload when the log is persistent, and the cached items are stored unchanged.
 *
 * This is the first slice of i2mint/zodal#115 (`createTieredProvider`): item
 * metadata with count-bounded LRU. Byte budgets, pins, watermarks, admission
 * rules and content (blob) tiering are the issue's later slices.
 */

import type { DataProvider, GetListParams, GetListResult, DataChangeEvent } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';

/** One access record: when an item was last read or written through the tier. */
export interface AccessRecord {
  id: string;
  /** Milliseconds since the epoch (`Date.now()`). */
  at: number;
}

export interface TieredProviderOptions<T> {
  /** The local cache (e.g. localStorage or IndexedDB). Must support create and delete. */
  hot: DataProvider<T>;
  /** The source of truth (e.g. HTTP or S3). */
  cold: DataProvider<T>;
  /** Most items the hot tier keeps; the least recently used are evicted. Default: 200. */
  maxItems?: number;
  /**
   * Whether a cached copy may be served without asking the cold tier. Default: always.
   * Return false for items that still change remotely (a job still running), so they
   * are re-read from the cold tier until they settle.
   */
  isFresh?: (item: T) => boolean;
  /**
   * Whether a successful `getList` from the cold tier also caches the items it
   * returned. Default: false (only items read one by one, or written, are cached),
   * so browsing a long remote list does not flush the recent items out.
   */
  admitOnList?: boolean;
  /**
   * Where access times are kept. Default: in memory (recency is lost on reload).
   * Pass a persistent provider (e.g. localStorage) to keep LRU order across sessions.
   */
  accessLog?: DataProvider<AccessRecord>;
  /** Field name used as the unique identifier. Default: 'id'. */
  idField?: string;
  /** Clock, for tests. Default: `Date.now`. */
  now?: () => number;
}

/** What the tier exposes beyond the DataProvider contract. */
export interface TieredProvider<T> extends DataProvider<T> {
  /** The items currently cached locally, most recently used first. */
  cached(): Promise<T[]>;
  /** Drop one item (or, with no id, everything) from the hot tier; the cold tier is untouched. */
  evict(id?: string): Promise<void>;
}

/**
 * Compose a bounded local cache over a remote DataProvider.
 *
 * @example
 * ```typescript
 * const songs = createTieredProvider({
 *   cold: createHttpProvider({ baseUrl: '/api/songs' }),
 *   hot: createLocalStorageProvider({ storageKey: 'songs:recent' }),
 *   accessLog: createLocalStorageProvider({ storageKey: 'songs:recent:access' }),
 *   maxItems: 100,
 *   isFresh: (song) => song.status === 'complete',
 * });
 * ```
 */
export function createTieredProvider<T extends Record<string, any>>(
  options: TieredProviderOptions<T>,
): TieredProvider<T> {
  const {
    hot,
    cold,
    maxItems = 200,
    isFresh = () => true,
    admitOnList = false,
    idField = 'id',
    now = Date.now,
  } = options;
  const accessLog = options.accessLog ?? createInMemoryProvider<AccessRecord>([]);
  if (!(maxItems >= 0)) throw new RangeError(`maxItems must be >= 0, got ${maxItems}`);

  const idOf = (item: T): string => String(item[idField]);

  async function tryGet<V>(provider: DataProvider<V>, id: string): Promise<V | undefined> {
    try {
      return await provider.getOne(id);
    } catch {
      return undefined;
    }
  }

  async function touch(id: string): Promise<void> {
    const record = { id, at: now() };
    if (accessLog.upsert) await accessLog.upsert(record);
    else if (await tryGet(accessLog, id)) await accessLog.update(id, record);
    else await accessLog.create(record);
  }

  async function forget(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await hot.deleteMany(ids);
    await accessLog.deleteMany(ids);
  }

  /** Hot ids, most recently used first (ids never accessed through the tier last). */
  async function hotIdsByRecency(): Promise<string[]> {
    const [{ data: items }, { data: log }] = await Promise.all([
      hot.getList({}),
      accessLog.getList({}),
    ]);
    const at = new Map(log.map((r) => [r.id, r.at]));
    return items
      .map(idOf)
      .sort((a, b) => (at.get(b) ?? -Infinity) - (at.get(a) ?? -Infinity));
  }

  async function enforceBudget(): Promise<void> {
    const ids = await hotIdsByRecency();
    if (ids.length > maxItems) await forget(ids.slice(maxItems));
  }

  /** Put (a copy of) `item` in the hot tier, mark it used, and trim to budget. */
  async function admit(item: T): Promise<void> {
    if (maxItems === 0) return;
    const id = idOf(item);
    if (hot.upsert) await hot.upsert(item);
    else if (await tryGet(hot, id)) await hot.update(id, item);
    else await hot.create(item);
    await touch(id);
    await enforceBudget();
  }

  /** Refresh a cached copy after a write, without admitting items that were not cached. */
  async function refreshIfCached(item: T): Promise<void> {
    const id = idOf(item);
    if (await tryGet(hot, id)) await admit(item);
  }

  const tier: TieredProvider<T> = {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      let result: GetListResult<T>;
      try {
        result = await cold.getList(params);
      } catch (error) {
        // Cold tier unreachable: answer from what is cached, the same query applied.
        try {
          return await hot.getList(params);
        } catch {
          throw error;
        }
      }
      if (admitOnList) for (const item of result.data) await admit(item);
      return result;
    },

    async getOne(id: string): Promise<T> {
      const cachedItem = await tryGet(hot, id);
      if (cachedItem !== undefined && isFresh(cachedItem)) {
        await touch(id);
        return cachedItem;
      }
      let item: T;
      try {
        item = await cold.getOne(id);
      } catch (error) {
        if (cachedItem !== undefined) return cachedItem; // stale beats nothing when offline
        throw error;
      }
      await admit(item);
      return item;
    },

    async create(data: Partial<T>): Promise<T> {
      const item = await cold.create(data);
      await admit(item);
      return item;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      const item = await cold.update(id, data);
      await admit(item);
      return item;
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      const items = await cold.updateMany(ids, data);
      for (const item of items) await refreshIfCached(item);
      return items;
    },

    async delete(id: string): Promise<void> {
      await cold.delete(id);
      await forget([id]);
    },

    async deleteMany(ids: string[]): Promise<void> {
      await cold.deleteMany(ids);
      await forget(ids);
    },

    getCapabilities(): ProviderCapabilities {
      return cold.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
    },

    async cached(): Promise<T[]> {
      const ids = await hotIdsByRecency();
      const items = await Promise.all(ids.map((id) => tryGet(hot, id)));
      return items.filter((x): x is Awaited<T> => x !== undefined) as T[];
    },

    async evict(id?: string): Promise<void> {
      const ids = id === undefined ? (await hot.getList({})).data.map(idOf) : [id];
      await forget(ids);
    },
  };

  if (cold.upsert) {
    const coldUpsert = cold.upsert.bind(cold);
    tier.upsert = async (data: T): Promise<T> => {
      const item = await coldUpsert(data);
      await admit(item);
      return item;
    };
  }
  if (cold.subscribe) {
    const coldSubscribe = cold.subscribe.bind(cold);
    tier.subscribe = (callback: (event: DataChangeEvent<T>) => void) =>
      coldSubscribe((event) => {
        // Keep cached copies in step with remote changes, then pass the event on.
        const sync =
          event.type === 'deleted'
            ? forget([event.id])
            : event.type === 'updated'
              ? refreshIfCached(event.item)
              : Promise.resolve();
        sync.catch(() => {}).finally(() => callback(event));
      });
  }
  // Content stays in the cold tier in this slice (zodal#115 tiers blobs later).
  if (cold.getContent) tier.getContent = cold.getContent.bind(cold);
  if (cold.setContent) tier.setContent = cold.setContent.bind(cold);
  if (cold.getUrl) tier.getUrl = cold.getUrl.bind(cold);
  return tier;
}
