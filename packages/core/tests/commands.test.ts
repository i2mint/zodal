import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toCommandRecord, operationCommandId, normalizeKeybinding, ok, fail } from '../src/commands.js';
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
