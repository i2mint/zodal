import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toCommandRecord } from '../src/commands.js';
import type { OperationDefinition } from '../src/types.js';

const archive: OperationDefinition = {
  name: 'archive', label: 'Archive', scope: 'selection', icon: 'archive', keyboardShortcut: 'e',
};

describe('toCommandRecord', () => {
  it('keeps the operation id and maps label, icon and shortcut', () => {
    const cmd = toCommandRecord(archive, () => 1, { params: z.object({ ids: z.array(z.string()) }), category: 'Notes' });
    expect(cmd).toMatchObject({ id: 'archive', title: 'Archive', icon: 'archive', keybinding: 'e', category: 'Notes' });
    expect(cmd.params).toBeDefined();
  });

  it('wraps a plain return value as ok', async () => {
    const cmd = toCommandRecord<{ ids: string[] }, number>(archive, ({ ids }) => ids.length);
    expect(await cmd.execute({ ids: ['a', 'b'] }, {})).toEqual({ ok: true, value: 2 });
  });

  it('passes a full result through (patches for undo)', async () => {
    const cmd = toCommandRecord(archive, () => ({ ok: true as const, value: 'x', patches: [{ op: 'replace' }] }));
    expect(await cmd.execute(undefined, {})).toEqual({ ok: true, value: 'x', patches: [{ op: 'replace' }] });
  });

  it('turns a throw into errors-as-data', async () => {
    const cmd = toCommandRecord(archive, () => { throw Object.assign(new Error('nope'), { code: 'not_found' }); });
    const r = await cmd.execute(undefined, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'not_found', message: 'nope' });
  });

  it('omits absent optional fields', () => {
    const cmd = toCommandRecord({ name: 'n', label: 'N', scope: 'item' }, () => null);
    expect(Object.keys(cmd).sort()).toEqual(['execute', 'id', 'title']);
  });
});
