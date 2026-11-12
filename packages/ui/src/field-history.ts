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

import type { FieldHistoryStore, HistoryReason } from '@zodal/core';
import type { FormFieldConfig } from './generators/form-config.js';

export type { FieldHistoryStore, HistoryEntry, HistoryReason } from '@zodal/core';

/** The fields {@link startNewItem} and {@link recordUse} read from a form field config. */
export type HistoryFieldConfig = Pick<FormFieldConfig, 'name' | 'sticky' | 'history' | 'defaultValue'> &
  Partial<Pick<FormFieldConfig, 'type'>> & { secret?: boolean };

/** A value worth remembering: a string with something in it besides whitespace. */
function recordable(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Never remember a secret, even from a hand-built config that slipped past the generators' refusal. */
function remembers(field: HistoryFieldConfig): boolean {
  return Boolean(field.history) && !field.secret && field.type !== 'password';
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
    if (field.history && remembers(field) && recordable(value)) {
      await history.record(field.history.scope, value, { reason, max: field.history.max });
    }
  }
}

/** A default value as a fresh copy, so a reset never shares an array or object with the config. */
function freshDefault(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

/** What {@link startNewItem} resolves with. */
export interface NewItemValues {
  /** The next item's values: one key per field (sticky ones kept, the others at their default). */
  values: Record<string, unknown>;
  /**
   * Only the reset fields, at their defaults: apply it over the form's values as they are when
   * the promise resolves (`{ ...current, ...reset }`), so text typed while history was being
   * written is not overwritten by the snapshot `values` was built from.
   */
  reset: Record<string, unknown>;
  /** The reset fields' values before the reset (only those): `{ ...current, ...previous }` is the Undo. */
  previous: Record<string, unknown>;
}

/**
 * The values a form starts its next item with: sticky fields keep theirs; the others go back to
 * their `defaultValue` (`undefined` when they have none, so the key is present and a shallow
 * merge clears it). Before anything is cleared, every non-sticky field with history and a
 * non-empty string value is recorded (reason `'reset'`), so starting over never loses typing;
 * if recording fails the promise rejects and nothing should be cleared.
 *
 * `values` holds the form's fields only: keys of the old item that are not form fields (its id,
 * its timestamps) are left out, so a new item never inherits the old one's identity.
 *
 * @example
 * ```typescript
 * const { reset, previous } = await startNewItem(fields, form.getValues(), { history });
 * form.reset({ ...form.getValues(), ...reset });
 * showUndo('Started a new piece', () => form.reset({ ...form.getValues(), ...previous }));
 * ```
 */
export async function startNewItem(
  fields: readonly HistoryFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options: { history?: FieldHistoryStore } = {},
): Promise<NewItemValues> {
  const resetFields = fields.filter((f) => !f.sticky);
  if (options.history) await recordFields(resetFields, values, options.history, 'reset');
  const next: Record<string, unknown> = {};
  const reset: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.sticky) {
      next[field.name] = values[field.name];
    } else {
      previous[field.name] = values[field.name];
      next[field.name] = reset[field.name] = freshDefault(field.defaultValue);
    }
  }
  return { values: next, reset, previous };
}

/**
 * Record every history field's current value (reason `'submit'`), sticky or not. Call it when
 * the form is used (a submit, a Generate): a value someone committed to is the one worth
 * offering back. Fields without history, secret or password fields, and empty or non-string
 * values are skipped. Top-level fields only: an options form's fieldset members are not walked.
 */
export async function recordUse(
  fields: readonly HistoryFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options: { history: FieldHistoryStore },
): Promise<void> {
  await recordFields(fields, values, options.history, 'submit');
}

// ============================================================================
// What every renderer package draws the same way (shadcn, vanilla, an app's own)
// ============================================================================

/** Above this many entries a history list shows a filter (APG recommends type-ahead above 7). */
export const HISTORY_FILTER_THRESHOLD = 7;

/** How long "History cleared. Undo" stays offered, in ms. */
export const HISTORY_UNDO_MS = 10_000;

/**
 * How a value reads in one history row: its first non-empty line (trimmed), and how many more
 * lines it has (`extraLines`, 0 for a one-line value), for "first line +N lines".
 */
export function historyLine(value: string): { first: string; extraLines: number } {
  const lines = value.split(/\r\n|\r|\n/);
  const first = lines.find((l) => l.trim() !== '') ?? '';
  return { first: first.trim(), extraLines: lines.length - 1 };
}

/** A compact relative time for a history row: "just now", "5 min ago", "2 h ago", "3 d ago", else the date. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * The history side of picking an entry: record the field's current value (reason `'pick'`, so the
 * pick loses nothing), then the picked value (so it moves to the top). Resolves with the value to
 * put in the field; rejects, before anything should be replaced, when recording fails.
 */
export async function pickHistoryEntry(
  history: FieldHistoryStore,
  field: { scope: string; max?: number },
  current: unknown,
  entry: { value: string },
): Promise<string> {
  const options = { reason: 'pick' as const, ...(field.max !== undefined ? { max: field.max } : {}) };
  const typed = typeof current === 'string' ? current.trim() : '';
  if (typed && typed !== entry.value) await history.record(field.scope, typed, options);
  await history.record(field.scope, entry.value, options);
  return entry.value;
}
