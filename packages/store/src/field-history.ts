/**
 * Field input history: a field's past values, remembered and offered back.
 *
 * `createFieldHistory({ provider })` is a headless store over any `DataProvider<HistoryEntry>`:
 * in memory by default, a localStorage provider to keep it on this device, a tiered provider
 * (local hot, HTTP cold) to sync it across devices. One provider holds every scope; the app picks
 * its storage key, so two apps on one origin never share a history.
 *
 * Privacy: a history holds what people typed, in plain text, for as long as the provider keeps it.
 * - It is never shared across users only if the app makes it so: on a browser shared by several
 *   signed-in people, put the user in the storage key (`'my-app.field-history.' + userId`) and call
 *   `clear()` on sign-out.
 * - Secret fields are refused upstream (`defineCollection`, `toOptionsFormConfig`); other
 *   sensitive values (card numbers, one-time codes, national ids) are the host's to keep out, by
 *   not declaring history on those fields. Cover stored input in the app's privacy notice.
 * - Offline: a tiered provider whose writes go to the remote tier first makes `record` reject
 *   while offline (and `startNewItem` with it, which then clears nothing).
 *
 * The rules (`docs/research/field-input-history.md` §4.6, §6.3):
 * - values are trimmed, and an empty value is never recorded;
 * - recording a value already in the scope moves it to the top (its `at` and `uses` go up);
 * - each scope keeps at most `max` unpinned entries, least recent evicted first; pinned entries
 *   never count and are never evicted;
 * - lists are pinned first, then most recent first.
 *
 * The types (`FieldHistoryStore`, `HistoryEntry`, `HistoryReason`) are declared in `@zodal/core`
 * and re-exported here, so `@zodal/ui` and renderer packages use them without importing this one.
 */

import { DEFAULT_HISTORY_MAX } from '@zodal/core';
import type { FieldHistoryStore, HistoryEntry } from '@zodal/core';
import type { DataProvider } from './data-provider.js';
import { createInMemoryProvider } from './in-memory.js';
import { leastRecentlyUsed } from './tiered-provider.js';

export type { FieldHistoryStore, HistoryEntry, HistoryReason } from '@zodal/core';

export interface CreateFieldHistoryOptions {
  /**
   * Where entries live. Default: in memory (gone on reload). A localStorage provider keeps them
   * on this device; a tiered provider (local hot, HTTP cold) syncs them across devices.
   */
  provider?: DataProvider<HistoryEntry>;
  /** Default cap per scope when a field gives none. Default: `DEFAULT_HISTORY_MAX` (50). */
  max?: number;
  /** The clock. Default: `Date.now`. */
  now?: () => number;
}

/** Pinned first, then most recent first (ties: most used first, then id, so the order is stable). */
function historyOrder(a: HistoryEntry, b: HistoryEntry): number {
  return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.at - a.at || b.uses - a.uses || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Entries read per `getList` page. */
const PAGE_SIZE = 1000;

function checkMax(max: number, where: string): number {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`${where}: max must be a positive integer, got ${JSON.stringify(max)}`);
  return max;
}

/**
 * Create a field history store.
 *
 * @example
 * ```typescript
 * const history = createFieldHistory({
 *   provider: createLocalStorageProvider<HistoryEntry>({ storageKey: 'my-app.field-history' }),
 * });
 * await history.record('lyrics', 'First verse\nSecond line', { reason: 'submit' });
 * await history.list('lyrics');   // [{ value: 'First verse\nSecond line', uses: 1, ... }]
 * ```
 */
export function createFieldHistory(options: CreateFieldHistoryOptions = {}): FieldHistoryStore {
  const provider = options.provider ?? createInMemoryProvider<HistoryEntry>([]);
  const defaultMax = checkMax(options.max ?? DEFAULT_HISTORY_MAX, 'createFieldHistory');
  const now = options.now ?? Date.now;

  // Every change runs through this queue, so two records of one value (a reset recording two
  // fields that share a scope) never both create an entry, and a cap pass never races a record.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<R>(job: () => Promise<R>): Promise<R> {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  }

  // Listeners hear of every change made through this store (a listener's error never fails the write).
  const listeners = new Set<(scope: string | undefined) => void>();
  function changed(scope: string | undefined): void {
    for (const listener of [...listeners]) {
      try {
        listener(scope);
      } catch (error) {
        console.warn('zodal field history: a subscriber threw', error);
      }
    }
  }
  /** A serial write that, once done, tells the listeners which scope changed. */
  function write<R>(scope: string | undefined, job: () => Promise<R>): Promise<R> {
    return serial(job).then((result) => {
      changed(scope);
      return result;
    });
  }

  /**
   * Every entry of a scope (filtered by the provider when it can, and again here in case it
   * cannot), page by page until `total`, so a provider that paginates by default still gives all.
   */
  async function entriesOf(scope?: string): Promise<HistoryEntry[]> {
    const filter = scope === undefined ? undefined : { field: 'scope', operator: 'eq' as const, value: scope };
    const byId = new Map<string, HistoryEntry>();
    for (let page = 1; ; page++) {
      const { data, total } = await provider.getList({ ...(filter ? { filter } : {}), pagination: { page, pageSize: PAGE_SIZE } });
      const before = byId.size;
      for (const entry of data) byId.set(entry.id, entry);
      // `total` decides, not the page length (a server may cap pages below the size asked for);
      // a page that adds nothing new (a provider that ignores `page`) ends it too.
      if (byId.size === before || !(byId.size < total)) break;
    }
    const all = [...byId.values()];
    return scope === undefined ? all : all.filter((e) => e.scope === scope);
  }

  /** The scope of an entry, for listeners (`undefined` when it is already gone). */
  async function scopeOf(id: string): Promise<string | undefined> {
    try {
      return (await provider.getOne(id)).scope;
    } catch {
      return undefined;
    }
  }

  async function evict(scope: string, max: number): Promise<void> {
    const unpinned = (await entriesOf(scope)).filter((e) => !e.pinned);
    if (unpinned.length <= max) return;
    const residents = unpinned.map((e, index) => ({ id: e.id, record: { id: e.id, at: e.at }, index }));
    await provider.deleteMany(leastRecentlyUsed(residents, max));
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    record(scope, value, { max } = {}) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return Promise.resolve();
      let cap: number;
      try {
        cap = max === undefined ? defaultMax : checkMax(max, `record(${JSON.stringify(scope)})`);
      } catch (error) {
        return Promise.reject(error);
      }
      return write(scope, async () => {
        const existing = (await entriesOf(scope)).find((e) => e.value === text);
        const at = now();
        if (existing) await provider.update(existing.id, { at, uses: existing.uses + 1 });
        else await provider.create({ scope, value: text, at, uses: 1 });
        await evict(scope, cap);
      });
    },

    async list(scope, { query, limit } = {}) {
      const needle = query?.trim().toLowerCase();
      const entries = (await entriesOf(scope))
        .filter((e) => !needle || e.value.toLowerCase().includes(needle))
        .sort(historyOrder);
      return limit === undefined ? entries : entries.slice(0, Math.max(0, limit));
    },

    remove(id) {
      return serial(async () => {
        const scope = await scopeOf(id);
        await provider.deleteMany([id]);
        return scope;
      }).then((scope) => changed(scope));
    },

    pin(id, pinned = true) {
      return serial(async () => (await provider.update(id, { pinned })).scope).then((scope) => changed(scope));
    },

    clear(scope) {
      return write(scope, async () => {
        const removed = (await entriesOf(scope)).sort(historyOrder);
        await provider.deleteMany(removed.map((e) => e.id));
        return removed;
      });
    },

    restore(entries) {
      const scopes = new Set(entries.map((e) => e.scope));
      return write(scopes.size === 1 ? [...scopes][0] : undefined, async () => {
        const present = new Map((await entriesOf()).map((e) => [e.id, e]));
        for (const entry of entries) {
          if (present.has(entry.id)) continue; // never removed: nothing to put back
          // A value recorded again since it was removed: keep one entry, the newer time, both counts.
          const same = [...present.values()].find((e) => e.scope === entry.scope && e.value === entry.value);
          if (same) {
            await provider.update(same.id, {
              at: Math.max(same.at, entry.at),
              uses: same.uses + entry.uses,
              pinned: Boolean(same.pinned || entry.pinned),
            });
          } else {
            const created = await provider.create({ ...entry });
            present.set(created.id, created);
          }
        }
      });
    },
  };
}
