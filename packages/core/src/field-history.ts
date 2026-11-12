/**
 * Field input history: the shared rules behind the `history` affordance.
 *
 * `FieldAffordance.history` (`true` or a {@link FieldHistorySpec}) asks for a field's past values
 * to be remembered and offered back. This module holds the one default cap and the one place a
 * declared spec is checked and resolved, so `defineCollection`, `@zodal/ui`'s form generators and
 * `@zodal/store`'s `createFieldHistory` agree. Design: `docs/research/field-input-history.md` §6.
 */

import type { FieldHistorySpec, ResolvedFieldHistory } from './types.js';

/** Most unpinned entries a history scope keeps when nothing says otherwise. */
export const DEFAULT_HISTORY_MAX = 50;

/**
 * Check a declared `history` affordance and resolve it: `undefined` when the field has no
 * history (`undefined` or `false`), else its cap and scope with the defaults filled in (the
 * scope defaults to `key`). Throws an error naming `key` for any other shape, a cap that is not
 * a positive integer, or an empty scope.
 *
 * @example
 * resolveFieldHistory('lyrics', true);                  // { max: 50, scope: 'lyrics' }
 * resolveFieldHistory('styles', { scope: 'style' });    // { max: 50, scope: 'style' }
 * resolveFieldHistory('title', false);                  // undefined
 */
export function resolveFieldHistory(key: string, history: unknown): ResolvedFieldHistory | undefined {
  if (history === undefined || history === false) return undefined;
  if (history === true) return { max: DEFAULT_HISTORY_MAX, scope: key };
  if (typeof history !== 'object' || history === null || Array.isArray(history)) {
    throw new TypeError(`field "${key}": history must be a boolean or { max?, scope? }, got ${JSON.stringify(history)}`);
  }
  const { max = DEFAULT_HISTORY_MAX, scope = key } = history as FieldHistorySpec;
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`field "${key}": history.max must be a positive integer, got ${JSON.stringify(max)}`);
  }
  if (typeof scope !== 'string' || scope === '') {
    throw new TypeError(`field "${key}": history.scope must be a non-empty string, got ${JSON.stringify(scope)}`);
  }
  return { max, scope };
}

/**
 * The inferred `sticky` default: free text (a string that is not a closed choice) starts over
 * with each new item; every other value (a number, a boolean, a closed choice, a date) is a
 * setting and carries over.
 */
export function inferSticky(zodType: string, isClosedChoice: boolean): boolean {
  return !(zodType === 'string' && !isClosedChoice);
}
