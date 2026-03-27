/**
 * Renderer Registry: Ranked Tester Pattern.
 *
 * Inspired by JSON Forms' tester-based registry with Zod-native predicates
 * and named priority bands.
 */

import type { ResolvedFieldAffordance } from '@zodal/core';

// ============================================================================
// Priority Bands
// ============================================================================

/** Named priority bands for renderer testers. */
export const PRIORITY = {
  /** Generic fallbacks (e.g., render any unknown as text) */
  FALLBACK: 1,
  /** Type-based defaults (string → TextInput) */
  DEFAULT: 10,
  /** Library-provided specialized renderers (email → EmailInput) */
  LIBRARY: 50,
  /** App-level overrides */
  APP: 100,
  /** Explicit .meta({ editWidget: '...' }) overrides */
  OVERRIDE: 200,
} as const;

// ============================================================================
// Types
// ============================================================================

/** Context passed to renderer testers. */
export interface RendererContext {
  /** The render mode: 'cell' for table cells, 'form' for form fields, 'filter' for filter widgets. */
  mode: 'cell' | 'form' | 'filter';
  /** Additional context from the consumer. */
  [key: string]: unknown;
}

/**
 * A tester function: returns a priority score (> 0 means match) or -1 (no match).
 * Higher score wins.
 */
export type RendererTester = (
  field: ResolvedFieldAffordance,
  context: RendererContext,
) => number;

/** A registry entry pairing a tester with a renderer. */
export interface RendererEntry<TComponent = unknown> {
  tester: RendererTester;
  renderer: TComponent;
  /** Optional name for debugging. */
  name?: string;
}

// ============================================================================
// Composable Predicates
// ============================================================================

/** Match fields with specific Zod types. Returns DEFAULT priority on match. */
export function zodTypeIs(...types: string[]): RendererTester {
  return (field) => types.includes(field.zodType) ? PRIORITY.DEFAULT : -1;
}

/** Match fields that have a specific Zod refinement. Returns LIBRARY priority on match. */
export function hasRefinement(kind: string): RendererTester {
  return (field) => {
    const def = (field.zodDef as any);
    if (def?.checks?.some?.((c: any) => c.kind === kind)) return PRIORITY.LIBRARY;
    if (def?.format === kind) return PRIORITY.LIBRARY;
    return -1;
  };
}

/** Match fields whose name matches a pattern. Returns LIBRARY priority on match. */
export function fieldNameMatches(pattern: RegExp): RendererTester {
  return (field) => {
    // The field name is typically in the trace or can be inferred
    // For now, check if the title (derived from name) matches
    const name = (field as any).fieldName ?? '';
    return pattern.test(name) ? PRIORITY.LIBRARY : -1;
  };
}

/** Match fields whose metadata matches a predicate. Returns APP priority on match. */
export function metaMatches(
  predicate: (field: ResolvedFieldAffordance) => boolean,
): RendererTester {
  return (field) => predicate(field) ? PRIORITY.APP : -1;
}

/** Match fields with a specific editWidget value. Returns OVERRIDE priority on match. */
export function editWidgetIs(widget: string): RendererTester {
  return (field) => {
    return (field as any).editWidget === widget ? PRIORITY.OVERRIDE : -1;
  };
}

/**
 * Combine testers with AND logic. Sums individual scores on match.
 * Returns -1 if any tester returns -1.
 */
export function and(...testers: RendererTester[]): RendererTester {
  return (field, context) => {
    let totalScore = 0;
    for (const tester of testers) {
      const score = tester(field, context);
      if (score < 0) return -1;
      totalScore += score;
    }
    return totalScore;
  };
}

/**
 * Combine testers with OR logic. Returns the highest score among matches.
 * Returns -1 if all testers return -1.
 */
export function or(...testers: RendererTester[]): RendererTester {
  return (field, context) => {
    let maxScore = -1;
    for (const tester of testers) {
      const score = tester(field, context);
      if (score > maxScore) maxScore = score;
    }
    return maxScore;
  };
}
