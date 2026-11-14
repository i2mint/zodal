import { describe, it, expect } from 'vitest';
import { createInMemoryProvider, createReadOnlyProvider, wrapProvider, isWriteConflict, WriteConflict } from '../src/index.js';
import { providerContract } from '../src/testing.js';

describe('conditional writes (#118)', () => {
  it('the in-memory provider runs the versioned contract cases', async () => {
    const cases = await providerContract({ make: (seed) => createInMemoryProvider(seed) });
    const v = cases.filter((c) => c.name.startsWith('versioned'));
    expect(v.length).toBe(3);
    for (const c of v) {
      expect(c.skip).toBeUndefined();
      await c.run();
    }
  });
  it('a lock racing an update: the second writer loses', async () => {
    const p = createInMemoryProvider([{ id: 'doc', lock: null as string | null }]);
    const a = await p.getVersioned!('doc');
    const b = await p.getVersioned!('doc');
    await p.updateIfVersion!('doc', { lock: 'alice' }, a.version);
    const err = await p.updateIfVersion!('doc', { lock: 'bob' }, b.version).catch((e) => e);
    expect(isWriteConflict(err)).toBe(true);
    expect(err).toBeInstanceOf(WriteConflict);
    expect((await p.getOne('doc')).lock).toBe('alice');
  });
  it('read-only passes versioned reads and refuses versioned writes; wrapProvider passes them through', async () => {
    const inner = createInMemoryProvider([{ id: '1', n: 1 }]);
    const ro = createReadOnlyProvider(inner);
    const { version } = await ro.getVersioned!('1');
    await expect(ro.updateIfVersion!('1', { n: 2 }, version)).rejects.toThrow(/read-only/);
    const w = wrapProvider(inner as any, { encode: (x: any) => ({ ...x }), decode: (x: any) => ({ ...x, seen: true }) });
    const r = await w.getVersioned!('1');
    expect(r.item).toMatchObject({ n: 1, seen: true });
    expect((await w.updateIfVersion!('1', { n: 3 }, r.version)).item).toMatchObject({ n: 3, seen: true });
  });
});
