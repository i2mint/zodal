/**
 * Renderer Registry: Resolution and debugging.
 *
 * The registry is user-supplied (not global) to avoid singleton conflicts.
 */

import type { ResolvedFieldAffordance } from '@zodal/core';
import type { RendererEntry, RendererTester, RendererContext } from './tester.js';

// ============================================================================
// Registry Interface
// ============================================================================

export interface RendererRegistry<TComponent = unknown> {
  /** All registered entries. */
  readonly entries: ReadonlyArray<RendererEntry<TComponent>>;

  /** Register a new renderer entry. */
  register(entry: RendererEntry<TComponent>): void;

  /** Find the highest-scoring renderer for a field. Returns null if no match. */
  resolve(field: ResolvedFieldAffordance, context: RendererContext): TComponent | null;

  /** Debug: show all testers and their scores for a field. */
  explain(
    field: ResolvedFieldAffordance,
    context: RendererContext,
  ): Array<{ renderer: TComponent; score: number; name?: string }>;
}

// ============================================================================
// createRendererRegistry
// ============================================================================

/**
 * Create a new renderer registry.
 *
 * The registry resolves renderers by running all testers against a field
 * and returning the renderer with the highest score.
 *
 * @example
 * ```typescript
 * const registry = createRendererRegistry<React.ComponentType>();
 *
 * registry.register({
 *   tester: zodTypeIs('string'),
 *   renderer: TextInput,
 *   name: 'TextInput',
 * });
 *
 * registry.register({
 *   tester: and(zodTypeIs('string'), hasRefinement('email')),
 *   renderer: EmailInput,
 *   name: 'EmailInput',
 * });
 *
 * const Component = registry.resolve(field, { mode: 'form' });
 * ```
 */
export function createRendererRegistry<TComponent = unknown>(): RendererRegistry<TComponent> {
  const entries: RendererEntry<TComponent>[] = [];

  return {
    get entries() {
      return entries as ReadonlyArray<RendererEntry<TComponent>>;
    },

    register(entry: RendererEntry<TComponent>) {
      entries.push(entry);
    },

    resolve(field: ResolvedFieldAffordance, context: RendererContext): TComponent | null {
      let bestScore = -1;
      let bestRenderer: TComponent | null = null;

      for (const entry of entries) {
        const score = entry.tester(field, context);
        if (score > bestScore) {
          bestScore = score;
          bestRenderer = entry.renderer;
        }
      }

      return bestRenderer;
    },

    explain(
      field: ResolvedFieldAffordance,
      context: RendererContext,
    ): Array<{ renderer: TComponent; score: number; name?: string }> {
      return entries
        .map((entry) => ({
          renderer: entry.renderer,
          score: entry.tester(field, context),
          name: entry.name,
        }))
        .sort((a, b) => b.score - a.score);
    },
  };
}
