/**
 * Auth-aware provider: local until the user signs in, their account's store after,
 * with the local records merged up on the first sign-in (i2mint/zodal#147).
 *
 * `remote()` is asked before every operation: `null` means signed out (use `local`),
 * a provider means signed in (use it, with `local` as its cache through
 * `createTieredProvider`). The first time a given remote provider appears, every local
 * record is merged into it (default: union by id, the newer `updatedAt` wins; with
 * `appendOnly`, union only, never overwriting). Until that merge has succeeded the
 * remote is used directly, without the cache, so a cache eviction can never drop a
 * record that is not yet in the account; the merge is retried on the next operation.
 *
 * On sign-out the provider goes back to `local`, which by then also holds the account
 * records the cache kept (at most `tier.maxItems`): nothing the user saw is lost, and a
 * host that must not leave account data on a shared device clears `local` on sign-out.
 *
 * `DataChangeEvent` has no "source switched" event, so a switch is announced through
 * `onSwitch(listener)`; `subscribe` follows whichever provider is current.
 */

import type { DataProvider, DataChangeEvent, GetListParams, GetListResult } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';
import { createTieredProvider, type TieredProviderOptions } from './tiered-provider.js';

/** Which provider an auth-aware provider is using. */
export type AuthSource = 'local' | 'remote';

/** Announced when the provider switches between local and remote. */
export interface AuthSwitchEvent {
  from: AuthSource;
  to: AuthSource;
}

/** What a merge did: the ids written to the remote, and the ids left as they were there. */
export interface MergeResult {
  written: string[];
  kept: string[];
}

/** Merges the local records into the remote provider on the first sign-in. */
export type MergeUp<T> = (local: DataProvider<T>, remote: DataProvider<T>) => Promise<MergeResult>;

export interface AuthAwareProviderOptions<T> {
  /** The device's store (localStorage, IndexedDB): used signed out, then as the cache. */
  local: DataProvider<T>;
  /** The account's store when signed in, `null` when signed out. Asked before every operation. */
  remote: () => DataProvider<T> | null;
  /** How local records reach the remote on first sign-in. Default: {@link mergeByUpdatedAt}. */
  merge?: MergeUp<T>;
  /** An append-only collection (a log): the default merge adds missing records and never overwrites. */
  appendOnly?: boolean;
  /** Field naming the unique id (local and remote must agree). Default: 'id'. */
  idField?: string;
  /** Field the default merge compares (ISO string, epoch number or Date). Default: 'updatedAt'. */
  updatedAtField?: string;
  /** Options for the cache tier over the remote (`maxItems`, `isFresh`, ...). */
  tier?: Omit<TieredProviderOptions<T>, 'hot' | 'cold' | 'idField'>;
  /** Told when a merge failed (it is retried on the next operation). Default: console.warn. */
  onMergeError?: (error: unknown) => void;
}

/** What the provider exposes beyond the DataProvider contract. */
export interface AuthAwareProvider<T> extends DataProvider<T> {
  /** The provider in use now (asks `remote()`). */
  source(): AuthSource;
  /** Listen for switches between local and remote; returns an unsubscribe function. */
  onSwitch(listener: (event: AuthSwitchEvent) => void): () => void;
  /** Check `remote()` now (e.g. right after sign-in), merging up if needed, without another operation. */
  refresh(): Promise<AuthSource>;
}

const timeOf = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  }
  return Number.NEGATIVE_INFINITY;
};

/**
 * The default merge: every local record the remote lacks is added; a record both have is
 * overwritten with the local one only when its `updatedAt` is strictly newer (never, with
 * `appendOnly`). Reads the whole remote collection once.
 */
export function mergeByUpdatedAt<T extends Record<string, any>>({
  idField = 'id',
  updatedAtField = 'updatedAt',
  appendOnly = false,
}: { idField?: string; updatedAtField?: string; appendOnly?: boolean } = {}): MergeUp<T> {
  return async (local, remote) => {
    const [{ data: mine }, { data: theirs }] = await Promise.all([local.getList({}), remote.getList({})]);
    const remoteById = new Map(theirs.map((item) => [String(item[idField]), item]));
    const result: MergeResult = { written: [], kept: [] };
    for (const item of mine) {
      const id = String(item[idField]);
      const existing = remoteById.get(id);
      const write =
        existing === undefined ||
        (!appendOnly && timeOf(item[updatedAtField]) > timeOf(existing[updatedAtField]));
      if (!write) {
        result.kept.push(id);
        continue;
      }
      if (remote.upsert) await remote.upsert(item);
      else if (existing === undefined) await remote.create(item);
      else await remote.update(id, item);
      result.written.push(id);
    }
    return result;
  };
}

/**
 * A provider that is `local` while signed out and `remote()` (cached in `local`) while
 * signed in, merging the local records up on the first sign-in.
 *
 * ```ts
 * const provider = createAuthAwareProvider({
 *   local: createLocalStorageProvider({ key: 'presets' }),
 *   remote: () => (auth.user ? createHttpProvider({ baseUrl: `/api/${auth.user.id}/presets` }) : null),
 * });
 * ```
 */
export function createAuthAwareProvider<T extends Record<string, any>>(
  options: AuthAwareProviderOptions<T>,
): AuthAwareProvider<T> {
  const {
    local,
    remote,
    idField = 'id',
    updatedAtField = 'updatedAt',
    appendOnly = false,
    tier = {},
    onMergeError = (error: unknown) => console.warn('zodal auth-aware provider: merge failed', error),
  } = options;
  const merge = options.merge ?? mergeByUpdatedAt<T>({ idField, updatedAtField, appendOnly });

  // Per remote provider: the merge in flight or done, and its cache tier once merged.
  const merges = new WeakMap<DataProvider<T>, Promise<boolean>>();
  const tiers = new WeakMap<DataProvider<T>, DataProvider<T>>();
  const switchListeners = new Set<(event: AuthSwitchEvent) => void>();
  const changeListeners = new Set<(event: DataChangeEvent<T>) => void>();

  let lastSource: AuthSource | null = null;
  let active: DataProvider<T> | null = null;
  let unsubscribeActive: (() => void) | null = null;

  function mergeOnce(target: DataProvider<T>): Promise<boolean> {
    let pending = merges.get(target);
    if (!pending) {
      pending = merge(local, target).then(
        () => {
          tiers.set(target, createTieredProvider<T>({ ...tier, hot: local, cold: target, idField }));
          return true;
        },
        (error) => {
          merges.delete(target); // retried on the next operation
          onMergeError(error);
          return false;
        },
      );
      merges.set(target, pending);
    }
    return pending;
  }

  function follow(provider: DataProvider<T>): void {
    if (provider === active) return;
    unsubscribeActive?.();
    unsubscribeActive = null;
    active = provider;
    if (provider.subscribe && changeListeners.size) {
      unsubscribeActive = provider.subscribe((event) => changeListeners.forEach((l) => l(event)));
    }
  }

  function announce(source: AuthSource): void {
    if (lastSource !== null && lastSource !== source) {
      const event = { from: lastSource, to: source };
      switchListeners.forEach((listener) => listener(event));
    }
    lastSource = source;
  }

  async function current(): Promise<DataProvider<T>> {
    const target = remote();
    if (!target) {
      announce('local');
      follow(local);
      return local;
    }
    const merged = await mergeOnce(target);
    const provider = merged ? tiers.get(target)! : target;
    announce('remote');
    follow(provider);
    return provider;
  }

  const provider: AuthAwareProvider<T> = {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      return (await current()).getList(params);
    },
    async getOne(id) {
      return (await current()).getOne(id);
    },
    async create(data) {
      return (await current()).create(data);
    },
    async update(id, data) {
      return (await current()).update(id, data);
    },
    async updateMany(ids, data) {
      return (await current()).updateMany(ids, data);
    },
    async delete(id) {
      return (await current()).delete(id);
    },
    async deleteMany(ids) {
      return (await current()).deleteMany(ids);
    },
    async upsert(data) {
      const p = await current();
      if (p.upsert) return p.upsert(data);
      const id = String(data[idField]);
      try {
        await p.getOne(id);
      } catch {
        return p.create(data);
      }
      return p.update(id, data);
    },
    // Conditional writes are forwarded to the provider in use; `getCapabilities` reports
    // `versioned` from that same provider (the cache tier does not route them, and says so).
    async getVersioned(id) {
      const p = await current();
      if (!p.getVersioned) throw new TypeError(`the ${lastSource} provider is not versioned`);
      return p.getVersioned(id);
    },
    async updateIfVersion(id, data, expected) {
      const p = await current();
      if (!p.updateIfVersion) throw new TypeError(`the ${lastSource} provider is not versioned`);
      return p.updateIfVersion(id, data, expected);
    },
    async deleteIfVersion(id, expected) {
      const p = await current();
      if (!p.deleteIfVersion) throw new TypeError(`the ${lastSource} provider is not versioned`);
      return p.deleteIfVersion(id, expected);
    },
    getCapabilities(): ProviderCapabilities {
      const target = remote();
      if (!target) return local.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
      // Signed in, reads and writes go through the cache tier, which does not route
      // conditional writes: report them off even before the tier exists (mid-merge).
      const { versioned: _notRouted, ...caps } = target.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
      return caps as ProviderCapabilities;
    },
    subscribe(callback) {
      changeListeners.add(callback);
      if (active && !unsubscribeActive && active.subscribe) {
        unsubscribeActive = active.subscribe((event) => changeListeners.forEach((l) => l(event)));
      }
      return () => {
        changeListeners.delete(callback);
        if (!changeListeners.size) {
          unsubscribeActive?.();
          unsubscribeActive = null;
        }
      };
    },
    source() {
      return remote() ? 'remote' : 'local';
    },
    onSwitch(listener) {
      switchListeners.add(listener);
      return () => switchListeners.delete(listener);
    },
    async refresh() {
      await current();
      return lastSource!;
    },
  };
  return provider;
}
