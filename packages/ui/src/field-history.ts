/**
 * Field input history and sticky fields, on the form side: what a form does when it is used and
 * when it starts a new item.
 *
 * - {@link recordUse}: when the form is used (a submit, a Generate), remember every history
 *   field's value (reason `'submit'`), the browser's and the shell's rule.
 * - {@link startNewItem}: when the form starts over (an explicit New, a new source item), sticky
 *   fields keep their values and the others go back to their defaults, after every non-sticky
 *   history field's value has been remembered (reason `'reset'`), so starting over never loses
 *   typing. It returns the previous values for an Undo.
 *
 * Both are pure over plain values, so any host form library (react-hook-form's `reset(values)`,
 * a zustand store, the vanilla DOM) can use them. The history store is typed structurally
 * ({@link FieldHistoryStore}, the same shape `@zodal/store`'s `createFieldHistory` returns), so
 * this package never imports the store. Design: `docs/research/field-input-history.md` §5, §6.3.
 */

import type { FormFieldConfig } from './generators/form-config.js';

/** One remembered value of one history scope (the shape of `@zodal/store`'s `HistoryEntry`). */
export interface HistoryEntry {
  id: string;
  /** The history it belongs to (`FieldHistorySpec.scope`). */
  scope: string;
  value: string;
  /** When it was last recorded or picked, ms since the epoch. */
  at: number;
  /** How many times it was recorded or picked. */
  uses: number;
  pinned?: boolean;
}

/** Why a value is recorded: it was used, it was saved before a reset, or a pick replaced it. */
export type HistoryReason = 'submit' | 'reset' | 'pick';

/**
 * What forms and renderers need from a history: the shape `@zodal/store`'s `createFieldHistory`
 * returns, declared here structurally so `@zodal/ui` and renderer packages never import the store.
 */
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
  /**
   * Be told when a scope changes (`undefined`: any scope may have), so a history button can appear
   * after a `recordUse` made elsewhere. Returns the unsubscribe. Optional: a store without it is
   * read again only when its UI writes to it.
   */
  subscribe?(listener: (scope: string | undefined) => void): () => void;
}

/** The fields {@link startNewItem} and {@link recordUse} read from a form field config. */
export type HistoryFieldConfig = Pick<FormFieldConfig, 'name' | 'sticky' | 'history' | 'defaultValue'>;

/** A value worth remembering: a string with something in it besides whitespace. */
function recordable(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Record each listed field's value, one after another (two fields may share a scope). */
async function recordFields(
  fields: readonly HistoryFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  history: FieldHistoryStore,
  reason: HistoryReason,
): Promise<void> {
  for (const field of fields) {
    const value = values[field.name];
    if (field.history && recordable(value)) {
      await history.record(field.history.scope, value, { reason, max: field.history.max });
    }
  }
}

/**
 * The values a form starts its next item with: sticky fields keep theirs; the others go back to
 * their `defaultValue` (`undefined` when they have none, so the key is present and a shallow
 * merge clears it). Before anything is cleared, every non-sticky field with history and a
 * non-empty string value is recorded (reason `'reset'`), so starting over never loses typing;
 * if recording fails the promise rejects and nothing should be cleared.
 *
 * Keys of `values` that are not form fields are kept as they are. `previous` holds the reset
 * fields' values before the reset (only those), so `{ ...current, ...previous }` is the Undo.
 *
 * @example
 * ```typescript
 * const { values: next, previous } = await startNewItem(fields, form.getValues(), { history });
 * form.reset(next);
 * showUndo('Started a new piece', () => form.reset({ ...form.getValues(), ...previous }));
 * ```
 */
export async function startNewItem(
  fields: readonly HistoryFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options: { history?: FieldHistoryStore } = {},
): Promise<{ values: Record<string, unknown>; previous: Record<string, unknown> }> {
  const reset = fields.filter((f) => !f.sticky);
  if (options.history) await recordFields(reset, values, options.history, 'reset');
  const next: Record<string, unknown> = { ...values };
  const previous: Record<string, unknown> = {};
  for (const field of reset) {
    previous[field.name] = values[field.name];
    next[field.name] = field.defaultValue;
  }
  return { values: next, previous };
}

/**
 * Record every history field's current value (reason `'submit'`), sticky or not. Call it when
 * the form is used (a submit, a Generate): a value someone committed to is the one worth
 * offering back. Fields without history, and empty or non-string values, are skipped.
 */
export async function recordUse(
  fields: readonly HistoryFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options: { history: FieldHistoryStore },
): Promise<void> {
  await recordFields(fields, values, options.history, 'submit');
}
