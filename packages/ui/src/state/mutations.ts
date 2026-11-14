/**
 * Mutation modes (zodal#110): where a create / update / delete shows up before the provider
 * answers. The mode lives here, on the mutation; `DataProvider<T>` stays a pure transport.
 *
 * - `'pessimistic'` (default): send, then show the provider's answer. What zodal hosts did before.
 * - `'optimistic'`: show at once, marked pending; send; replace with the provider's answer, or
 *   roll the item back, mark the mutation failed and report it with a `retry`.
 * - `'undoable'`: show at once and offer Undo for `undoSeconds`; send only after the window (or
 *   on `flush()`, e.g. from `pagehide`). An undone mutation sends nothing.
 *
 * Headless and framework-free: it reads and writes a {@link CollectionState} through `get`/`set`
 * (Zustand's shape), so `createZustandStoreSlice` uses it and any host can. Rollback restores a
 * snapshot of the one item the mutation touched (and its position), not the whole list, so
 * other edits made meanwhile survive. Mutations of one item are sent in order, one at a time.
 *
 * Feedback goes to `onFeedback`: `scheduled` (with `undo`), `committed`, `rolledBack` (with the
 * `error` and a `retry` that sends the same mutation again).
 */

import type { DataProvider } from '@zodal/store';
import type { CollectionState } from './store.js';

export type MutationMode = 'pessimistic' | 'optimistic' | 'undoable';
export type MutationKind = 'create' | 'update' | 'delete';

/** A mutation the store is waiting on (`CollectionState.pending`, keyed by mutation id). */
export interface PendingMutation {
  id: string;
  kind: MutationKind;
  itemId: string;
  /** `scheduled`: waiting out its Undo window; `pending`: sent; `failed`: rolled back. */
  status: 'scheduled' | 'pending' | 'failed';
  error?: unknown;
}

/** What a host is told about a mutation's life. */
export type MutationFeedback =
  | { kind: 'scheduled'; mutation: PendingMutation; seconds: number; undo: () => void }
  | { kind: 'committed'; mutation: PendingMutation }
  | { kind: 'undone'; mutation: PendingMutation }
  | { kind: 'rolledBack'; mutation: PendingMutation; error: unknown; retry: () => Promise<void> };

export interface MutationOptions {
  /** Default mode for every mutation. Default: `'pessimistic'`. */
  mode?: MutationMode;
  /** Undo window for `undoable`, in seconds. Default: 5 (a function may vary it per mutation). */
  undoSeconds?: number | ((kind: MutationKind, itemId: string) => number);
  /** Told of every scheduled, committed, undone and rolled-back mutation. */
  onFeedback?: (feedback: MutationFeedback) => void;
  /**
   * A new id for an item created optimistically or undoably without one, so it never changes id
   * when the provider answers (the provider stores a given id). Default: `crypto.randomUUID()`.
   */
  newId?: () => string;
  /** Field holding the item id. Default: `'id'`. */
  idField?: string;
  /** Timers, for tests. Default: global `setTimeout` / `clearTimeout`. */
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
}

/** A per-call override. */
export interface MutationCallOptions {
  mode?: MutationMode;
}

export interface Mutations<T> {
  create(data: Partial<T>, options?: MutationCallOptions): Promise<T>;
  update(id: string, data: Partial<T>, options?: MutationCallOptions): Promise<T>;
  delete(id: string, options?: MutationCallOptions): Promise<void>;
  /** Send every mutation still waiting out its Undo window now (call it on `pagehide`). */
  flush(): Promise<void>;
}

type State<T> = CollectionState<T> & { pending?: Record<string, PendingMutation> };

let seq = 0;
const defaultNewId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `tmp-${Date.now().toString(36)}-${++seq}`;

/** Build the mutation runner over a state holder and a provider. */
export function createMutations<T extends Record<string, any>>(
  provider: DataProvider<T>,
  get: () => State<T>,
  set: (fn: (s: State<T>) => Partial<State<T>> | State<T>) => void,
  options: MutationOptions = {},
): Mutations<T> {
  const {
    mode: defaultMode = 'pessimistic',
    undoSeconds = 5,
    onFeedback = () => {},
    newId = defaultNewId,
    idField = 'id',
    timers = {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  } = options;
  const idOf = (item: T) => String(item[idField]);
  let mutationSeq = 0;
  /** Sends for one item run in order (one in flight per record). */
  const chains = new Map<string, Promise<unknown>>();
  /** Undoable mutations waiting out their window: how to send or drop them. */
  const scheduled = new Map<string, { send: () => Promise<void>; timer: unknown }>();

  const feedback = (f: MutationFeedback) => {
    try {
      onFeedback(f);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  };

  // ---- local state edits -------------------------------------------------------------------
  const setPending = (m: PendingMutation | null, id: string) =>
    set((s) => {
      const pending = { ...(s.pending ?? {}) };
      if (m) pending[id] = m;
      else delete pending[id];
      return { pending };
    });
  const putItem = (item: T, at?: number) =>
    set((s) => {
      const items = [...s.items];
      const i = items.findIndex((x) => idOf(x) === idOf(item));
      if (i !== -1) items[i] = item;
      else items.splice(at === undefined ? items.length : Math.min(at, items.length), 0, item);
      return { items, totalCount: s.totalCount + (i === -1 ? 1 : 0) };
    });
  const dropItem = (id: string) =>
    set((s) => {
      const items = s.items.filter((x) => idOf(x) !== id);
      return { items, totalCount: s.totalCount - (s.items.length - items.length) };
    });
  const snapshot = (id: string): { item: T; at: number } | undefined => {
    const items = get().items;
    const at = items.findIndex((x) => idOf(x) === id);
    return at === -1 ? undefined : { item: structuredClone(items[at]!), at };
  };

  const inOrder = <R>(itemId: string, job: () => Promise<R>): Promise<R> => {
    const prev = chains.get(itemId) ?? Promise.resolve();
    const run = prev.then(job, job);
    chains.set(itemId, run.catch(() => {}));
    return run;
  };

  /**
   * Apply `local` now, send with `send`, keep `answer` on success; on failure undo `local` with
   * `rollback`, mark failed and report a retry. `mode` decides when `send` runs.
   */
  function run<R>(
    m: Omit<PendingMutation, 'status' | 'id'>,
    mode: MutationMode,
    local: () => void,
    rollback: () => void,
    send: () => Promise<R>,
    answer: (r: R) => void,
  ): Promise<R> {
    const id = `m${++mutationSeq}`;
    const mutation = (status: PendingMutation['status'], error?: unknown): PendingMutation =>
      error === undefined ? { id, ...m, status } : { id, ...m, status, error };

    if (mode === 'pessimistic') {
      setPending(mutation('pending'), id);
      return inOrder(m.itemId, async () => {
        try {
          const r = await send();
          answer(r);
          setPending(null, id);
          feedback({ kind: 'committed', mutation: mutation('pending') });
          return r;
        } catch (error) {
          setPending(mutation('failed', error), id);
          throw error;
        }
      });
    }

    local();
    const attempt = (): Promise<R> => {
      // Marked pending at once (the item already shows the change); sent in order.
      setPending(mutation('pending'), id);
      return inOrder(m.itemId, async () => {
        try {
          const r = await send();
          answer(r);
          setPending(null, id);
          feedback({ kind: 'committed', mutation: mutation('pending') });
          return r;
        } catch (error) {
          rollback();
          setPending(mutation('failed', error), id);
          feedback({
            kind: 'rolledBack',
            mutation: mutation('failed', error),
            error,
            retry: async () => {
              local();
              await attempt();
            },
          });
          throw error;
        }
      });
    };

    if (mode === 'optimistic') return attempt();

    // undoable: wait out the window, then send.
    const seconds = typeof undoSeconds === 'function' ? undoSeconds(m.kind, m.itemId) : undoSeconds;
    setPending(mutation('scheduled'), id);
    return new Promise<R>((resolve, reject) => {
      const send = () => {
        const s = scheduled.get(id);
        if (!s) return Promise.resolve();
        timers.clearTimeout(s.timer);
        scheduled.delete(id);
        return attempt().then(resolve, (e) => {
          reject(e);
        });
      };
      const timer = timers.setTimeout(() => void send(), seconds * 1000);
      scheduled.set(id, { send, timer });
      feedback({
        kind: 'scheduled',
        mutation: mutation('scheduled'),
        seconds,
        undo: () => {
          const s = scheduled.get(id);
          if (!s) return; // already sent: Undo is too late
          timers.clearTimeout(s.timer);
          scheduled.delete(id);
          rollback();
          setPending(null, id);
          feedback({ kind: 'undone', mutation: mutation('scheduled') });
          reject(Object.assign(new Error('Undone'), { name: 'MutationUndone' }));
        },
      });
    });
  }

  return {
    create(data, call = {}) {
      const mode = call.mode ?? defaultMode;
      const given = (data as Record<string, unknown>)[idField];
      const item = (given == null && mode !== 'pessimistic' ? { ...data, [idField]: newId() } : { ...data }) as T;
      const itemId = given == null && mode === 'pessimistic' ? '(new)' : idOf(item);
      return run(
        { kind: 'create', itemId },
        mode,
        () => putItem(item),
        () => dropItem(itemId),
        () => provider.create(item),
        (created) => putItem(created),
      );
    },
    update(id, data, call = {}) {
      const mode = call.mode ?? defaultMode;
      const before = snapshot(id);
      return run(
        { kind: 'update', itemId: id },
        mode,
        () => {
          const now = snapshot(id);
          if (now) putItem({ ...now.item, ...data });
        },
        () => {
          if (before) putItem(before.item, before.at);
        },
        () => provider.update(id, data),
        (updated) => putItem(updated),
      );
    },
    delete(id, call = {}) {
      const mode = call.mode ?? defaultMode;
      const before = snapshot(id);
      return run(
        { kind: 'delete', itemId: id },
        mode,
        () => dropItem(id),
        () => {
          if (before) putItem(before.item, before.at);
        },
        () => provider.delete(id),
        () => dropItem(id),
      );
    },
    async flush() {
      await Promise.all([...scheduled.values()].map((s) => s.send()));
    },
  };
}
