/**
 * Feedback: every action a person takes is acknowledged at once, and its progress stays visible.
 *
 * Don Norman's feedback principle (The Design of Everyday Things, 2013, pp. 23-24): feedback must
 * be immediate ("even a delay of a tenth of a second can be disconcerting"), informative, and
 * not excessive. The response-time limits give the scale: about 0.1 s feels
 * instantaneous, 1 s keeps the flow of thought, 10 s is the limit of attention (Miller 1968;
 * Card, Robertson & Mackinlay 1991; Nielsen 1993). This module is where zodal states those numbers
 * once ({@link FEEDBACK_MS}), maps an expected wait to the feedback it owes ({@link feedbackFor}),
 * and runs one action with the states a control needs to show it ({@link createActionFeedback}):
 * pending from the press, a busy indicator only once the wait is long enough to be worth one, and
 * a guard that ignores repeat presses while the first is in flight (the double tap).
 *
 * Headless: no DOM, no React. A renderer maps the state to attributes (`data-pending`,
 * `aria-busy`, `aria-disabled`, `data-indicator`) and the pressed state (`data-pressed`, on
 * `pointerdown`) itself. The decision and its research: `docs/adr/0001-feedback-principle.md`.
 */

import type { OperationCommandResult } from '@zodal/core';

/**
 * The response-time limits, in milliseconds. One source of truth for every renderer and app.
 *
 * - `instant` (100): what lands within this feels caused by the hand; the pressed state must
 *   show within it, so it is applied synchronously in the press handler, never after an await.
 * - `indicator` (400): when a busy indicator appears on an action still in flight (the default
 *   `indicatorDelayMs`; community conventions run 300-500 ms, Adobe Spectrum 2 waits 1 s).
 *   This is the "Doherty threshold" of UX lore; the 1982 IBM brief (Doherty & Thadhani) shows a
 *   smooth productivity gain all through the sub-second range rather than a 400 ms cliff, so read
 *   it as a budget inside the 0.1-1 s band. Before it, the pending styling alone acknowledges the
 *   press, so a quick action does not flash a spinner.
 * - `flow` (1000): past this, show what is coming (a skeleton for content, a labelled spinner
 *   for an action); the person's train of thought is at risk.
 * - `attention` (10000): past this, show determinate progress with a way to cancel, or move the
 *   work to the background and notify when it is done.
 */
export const FEEDBACK_MS = Object.freeze({
  instant: 100,
  indicator: 400,
  flow: 1000,
  attention: 10_000,
});

/**
 * What an expected wait owes the person, beyond the pressed state every press gets:
 * - `'none'`: the result itself lands within {@link FEEDBACK_MS.instant};
 * - `'pending'`: mark the control pending (dimmed, `aria-busy`), repeat presses ignored;
 * - `'indicator'`: and a busy indicator (a spinner in the control, a progress cursor);
 * - `'skeleton'`: content-shaped placeholders where the result will appear, or a labelled
 *   spinner for an action with no content to preview;
 * - `'progress'`: determinate progress (percent or steps) and a Cancel;
 * - `'background'`: let the person leave; notify when done.
 */
export type FeedbackLevel = 'none' | 'pending' | 'indicator' | 'skeleton' | 'progress' | 'background';

/**
 * The feedback owed to an action expected to take `expectedMs`, by the limits in
 * {@link FEEDBACK_MS}. A heuristic for choosing the indicator up front; at run time,
 * {@link createActionFeedback} escalates by elapsed time on its own. `background` applies when
 * the wait is a multiple of the attention limit (more than `backgroundFactor` times it).
 */
export function feedbackFor(expectedMs: number, { backgroundFactor = 6 }: { backgroundFactor?: number } = {}): FeedbackLevel {
  if (!(expectedMs > FEEDBACK_MS.instant)) return 'none';
  if (expectedMs <= FEEDBACK_MS.indicator) return 'pending';
  if (expectedMs <= FEEDBACK_MS.flow) return 'indicator';
  if (expectedMs <= FEEDBACK_MS.attention) return 'skeleton';
  if (expectedMs <= FEEDBACK_MS.attention * backgroundFactor) return 'progress';
  return 'background';
}

/** Where an action is: `pending` from the press until it settles; then how it ended. */
export type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

/** What a control shows for its action. */
export interface ActionFeedbackState<R = unknown> {
  status: ActionStatus;
  /**
   * Show a busy indicator: the action has been pending for `indicatorDelayMs`. Before that the
   * pending styling alone acknowledges the press. Once shown it stays at least `minIndicatorMs`,
   * so it never flickers on and off.
   */
  indicator: boolean;
  /** The action's value, once it succeeded. */
  result?: R;
  /** Why it failed: the thrown value, or the `{ ok: false }` result's `error`. */
  error?: unknown;
}

/** Timing and reporting for {@link createActionFeedback}. Every option has a default. */
export interface ActionFeedbackOptions<R = unknown> {
  /** Called on every change of state, synchronously with the press for the first one. */
  onChange?: (state: Readonly<ActionFeedbackState<R>>) => void;
  /** How long an action may be pending before the busy indicator shows. Default: {@link FEEDBACK_MS.indicator}. */
  indicatorDelayMs?: number;
  /** Once the indicator shows, it stays at least this long, so it never flickers. Default: 500 ms. */
  minIndicatorMs?: number;
  /**
   * Is this resolved value a failure? Default: any object with `ok === false`: a zodal command
   * result (`fail(code, message)`, whose `error` becomes the state's `error`), and also a `fetch`
   * `Response` with a 4xx/5xx status (the `Response` itself becomes the `error`).
   */
  isFailure?: (value: R) => boolean;
  /** Injected timers, for tests. Default: the global `setTimeout` / `clearTimeout` / `Date.now`. */
  clock?: FeedbackClock;
}

/** The timers {@link createActionFeedback} uses; inject a fake one in tests. */
export interface FeedbackClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** One action with its feedback state. */
export interface ActionFeedback<A extends unknown[], R> {
  /**
   * Run the action, unless it is already pending: then the press is ignored and `null` is
   * returned (the double-tap guard). Otherwise the state turns `pending` before the action is
   * called, and the returned promise resolves to the settled state. It never rejects: a throw or
   * a rejection becomes `status: 'error'`.
   */
  run(...args: A): Promise<ActionFeedbackState<R>> | null;
  /** The current state. */
  readonly state: Readonly<ActionFeedbackState<R>>;
  /**
   * Back to `idle` at once, dropping the in-flight action's outcome: for a page restored from
   * the back/forward cache (`pageshow` with `persisted`) after a press that navigated away,
   * which would otherwise come back still pending, and for a Cancel.
   */
  reset(): void;
  /**
   * Cancel the timers (the control was removed or hidden): the indicator timer is dropped, and an
   * outcome waiting out the minimum indicator is applied at once. The action itself is not aborted;
   * if it is still running, it settles as usual (without the indicator).
   */
  dispose(): void;
}

const systemClock: FeedbackClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Default failure test: a zodal command result `{ ok: false, error }`. */
export function isCommandFailure(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Partial<OperationCommandResult<unknown>>).ok === false;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Wrap an action so a control can show it: `pending` at once, a busy indicator after
 * `indicatorDelayMs`, repeat presses ignored while it runs, and `success` or `error` at the end.
 * A synchronous action settles synchronously and never shows the indicator.
 *
 * @example
 * ```ts
 * const save = createActionFeedback(() => provider.update(id, patch), {
 *   onChange: (s) => {
 *     button.toggleAttribute('data-pending', s.status === 'pending');
 *     button.setAttribute('aria-busy', String(s.status === 'pending'));
 *     button.toggleAttribute('data-indicator', s.indicator);
 *   },
 * });
 * button.addEventListener('click', () => save.run());
 * ```
 */
export function createActionFeedback<A extends unknown[], R>(
  action: (...args: A) => R | PromiseLike<R>,
  options: ActionFeedbackOptions<R> = {},
): ActionFeedback<A, R> {
  const {
    onChange,
    indicatorDelayMs = FEEDBACK_MS.indicator,
    minIndicatorMs = 500,
    isFailure = isCommandFailure as (value: R) => boolean,
    clock = systemClock,
  } = options;
  let state: ActionFeedbackState<R> = { status: 'idle', indicator: false };
  let indicatorTimer: unknown;
  let indicatorShownAt = 0;
  /** The minimum-indicator hold, while an outcome waits to be shown: its timer, outcome and resolver. */
  let hold: { timer: unknown; final: ActionFeedbackState<R>; resolve: (s: ActionFeedbackState<R>) => void } | undefined;
  /** Bumped by `reset`, so an outcome from before it is dropped. */
  let generation = 0;

  /** Set and report the state. A throwing listener must not break the machine or reject `run`. */
  const set = (next: ActionFeedbackState<R>) => {
    state = next;
    try {
      onChange?.(state);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      }); // surfaced like any uncaught error, without unwinding the machine
    }
  };
  const clearIndicatorTimer = () => {
    if (indicatorTimer !== undefined) clock.clearTimeout(indicatorTimer);
    indicatorTimer = undefined;
  };
  /** End a hold now: resolve its run with `final` (its own outcome, or the reset state). */
  const endHold = (final?: ActionFeedbackState<R>) => {
    if (!hold) return;
    const h = hold;
    hold = undefined;
    clock.clearTimeout(h.timer);
    if (final === undefined) set(h.final);
    h.resolve(final ?? h.final);
  };
  const outcome = (value: R): ActionFeedbackState<R> =>
    isFailure(value)
      ? { status: 'error', indicator: false, error: (value as { error?: unknown }).error ?? value }
      : { status: 'success', indicator: false, result: value };

  /** Settle, keeping a shown indicator up for at least `minIndicatorMs`; a reset run settles nothing. */
  const settle = (final: ActionFeedbackState<R>, run: number): Promise<ActionFeedbackState<R>> => {
    if (run !== generation) return Promise.resolve(state);
    clearIndicatorTimer();
    const remaining = state.indicator ? minIndicatorMs - (clock.now() - indicatorShownAt) : 0;
    if (remaining <= 0) {
      set(final);
      return Promise.resolve(final);
    }
    return new Promise((resolve) => {
      hold = { final, resolve, timer: clock.setTimeout(() => endHold(), remaining) };
    });
  };

  return {
    run(...args: A) {
      if (state.status === 'pending') return null;
      const run = ++generation;
      set({ status: 'pending', indicator: false });
      let value: R | PromiseLike<R>;
      try {
        value = action(...args);
      } catch (error) {
        return settle({ status: 'error', indicator: false, error }, run);
      }
      if (!isThenable(value)) return settle(outcome(value), run);
      indicatorTimer = clock.setTimeout(() => {
        indicatorTimer = undefined;
        if (run !== generation || state.status !== 'pending') return;
        indicatorShownAt = clock.now();
        set({ status: 'pending', indicator: true });
      }, indicatorDelayMs);
      return Promise.resolve(value).then(
        (v) => settle(outcome(v), run),
        (error: unknown) => settle({ status: 'error', indicator: false, error }, run),
      );
    },
    get state() {
      return state;
    },
    reset() {
      generation++;
      clearIndicatorTimer();
      const idle: ActionFeedbackState<R> = { status: 'idle', indicator: false };
      endHold(idle);
      if (state.status !== 'idle' || state.indicator) set(idle);
    },
    dispose() {
      clearIndicatorTimer();
      endHold(); // an outcome waiting out the minimum indicator is shown now, and its run resolves
    },
  };
}
