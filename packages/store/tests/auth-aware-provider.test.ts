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

/** A device store and two accounts; `auth.user` picks the account, null is signed out. */
function setup(localSeed: Preset[], remoteSeed: Preset[], extra = {}) {
  const local = createInMemoryProvider<Preset>(localSeed);
  const accounts: Record<string, DataProvider<Preset>> = {
    alice: createInMemoryProvider<Preset>(remoteSeed),
    bob: createInMemoryProvider<Preset>([]),
  };
  const auth: { user: string | null } = { user: null };
  const provider = createAuthAwareProvider<Preset>({
    local,
    remote: () => (auth.user ? { key: auth.user, provider: accounts[auth.user] } : null),
    ...extra,
  });
  return { local, accounts, account: accounts.alice, auth, provider };
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

  it('merges device records up on sign-in: union, the newer updatedAt wins', async () => {
    const { account, auth, provider } = setup(
      [p('a', 'local-new', '2026-03-01T00:00:00Z'), p('b', 'local-old', '2026-01-01T00:00:00Z'), p('c', 'only-local')],
      [p('a', 'remote-old', '2026-02-01T00:00:00Z'), p('b', 'remote-new', '2026-02-01T00:00:00Z'), p('r', 'R')],
    );
    auth.user = 'alice';
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
    auth.user = 'alice';
    await provider.refresh();
    expect((await account.getOne('a')).name).toBe('remote');
    expect((await account.getOne('c')).name).toBe('new');
  });

  it('signed in, writes go to the account and never to local; after sign-out local is the device again', async () => {
    const { local, account, auth, provider } = setup([p('a', 'A')], []);
    auth.user = 'alice';
    await provider.create(p('s', 'signed-in'));
    await provider.getOne('s');
    expect(await ids(account)).toEqual(['a', 's']);
    expect(await ids(local)).toEqual(['a']);
    auth.user = null;
    expect(await ids(provider)).toEqual(['a']);
  });

  it('records made between two sign-ins are merged on the second one', async () => {
    const { account, auth, provider } = setup([], []);
    auth.user = 'alice';
    await provider.refresh();
    auth.user = null;
    await provider.create(p('offline', 'made signed out'));
    auth.user = 'alice';
    await provider.refresh();
    expect(await ids(account)).toEqual(['offline']);
  });

  it("never merges one account's records into another", async () => {
    const { accounts, auth, provider } = setup([p('device', 'D')], [p('secretA', 'A only')]);
    auth.user = 'alice';
    await provider.getOne('secretA');
    auth.user = null;
    await provider.refresh();
    auth.user = 'bob';
    await provider.refresh();
    expect(await ids(accounts.bob)).toEqual(['device']);
  });

  it('a device record merged once is not brought back after the account deletes it', async () => {
    const { account, auth, provider } = setup([p('d', 'D')], []);
    auth.user = 'alice';
    await provider.refresh();
    await account.delete('d'); // deleted on another device
    auth.user = null;
    await provider.refresh();
    auth.user = 'alice';
    await provider.refresh();
    expect(await ids(account)).toEqual([]);
  });

  it('keys accounts, not provider objects: a new provider per call merges once', async () => {
    let merges = 0;
    const local = createInMemoryProvider<Preset>([p('a', 'A')]);
    const store = createInMemoryProvider<Preset>([]);
    const provider = createAuthAwareProvider<Preset>({
      local,
      remote: () => ({ key: 'alice', provider: { ...store } }),
      merge: async (records, remote) => {
        merges++;
        return mergeByUpdatedAt<Preset>()(records, remote);
      },
    });
    for (let i = 0; i < 5; i++) await provider.getList({});
    expect(merges).toBe(1);
  });

  it('merges against every page of a paginated account', async () => {
    const remote = createInMemoryProvider<Preset>([p('a', 'remote-newer', '2026-09-01T00:00:00Z'), p('z', 'Z')]);
    const capped: DataProvider<Preset> = {
      ...remote,
      getList: (params) =>
        remote.getList({ ...params, pagination: { page: params.pagination?.page ?? 1, pageSize: 1 } }),
    };
    const provider = createAuthAwareProvider<Preset>({
      local: createInMemoryProvider([p('a', 'local-older', '2020-01-01T00:00:00Z')]),
      remote: () => ({ key: 'k', provider: capped }),
    });
    await provider.refresh();
    expect((await remote.getOne('a')).name).toBe('remote-newer');
  });

  it('a failed merge is retried and never touches local', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const { local, account, auth, provider } = setup([p('a', 'A'), p('b', 'B')], [], {
      merge: async (records: Preset[], r: DataProvider<Preset>) => {
        if (fail) throw new Error('offline');
        return mergeByUpdatedAt<Preset>()(records, r);
      },
      onMergeError: (e: unknown) => errors.push(e),
    });
    auth.user = 'alice';
    await provider.getList({});
    expect(errors).toHaveLength(1);
    expect(await ids(local)).toEqual(['a', 'b']);
    fail = false;
    await provider.getList({});
    expect(await ids(account)).toEqual(['a', 'b']);
  });

  it('an opt-in cache per account serves the account through a tier', async () => {
    const caches: Record<string, DataProvider<Preset>> = {};
    const { local, auth, provider } = setup([], [p('r', 'R')], {
      cache: (key: string) => (caches[key] ??= createInMemoryProvider<Preset>([])),
    });
    auth.user = 'alice';
    await provider.getOne('r');
    expect(await ids(caches.alice)).toEqual(['r']);
    expect(await ids(local)).toEqual([]);
  });

  it('announces switches, naming the account', async () => {
    const { auth, provider } = setup([], []);
    const switches: unknown[] = [];
    provider.onSwitch((e) => switches.push(e));
    await provider.refresh();
    auth.user = 'alice';
    await provider.refresh();
    auth.user = 'bob';
    await provider.refresh();
    auth.user = null;
    await provider.refresh();
    expect(switches).toEqual([
      { from: 'local', to: 'remote', account: 'alice' },
      { from: 'remote', to: 'remote', account: 'bob' },
      { from: 'remote', to: 'local', account: 'bob' },
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
