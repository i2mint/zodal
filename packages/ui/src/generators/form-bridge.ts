/**
 * Form-renderer bridge: what a renderer needs next to `toFormConfig` to resolve and drive
 * a form field, shared so each renderer package does not copy it.
 */

import type { ResolvedFieldAffordance } from '@zodal/core';
import type { FormFieldConfig } from './form-config.js';
import { optionRaw } from '../tag-logic.js';

/**
 * The field affordance to resolve a form field's renderer with:
 * `registry.resolve(formFieldAffordance(fa, config), { mode: 'form' })`.
 *
 * `toFormConfig` decides the widget (closed choice, file, ...) and puts it in `config.type`;
 * this carries it across as `editWidget`, the way `toOptionsFormConfig` fields do.
 */
export function formFieldAffordance(
  affordance: ResolvedFieldAffordance,
  config: Pick<FormFieldConfig, 'type'>,
): ResolvedFieldAffordance {
  return { ...affordance, editWidget: config.type };
}

/**
 * The value to write back when a select (or radio) widget reports the option `selected`
 * (its string `value`; `''` is the placeholder). A numeric or boolean choice yields its
 * `raw`, a bigint choice `BigInt(value)`, a string choice the string; the placeholder
 * yields `undefined` for an optional field (clearing means no value) and `''` for a required one.
 * A value that is not an option (stale) yields `undefined`. Known limits: a nullable field is cleared to
 * `undefined`, not `null`, and an option whose value is `''` cannot be told from the placeholder.
 */
export function selectedValue(config: Pick<FormFieldConfig, 'options' | 'required'>, selected: string): unknown {
  const option = config.options?.find((o) => o.value === selected);
  if (option) return optionRaw(option);
  return selected === '' && config.required ? '' : undefined;
}

/**
 * The option key (the string `value` a select or radio widget keys on) of `value`, the
 * field's current value: the inverse of `selectedValue`. An option matches only when its
 * schema value is `value` itself (`4` matches option `'4'` of a numeric choice, the string
 * `'4'` does not), so a value of the wrong type is not shown as chosen.
 * No value, or a value that is not an option (stale), yields `''`, the placeholder.
 * Known limits, as for `selectedValue`: an option whose value is `''` cannot be told from the
 * placeholder, and a choice `1 | '1'` keeps one option (`1`), so `'1'` shows as the placeholder.
 * Tags widgets key their chips with the tag helpers (`tagKey`, `findOption`, `resolveChoice`).
 */
export function optionKey(config: Pick<FormFieldConfig, 'options'>, value: unknown): string {
  return config.options?.find((o) => optionRaw(o) === value)?.value ?? '';
}
