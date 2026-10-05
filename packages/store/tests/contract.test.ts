import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { providerContract, ContractViolation } from '../src/testing.js';
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

  it('reports options.skip as the reason', async () => {
    const s = await providerContract({ make: (seed) => createInMemoryProvider(seed), skip: { 'getList sort by several keys': 'no multi-key sort' } });
    expect(s.find((c) => c.name === 'getList sort by several keys')!.skip).toBe('no multi-key sort');
  });
});
