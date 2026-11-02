/**
 * Renderer sets: a registry factory with options.
 *
 * Behaviour shared by every control of a set (a minimum target size, a tap guard, a lockout
 * after an action, an Undo window) is the set's, not each screen's: it goes in the factory's
 * options, `createXRegistry(options?)`, keyword options that all have defaults. The renderers
 * close over the resolved options when the set builds its entries. What changes per render
 * (the app's state, a suggestion source) stays in `RendererContext`.
 */

import type { ResolvedFieldAffordance } from '@zodal/core';
import { createRendererRegistry, type RendererRegistry } from './registry.js';
import type { RendererEntry } from './tester.js';

/** What {@link defineRendererSet} builds a set from. */
export interface RendererSetDefinition<O extends object, C, S = ResolvedFieldAffordance> {
  /** Every option, with its default: a set works with no options at all. */
  defaults: Readonly<O>;
  /** The set's entries, built with the resolved options (renderers close over them). */
  entries: (options: Readonly<O>) => readonly RendererEntry<C, S>[];
}

/** A registry built by a renderer set, with the options it was built with. */
export type RendererSet<O extends object, C, S = ResolvedFieldAffordance> = RendererRegistry<C, S> & {
  readonly options: Readonly<O>;
};

/**
 * The `createXRegistry(options?)` of a renderer set: each call resolves `options` over the
 * set's `defaults` (an `undefined` value keeps the default), builds the entries with them and
 * returns the registry, which also exposes the resolved `options`. An option the set does not
 * define is refused, naming it, so a misspelt option fails where it is passed.
 *
 * @example
 * ```ts
 * export const createTremorRegistry = defineRendererSet({
 *   defaults: { minTargetPx: 64, tapGuardMs: 450 },
 *   entries: (o) => [{ tester: closedChoice(), renderer: tiles(o), name: 'TileChoice' }],
 * });
 * const registry = createTremorRegistry({ tapGuardMs: 600 });
 * ```
 */
export function defineRendererSet<O extends object, C, S = ResolvedFieldAffordance>(
  definition: RendererSetDefinition<O, C, S>,
): (options?: Partial<O>) => RendererSet<O, C, S> {
  const known = new Set(Object.keys(definition.defaults));
  return (options = {}) => {
    const unknown = Object.keys(options).filter((k) => !known.has(k));
    if (unknown.length) {
      throw new Error(`Unknown renderer-set option(s) ${unknown.join(', ')}; this set takes: ${[...known].join(', ') || 'none'}.`);
    }
    const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
    const resolved = Object.freeze({ ...definition.defaults, ...given }) as Readonly<O>;
    const registry = createRendererRegistry<C, S>();
    for (const entry of definition.entries(resolved)) registry.register(entry);
    return Object.assign(registry, { options: resolved });
  };
}
