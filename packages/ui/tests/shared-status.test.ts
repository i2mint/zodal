import { describe, it, expect } from 'vitest';
import { createActionFeedback, createOperationStatus, operationKey } from '../src/index.js';

const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

describe('shared operation status (zodal#112)', () => {
  it('a run from the palette shows pending on the button, and the button guard holds', async () => {
    const source = createOperationStatus();
    const key = operationKey('archive', 'item-1');
    const work = deferred();
    const buttonSeen: string[] = [];
    const button = createActionFeedback(() => work.promise, { shared: { source, key }, onChange: (s) => buttonSeen.push(s.status) });
    const palette = createActionFeedback(() => work.promise, { shared: { source, key } });

    const running = palette.run();
    expect(running).not.toBeNull();
    expect(buttonSeen).toEqual(['pending']); // the button learns of the palette's run
    expect(button.state.status).toBe('pending');
    expect(button.run()).toBeNull(); // the guard holds across surfaces
    work.resolve('done');
    await running;
    expect(buttonSeen.at(-1)).toBe('success');
    expect(button.state.status).toBe('success');
    expect(button.run()).not.toBeNull(); // settled: a new press runs
  });
  it('keys separate items and operations; no shared source behaves as before', () => {
    expect(operationKey('a', '1')).not.toBe(operationKey('a', '2'));
    expect(operationKey('a')).not.toBe(operationKey('a', ''));
    const local = createActionFeedback(() => new Promise(() => {}));
    expect(local.run()).not.toBeNull();
    expect(local.run()).toBeNull();
  });
  it('dispose stops listening', () => {
    const source = createOperationStatus();
    const seen: string[] = [];
    const a = createActionFeedback(() => 1, { shared: { source, key: 'k' }, onChange: (s) => seen.push(s.status) });
    a.dispose();
    source.set('k', { status: 'pending', indicator: false });
    expect(seen).toEqual([]);
  });
});
