import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toCommandRecord, operationCommandId, operationDispatcher, normalizeKeybinding, ok, fail } from '../src/commands.js';
import type { OperationDefinition } from '../src/types.js';

const archive: OperationDefinition = {
  name: 'archive', label: 'Archive', scope: 'selection', icon: 'archive', keyboardShortcut: 'ctrl+e',
};

describe('toCommandRecord', () => {
  it('namespaces the id, maps label/icon/when and normalizes the shortcut', () => {
    const cmd = toCommandRecord(archive, () => ok(1), {
      namespace: 'notes', params: z.object({ ids: z.array(z.string()) }), category: 'Notes', when: 'selection.length >= 1',
    });
    expect(cmd).toMatchObject({ id: 'notes.archive', title: 'Archive', icon: 'archive', keybinding: 'Control+e', category: 'Notes', when: 'selection.length >= 1' });
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('returns exactly what execute returns: no guessing from shape', async () => {
    const health = toCommandRecord<void, { ok: boolean; value: number; latencyMs: number }>(archive, () => ok({ ok: true, value: 3, latencyMs: 12 }));
    expect(await health.execute(undefined, {})).toEqual({ ok: true, value: { ok: true, value: 3, latencyMs: 12 } });
    const withPatches = toCommandRecord(archive, () => ok('x', { patches: [{ op: 'replace', path: ['a'], value: 1 }] }));
    expect(await withPatches.execute(undefined, {})).toEqual({ ok: true, value: 'x', patches: [{ op: 'replace', path: ['a'], value: 1 }] });
    expect(await toCommandRecord(archive, () => fail('not_found', 'gone')).execute(undefined, {})).toEqual({ ok: false, error: { code: 'not_found', message: 'gone' } });
  });

  it('a throw becomes execute_threw without the raw error (no credentials in details)', async () => {
    const leaky = Object.assign(new Error('boom'), { config: { headers: { Authorization: 'Bearer sk-SECRET' } } });
    const r = await toCommandRecord(archive, () => { throw leaky; }).execute(undefined, {});
    expect(r).toEqual({ ok: false, error: { code: 'execute_threw', message: 'boom' } });
    expect(JSON.stringify(r)).not.toContain('sk-SECRET');
  });
});

describe('operationCommandId / normalizeKeybinding', () => {
  it('normalizes names to acture id segments', () => {
    expect(operationCommandId('my-app.notes', { name: 'bulk-delete' })).toBe('myApp.notes.bulkDelete');
    expect(operationCommandId(undefined, { name: 'Archive' })).toBe('archive');
    expect(() => operationCommandId(undefined, { name: '9lives' })).toThrow(/start with a letter/);
  });
  it('maps key names to the hotkeys convention', () => {
    expect(normalizeKeybinding('ctrl+shift+d')).toBe('Control+Shift+d');
    expect(normalizeKeybinding('mod+k mod+s')).toBe('$mod+k $mod+s');
  });
});

describe('review round 2', () => {
  it('everything is importable from the package entry point', async () => {
    const core = await import('../src/index.js');
    for (const name of ['toCommandRecord', 'ok', 'fail', 'operationCommandId', 'normalizeKeybinding', 'getVocabulary', 'getVocabularyEntries']) {
      expect(typeof (core as any)[name], name).toBe('function');
    }
  });
  it('ids: acronyms, separators, refusals that name what is wrong', () => {
    expect(operationCommandId('notes', { name: 'URLFetch' })).toBe('notes.urlFetch');
    expect(operationCommandId('notes', { name: 'bulk_delete' })).toBe('notes.bulkDelete');
    expect(() => operationCommandId('notes', { name: 'café' })).toThrow(/ASCII/);
    expect(() => operationCommandId('2notes', { name: 'x' })).toThrow(/namespace/);
  });
  it('key aliases', () => {
    expect(normalizeKeybinding('esc')).toBe('Escape');
    expect(normalizeKeybinding('mod+space')).toBe('$mod+Space');
    expect(normalizeKeybinding('ctrl++')).toBe('Control++');
    expect(normalizeKeybinding('cmdorctrl+up')).toBe('$mod+ArrowUp');
  });
  it('a thrown error keeps its string code', async () => {
    const r = await toCommandRecord(archive, () => { throw Object.assign(new Error('x'), { code: 'not_found' }); }).execute(undefined, {});
    expect(r).toEqual({ ok: false, error: { code: 'not_found', message: 'x' } });
  });
});

describe('operationDispatcher (#97)', () => {
  const op: OperationDefinition = { name: 'archive', label: 'Archive', scope: 'selection' };

  it('runs the command registered for the operation, by the same id', async () => {
    const seen: [string, unknown][] = [];
    const cmd = toCommandRecord(op, (p: { ids: string[] }) => ok(p.ids.length), { namespace: 'notes' });
    const dispatchFor = operationDispatcher({
      namespace: 'notes',
      execute: (id, params) => {
        seen.push([id, params]);
        return id === cmd.id ? cmd.execute(params as { ids: string[] }, {}) : fail('unknown_command', id);
      },
    });
    const dispatch = dispatchFor<{ ids: string[] }, number>(op);
    expect(await dispatch({ ids: ['a', 'b'] })).toEqual({ ok: true, value: 2 });
    expect(seen).toEqual([['notes.archive', { ids: ['a', 'b'] }]]);
  });
  it('passes the dispatch context, read at dispatch time, for a when clause', async () => {
    let selection: string[] = [];
    const dispatch = operationDispatcher({
      namespace: 'notes',
      // A host executor that checks `when: 'selection.length >= 1'` the way acture's dispatch would.
      execute: (_id, _params, ctx) => ((ctx?.selection as string[] | undefined)?.length ? ok('ran') : fail('when_clause_failed', 'nothing selected')),
      context: () => ({ selection }),
    })(op);
    expect((await dispatch()).ok).toBe(false);
    selection = ['a'];
    expect(await dispatch()).toEqual({ ok: true, value: 'ran' });
  });
  it('keeps a thrown plain object\'s message, and survives a value that cannot be stringified', async () => {
    const quota = operationDispatcher({ execute: () => { throw { code: 'quota', message: 'over quota' }; } })(op);
    expect(await quota()).toEqual({ ok: false, error: { code: 'quota', message: 'over quota' } });
    const odd = operationDispatcher({ execute: () => { throw Object.create(null); } })(op);
    expect(await odd()).toEqual({ ok: false, error: { code: 'dispatch_threw', message: 'unknown error' } });
  });
  it('a throwing executor is a failed result, keeping a string code and never the raw error', async () => {
    const dispatch = operationDispatcher({ execute: () => { throw Object.assign(new Error('gone'), { code: 'offline', secret: 'x' }); } })(op);
    expect(await dispatch()).toEqual({ ok: false, error: { code: 'offline', message: 'gone' } });
    const plain = operationDispatcher({ execute: async () => { throw 'boom'; } })(op);
    expect(await plain()).toEqual({ ok: false, error: { code: 'dispatch_threw', message: 'boom' } });
  });
  it('checks the id when the dispatch is made', () => {
    expect(() => operationDispatcher({ execute: () => ok(1) })({ name: '1bad' })).toThrow(/must start with a letter/);
  });
});
