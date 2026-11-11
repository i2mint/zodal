/**
 * Tiered Provider: a bounded local cache (the hot tier) in front of a remote
 * source of truth (the cold tier), both plain DataProviders.
 *
 * The browser pattern of "the library lives in S3, the recent part lives on this
 * device": `cold` is, say, an HTTP or S3 provider, `hot` a localStorage or
 * IndexedDB one. Reads are served from the hot tier when it holds a fresh copy and
 * fall back to it when the cold tier is unreachable, so recent items stay
 * browsable offline. Writes go to the cold tier first (write-through); the cache
 * follows only once the cold tier accepted them.
 *
 * The cache is best-effort: a hot-tier failure (a full localStorage quota) never
 * fails an operation the cold tier completed. It is reported to `onCacheError`.
 *
 * Which items are cached (`admit`) and which leave when the budget is exceeded
 * (`selectEvictions`, least recently used by default) are options, so the later
 * slices of i2mint/zodal#115 (byte budget, pins, watermarks, second-hit admission,
 * blob tiering) are added as policies without changing callers. Residency records
 * (`{id, at, ...}`) live in their own provider (`residency`), so recency survives a
 * reload when that provider is persistent, the cached items are stored unchanged,
 * and a policy can keep its own fields there (pins, hits, bytes): a touch merges
 * `at` into the record and leaves the other fields alone.
 */

import type { DataProvider, GetListParams, GetListResult, DataChangeEvent } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';

/** What the tier knows about one cached item. Policies may add their own fields. */
export interface ResidencyRecord {
  id: string;
  /** Last use through the tier, in milliseconds since the epoch. */
  at: number;
  [field: string]: unknown;
}

/** A cached item as an eviction policy sees it. */
export interface Resident {
  id: string;
  /** Its residency record, when the tier has one (none: cached before the log existed). */
  record?: ResidencyRecord;
  /** Its position in the hot tier's own order (0 = first stored). */
  index: number;
}

/** How an item reached the tier: read one by one, listed, or written. */
export type AdmitVia = 'one' | 'list' | 'write';

/** Why the tier answered from the cache instead of the cold tier. */
export interface FallbackInfo {
  op: 'getList' | 'getOne';
  id?: string;
  error: unknown;
}

export interface TieredProviderOptions<T> {
  /** The local cache (e.g. localStorage or IndexedDB). */
  hot: DataProvider<T>;
  /** The source of truth (e.g. HTTP or S3). */
  cold: DataProvider<T>;
  /** Most items the hot tier keeps. Default: 200. */
  maxItems?: number;
  /**
   * Whether a cached copy may be served without asking the cold tier. Default: always.
   * Return false for items that still change remotely (a job still running), so they
   * are re-read from the cold tier until they settle.
   */
  isFresh?: (item: T) => boolean;
  /**
   * Whether an item the tier just saw is cached. Default: items read one by one and
   * items written are; items seen in a list are not (so browsing a long remote list
   * does not flush the recent items out).
   */
  admit?: (item: T, context: { via: AdmitVia }) => boolean;
  /**
   * Which cached items to drop when there are more than `maxItems`. Default: the
   * least recently used; items with no residency record count as older than every
   * recorded one, the later stored the newer.
   */
  selectEvictions?: (residents: Resident[], maxItems: number) => string[];
  /**
   * Whether a cold-tier error should be answered from the cache. Default: failures
   * with no HTTP status below 500 (the network is down, or the server is), never a
   * 4xx (a 401 is a login problem, a 404 a deleted item, not a reason to show a copy).
   */
  fallbackOn?: (error: unknown) => boolean;
  /** Told whenever a read was answered from the cache (to show "offline" in the UI). */
  onFallback?: (info: FallbackInfo) => void;
  /** Told when the cache failed (the operation itself succeeded). Default: console.warn. */
  onCacheError?: (error: unknown) => void;
  /**
   * Where residency records are kept. Default: in memory (recency is lost on reload).
   * Pass a persistent provider (e.g. localStorage) to keep LRU order across sessions.
   */
  residency?: DataProvider<ResidencyRecord>;
  /** Field name used as the unique identifier of items (hot and cold must agree). Default: 'id'. */
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

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/** The default `fallbackOn`: no status (network failure) or a 5xx. */
export function isUnreachable(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

/** The default `selectEvictions`: least recently used first. */
export function leastRecentlyUsed(residents: Resident[], maxItems: number): string[] {
  const rank = (r: Resident) => r.record?.at ?? Number.MIN_SAFE_INTEGER + r.index;
  const newestFirst = [...residents].sort((a, b) => rank(b) - rank(a));
  return newestFirst.slice(maxItems).map((r) => r.id);
}

/**
 * Compose a bounded local cache over a remote DataProvider.
 *
 * @example
 * ```typescript
 * const songs = createTieredProvider({
 *   cold: createHttpProvider({ baseUrl: '/api/songs' }),
 *   hot: createLocalStorageProvider({ storageKey: 'songs:recent' }),
 *   residency: createLocalStorageProvider({ storageKey: 'songs:recent:at' }),
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
    admit: shouldAdmit = (_item: T, { via }: { via: AdmitVia }) => via !== 'list',
    selectEvictions = leastRecentlyUsed,
    fallbackOn = isUnreachable,
    onFallback = () => {},
    onCacheError = (error: unknown) => console.warn('zodal tiered provider: cache error', error),
    idField = 'id',
    now = Date.now,
  } = options;
  const residency = options.residency ?? createInMemoryProvider<ResidencyRecord>([]);
  if (!(maxItems >= 0)) throw new RangeError(`maxItems must be >= 0, got ${maxItems}`);

  const idOf = (item: T): string => String(item[idField]);

  // Every change to the hot tier or the residency log runs through this queue, so
  // an admit, a budget pass and a remote event never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<R>(job: () => Promise<R>): Promise<R> {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  }
  /** Run a cache job; a failure is reported, never thrown. */
  function cacheJob(job: () => Promise<void>): Promise<void> {
    return serial(job).catch(onCacheError);
  }

  async function tryGet<V>(provider: DataProvider<V>, id: string): Promise<V | undefined> {
    try {
      return await provider.getOne(id);
    } catch {
      return undefined;
    }
  }

  async function put<V extends Record<string, any>>(provider: DataProvider<V>, id: string, value: V) {
    if (provider.upsert) await provider.upsert(value);
    else if ((await tryGet(provider, id)) !== undefined) await provider.update(id, value);
    else await provider.create(value);
  }

  async function touch(id: string): Promise<void> {
    if ((await tryGet(residency, id)) !== undefined) await residency.update(id, { at: now() });
    else await residency.create({ id, at: now() });
  }

  async function forget(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await hot.deleteMany(ids);
    await residency.deleteMany(ids);
  }

  async function enforceBudget(): Promise<void> {
    const [{ data: items }, { data: log }] = await Promise.all([
      hot.getList({}),
      residency.getList({}),
    ]);
    if (items.length <= maxItems) return;
    const records = new Map(log.map((r) => [r.id, r]));
    const residents = items.map((item, index) => {
      const id = idOf(item);
      return { id, index, record: records.get(id) };
    });
    await forget(selectEvictions(residents, maxItems));
  }

  let checkedIds = false;
  /** Cache `items` (touching them unless `refreshOnly`), then trim once to budget. */
  async function store(items: T[], { touchThem = true } = {}): Promise<void> {
    if (!items.length || maxItems === 0) return;
    for (const item of items) {
      const id = idOf(item);
      if (touchThem) await touch(id); // before the write: a new item is never "oldest"
      await put(hot, id, item);
      if (!checkedIds) {
        if ((await tryGet(hot, id)) === undefined) {
          throw new Error(
            `zodal tiered provider: the hot tier does not find an item by its '${idField}' ` +
              `(${id}); give hot, cold and the tier the same idField`,
          );
        }
        checkedIds = true;
      }
    }
    await enforceBudget();
  }

  function admit(items: T[], via: AdmitVia): Promise<void> {
    const chosen = items.filter((item) => shouldAdmit(item, { via }));
    return cacheJob(() => store(chosen));
  }

  /** Refresh copies already cached (a write or a remote change), without counting a use. */
  function refresh(items: T[]): Promise<void> {
    return cacheJob(async () => {
      const cachedOnes: T[] = [];
      for (const item of items) if ((await tryGet(hot, idOf(item))) !== undefined) cachedOnes.push(item);
      await store(cachedOnes, { touchThem: false });
    });
  }

  // A budget lowered since the last session (or maxItems 0) applies before the first read.
  const ready = cacheJob(() => (maxItems === 0 ? hot.getList({}).then(({ data }) => forget(data.map(idOf))) : enforceBudget()));

  const tier: TieredProvider<T> = {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      await ready;
      let result: GetListResult<T>;
      try {
        result = await cold.getList(params);
      } catch (error) {
        if (!fallbackOn(error)) throw error;
        let local: GetListResult<T>;
        try {
          local = await hot.getList(params);
        } catch {
          throw error;
        }
        onFallback({ op: 'getList', error });
        return local;
      }
      await admit(result.data, 'list');
      return result;
    },

    async getOne(id: string): Promise<T> {
      await ready;
      const cachedItem = await tryGet(hot, id);
      if (cachedItem !== undefined && isFresh(cachedItem)) {
        await cacheJob(() => touch(id));
        return cachedItem;
      }
      let item: T;
      try {
        item = await cold.getOne(id);
      } catch (error) {
        if (statusOf(error) === 404 && cachedItem !== undefined) {
          await cacheJob(() => forget([id])); // deleted remotely: drop the copy
        } else if (cachedItem !== undefined && fallbackOn(error)) {
          onFallback({ op: 'getOne', id, error });
          return cachedItem; // stale beats nothing when offline
        }
        throw error;
      }
      await admit([item], 'one');
      return item;
    },

    async create(data: Partial<T>): Promise<T> {
      const item = await cold.create(data);
      await admit([item], 'write');
      return item;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      const item = await cold.update(id, data);
      await refresh([item]);
      return item;
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      const items = await cold.updateMany(ids, data);
      await refresh(items);
      return items;
    },

    async delete(id: string): Promise<void> {
      await cold.delete(id);
      await cacheJob(() => forget([id]));
    },

    async deleteMany(ids: string[]): Promise<void> {
      await cold.deleteMany(ids);
      await cacheJob(() => forget(ids));
    },

    getCapabilities(): ProviderCapabilities {
      // The tier answers the full query in both tiers, so the cold tier's word holds.
      return cold.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
    },

    async cached(): Promise<T[]> {
      await ready;
      return serial(async () => {
        const [{ data: items }, { data: log }] = await Promise.all([
          hot.getList({}),
          residency.getList({}),
        ]);
        const records = new Map(log.map((r) => [r.id, r]));
        const residents = items.map((item, index) => ({ id: idOf(item), index, record: records.get(idOf(item)) }));
        const byId = new Map(items.map((item) => [idOf(item), item]));
        return leastRecentlyUsed(residents, 0).map((id) => byId.get(id)!); // newest first
      });
    },

    async evict(id?: string): Promise<void> {
      await serial(async () => {
        const ids = id === undefined ? (await hot.getList({})).data.map(idOf) : [id];
        await forget(ids);
      });
    },
  };

  if (cold.upsert) {
    const coldUpsert = cold.upsert.bind(cold);
    tier.upsert = async (data: T): Promise<T> => {
      const item = await coldUpsert(data);
      await admit([item], 'write');
      return item;
    };
  }
  if (cold.subscribe) {
    const coldSubscribe = cold.subscribe.bind(cold);
    tier.subscribe = (callback: (event: DataChangeEvent<T>) => void) => {
      // Events are applied, and passed on, in the order they arrived.
      let delivered: Promise<void> = Promise.resolve();
      return coldSubscribe((event) => {
        const sync =
          event.type === 'deleted'
            ? cacheJob(() => forget([event.id]))
            : event.type === 'updated'
              ? refresh([event.item])
              : Promise.resolve();
        delivered = delivered.then(() => sync).then(() => callback(event));
      });
    };
  }
  // Content stays in the cold tier in this slice (zodal#115 tiers blobs later).
  if (cold.getContent) tier.getContent = cold.getContent.bind(cold);
  if (cold.setContent) tier.setContent = cold.setContent.bind(cold);
  if (cold.getUrl) tier.getUrl = cold.getUrl.bind(cold);
  return tier;
}
