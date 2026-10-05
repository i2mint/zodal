import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { providerContract, ContractViolation, CONTRACT_SEED } from '../src/testing.js';
import type { DataProvider } from '../src/data-provider.js';
import type { ContractRow } from '../src/testing.js';

// The in-memory provider is the reference implementation: it must pass all of it.
const cases = await providerContract({ make: (seed) => createInMemoryProvider(seed) });

describe('in-memory provider: DataProvider contract', () => {
  for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
});

describe('the contract kit itself', () => {
  it('runs every case for a fully capable provider', () => {
    expect(cases.filter((c) => c.skip)).toEqual([]);
    expect(cases.length).toBeGreaterThan(20);
  });

  it('catches a provider whose search is case-sensitive', async () => {
    const broken = await providerContract({
      make: (seed) => {
        const p = createInMemoryProvider(seed);
        return {
          ...p,
          getList: (params) =>
            p.getList({ ...params, search: undefined }).then((r) => {
              if (!params.search) return r;
              const data = r.data.filter((x) => x.name.includes(params.search!));
              return { data, total: data.length };
            }),
        } as DataProvider<ContractRow>;
      },
    });
    const search = broken.find((c) => c.name.startsWith('getList search'))!;
    await expect(search.run()).rejects.toBeInstanceOf(ContractViolation);
  });

  it('skips writes a provider declares it cannot do, and checks they are refused', async () => {
    const readOnly = (seed: ContractRow[]): DataProvider<ContractRow> => {
      const p = createInMemoryProvider(seed);
      const no = () => Promise.reject(new Error('read-only'));
      return {
        ...p,
        create: no, update: no, updateMany: no, delete: no, deleteMany: no, upsert: undefined,
        getCapabilities: () => ({
          ...p.getCapabilities!(),
          canCreate: false, canUpdate: false, canDelete: false, canBulkUpdate: false, canBulkDelete: false, canUpsert: false,
        }),
      };
    };
    const ro = await providerContract({ make: readOnly });
    expect(ro.find((c) => c.name.startsWith('create with'))!.skip).toMatch(/canCreate: false/);
    await ro.find((c) => c.name === 'a write the capabilities refuse is refused')!.run();

    // A provider that claims read-only but still writes is caught.
    const liar = await providerContract({
      make: (seed) => ({ ...createInMemoryProvider(seed), getCapabilities: () => ({ ...readOnly(seed).getCapabilities!() }) }),
    });
    await expect(liar.find((c) => c.name === 'a write the capabilities refuse is refused')!.run()).rejects.toBeInstanceOf(ContractViolation);
  });

  it('a read-only stub whose writes throw synchronously passes the honesty case', async () => {
    const sync = await providerContract({
      make: (seed) => {
        const p = createInMemoryProvider(seed);
        const no = () => { throw new Error('read-only'); };
        return {
          ...p, create: no, update: no, updateMany: no, delete: no, deleteMany: no, upsert: undefined,
          getCapabilities: () => ({ ...p.getCapabilities!(), canCreate: false, canUpdate: false, canDelete: false, canBulkUpdate: false, canBulkDelete: false, canUpsert: false }),
        } as unknown as DataProvider<ContractRow>;
      },
    });
    await sync.find((c) => c.name === 'a write the capabilities refuse is refused')!.run();
  });

  it('skips a filter case whose operator the provider does not declare', async () => {
    const s = await providerContract({
      make: (seed) => {
        const p = createInMemoryProvider(seed);
        return { ...p, getCapabilities: () => ({ ...p.getCapabilities!(), filterOperators: { '*': ['eq', 'gte'] } }) } as DataProvider<ContractRow>;
      },
    });
    expect(s.find((c) => c.name.startsWith('getList filter arrayContains ('))!.skip).toMatch(/without arrayContains/);
    expect(s.find((c) => c.name === 'getList filter eq')!.skip).toBeUndefined();
  });

  it('calls dispose after each case and after the capability probe', async () => {
    let made = 0;
    let disposed = 0;
    const s = await providerContract({ make: (seed) => { made++; return createInMemoryProvider(seed); }, dispose: () => { disposed++; } });
    await s[0].run();
    expect(disposed).toBe(made);
  });

  it('the seed is deeply frozen', () => {
    expect(Object.isFrozen(CONTRACT_SEED[0].tags)).toBe(true);
  });

  it('reports options.skip as the reason', async () => {
    const s = await providerContract({ make: (seed) => createInMemoryProvider(seed), skip: { 'getList sort by several keys': 'no multi-key sort' } });
    expect(s.find((c) => c.name === 'getList sort by several keys')!.skip).toBe('no multi-key sort');
  });
});

describe('in-memory provider: regressions found by review', () => {
  it('an assigned id never collides with a seeded one', async () => {
    const p = createInMemoryProvider<{ id: string; name?: string }>([{ id: '2' }, { id: '3' }]);
    const a = await p.create({ name: 'a' });
    const b = await p.create({ name: 'b' });
    expect(new Set(['2', '3', a.id, b.id]).size).toBe(4);
    expect((await p.getList({})).total).toBe(4);
  });

  it('create with an existing id rejects instead of duplicating', async () => {
    const p = createInMemoryProvider([{ id: '1', name: 'x' }]);
    await expect(p.create({ id: '1', name: 'y' })).rejects.toThrow(/already exists/);
    expect((await p.getList({})).total).toBe(1);
  });

  it('a custom clone option is used', async () => {
    const shallow = <V,>(v: V): V => (Array.isArray(v) ? ([...v] as V) : typeof v === 'object' && v ? ({ ...(v as object) } as V) : v);
    class Thing { constructor(public id: string) {} get label() { return `#${this.id}`; } }
    const p = createInMemoryProvider<any>([{ id: '1', thing: new Thing('1') }], { clone: shallow });
    expect((await p.getOne('1')).thing.label).toBe('#1');
  });
});
