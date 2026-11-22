/**
 * Auth-aware provider: the device's records until the user signs in, their account's
 * store after, with the device's records merged up on sign-in (i2mint/zodal#147).
 *
 * `remote()` is asked before every operation: `null` means signed out (use `local`); an
 * account (`{ key, provider }`, or just a provider) means signed in (use the account's
 * provider). Three rules keep data where it belongs:
 *
 * - **`local` only ever holds the device's own records.** Account records are never
 *   written to it, so one account's data cannot be merged into another account, and a
 *   record deleted in the account is not brought back from a stale local copy. An
 *   offline cache of the account is opt-in and per account: `cache: (key) => provider`
 *   puts `createTieredProvider` between the account and that cache.
 * - **The device's records are merged up on every sign-in**, but only those new or
 *   changed since they were last merged into that account (`mergeState` remembers, in
 *   memory by default; pass a persistent provider so a reload does not merge again).
 *   The default merge is a union by id where the strictly newer `updatedAt` wins; with
 *   `appendOnly`, a union that never overwrites.
 * - **Until a merge has succeeded nothing is cached**, and a failed merge is retried on
 *   the next operation; it never deletes or rewrites a local record.
 *
 * Accounts are told apart by `key`: return the same key for the same account even when
 * `remote()` builds a new provider object each call. A bare provider is keyed by identity.
 *
 * `DataChangeEvent` has no "source switched" event, so a switch is announced through
 * `onSwitch(listener)`. Switches are noticed on the next operation; call `refresh()` when
 * the auth state changes so listeners and `subscribe` follow at once.
 */

import type { ContentRef } from '@zodal/core';
import type { ContentWriteInit, DataProvider, DataChangeEvent, GetListParams, GetListResult } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';
import { createInMemoryProvider } from './in-memory.js';
import { createTieredProvider, type TieredProviderOptions } from './tiered-provider.js';

/** Which provider an auth-aware provider is using. */
export type AuthSource = 'local' | 'remote';

/** Announced when the provider switches between local and an account. */
export interface AuthSwitchEvent {
  from: AuthSource;
  to: AuthSource;
  /** The account signed into (`to: 'remote'`) or out of (`from: 'remote'`). */
  account?: string;
}

/** A signed-in account: a stable key and its store. */
export interface RemoteAccount<T> {
  key: string;
  provider: DataProvider<T>;
}

/** What a merge did: the ids written to the account, and the ids left as they were there. */
export interface MergeResult {
  written: string[];
  kept: string[];
}

/** Merges device records (the ones new or changed since the last merge) into an account. */
export type MergeUp<T> = (records: T[], remote: DataProvider<T>) => Promise<MergeResult>;

/** What `mergeState` stores: one per (account, record) merged. */
export interface MergeStateRecord {
  id: string;
  account: string;
  record: string;
  /** The record's fingerprint when it was merged. */
  stamp: string;
  [field: string]: unknown;
}

export interface AuthAwareProviderOptions<T> {
  /** The device's own records (localStorage, IndexedDB): used signed out, merged up on sign-in. */
  local: DataProvider<T>;
  /** The signed-in account, or `null` when signed out. Asked before every operation. */
  remote: () => RemoteAccount<T> | DataProvider<T> | null;
  /** How device records reach the account. Default: {@link mergeByUpdatedAt}. */
  merge?: MergeUp<T>;
  /** An append-only collection (a log): the default merge adds missing records and never overwrites. */
  appendOnly?: boolean;
  /** Field naming the unique id (local and remote must agree). Default: 'id'. */
  idField?: string;
  /** Field the default merge compares. Default: 'updatedAt'. The local provider must stamp it on every edit. */
  updatedAtField?: string;
  /** Reads `updatedAtField` as milliseconds. Default: Date, ISO string, or a number of milliseconds. */
  timeOf?: (value: unknown) => number;
  /** An offline cache for an account (opt-in): the account is read through `createTieredProvider` over it. */
  cache?: (accountKey: string) => DataProvider<T>;
  /** Options for that tier (`maxItems`, `isFresh`, ...). */
  tier?: Omit<TieredProviderOptions<T>, 'hot' | 'cold' | 'idField'>;
  /** Which device records were already merged into which account. Default: in memory. */
  mergeState?: DataProvider<MergeStateRecord>;
  /** Told when a merge failed (it is retried on the next operation). Default: console.warn. */
  onMergeError?: (error: unknown) => void;
}

/** What the provider exposes beyond the DataProvider contract. */
export interface AuthAwareProvider<T> extends DataProvider<T> {
  /** Whether an account is signed in now (asks `remote()`). */
  source(): AuthSource;
  /** Listen for switches between local and an account; returns an unsubscribe function. */
  onSwitch(listener: (event: AuthSwitchEvent) => void): () => void;
  /** Check `remote()` now (call it on every auth change), merging up if needed. */
  refresh(): Promise<AuthSource>;
}

/** The default `timeOf`: a Date, an ISO string, or a number of milliseconds; anything else is oldest. */
export function defaultTimeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  }
  return Number.NEGATIVE_INFINITY;
}

const PAGE_SIZE = 500;

/** Every item of a provider, page by page (an API may cap an unpaginated list). */
async function listAll<T>(provider: DataProvider<T>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const { data, total } = await provider.getList({ pagination: { page, pageSize: PAGE_SIZE } });
    items.push(...data);
    if (data.length === 0 || items.length >= total) return items;
  }
}

/**
 * The default merge: a record the account lacks is added; a record both have is
 * overwritten with the device's only when its `updatedAt` is strictly newer (never, with
 * `appendOnly`). Reads the account's whole collection, page by page.
 */
export function mergeByUpdatedAt<T extends Record<string, any>>({
  idField = 'id',
  updatedAtField = 'updatedAt',
  appendOnly = false,
  timeOf = defaultTimeOf,
}: { idField?: string; updatedAtField?: string; appendOnly?: boolean; timeOf?: (value: unknown) => number } = {}): MergeUp<T> {
  return async (records, remote) => {
    const result: MergeResult = { written: [], kept: [] };
    if (records.length === 0) return result;
    const remoteById = new Map((await listAll(remote)).map((item) => [String(item[idField]), item]));
    for (const item of records) {
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

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * A provider that holds the device's records while signed out and the account's store
 * while signed in, merging the device's records up on sign-in. See the module docs.
 *
 * ```ts
 * const presets = createAuthAwareProvider({
 *   local: createLocalStorageProvider({ storageKey: 'presets' }),
 *   remote: () => auth.user && { key: auth.user.id, provider: accountPresets(auth.user) },
 * });
 * ```
 */
export function createAuthAwareProvider<T extends Record<string, any>>(
  options: AuthAwareProviderOptions<T>,
): AuthAwareProvider<T> {
  const {
    local,
    idField = 'id',
    updatedAtField = 'updatedAt',
    appendOnly = false,
    timeOf = defaultTimeOf,
    cache,
    tier = {},
    onMergeError = (error: unknown) => console.warn('zodal auth-aware provider: merge failed', error),
  } = options;
  const merge = options.merge ?? mergeByUpdatedAt<T>({ idField, updatedAtField, appendOnly, timeOf });
  const mergeState = options.mergeState ?? createInMemoryProvider<MergeStateRecord>([]);

  const anonymousKeys = new WeakMap<DataProvider<T>, string>();
  let anonymousCount = 0;
  function account(): RemoteAccount<T> | null {
    const r = options.remote();
    if (!r) return null;
    const maybe = r as Partial<RemoteAccount<T>>;
    if (typeof maybe.key === 'string' && maybe.provider) return r as RemoteAccount<T>;
    const provider = r as DataProvider<T>;
    let key = anonymousKeys.get(provider);
    if (!key) anonymousKeys.set(provider, (key = `provider-${++anonymousCount}`));
    return { key, provider };
  }

  const idOf = (item: T) => String(item[idField]);
  const stampOf = (item: T) => JSON.stringify(item);
  const stateId = (accountKey: string, id: string) => `${accountKey}\u0000${id}`;

  /** Merge the device records new or changed since the last merge into this account. */
  async function mergeUp(target: RemoteAccount<T>): Promise<void> {
    const [mine, state] = await Promise.all([listAll(local), listAll(mergeState)]);
    const merged = new Map(state.filter((s) => s.account === target.key).map((s) => [s.record, s.stamp]));
    const dirty = mine.filter((item) => merged.get(idOf(item)) !== stampOf(item));
    if (dirty.length === 0) return;
    await merge(dirty, target.provider);
    for (const item of dirty) {
      const record: MergeStateRecord = {
        id: stateId(target.key, idOf(item)),
        account: target.key,
        record: idOf(item),
        stamp: stampOf(item),
      };
      if (mergeState.upsert) await mergeState.upsert(record);
      else {
        await mergeState.delete(record.id).catch(() => {});
        await mergeState.create(record);
      }
    }
  }

  // Per account key: the merge of the current sign-in (in flight or done), and its view.
  const merges = new Map<string, Promise<boolean>>();
  const views = new Map<string, DataProvider<T>>();
  let signedInAs: string | null = null;

  function mergeOnce(target: RemoteAccount<T>): Promise<boolean> {
    let pending = merges.get(target.key);
    if (!pending) {
      pending = mergeUp(target).then(
        () => true,
        (error) => {
          merges.delete(target.key); // retried on the next operation
          onMergeError(error);
          return false;
        },
      );
      merges.set(target.key, pending);
    }
    return pending;
  }

  function viewOf(target: RemoteAccount<T>): DataProvider<T> {
    if (!cache) return target.provider;
    let view = views.get(target.key);
    if (!view) {
      view = createTieredProvider<T>({ ...tier, hot: cache(target.key), cold: target.provider, idField });
      views.set(target.key, view);
    }
    return view;
  }

  const switchListeners = new Set<(event: AuthSwitchEvent) => void>();
  const changeListeners = new Set<(event: DataChangeEvent<T>) => void>();
  let lastSource: AuthSource | null = null;
  let lastAccount: string | undefined;
  let active: DataProvider<T> | null = null;
  let unsubscribeActive: (() => void) | null = null;

  function follow(provider: DataProvider<T>): void {
    if (provider === active) return;
    unsubscribeActive?.();
    unsubscribeActive = null;
    active = provider;
    if (provider.subscribe && changeListeners.size) {
      unsubscribeActive = provider.subscribe((event) => changeListeners.forEach((l) => l(event)));
    }
  }

  function announce(source: AuthSource, accountKey?: string): void {
    if (lastSource !== null && (lastSource !== source || lastAccount !== accountKey)) {
      const event: AuthSwitchEvent = { from: lastSource, to: source };
      const named = accountKey ?? lastAccount;
      if (named !== undefined) event.account = named;
      switchListeners.forEach((listener) => listener(event));
    }
    lastSource = source;
    lastAccount = accountKey;
  }

  async function current(): Promise<DataProvider<T>> {
    for (;;) {
      const target = account();
      if (!target) {
        if (signedInAs !== null) merges.delete(signedInAs); // the next sign-in merges again
        signedInAs = null;
        announce('local');
        follow(local);
        return local;
      }
      if (signedInAs !== target.key) {
        if (signedInAs !== null) merges.delete(signedInAs);
        signedInAs = target.key;
      }
      const merged = await mergeOnce(target);
      if (account()?.key !== target.key) continue; // auth changed during the merge
      const provider = merged ? viewOf(target) : target.provider;
      announce('remote', target.key);
      follow(provider);
      return provider;
    }
  }

  /** Forward an optional method to the provider in use, refusing when it lacks it. */
  function optional(name: keyof DataProvider<T>) {
    return async (...args: unknown[]) => {
      const p = await current();
      const method = p[name] as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (!method) throw new TypeError(`the ${lastSource} provider has no ${String(name)}`);
      return method.apply(p, args);
    };
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
      const id = idOf(data);
      try {
        await p.getOne(id);
      } catch (error) {
        const status = statusOf(error);
        if (status !== undefined && status !== 404) throw error; // not "missing": do not create
        return p.create(data);
      }
      return p.update(id, data);
    },
    async upsertMany(data) {
      const p = await current();
      if (p.upsertMany) return p.upsertMany(data);
      const out: T[] = [];
      for (const item of data) out.push(await provider.upsert!(item));
      return out;
    },
    getVersioned: optional('getVersioned') as DataProvider<T>['getVersioned'],
    updateIfVersion: optional('updateIfVersion') as DataProvider<T>['updateIfVersion'],
    deleteIfVersion: optional('deleteIfVersion') as DataProvider<T>['deleteIfVersion'],
    getContent: optional('getContent') as DataProvider<T>['getContent'],
    setContent: optional('setContent') as (
      id: string,
      field: string,
      content: unknown,
      init?: ContentWriteInit,
    ) => Promise<ContentRef>,
    headContent: optional('headContent') as DataProvider<T>['headContent'],
    getUrl: optional('getUrl') as DataProvider<T>['getUrl'],
    getCapabilities(): ProviderCapabilities {
      // What the provider in use reports, as current() would pick it now.
      const target = account();
      if (!target) return local.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
      const p = cache && merges.has(target.key) ? viewOf(target) : target.provider;
      return p.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
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
      return account() ? 'remote' : 'local';
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
