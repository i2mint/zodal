/**
 * Operation semantics that renderers and hosts read from an `OperationDefinition`, decided in
 * one place: for now, how long an undoable operation offers Undo.
 */

import type { OperationDefinition } from './types.js';

/**
 * Refuse an `undoable` that is not `true`, `false` or exactly `{ seconds: <positive number> }`,
 * naming the operation. `defineCollection` and {@link undoSeconds} call it, so a wrong value
 * fails wherever it is first used.
 */
export function checkUndoable({ name, undoable }: Pick<OperationDefinition, 'name' | 'undoable'>): void {
  if (undoable === undefined || typeof undoable === 'boolean') return;
  const isObject = typeof undoable === 'object' && undoable !== null;
  const seconds = isObject ? (undoable as { seconds?: unknown }).seconds : undefined;
  const extra = isObject ? Object.keys(undoable).filter((k) => k !== 'seconds') : [];
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && extra.length === 0) return;
  const got = !isObject ? `${typeof undoable} ${String(undoable)}`
    : extra.length ? `unknown key(s) ${extra.join(', ')}` : `seconds ${String(seconds)}`;
  throw new Error(`operation "${name}" has an invalid undoable (${got}); use true, false or { seconds: <a positive number> }.`);
}

/**
 * How many seconds to offer Undo after the operation runs, or `undefined` when it cannot be
 * undone: its own `{ seconds }`, else, for `undoable: true`, the renderer set's `defaultSeconds`
 * (the one place that default is chosen). Throws on an invalid `undoable` or `defaultSeconds`.
 */
export function undoSeconds(
  operation: Pick<OperationDefinition, 'name' | 'undoable'>,
  { defaultSeconds }: { defaultSeconds: number },
): number | undefined {
  checkUndoable(operation);
  if (!(Number.isFinite(defaultSeconds) && defaultSeconds > 0)) {
    throw new Error(`undoSeconds: defaultSeconds must be a positive number, got ${String(defaultSeconds)}`);
  }
  const { undoable } = operation;
  if (!undoable) return undefined;
  return undoable === true ? defaultSeconds : undoable.seconds;
}
