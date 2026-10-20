/**
 * Framework-free logic behind tag widgets (tag input, chip filter, chip cell).
 *
 * Nothing here touches the DOM: it decides what a typed draft means (an allowed
 * option, a new value, a duplicate, a refusal), which options match a query, how
 * a `contains` filter value is read and written, and how suggestion requests are
 * paced (debounced, the previous one aborted, stale results dropped). Renderer
 * packages (`@zodal/ui-vanilla`, `@zodal/ui-shadcn`) draw their widgets over it,
 * so every renderer means the same thing by a tag and by a `contains` filter (zodal#31).
 */

import type { FilterCondition } from '@zodal/core';
import type { VocabularyOption } from './generators/form-config.js';
import type { Suggestion, SuggestionSource } from './registry/tester.js';

// ============================================================================
// Settings
// ============================================================================

/** The texts a tag widget shows or announces. Override any of them (i18n, tone). */
export interface TagMessages {
  added: (label: string) => string;
  removed: (label: string) => string;
  duplicate: (label: string) => string;
  notAllowed: (label: string) => string;
  /** Accessible name of a chip's remove button. */
  remove: (label: string) => string;
  /** Accessible name of the selected-values list. */
  selected: (fieldLabel: string) => string;
  /** Accessible name of the suggestion listbox. */
  suggestions: (fieldLabel: string) => string;
  loading: string;
  error: string;
  noMatches: string;
  /** Hint shown when the draft matches nothing but may be added as a new value. */
  pressEnterToAdd: (draft: string) => string;
  /** The overflow chip's accessible name: `n` hidden values, listed. */
  more: (n: number, labels: string) => string;
  /** The within-filter connective, said in words (OR within one field). */
  anyOf: string;
}

export const DEFAULT_TAG_MESSAGES: TagMessages = {
  added: (label) => `${label} added`,
  removed: (label) => `${label} removed`,
  duplicate: (label) => `${label} is already added`,
  notAllowed: (label) => `${label} is not one of the allowed values`,
  remove: (label) => `Remove ${label}`,
  selected: (fieldLabel) => `Selected ${fieldLabel}`,
  suggestions: (fieldLabel) => `${fieldLabel} suggestions`,
  loading: 'Loading suggestions…',
  error: 'Could not load suggestions',
  noMatches: 'No matches',
  pressEnterToAdd: (draft) => `Press Enter to add “${draft}”`,
  more: (n, labels) => `${n} more: ${labels}`,
  anyOf: 'is any of',
};

/** Tunables of the tag widgets; every widget factory takes a `Partial<TagSettings>`. */
export interface TagSettings {
  /** Wait this long after the last keystroke before asking `suggest`. */
  debounceMs: number;
  /** At most this many suggestions (passed to `suggest` and enforced on its result). */
  limit: number;
  /** A chip cell shows this many chips, then "+N". */
  maxVisibleChips: number;
  /** A chip filter shows every option as a toggle up to this many; above it, a type-ahead. */
  maxToggleOptions: number;
  messages: TagMessages;
}

export const DEFAULT_TAG_SETTINGS: TagSettings = {
  debounceMs: 200,
  limit: 10,
  maxVisibleChips: 3,
  // faceted-filter-ux: past ~15-20 values a flat list stops working; search within it.
  maxToggleOptions: 15,
  messages: DEFAULT_TAG_MESSAGES,
};

/** Merge partial settings (and partial messages) over the defaults. */
export function resolveTagSettings(settings: Partial<TagSettings> = {}): TagSettings {
  return {
    ...DEFAULT_TAG_SETTINGS,
    ...settings,
    messages: { ...DEFAULT_TAG_MESSAGES, ...settings.messages },
  };
}

// ============================================================================
// Values and options
// ============================================================================

/** A value as the schema stores it: a string, or `raw` of a numeric/boolean vocabulary. */
export type TagValue = string | number | boolean | bigint;

/** One choice a widget can offer: a vocabulary option or a suggestion. */
export type TagOption = VocabularyOption | Suggestion;

/** The string key a value is compared and keyed on (numbers stringified, as in `getVocabulary`). */
export function tagKey(value: unknown): string {
  return String(value);
}

/** Read a field value as a list: an array or a Set as is, nothing as empty, a scalar as one. */
export function toValueList(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return [...value];
  return [value];
}

/** The value to write back for an option: its `raw` when present, else its string value. */
export function optionRaw(option: TagOption): TagValue {
  const raw = (option as VocabularyOption).raw;
  return raw !== undefined ? raw : option.value;
}

/** The option a stored value corresponds to, if any. */
export function findOption(options: readonly TagOption[] | undefined, value: unknown): TagOption | undefined {
  if (!options) return undefined;
  const key = tagKey(value);
  return options.find((o) => o.value === key);
}

/** The label to show for a stored value. */
export function labelOf(options: readonly TagOption[] | undefined, value: unknown): string {
  return findOption(options, value)?.label ?? tagKey(value);
}

/** Options matching `query` (case-insensitive, label or value), minus the selected ones, at most `limit`. */
export function matchOptions(
  options: readonly TagOption[],
  query: string,
  selected: readonly unknown[],
  limit: number,
): TagOption[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(selected.map(tagKey));
  const out: TagOption[] = [];
  for (const o of options) {
    if (taken.has(o.value)) continue;
    if (q && !o.label.toLowerCase().includes(q) && !o.value.toLowerCase().includes(q)) continue;
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

/** What committing a draft would do. */
export type DraftResolution =
  | { ok: true; value: TagValue; label: string }
  | { ok: false; reason: 'empty' | 'duplicate' | 'notAllowed'; label: string };

/**
 * Decide what a typed draft means. An exact (case-insensitive) match on an
 * allowed choice's value or label commits that choice (its `raw`); anything else
 * is a new value, accepted only when `allowCreate` is true. A value already
 * selected is refused as a duplicate.
 */
export function resolveDraft(
  draft: string,
  {
    choices,
    allowCreate,
    selected,
  }: { choices: readonly TagOption[]; allowCreate: boolean; selected: readonly unknown[] },
): DraftResolution {
  const text = draft.trim();
  if (!text) return { ok: false, reason: 'empty', label: text };
  const lower = text.toLowerCase();
  const match = choices.find((o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower);
  const value: TagValue = match ? optionRaw(match) : text;
  const label = match ? match.label : text;
  if (!match && !allowCreate) return { ok: false, reason: 'notAllowed', label };
  if (selected.some((v) => tagKey(v) === tagKey(value))) return { ok: false, reason: 'duplicate', label };
  return { ok: true, value, label };
}

/** Commit a choice the user picked from a list (not typed). Refuses duplicates. */
export function resolveChoice(option: TagOption, selected: readonly unknown[]): DraftResolution {
  const value = optionRaw(option);
  if (selected.some((v) => tagKey(v) === tagKey(value))) {
    return { ok: false, reason: 'duplicate', label: option.label };
  }
  return { ok: true, value, label: option.label };
}

/** Split typed or pasted text into tags: commas and newlines separate, blanks are dropped. */
export function splitTags(text: string): string[] {
  return text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
}

/** A suggestion as a widget option, carrying the vocabulary's `raw` when the value is in it. */
export function suggestionToOption(s: Suggestion, options: readonly TagOption[] | undefined): TagOption {
  return findOption(options, s.value) ?? { value: s.value, label: s.label };
}

// ============================================================================
// The `contains` filter value
// ============================================================================

/**
 * The value a chip filter emits: a ready `FilterCondition` using
 * `arrayContainsAny`, or `undefined` when nothing is selected (no filter).
 *
 * Always `arrayContainsAny`, even for one value: it is the OR within one field
 * that faceted filters use, it equals `arrayContains` for a single value, and
 * one operator keeps the value's shape stable (an array) as chips are added and
 * removed, so state, URLs and backends never see it flip between a scalar and a list.
 *
 * A TanStack column filter (`arrIncludesSome`, what `toColumnDefs` sets for `contains`)
 * wants the bare array: pass `condition.value` to `setFilterValue`, not the condition.
 */
export function toContainsFilter(field: string, values: readonly unknown[]): FilterCondition | undefined {
  if (values.length === 0) return undefined;
  return { field, operator: 'arrayContainsAny', value: [...values] };
}

/**
 * Read a chip filter's current selection from whatever the app holds: the
 * `FilterCondition` it emitted (`arrayContainsAny` or `arrayContains`), a bare
 * array, or a single value.
 */
export function fromContainsFilter(value: unknown): unknown[] {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set) && 'operator' in value) {
    return toValueList((value as FilterCondition).value);
  }
  return toValueList(value);
}

// ============================================================================
// Suggestion pacing
// ============================================================================

/** What the suggestion list currently shows. */
export type SuggestionState =
  | { status: 'idle'; query: string; items: readonly Suggestion[] }
  | { status: 'loading'; query: string; items: readonly Suggestion[] }
  | { status: 'ready'; query: string; items: readonly Suggestion[] }
  | { status: 'error'; query: string; items: readonly Suggestion[]; error: unknown };

export interface SuggestionController {
  /** Ask for suggestions for `query`: debounced unless `immediate`; aborts the previous request. */
  request(query: string, options?: { immediate?: boolean }): void;
  /** Drop any pending or in-flight request; its result will be ignored. */
  cancel(): void;
}

/**
 * Pace calls to a `SuggestionSource`. Each `request` switches the state to
 * `loading` at once (the old list is cleared, never left showing for a new
 * query), waits `debounceMs`, aborts the previous request's `AbortSignal`, and
 * calls `suggest(query, field, { signal, limit })`. A result that arrives after
 * a newer request started is ignored even if the source ignored the signal.
 */
export function createSuggestionController({
  suggest,
  field,
  debounceMs,
  limit,
  onUpdate,
}: {
  suggest: SuggestionSource;
  field: string;
  debounceMs: number;
  limit: number;
  onUpdate: (state: SuggestionState) => void;
}): SuggestionController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;
  let seq = 0;

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    inflight?.abort();
    inflight = undefined;
  };

  return {
    request(query, { immediate = false } = {}) {
      stop();
      const id = ++seq;
      onUpdate({ status: 'loading', query, items: [] });
      const run = async () => {
        timer = undefined;
        const controller = new AbortController();
        inflight = controller;
        const isStale = () => id !== seq || controller.signal.aborted;
        try {
          const result = await suggest(query, field, { signal: controller.signal, limit });
          if (isStale()) return;
          onUpdate({ status: 'ready', query, items: (result ?? []).slice(0, limit) });
        } catch (error) {
          if (isStale()) return;
          onUpdate({ status: 'error', query, items: [], error });
        }
      };
      if (immediate || debounceMs <= 0) void run();
      else timer = setTimeout(run, debounceMs);
    },
    cancel() {
      seq++;
      stop();
    },
  };
}
