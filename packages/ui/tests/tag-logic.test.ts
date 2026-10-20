import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSuggestionController,
  fromContainsFilter,
  matchOptions,
  resolveDraft,
  splitTags,
  toContainsFilter,
  type SuggestionState,
} from '../src/tag-logic.js';

const PRIORITIES = [
  { label: 'Low', value: '1', raw: 1 },
  { label: 'High', value: '3', raw: 3 },
];

describe('resolveDraft', () => {
  const open = { choices: [{ label: 'Design', value: 'design' }], allowCreate: true, selected: [] as unknown[] };

  it('commits a matching choice by label or value, case-insensitively', () => {
    expect(resolveDraft('DESIGN', open)).toEqual({ ok: true, value: 'design', label: 'Design' });
  });

  it('writes back raw for a numeric vocabulary', () => {
    const res = resolveDraft('high', { choices: PRIORITIES, allowCreate: false, selected: [] });
    expect(res).toEqual({ ok: true, value: 3, label: 'High' });
  });

  it('accepts new text only when allowCreate', () => {
    expect(resolveDraft(' fresh ', open)).toEqual({ ok: true, value: 'fresh', label: 'fresh' });
    expect(resolveDraft('fresh', { ...open, allowCreate: false })).toMatchObject({ ok: false, reason: 'notAllowed' });
  });

  it('refuses duplicates, comparing numbers by their string key', () => {
    expect(resolveDraft('Low', { choices: PRIORITIES, allowCreate: false, selected: [1] })).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('treats blank text as empty', () => {
    expect(resolveDraft('   ', open)).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('matchOptions and splitTags', () => {
  it('matches label or value, skips selected values, respects the limit', () => {
    const opts = [
      { label: 'Alpha', value: 'a' },
      { label: 'Alpine', value: 'b' },
      { label: 'Beta', value: 'c' },
    ];
    expect(matchOptions(opts, 'alp', ['a'], 10).map((o) => o.value)).toEqual(['b']);
    expect(matchOptions(opts, '', [], 2)).toHaveLength(2);
  });

  it('splits on commas and newlines and drops blanks', () => {
    expect(splitTags('a, b,,\nc ')).toEqual(['a', 'b', 'c']);
  });
});

describe('the contains filter value', () => {
  it('is undefined when nothing is selected', () => {
    expect(toContainsFilter('tags', [])).toBeUndefined();
  });

  it('is arrayContainsAny even for one value', () => {
    expect(toContainsFilter('tags', ['a'])).toEqual({ field: 'tags', operator: 'arrayContainsAny', value: ['a'] });
  });

  it('reads back a condition, a bare array, or a scalar', () => {
    expect(fromContainsFilter({ field: 'tags', operator: 'arrayContainsAny', value: [1, 2] })).toEqual([1, 2]);
    expect(fromContainsFilter({ field: 'tags', operator: 'arrayContains', value: 'x' })).toEqual(['x']);
    expect(fromContainsFilter(['a'])).toEqual(['a']);
    expect(fromContainsFilter('a')).toEqual(['a']);
    expect(fromContainsFilter(undefined)).toEqual([]);
  });
});

describe('createSuggestionController', () => {
  afterEach(() => vi.useRealTimers());

  function setup(suggest: any, { debounceMs = 100, limit = 3 } = {}) {
    const states: SuggestionState[] = [];
    const c = createSuggestionController({ suggest, field: 'tags', debounceMs, limit, onUpdate: (s) => states.push(s) });
    return { c, states, last: () => states[states.length - 1] };
  }

  it('debounces, then calls suggest with the field, an AbortSignal and the limit', async () => {
    vi.useFakeTimers();
    const suggest = vi.fn().mockResolvedValue([]);
    const { c, last } = setup(suggest);
    c.request('a');
    c.request('ab');
    expect(last().status).toBe('loading');
    expect(suggest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(suggest).toHaveBeenCalledTimes(1);
    const [query, field, opts] = suggest.mock.calls[0];
    expect([query, field, opts.limit]).toEqual(['ab', 'tags', 3]);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the previous request and ignores its late result', async () => {
    const resolvers: Array<(v: any) => void> = [];
    const signals: AbortSignal[] = [];
    // A source that ignores its signal and resolves out of order.
    const suggest = vi.fn((_q: string, _f: string, o: any) => {
      signals.push(o.signal);
      return new Promise((r) => resolvers.push(r));
    });
    const { c, states, last } = setup(suggest, { debounceMs: 0 });
    c.request('a');
    c.request('ab');
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    resolvers[1]([{ value: 'abc', label: 'abc' }]);
    await Promise.resolve();
    resolvers[0]([{ value: 'stale', label: 'stale' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(last()).toMatchObject({ status: 'ready', query: 'ab', items: [{ value: 'abc', label: 'abc' }] });
    expect(states.some((s) => s.items.some((i) => i.value === 'stale'))).toBe(false);
  });

  it('enforces the limit even if the source does not', async () => {
    const suggest = () => ['a', 'b', 'c', 'd', 'e'].map((v) => ({ value: v, label: v }));
    const { c, last } = setup(suggest, { debounceMs: 0, limit: 2 });
    c.request('x');
    await new Promise((r) => setTimeout(r, 0));
    expect(last().items).toHaveLength(2);
  });

  it('reports a failure as an error state, and cancel drops a pending result', async () => {
    const { c, last } = setup(() => Promise.reject(new Error('down')), { debounceMs: 0 });
    c.request('x');
    await new Promise((r) => setTimeout(r, 0));
    expect(last().status).toBe('error');

    let resolve!: (v: any) => void;
    const slow = setup(() => new Promise((r) => (resolve = r)), { debounceMs: 0 });
    slow.c.request('y');
    slow.c.cancel();
    resolve([{ value: 'y', label: 'y' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(slow.last().status).toBe('loading');
  });
});
