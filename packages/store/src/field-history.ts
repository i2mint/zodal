/**
 * Field input history: a field's past values, remembered and offered back.
 *
 * `createFieldHistory({ provider })` is a headless store over any `DataProvider<HistoryEntry>`:
 * in memory by default, a localStorage provider to keep it on this device, a tiered provider
 * (local hot, HTTP cold) to sync it across devices. One provider holds every scope; the app picks
 * its storage key, so two apps on one origin never share a history.
 *
 * The rules (`docs/research/field-input-history.md` §4.6, §6.3):
 * - values are trimmed, and an empty value is never recorded;
 * - recording a value already in the scope moves it to the top (its `at` and `uses` go up);
 * - each scope keeps at most `max` unpinned entries, least recent evicted first; pinned entries
 *   never count and are never evicted;
 * - lists are pinned first, then most recent first.
 *
 * `@zodal/ui` and renderer packages type against {@link FieldHistoryStore} structurally, so none
 * of them imports this package.
 */

import { DEFAULT_HISTORY_MAX } from '@zodal/core';
import type { DataProvider } from './data-provider.js';
import { createInMemoryProvider } from './in-memory.js';
import { leastRecentlyUsed } from './tiered-provider.js';

/** One remembered value of one history scope. */
export interface HistoryEntry {
  id: string;
  /** The history it belongs to (`FieldHistorySpec.scope`). */
  scope: string;
  value: string;
  /** When it was last recorded or picked, ms since the epoch. */
  at: number;
  /** How many times it was recorded or picked (kept for a later frecency order). */
  uses: number;
  pinned?: boolean;
}

/** Why a value is recorded: it was used, it was saved before a reset, or a pick replaced it. */
export type HistoryReason = 'submit' | 'reset' | 'pick';

/** What forms and renderers need from a history (structural: `@zodal/ui` and renderers declare the same shape). */
export interface FieldHistoryStore {
  /** Remember `value` (trimmed; empty is ignored). An equal value moves to the top instead of repeating. */
  record(scope: string, value: string, options?: { reason?: HistoryReason; max?: number }): Promise<void>;
  /** Pinned first, then most recent first. `query` keeps entries containing it, ignoring case. */
  list(scope: string, options?: { query?: string; limit?: number }): Promise<HistoryEntry[]>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned?: boolean): Promise<void>;
  /** Forget one scope, or every scope; resolves with what was removed, for an Undo. */
  clear(scope?: string): Promise<HistoryEntry[]>;
  /** Put entries back (the Undo of `clear` or `remove`). */
  restore(entries: readonly HistoryEntry[]): Promise<void>;
}

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

  /** Every entry of a scope (filtered by the provider when it can, and again here in case it cannot). */
  async function entriesOf(scope?: string): Promise<HistoryEntry[]> {
    const { data } = await provider.getList(scope === undefined ? {} : { filter: { field: 'scope', operator: 'eq', value: scope } });
    return scope === undefined ? data : data.filter((e) => e.scope === scope);
  }

  async function evict(scope: string, max: number): Promise<void> {
    const unpinned = (await entriesOf(scope)).filter((e) => !e.pinned);
    if (unpinned.length <= max) return;
    const residents = unpinned.map((e, index) => ({ id: e.id, record: { id: e.id, at: e.at }, index }));
    await provider.deleteMany(leastRecentlyUsed(residents, max));
  }

  return {
    record(scope, value, { max } = {}) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return Promise.resolve();
      let cap: number;
      try {
        cap = max === undefined ? defaultMax : checkMax(max, `record(${JSON.stringify(scope)})`);
      } catch (error) {
        return Promise.reject(error);
      }
      return serial(async () => {
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
      return serial(() => provider.deleteMany([id]));
    },

    pin(id, pinned = true) {
      return serial(async () => {
        await provider.update(id, { pinned });
      });
    },

    clear(scope) {
      return serial(async () => {
        const removed = (await entriesOf(scope)).sort(historyOrder);
        await provider.deleteMany(removed.map((e) => e.id));
        return removed;
      });
    },

    restore(entries) {
      return serial(async () => {
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
