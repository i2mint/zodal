import { describe, it, expect } from 'vitest';
import { createReadOnlyProvider, createInMemoryProvider, READ_ONLY_CAPABILITIES, ReadOnlyError } from '../src/index.js';
import { providerContract } from '../src/testing.js';

const cases = await providerContract({ make: (seed) => createReadOnlyProvider(seed) });

describe('read-only provider: DataProvider contract (writes skipped, refusals checked)', () => {
  for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
});

describe('createReadOnlyProvider', () => {
  it('declares every write refused, with the reason', () => {
    const p = createReadOnlyProvider([], { reason: 'Published snapshot.' });
    const caps = p.getCapabilities();
    for (const f of ['canCreate', 'canUpdate', 'canDelete', 'canBulkUpdate', 'canBulkDelete', 'canUpsert'] as const) {
      expect(caps[f]).toBe(false);
    }
    expect(caps.writeRefusal).toBe('Published snapshot.');
  });
  it('rejects writes with the reason', async () => {
    const p = createReadOnlyProvider([{ id: '1' }], { reason: 'No.' });
    await expect(p.create({ id: '2' })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(p.update('1', {})).rejects.toThrow('No.');
    expect((await p.getList({})).total).toBe(1);
  });
  it('wraps an existing provider, keeping its query capabilities', async () => {
    const inner = createInMemoryProvider([{ id: 'a', n: 1 }]);
    const p = createReadOnlyProvider(inner);
    expect(await p.getOne('a')).toEqual({ id: 'a', n: 1 });
    await expect(p.delete('a')).rejects.toThrow(/read-only/);
    expect((await inner.getList({})).total).toBe(1);
  });
  it('is empty by default', async () => {
    expect((await createReadOnlyProvider().getList({})).total).toBe(0);
  });
  it('READ_ONLY_CAPABILITIES is frozen', () => {
    expect(Object.isFrozen(READ_ONLY_CAPABILITIES)).toBe(true);
  });
});
