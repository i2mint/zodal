/**
 * Renderer Registry: Ranked Tester Pattern.
 *
 * Inspired by JSON Forms' tester-based registry with Zod-native predicates
 * and named priority bands.
 */

import type { ChoiceArity, OperationCommandResult, OperationDefinition, OperationScope, ResolvedFieldAffordance } from '@zodal/core';

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
  /**
   * The render mode: 'cell' for table cells, 'form' for form fields, 'filter' for filter widgets,
   * 'operation' for an operation's control (a button, a menu item; see {@link OperationRenderProps}).
   */
  mode: 'cell' | 'form' | 'filter' | 'operation';
  /**
   * Where a tag-like widget (a `'tags'` form field, a `contains` filter) gets its
   * suggestions: the values already used in the collection, a zodal-groups
   * vocabulary, a server endpoint. Injected by the app, so no renderer imports a
   * store. Absent: the widget offers the field's `options`, or free text.
   * Testers may read it as a hint (a source exists: prefer a combobox); the
   * component receives it through {@link FieldRenderProps.context}.
   */
  suggest?: SuggestionSource;
  /** Additional context from the consumer. */
  [key: string]: unknown;
}

/** One suggestion offered by a tag-like widget. */
export interface Suggestion {
  value: string;
  label: string;
}

/** Options for one suggestion request. */
export interface SuggestOptions {
  /** Aborted when the user keeps typing: drop the stale request. */
  signal?: AbortSignal;
  /** At most this many suggestions. */
  limit?: number;
}

/**
 * Suggestions for `query` (what the user typed so far) in the field named
 * `field`. Values are strings (a numeric vocabulary is stringified, as in
 * `getVocabulary`).
 */
export type SuggestionSource = (
  query: string,
  field: string,
  options?: SuggestOptions,
) => readonly Suggestion[] | Promise<readonly Suggestion[]>;

/**
 * How a field component reads and writes its value. Renderers may read `value`
 * lazily (a host can pass a getter), which a DOM renderer needs to stay mounted
 * across changes instead of being rebuilt on every keystroke.
 */
export interface FieldBinding<V = unknown> {
  value: V;
  onChange: (value: V) => void;
  /** The field's name (also what `context.suggest` is asked about). */
  name?: string;
  onBlur?: () => void;
  /** A host form library's ref callback, when it wants the element. */
  ref?: (element: unknown) => void;
}

/**
 * What a field component (form or filter) receives: its value binding, its
 * generated config, the render context (including `suggest`), and the field's
 * resolved affordance. This is the shape renderer packages have always used for
 * `field` (the binding); the affordance travels beside it. Optional so far:
 * everything but `field` and `config`; a renderer needing the affordance falls
 * back to `config`.
 */
export interface FieldRenderProps<C = unknown, V = unknown> {
  field: FieldBinding<V>;
  config: C;
  context?: RendererContext;
  affordance?: ResolvedFieldAffordance;
  /** A validation message to show (a host form library maps its field state here). */
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Aborted when the component is unmounted or replaced: cancel pending work (suggestions...). */
  signal?: AbortSignal;
}

/** A filter component's props: its value may be `undefined` (the filter cleared). */
export type FilterFieldProps<C = unknown, V = unknown> = FieldRenderProps<C, V | undefined>;

/**
 * A tester function: returns a priority score (> 0 means match) or -1 (no match).
 * Higher score wins.
 */
export type RendererTester<TSubject = ResolvedFieldAffordance> = (
  subject: TSubject,
  context: RendererContext,
) => number;

/**
 * A registry entry pairing a tester with a renderer. `TSubject` is what the registry resolves
 * for: a field (the default) or an `OperationDefinition` (an operation registry).
 */
export interface RendererEntry<TComponent = unknown, TSubject = ResolvedFieldAffordance> {
  tester: RendererTester<TSubject>;
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

/** `editWidget` values that still mean "pick from the vocabulary" (anything else is the user opting out of it). */
const CHOICE_WIDGETS: ReadonlySet<string> = new Set(['select', 'multiselect', 'tags']);

/**
 * Match closed-choice fields (an enum, a literal, a union of literals; see
 * `ResolvedFieldAffordance.choice`) of the given arity, `'single'` by default (a select);
 * pass `'multi'` for an array or set of them (tags). A field whose `editWidget` names a
 * non-choice widget (`'text'`) is not matched. Returns DEFAULT priority on match.
 */
export function closedChoice(arity: ChoiceArity = 'single'): RendererTester {
  return (field) => {
    const widget = field.editWidget;
    const widgetOk = widget === undefined || (typeof widget === 'string' && CHOICE_WIDGETS.has(widget));
    return field.choice === arity && widgetOk ? PRIORITY.DEFAULT : -1;
  };
}

/** Match fields with a specific editWidget value. Returns OVERRIDE priority on match. */
export function editWidgetIs(widget: string): RendererTester {
  return (field) => {
    return (field as any).editWidget === widget ? PRIORITY.OVERRIDE : -1;
  };
}

/**
 * Match fields whose filter widget is `widget`, in filter mode only: `filterWidget`, else
 * `editWidget` (one field can be a `'slider'` in forms and a `'range-slider'` in filters).
 * Returns OVERRIDE priority on match.
 */
export function filterWidgetIs(widget: string): RendererTester {
  return (field, context) =>
    context.mode === 'filter' && (field.filterWidget ?? field.editWidget) === widget ? PRIORITY.OVERRIDE : -1;
}

/** Match fields with a specific storage role. Returns LIBRARY priority on match. */
export function storageRoleIs(role: 'metadata' | 'content'): RendererTester {
  return (field) =>
    (field as any).storageRole === role ? PRIORITY.LIBRARY : -1;
}

/**
 * Combine testers with AND logic. Sums individual scores on match.
 * Returns -1 if any tester returns -1.
 */
export function and<S = ResolvedFieldAffordance>(...testers: RendererTester<S>[]): RendererTester<S> {
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
export function or<S = ResolvedFieldAffordance>(...testers: RendererTester<S>[]): RendererTester<S> {
  return (field, context) => {
    let maxScore = -1;
    for (const tester of testers) {
      const score = tester(field, context);
      if (score > maxScore) maxScore = score;
    }
    return maxScore;
  };
}

// ============================================================================
// Operations
// ============================================================================

/**
 * What an operation's component (a button, a menu item) receives, resolved from an operation
 * registry: `createRendererRegistry<Component, OperationDefinition>()`, then
 * `registry.resolve(operation, { mode: 'operation' })`. The component shows whatever
 * `operation.confirm` asks for before calling `dispatch`.
 */
export interface OperationRenderProps<TParams = unknown, TResult = unknown> {
  operation: OperationDefinition<TParams>;
  /**
   * Run the operation: the host binds it to the operation's command, so it returns that
   * command's result (`ok(value)` or `fail(code, message)`). Await it to show progress, and
   * show a failure's message.
   */
  dispatch: (params?: TParams) => OperationCommandResult<TResult> | Promise<OperationCommandResult<TResult>>;
  context?: RendererContext;
  disabled?: boolean;
}

/** An operation tester: the score of a renderer for an `OperationDefinition`. */
export type OperationTester = RendererTester<OperationDefinition>;

const inOperationMode = (context: RendererContext) => context.mode === 'operation';

/** Match operations of the given scope (`'item'`, `'selection'`, `'collection'`). Returns DEFAULT priority on match. */
export function operationScopeIs(...scopes: OperationScope[]): OperationTester {
  return (op, context) => (inOperationMode(context) && scopes.includes(op.scope) ? PRIORITY.DEFAULT : -1);
}

/** Match operations of the given visual variant (`'destructive'`...; an unset variant is `'default'`). Returns LIBRARY priority on match. */
export function operationVariantIs(...variants: NonNullable<OperationDefinition['variant']>[]): OperationTester {
  return (op, context) => (inOperationMode(context) && variants.includes(op.variant ?? 'default') ? PRIORITY.LIBRARY : -1);
}

/** Match any operation: a renderer set's default control. Returns FALLBACK priority. */
export function anyOperation(): OperationTester {
  return (_op, context) => (inOperationMode(context) ? PRIORITY.FALLBACK : -1);
}

/** Match operations by name: an app's renderer for one operation. Returns APP priority on match. */
export function operationIs(...names: string[]): OperationTester {
  return (op, context) => (inOperationMode(context) && names.includes(op.name) ? PRIORITY.APP : -1);
}
