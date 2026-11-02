import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fail, ok } from '@zodal/core';
import { createActionFeedback, feedbackFor, FEEDBACK_MS, isCommandFailure, type ActionFeedbackState } from '../src/index.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('FEEDBACK_MS and feedbackFor: the response-time limits, stated once', () => {
  it('holds the 0.1 / 0.4 / 1 / 10 s limits, frozen', () => {
    expect(FEEDBACK_MS).toEqual({ instant: 100, indicator: 400, flow: 1000, attention: 10_000 });
    expect(Object.isFrozen(FEEDBACK_MS)).toBe(true);
  });
  it('maps an expected wait to the feedback it owes', () => {
    expect(feedbackFor(50)).toBe('none');
    expect(feedbackFor(250)).toBe('pending');
    expect(feedbackFor(800)).toBe('indicator');
    expect(feedbackFor(4000)).toBe('skeleton');
    expect(feedbackFor(30_000)).toBe('progress');
    expect(feedbackFor(10 * 60_000)).toBe('background');
    expect(feedbackFor(30_000, { backgroundFactor: 2 })).toBe('background');
    expect(feedbackFor(Number.NaN)).toBe('none');
  });
});

describe('createActionFeedback: pending at once, indicator later, repeat presses ignored', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns pending synchronously, before the action runs', () => {
    const seen: string[] = [];
    const fb = createActionFeedback(() => {
      seen.push(`action saw ${fb.state.status}`);
      return new Promise(() => {});
    }, { onChange: (s) => seen.push(s.status) });
    fb.run();
    expect(seen).toEqual(['pending', 'action saw pending']);
    expect(fb.state).toEqual({ status: 'pending', indicator: false });
  });

  it('ignores a second press while the first is in flight (the double-tap guard)', async () => {
    const d = deferred<number>();
    const action = vi.fn(() => d.promise);
    const fb = createActionFeedback(action);
    const first = fb.run();
    expect(fb.run()).toBeNull();
    expect(fb.run()).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
    d.resolve(7);
    await expect(first).resolves.toEqual({ status: 'success', indicator: false, result: 7 });
    expect(fb.run()).not.toBeNull();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('shows the indicator only after the delay, and keeps it up at least the minimum', async () => {
    const d = deferred<string>();
    const states: ActionFeedbackState<string>[] = [];
    const fb = createActionFeedback(() => d.promise, { indicatorDelayMs: 300, minIndicatorMs: 500, onChange: (s) => states.push(s) });
    const done = fb.run();
    vi.advanceTimersByTime(299);
    expect(fb.state.indicator).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fb.state).toEqual({ status: 'pending', indicator: true });
    vi.advanceTimersByTime(100);
    d.resolve('x');
    await Promise.resolve();
    await Promise.resolve();
    expect(fb.state.status).toBe('pending'); // indicator held: 100 of 500 ms shown
    await vi.advanceTimersByTimeAsync(400);
    await expect(done).resolves.toEqual({ status: 'success', indicator: false, result: 'x' });
    expect(states.map((s) => `${s.status}:${s.indicator}`)).toEqual(['pending:false', 'pending:true', 'success:false']);
  });

  it('a quick action never shows the indicator', async () => {
    const fb = createActionFeedback(() => Promise.resolve(1));
    await fb.run();
    vi.advanceTimersByTime(1000);
    expect(fb.state).toEqual({ status: 'success', indicator: false, result: 1 });
  });

  it('a synchronous action settles synchronously', () => {
    const fb = createActionFeedback((n: number) => n * 2);
    void fb.run(21);
    expect(fb.state).toEqual({ status: 'success', indicator: false, result: 42 });
  });

  it('a throw, a rejection and a command fail() are errors; run never rejects', async () => {
    const thrown = createActionFeedback(() => {
      throw new Error('boom');
    });
    await expect(thrown.run()).resolves.toMatchObject({ status: 'error', error: new Error('boom') });
    const rejected = createActionFeedback(() => Promise.reject(new Error('nope')));
    await expect(rejected.run()).resolves.toMatchObject({ status: 'error', error: new Error('nope') });
    const failed = createActionFeedback(async () => fail('conflict', 'Changed elsewhere'));
    await expect(failed.run()).resolves.toMatchObject({ status: 'error', error: { code: 'conflict', message: 'Changed elsewhere' } });
    const succeeded = createActionFeedback(async () => ok(3));
    await expect(succeeded.run()).resolves.toMatchObject({ status: 'success' });
  });

  it('isFailure is injectable; the default reads command results', async () => {
    expect(isCommandFailure({ ok: false, error: {} })).toBe(true);
    expect(isCommandFailure({ ok: true, value: 1 })).toBe(false);
    expect(isCommandFailure(null)).toBe(false);
    const fb = createActionFeedback(async () => 404, { isFailure: (status) => status >= 400 });
    await expect(fb.run()).resolves.toMatchObject({ status: 'error', error: 404 });
  });

  it('reset returns to idle at once and drops the in-flight outcome (bfcache restore)', async () => {
    const d = deferred<number>();
    const states: string[] = [];
    const fb = createActionFeedback(() => d.promise, { onChange: (s) => states.push(s.status) });
    const first = fb.run();
    fb.reset();
    expect(fb.state).toEqual({ status: 'idle', indicator: false });
    vi.advanceTimersByTime(1000);
    expect(fb.state.indicator).toBe(false);
    d.resolve(1);
    await expect(first).resolves.toEqual({ status: 'idle', indicator: false });
    expect(states).toEqual(['pending', 'idle']);
    expect(fb.run()).not.toBeNull(); // a press after the reset runs
  });

  it('dispose during the minimum-indicator hold applies the outcome now and resolves the run', async () => {
    const d = deferred<number>();
    const fb = createActionFeedback(() => d.promise);
    const done = fb.run();
    vi.advanceTimersByTime(FEEDBACK_MS.indicator);
    expect(fb.state.indicator).toBe(true);
    d.resolve(5);
    await Promise.resolve();
    await Promise.resolve();
    expect(fb.state.status).toBe('pending'); // held
    fb.dispose();
    expect(fb.state).toEqual({ status: 'success', indicator: false, result: 5 });
    await expect(done).resolves.toEqual({ status: 'success', indicator: false, result: 5 });
    expect(fb.run()).not.toBeNull(); // not dead
  });

  it('reset during the hold resolves that run with the idle state', async () => {
    const d = deferred<number>();
    const fb = createActionFeedback(() => d.promise);
    const done = fb.run();
    vi.advanceTimersByTime(FEEDBACK_MS.indicator);
    d.resolve(5);
    await Promise.resolve();
    await Promise.resolve();
    fb.reset();
    await expect(done).resolves.toEqual({ status: 'idle', indicator: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fb.state).toEqual({ status: 'idle', indicator: false });
  });

  it('a throwing onChange neither breaks the machine nor rejects run', async () => {
    const errors: unknown[] = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn) => { try { fn(); } catch (e) { errors.push(e); } };
    try {
      const fb = createActionFeedback(async () => 1, { onChange: () => { throw new Error('listener'); } });
      await expect(fb.run()).resolves.toMatchObject({ status: 'success' });
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      globalThis.queueMicrotask = original;
    }
  });

  it('dispose cancels the indicator timer', () => {
    const fb = createActionFeedback(() => new Promise(() => {}));
    fb.run();
    fb.dispose();
    vi.advanceTimersByTime(5000);
    expect(fb.state.indicator).toBe(false);
  });

  it('takes an injected clock', () => {
    const timers: Array<() => void> = [];
    const fb = createActionFeedback(() => new Promise(() => {}), {
      clock: { now: () => 0, setTimeout: (fn) => timers.push(fn), clearTimeout: () => {} },
    });
    fb.run();
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(fb.state.indicator).toBe(true);
  });
});
