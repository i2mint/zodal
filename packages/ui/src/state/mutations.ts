/**
 * Mutation modes (zodal#110): where a create / update / delete shows up before the provider
 * answers. The mode lives here, on the mutation; `DataProvider<T>` stays a pure transport.
 *
 * - `'pessimistic'` (default): send, then show the provider's answer. What zodal hosts did before.
 * - `'optimistic'`: show at once, marked pending; send; replace with the provider's answer, or
 *   take the change back, mark the mutation failed and report it with a `retry`.
 * - `'undoable'`: show at once and offer Undo for `undoSeconds`; send only after the window (or
 *   on `flush()`, e.g. from `pagehide`). An undone mutation sends nothing.
 *
 * Headless and framework-free: it reads and writes a {@link CollectionState} through `get`/`set`
 * (Zustand's shape). How it stays correct:
 *
 * - **Each mutation is a pure transform of the item list** (`overlay`). Its local effect is that
 *   transform; a refetch that replaces `items` keeps every unsettled mutation visible by
 *   re-applying the overlays (`overlay(items)`; `createZustandStoreSlice`'s `fetchData` does).
 * - **Rollback is precise**: an update takes back only the fields it set, and only where they
 *   still hold its value (a later edit to the same field survives); a delete puts the item back
 *   next to its old neighbour, only if it is still gone; a create removes only its own row.
 * - **One record, one queue**: every mutation joins its item's queue when called, so sends for one
 *   item go in call order (an undoable mutation holds its place while its window runs).
 * - **A provider may assign the id**: a created row is re-keyed to the id the provider answers.
 * - **Promises are optional**: the returned promise rejects on failure (and resolves with
 *   `undefined` after Undo), but is never an unhandled rejection; drive the UI from `onFeedback`.
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
  /** `scheduled`: waiting out its Undo window; `pending`: sent; `failed`: taken back (dismiss it). */
  status: 'scheduled' | 'pending' | 'failed';
  error?: unknown;
}

/** What a host is told about a mutation's life. */
export type MutationFeedback =
  | { kind: 'scheduled'; mutation: PendingMutation; seconds: number; undo: () => boolean }
  | { kind: 'committed'; mutation: PendingMutation }
  | { kind: 'undone'; mutation: PendingMutation }
  | { kind: 'failed'; mutation: PendingMutation; error: unknown; retry: () => Promise<void> };

export interface MutationOptions {
  /** Default mode for every mutation. Default: `'pessimistic'`. */
  mode?: MutationMode;
  /** Undo window for `undoable`, in seconds. Default: 5 (a function may vary it per mutation). */
  undoSeconds?: number | ((kind: MutationKind, itemId: string) => number);
  /** Told of every scheduled, committed, undone and failed mutation. */
  onFeedback?: (feedback: MutationFeedback) => void;
  /**
   * A new id for an item created optimistically or undoably without one. Default:
   * `crypto.randomUUID()`. A provider that assigns its own id anyway is fine: the row is re-keyed.
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
  /** Resolves with the stored item, or `undefined` when undone. */
  create(data: Partial<T>, options?: MutationCallOptions): Promise<T | undefined>;
  update(id: string, data: Partial<T>, options?: MutationCallOptions): Promise<T | undefined>;
  delete(id: string, options?: MutationCallOptions): Promise<void>;
  /** Send every mutation still waiting out its Undo window now (call it on `pagehide`). */
  flush(): Promise<void>;
  /** Forget a failed mutation (after the host showed it). */
  dismiss(mutationId: string): void;
  /** Drop every scheduled mutation (unsent, taken back) and clear `pending`: for a reset. */
  cancelAll(): void;
  /** `items` with every unsettled mutation applied: re-apply after a refetch replaced the list. */
  overlay(items: readonly T[]): T[];
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
  /** Per-item send queues (entries removed once idle). */
  const chains = new Map<string, Promise<unknown>>();
  /** Unsettled mutations' list transforms, in call order (re-applied after a refetch). */
  const overlays = new Map<string, (items: T[]) => T[]>();
  /** Undoable mutations in their window: release (send now) or cancel (undo). */
  const windows = new Map<string, { release: () => void; cancel: () => void; timer: unknown; itemId: string }>();

  const feedback = (f: MutationFeedback) => {
    try {
      onFeedback(f);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  };
  const setPending = (m: PendingMutation | null, id: string) =>
    set((s) => {
      const pending = { ...(s.pending ?? {}) };
      if (m) pending[id] = m;
      else delete pending[id];
      return { pending };
    });
  /** Replace the list, keeping `totalCount` in step with rows added or removed. */
  const edit = (fn: (items: T[]) => T[]) =>
    set((s) => {
      const items = fn([...s.items]);
      return { items, totalCount: Math.max(0, s.totalCount + items.length - s.items.length) };
    });

  /** Join the item's queue now; `job` runs after the item's earlier mutations settle. */
  const enqueue = <R>(key: string, job: () => Promise<R>): Promise<R> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.then(job, job);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  };

  /** Never an unhandled rejection: a host may ignore the promise and use `onFeedback`. */
  const quiet = <R>(p: Promise<R>): Promise<R> => {
    p.catch(() => {});
    return p;
  };

  interface Spec<R> {
    kind: MutationKind;
    itemId: string;
    /** The local effect, as a list transform (none for pessimistic). */
    overlay: (items: T[]) => T[];
    /** Take the local effect back. */
    rollback: () => void;
    send: () => Promise<R>;
    /** Show the provider's answer. */
    answer: (r: R) => void;
  }

  function run<R>(spec: Spec<R>, mode: MutationMode): Promise<R | undefined> {
    const id = `m${++mutationSeq}`;
    const mutation = (status: PendingMutation['status'], error?: unknown): PendingMutation => ({
      id,
      kind: spec.kind,
      itemId: spec.itemId,
      status,
      ...(error === undefined ? {} : { error }),
    });
    const local = mode !== 'pessimistic';

    const fail = (error: unknown) => {
      if (local) {
        overlays.delete(id);
        spec.rollback();
      }
      setPending(mutation('failed', error), id);
      feedback({
        kind: 'failed',
        mutation: mutation('failed', error),
        error,
        retry: async () => {
          setPending(null, id);
          await run(spec, mode === 'undoable' ? 'optimistic' : mode);
        },
      });
    };
    const send = async (): Promise<R> => {
      setPending(mutation('pending'), id);
      try {
        const r = await spec.send();
        overlays.delete(id);
        spec.answer(r);
        setPending(null, id);
        feedback({ kind: 'committed', mutation: mutation('pending') });
        return r;
      } catch (error) {
        fail(error);
        throw error;
      }
    };

    if (local) {
      overlays.set(id, spec.overlay);
      edit(spec.overlay);
    }
    if (mode !== 'undoable') {
      setPending(mutation('pending'), id);
      return quiet(enqueue(spec.itemId, send));
    }

    // undoable: hold the item's queue place now; send when the window ends (or on flush).
    const seconds = typeof undoSeconds === 'function' ? undoSeconds(spec.kind, spec.itemId) : undoSeconds;
    setPending(mutation('scheduled'), id);
    let release!: () => void;
    let cancel!: () => void;
    const window = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
      cancel = () => resolve(false);
    });
    const timer = timers.setTimeout(() => windows.get(id)?.release(), seconds * 1000);
    windows.set(id, {
      itemId: spec.itemId,
      timer,
      release: () => {
        timers.clearTimeout(timer);
        windows.delete(id);
        release();
      },
      cancel: () => {
        timers.clearTimeout(timer);
        windows.delete(id);
        cancel();
      },
    });
    const undo = (): boolean => {
      const w = windows.get(id);
      if (!w) return false; // already sent: too late to undo
      w.cancel();
      overlays.delete(id);
      spec.rollback();
      setPending(null, id);
      feedback({ kind: 'undone', mutation: mutation('scheduled') });
      // Undoing a create also drops what was scheduled on the item it created.
      if (spec.kind === 'create') {
        for (const [mid, other] of [...windows]) if (other.itemId === spec.itemId) cancelScheduled(mid);
      }
      return true;
    };
    feedback({ kind: 'scheduled', mutation: mutation('scheduled'), seconds, undo });
    return quiet(enqueue(spec.itemId, async () => ((await window) ? send() : undefined)));
  }

  /** Cancel a scheduled mutation as if undone, without feedback (its item is gone). */
  function cancelScheduled(mid: string): void {
    windows.get(mid)?.cancel();
    overlays.delete(mid);
    setPending(null, mid);
  }

  // ---- precise local effects ---------------------------------------------------------------
  const indexOf = (items: T[], id: string) => items.findIndex((x) => idOf(x) === id);

  return {
    create(data, call = {}) {
      const mode = call.mode ?? defaultMode;
      const given = (data as Record<string, unknown>)[idField];
      const local = mode !== 'pessimistic';
      const item = (given == null && local ? { ...data, [idField]: newId() } : { ...data }) as T;
      // Key the queue by the item when it has an id, else by this call (unrelated creates run apart).
      const itemId = given == null && !local ? `(new:${++mutationSeq})` : idOf(item);
      return run<T>(
        {
          kind: 'create',
          itemId,
          overlay: (items) => (indexOf(items, itemId) === -1 ? [...items, item] : items),
          rollback: () => edit((items) => items.filter((x) => idOf(x) !== itemId)),
          send: () => provider.create(item),
          answer: (created) =>
            edit((items) => {
              // The provider may assign its own id: re-key our row rather than append a second one.
              const at = indexOf(items, local ? itemId : idOf(created));
              if (at === -1) return [...items, created];
              const out = [...items];
              out[at] = created;
              return out;
            }),
        },
        mode,
      );
    },

    update(id, data, call = {}) {
      const mode = call.mode ?? defaultMode;
      const keys = Object.keys(data) as (keyof T)[];
      /** The values before this update, for the fields it sets. */
      let previous: Partial<T> | undefined;
      const apply = (items: T[]) => {
        const at = indexOf(items, id);
        if (at === -1) return items;
        if (previous === undefined) previous = Object.fromEntries(keys.map((k) => [k, items[at]![k]])) as Partial<T>;
        const out = [...items];
        out[at] = { ...items[at]!, ...data };
        return out;
      };
      return run<T>(
        {
          kind: 'update',
          itemId: id,
          overlay: apply,
          rollback: () =>
            edit((items) => {
              const at = indexOf(items, id);
              if (at === -1 || !previous) return items; // never brings back a row that is gone
              const current = items[at]!;
              const restored = { ...current };
              // Only fields still holding this update's value: a later edit to the field survives.
              for (const k of keys) if (Object.is(current[k], data[k])) restored[k] = previous[k] as T[keyof T];
              const out = [...items];
              out[at] = restored;
              return out;
            }),
          send: () => provider.update(id, data),
          answer: (updated) =>
            edit((items) => {
              const at = indexOf(items, id);
              if (at === -1) return items;
              const out = [...items];
              out[at] = updated;
              return out;
            }),
        },
        mode,
      );
    },

    delete(id, call = {}) {
      const mode = call.mode ?? defaultMode;
      let removed: { item: T; before: string | undefined } | undefined;
      return run<void>(
        {
          kind: 'delete',
          itemId: id,
          overlay: (items) => {
            const at = indexOf(items, id);
            if (at === -1) return items;
            if (!removed) removed = { item: items[at]!, before: at > 0 ? idOf(items[at - 1]!) : undefined };
            return items.filter((_, i) => i !== at);
          },
          rollback: () =>
            edit((items) => {
              if (!removed || indexOf(items, id) !== -1) return items;
              // Back next to its old neighbour (an index would drift after other inserts).
              const after = removed.before === undefined ? -1 : indexOf(items, removed.before);
              const out = [...items];
              out.splice(after + 1, 0, removed.item);
              return out;
            }),
          send: () => provider.delete(id),
          answer: () => edit((items) => items.filter((x) => idOf(x) !== id)),
        },
        mode,
      ) as Promise<void>;
    },

    async flush() {
      const open = [...windows.values()];
      for (const w of open) w.release();
      await Promise.all([...chains.values()]);
    },

    dismiss(mutationId) {
      if (get().pending?.[mutationId]?.status === 'failed') setPending(null, mutationId);
    },

    cancelAll() {
      for (const mid of [...windows.keys()]) cancelScheduled(mid);
      set(() => ({ pending: {} }));
    },

    overlay(items) {
      let out = [...items];
      for (const f of overlays.values()) out = f(out);
      return out;
    },
  };
}
