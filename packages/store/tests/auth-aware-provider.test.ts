import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { createAuthAwareProvider, mergeByUpdatedAt } from '../src/auth-aware-provider.js';
import { providerContract } from '../src/testing.js';
import type { DataProvider } from '../src/data-provider.js';

interface Preset {
  id: string;
  name: string;
  updatedAt?: string;
  [k: string]: unknown;
}

const p = (id: string, name: string, updatedAt = '2026-01-01T00:00:00Z'): Preset => ({ id, name, updatedAt });

function setup(localSeed: Preset[], remoteSeed: Preset[], extra = {}) {
  const local = createInMemoryProvider<Preset>(localSeed);
  const account = createInMemoryProvider<Preset>(remoteSeed);
  const auth = { signedIn: false };
  const provider = createAuthAwareProvider<Preset>({
    local,
    remote: () => (auth.signedIn ? account : null),
    ...extra,
  });
  return { local, account, auth, provider };
}

const ids = async (dp: DataProvider<Preset>) => (await dp.getList({})).data.map((x) => x.id).sort();

describe('createAuthAwareProvider', () => {
  it('reads and writes local while signed out', async () => {
    const { local, account, provider } = setup([p('a', 'A')], [p('r', 'R')]);
    await provider.create(p('b', 'B'));
    expect(await ids(provider)).toEqual(['a', 'b']);
    expect(await ids(local)).toEqual(['a', 'b']);
    expect(await ids(account)).toEqual(['r']);
    expect(provider.source()).toBe('local');
  });

  it('merges local records up on first sign-in: union, the newer updatedAt wins', async () => {
    const { account, auth, provider } = setup(
      [p('a', 'local-new', '2026-03-01T00:00:00Z'), p('b', 'local-old', '2026-01-01T00:00:00Z'), p('c', 'only-local')],
      [p('a', 'remote-old', '2026-02-01T00:00:00Z'), p('b', 'remote-new', '2026-02-01T00:00:00Z'), p('r', 'R')],
    );
    auth.signedIn = true;
    expect(await provider.refresh()).toBe('remote');
    const byId = Object.fromEntries((await account.getList({})).data.map((x) => [x.id, x.name]));
    expect(byId).toEqual({ a: 'local-new', b: 'remote-new', c: 'only-local', r: 'R' });
    expect(await ids(provider)).toEqual(['a', 'b', 'c', 'r']);
  });

  it('appendOnly: union, never overwriting', async () => {
    const { account, auth, provider } = setup(
      [p('a', 'local', '2030-01-01T00:00:00Z'), p('c', 'new')],
      [p('a', 'remote', '2020-01-01T00:00:00Z')],
      { appendOnly: true },
    );
    auth.signedIn = true;
    await provider.refresh();
    expect((await account.getOne('a')).name).toBe('remote');
    expect((await account.getOne('c')).name).toBe('new');
  });

  it('writes go to the account while signed in, and local again after sign-out, losing nothing', async () => {
    const { local, account, auth, provider } = setup([p('a', 'A')], []);
    auth.signedIn = true;
    await provider.create(p('s', 'signed-in'));
    expect(await ids(account)).toEqual(['a', 's']);
    auth.signedIn = false;
    expect(await ids(provider)).toContain('a');
    await provider.create(p('o', 'offline'));
    expect(await ids(local)).toContain('o');
    expect(await ids(account)).not.toContain('o');
  });

  it('merges once per remote provider', async () => {
    let merges = 0;
    const { auth, provider } = setup([p('a', 'A')], [], {
      merge: async () => {
        merges++;
        return { written: [], kept: [] };
      },
    });
    auth.signedIn = true;
    await Promise.all([provider.getList({}), provider.getList({}), provider.refresh()]);
    await provider.getOne('a').catch(() => {});
    expect(merges).toBe(1);
  });

  it('a failed merge is retried, and until then the cache never touches local', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const { local, auth, provider } = setup([p('a', 'A'), p('b', 'B')], [], {
      merge: async (l: DataProvider<Preset>, r: DataProvider<Preset>) => {
        if (fail) throw new Error('offline');
        return mergeByUpdatedAt<Preset>()(l, r);
      },
      onMergeError: (e: unknown) => errors.push(e),
      tier: { maxItems: 0 }, // the cache would evict everything it holds
    });
    auth.signedIn = true;
    await provider.getList({});
    expect(errors).toHaveLength(1);
    expect(await ids(local)).toEqual(['a', 'b']); // unmerged records are still on the device
    fail = false;
    expect(await ids(provider)).toEqual(['a', 'b']);
  });

  it('announces switches, and subscribe follows the current provider', async () => {
    const { auth, provider } = setup([], []);
    const switches: unknown[] = [];
    provider.onSwitch((e) => switches.push(e));
    await provider.refresh();
    auth.signedIn = true;
    await provider.refresh();
    auth.signedIn = false;
    await provider.refresh();
    expect(switches).toEqual([
      { from: 'local', to: 'remote' },
      { from: 'remote', to: 'local' },
    ]);
  });
});

describe('auth-aware provider: DataProvider contract', async () => {
  for (const signedIn of [false, true]) {
    const cases = await providerContract({
      make: (seed) => {
        const local = createInMemoryProvider<any>(signedIn ? [] : seed);
        const account = createInMemoryProvider<any>(signedIn ? seed : []);
        return createAuthAwareProvider<any>({ local, remote: () => (signedIn ? account : null) });
      },
    });
    for (const c of cases) (c.skip ? it.skip : it)(`${signedIn ? 'signed in' : 'signed out'}: ${c.name}`, c.run);
  }
});
