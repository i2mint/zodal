/**
 * `@zodal/store/testing` — the DataProvider conformance kit.
 *
 * Every `zodal-store-*` adapter is required to test the same contract (CRUD,
 * `getList` with filter/search/sort/pagination, honest capabilities, errors).
 * Before this kit each adapter wrote its own copy of those tests, and the copies
 * drifted. This module is the one statement of the contract, as plain data:
 *
 * ```ts
 * import { describe, it } from 'vitest';
 * import { providerContract } from '@zodal/store/testing';
 *
 * const cases = await providerContract({ make: (seed) => createMyProvider(seed) });
 *
 * describe('my adapter: DataProvider contract', () => {
 *   for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
 * });
 * ```
 *
 * It depends on no test framework: each case's `run` throws a
 * {@link ContractViolation} on failure, so it works under vitest, jest, node:test
 * or a plain script.
 */

import type { DataProvider } from './data-provider.js';
import type { ProviderCapabilities } from './capabilities.js';
import { DEFAULT_CAPABILITIES } from './capabilities.js';

/** The row type every contract case uses. */
export interface ContractRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  priority: number;
  tags: string[];
}

/** The rows a provider under test must hold when a case starts (fresh copies per case). */
export const CONTRACT_SEED: readonly Readonly<ContractRow>[] = deepFreeze([
  { id: '1', name: 'Alpha Project', status: 'active', priority: 3, tags: ['web', 'frontend'] },
  { id: '2', name: 'Beta API', status: 'draft', priority: 1, tags: ['api'] },
  { id: '3', name: 'Gamma Platform', status: 'archived', priority: 5, tags: ['web', 'api', 'backend'] },
  { id: '4', name: 'Delta Service', status: 'active', priority: 2, tags: ['api', 'microservice'] },
  { id: '5', name: 'Epsilon UI', status: 'draft', priority: 4, tags: ['web', 'frontend', 'design'] },
] as ContractRow[]);

function deepFreeze<V>(value: V): V {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export interface ProviderContractOptions {
  /**
   * Build a provider that holds exactly `seed` (keyed by `id`). Called once per
   * case, so cases never see each other's writes. May be async (create a temp dir,
   * seed a bucket, ...).
   */
  make: (seed: ContractRow[]) => DataProvider<ContractRow> | Promise<DataProvider<ContractRow>>;
  /**
   * Cases to skip, by name, with the reason (reported as the case's `skip`).
   * A skip is a documented deviation from the contract, not a silent one.
   */
  skip?: Record<string, string>;
  /** Release what `make` created (a temp dir, a bucket prefix...); called after each case. */
  dispose?: (provider: DataProvider<ContractRow>) => void | Promise<void>;
}

export interface ContractCase {
  /** Stable, human-readable name (also the key for `options.skip`). */
  name: string;
  /** Throws {@link ContractViolation} when the provider breaks the contract. */
  run: () => Promise<void>;
  /** Why this case is skipped (from `options.skip`, or a capability the provider declares false). */
  skip?: string;
}

/** Thrown by a contract case: what was expected, and what the provider did. */
export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

function fail(message: string): never {
  throw new ContractViolation(message);
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Map || b instanceof Map || a instanceof Set || b instanceof Set) {
    if (a.constructor !== b.constructor) return false;
    return deepEqual([...(a as any).entries()], [...(b as any).entries()]);
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

function equal(actual: unknown, expected: unknown, what: string): void {
  if (!deepEqual(actual, expected)) {
    fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** `actual` has every field of `expected` with the same value (extra fields allowed). */
function hasFields(actual: unknown, expected: Record<string, unknown>, what: string): void {
  if (typeof actual !== 'object' || actual === null) fail(`${what}: expected an object, got ${show(actual)}`);
  for (const [k, v] of Object.entries(expected)) {
    if (!deepEqual((actual as any)[k], v)) {
      fail(`${what}: field "${k}" expected ${show(v)}, got ${show((actual as any)[k])}`);
    }
  }
}

/** `call` rejects or throws (synchronously too: a read-only stub may just `throw`). */
async function rejects(call: () => unknown, what: string): Promise<void> {
  let threw = false;
  try {
    await call();
  } catch {
    threw = true;
  }
  if (!threw) fail(`${what}: expected the call to reject, but it resolved`);
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);
const sortedIds = (rows: readonly { id: string }[]) => [...ids(rows)].sort();

/**
 * The DataProvider contract as a list of independent cases.
 *
 * Async because it builds one provider to read `getCapabilities()`. Write cases
 * are skipped, with the reason, when the provider says it cannot do them; the
 * case "a write the capabilities refuse is refused" then checks that the refused
 * call really rejects, so capabilities must be honest.
 */
export async function providerContract(options: ProviderContractOptions): Promise<ContractCase[]> {
  const fresh = async () => {
    const seed = CONTRACT_SEED.map((r) => ({ ...r, tags: [...r.tags] }));
    const provider = await options.make(seed);
    const caps: ProviderCapabilities = provider.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
    return { provider, caps };
  };

  type Body = (p: DataProvider<ContractRow>, caps: ProviderCapabilities) => Promise<void>;
  type Gate = (caps: ProviderCapabilities) => string | undefined;
  const cases: { name: string; body: Body; gate?: Gate }[] = [];
  const add = (name: string, body: Body, gate?: Gate) => cases.push({ name, body, gate });

  /** Skip when the provider declares `filterOperators` that leave one of `ops` out for `field`. */
  const ops = (field: string, ...wanted: string[]): Gate => (caps) => {
    const declared = caps.filterOperators;
    if (!declared) return undefined;
    const allowed = declared[field] ?? declared['*'];
    if (!allowed) return undefined;
    const missing = wanted.filter((o) => !(allowed as string[]).includes(o));
    return missing.length
      ? `provider declares filterOperators without ${missing.join(', ')} for "${field}"`
      : undefined;
  };

  // ---- getList: reads ------------------------------------------------------

  add('getList with no params returns every item and the total', async (p) => {
    const r = await p.getList({});
    equal(sortedIds(r.data), ['1', '2', '3', '4', '5'], 'ids');
    equal(r.total, 5, 'total');
  });

  add('getList filter eq', async (p) => {
    const r = await p.getList({ filter: { field: 'status', operator: 'eq', value: 'active' } });
    equal(sortedIds(r.data), ['1', '4'], 'ids');
    equal(r.total, 2, 'total');
  }, ops('status', 'eq'));

  add('getList filter arrayContains (a tag)', async (p) => {
    const r = await p.getList({ filter: { field: 'tags', operator: 'arrayContains', value: 'frontend' } });
    equal(sortedIds(r.data), ['1', '5'], 'ids');
  }, ops('tags', 'arrayContains'));

  add('getList filter arrayContainsAny (any of several tags)', async (p) => {
    const r = await p.getList({
      filter: { field: 'tags', operator: 'arrayContainsAny', value: ['design', 'backend'] },
    });
    equal(sortedIds(r.data), ['3', '5'], 'ids');
  }, ops('tags', 'arrayContainsAny'));

  add('getList filter and/or compound', async (p) => {
    const r = await p.getList({
      filter: {
        and: [
          { field: 'priority', operator: 'gte', value: 2 },
          {
            or: [
              { field: 'status', operator: 'eq', value: 'draft' },
              { field: 'status', operator: 'eq', value: 'archived' },
            ],
          },
        ],
      },
    });
    equal(sortedIds(r.data), ['3', '5'], 'ids');
  }, (caps) => ops('priority', 'gte')(caps) ?? ops('status', 'eq')(caps));

  add('getList filter not (negation of a compound)', async (p) => {
    const r = await p.getList({
      filter: {
        not: {
          or: [
            { field: 'status', operator: 'eq', value: 'active' },
            { field: 'priority', operator: 'gte', value: 5 },
          ],
        },
      },
    });
    equal(sortedIds(r.data), ['2', '5'], 'ids');
  }, (caps) => ops('status', 'eq')(caps) ?? ops('priority', 'gte')(caps));

  add('getList filter contains (substring of a string field)', async (p) => {
    const r = await p.getList({ filter: { field: 'name', operator: 'contains', value: 'Platform' } });
    equal(sortedIds(r.data), ['3'], 'ids');
  }, ops('name', 'contains'));

  add('getList filter in and ne', async (p) => {
    const r = await p.getList({ filter: { field: 'status', operator: 'in', value: ['draft', 'archived'] } });
    equal(sortedIds(r.data), ['2', '3', '5'], 'in ids');
    const n = await p.getList({ filter: { field: 'status', operator: 'ne', value: 'draft' } });
    equal(sortedIds(n.data), ['1', '3', '4'], 'ne ids');
  }, ops('status', 'in', 'ne'));

  add('getList search is a case-insensitive substring match', async (p) => {
    const r = await p.getList({ search: 'api' });
    equal(sortedIds(r.data), ['2'], 'ids');
    equal(r.total, 1, 'total');
  });

  add('getList sort ascending and descending', async (p) => {
    const asc = await p.getList({ sort: [{ id: 'priority', desc: false }] });
    equal(ids(asc.data), ['2', '4', '1', '5', '3'], 'ascending ids');
    const desc = await p.getList({ sort: [{ id: 'priority', desc: true }] });
    equal(ids(desc.data), ['3', '5', '1', '4', '2'], 'descending ids');
  });

  add('getList sort by several keys', async (p) => {
    const r = await p.getList({
      sort: [
        { id: 'status', desc: false },
        { id: 'priority', desc: true },
      ],
    });
    equal(ids(r.data), ['1', '4', '3', '5', '2'], 'ids');
  });

  add('getList pagination is 1-based and total counts every match', async (p) => {
    const sort = [{ id: 'priority', desc: false }];
    const page2 = await p.getList({ sort, pagination: { page: 2, pageSize: 2 } });
    equal(ids(page2.data), ['1', '5'], 'page 2 ids');
    equal(page2.total, 5, 'total');
    const last = await p.getList({ sort, pagination: { page: 3, pageSize: 2 } });
    equal(ids(last.data), ['3'], 'last page ids');
    const beyond = await p.getList({ sort, pagination: { page: 4, pageSize: 2 } });
    equal(beyond.data.length, 0, 'items beyond the last page');
    equal(beyond.total, 5, 'total beyond the last page');
  });

  add('getList search with a filter and pagination: total counts every match', async (p) => {
    // 'h' matches "Alpha Project" and (status) "archived" among the three web items,
    // so a total counted before the search (3) or after the page (1) is caught.
    const r = await p.getList({
      search: 'h',
      filter: { field: 'tags', operator: 'arrayContains', value: 'web' },
      sort: [{ id: 'priority', desc: false }],
      pagination: { page: 1, pageSize: 1 },
    });
    equal(ids(r.data), ['1'], 'ids');
    equal(r.total, 2, 'total');
  }, ops('tags', 'arrayContains'));

  add('getList total counts filtered items, not the page', async (p) => {
    const r = await p.getList({
      filter: { field: 'tags', operator: 'arrayContains', value: 'web' },
      pagination: { page: 1, pageSize: 2 },
    });
    equal(r.data.length, 2, 'page size');
    equal(r.total, 3, 'total');
  });

  // ---- getOne --------------------------------------------------------------

  add('getOne returns the item', async (p) => {
    const item = await p.getOne('3');
    hasFields(item, { ...CONTRACT_SEED[2] }, 'getOne("3")');
  });

  add('getOne of a missing id rejects', async (p) => {
    await rejects(() => p.getOne('nope'), 'getOne("nope")');
  });

  add('mutating a returned item, or its arrays, does not change the store', async (p) => {
    const item = await p.getOne('1');
    item.name = 'mutated';
    item.tags.push('mutated');
    hasFields(await p.getOne('1'), { name: 'Alpha Project', tags: ['web', 'frontend'] }, 'getOne("1") after mutating a getOne result');
    const listed = (await p.getList({})).data.find((r) => r.id === '1')!;
    listed.name = 'mutated';
    listed.tags.push('mutated');
    hasFields(await p.getOne('1'), { name: 'Alpha Project', tags: ['web', 'frontend'] }, 'getOne("1") after mutating a getList result');
  });

  // ---- writes (each gated on an honest capability) -------------------------

  const can = (flag: keyof ProviderCapabilities, verb: string): Gate => (caps) =>
    caps[flag] ? undefined : `provider declares ${String(flag)}: false (${verb} not supported)`;

  add(
    'create with an explicit id stores the item',
    async (p) => {
      const created = await p.create({ id: '6', name: 'Zeta', status: 'draft', priority: 6, tags: [] });
      hasFields(created, { id: '6', name: 'Zeta' }, 'create result');
      hasFields(await p.getOne('6'), { id: '6', name: 'Zeta', priority: 6 }, 'getOne("6")');
      equal((await p.getList({})).total, 6, 'total after create');
    },
    can('canCreate', 'create'),
  );

  add(
    'create without an id assigns one',
    async (p) => {
      const created = await p.create({ name: 'Eta', status: 'draft', priority: 7, tags: [] });
      if (typeof created.id !== 'string' || created.id === '') fail(`create result: expected a string id, got ${show(created.id)}`);
      if (CONTRACT_SEED.some((r) => r.id === created.id)) fail(`create result: assigned id "${created.id}" collides with an existing item`);
      hasFields(await p.getOne(created.id), { name: 'Eta' }, `getOne("${created.id}")`);
      equal((await p.getList({})).total, 6, 'total after create');
    },
    can('canCreate', 'create'),
  );

  add(
    'create with an id that already exists rejects',
    async (p) => {
      await rejects(() => p.create({ id: '1', name: 'dup', status: 'draft', priority: 0, tags: [] }), 'create({id: "1"})');
      hasFields(await p.getOne('1'), { name: 'Alpha Project' }, 'getOne("1") after the refused create');
      equal((await p.getList({})).total, 5, 'total after the refused create');
    },
    can('canCreate', 'create'),
  );

  add(
    'update merges the given fields and keeps the others',
    async (p) => {
      const updated = await p.update('2', { status: 'active' });
      hasFields(updated, { id: '2', status: 'active', name: 'Beta API', priority: 1 }, 'update result');
      hasFields(await p.getOne('2'), { status: 'active', name: 'Beta API', tags: ['api'] }, 'getOne("2")');
    },
    can('canUpdate', 'update'),
  );

  add(
    'update of a missing id rejects',
    async (p) => {
      await rejects(() => p.update('nope', { name: 'x' }), 'update("nope")');
    },
    can('canUpdate', 'update'),
  );

  add(
    'updateMany applies the same patch to each id',
    async (p) => {
      const updated = await p.updateMany(['1', '3'], { priority: 9 });
      equal(sortedIds(updated), ['1', '3'], 'updated ids');
      hasFields(await p.getOne('1'), { priority: 9, name: 'Alpha Project' }, 'getOne("1")');
      hasFields(await p.getOne('3'), { priority: 9, name: 'Gamma Platform' }, 'getOne("3")');
      hasFields(await p.getOne('2'), { priority: 1 }, 'getOne("2") untouched');
    },
    can('canBulkUpdate', 'updateMany'),
  );

  add(
    'updateMany skips ids that do not exist',
    async (p) => {
      const updated = await p.updateMany(['1', 'nope'], { priority: 8 });
      equal(sortedIds(updated), ['1'], 'updated ids');
      hasFields(await p.getOne('1'), { priority: 8 }, 'getOne("1")');
      equal((await p.getList({})).total, 5, 'total (no item created for the missing id)');
    },
    can('canBulkUpdate', 'updateMany'),
  );

  add(
    'delete removes the item',
    async (p) => {
      await p.delete('4');
      await rejects(() => p.getOne('4'), 'getOne("4") after delete');
      equal((await p.getList({})).total, 4, 'total after delete');
    },
    can('canDelete', 'delete'),
  );

  add(
    'delete of a missing id rejects',
    async (p) => {
      await rejects(() => p.delete('nope'), 'delete("nope")');
    },
    can('canDelete', 'delete'),
  );

  add(
    'deleteMany removes every listed item',
    async (p) => {
      await p.deleteMany(['1', '2']);
      equal(sortedIds((await p.getList({})).data), ['3', '4', '5'], 'ids after deleteMany');
    },
    can('canBulkDelete', 'deleteMany'),
  );

  add(
    'deleteMany skips ids that do not exist',
    async (p) => {
      await p.deleteMany(['2', 'nope']);
      equal(sortedIds((await p.getList({})).data), ['1', '3', '4', '5'], 'ids after deleteMany');
    },
    can('canBulkDelete', 'deleteMany'),
  );

  add(
    'upsert inserts a new item and replaces an existing one',
    async (p) => {
      if (!p.upsert) fail('provider declares canUpsert: true but has no upsert method');
      await p.upsert({ id: '7', name: 'Theta', status: 'draft', priority: 0, tags: [] });
      hasFields(await p.getOne('7'), { name: 'Theta' }, 'getOne("7") after insert');
      await p.upsert({ id: '1', name: 'Alpha 2', status: 'archived', priority: 3, tags: [] });
      hasFields(await p.getOne('1'), { name: 'Alpha 2', status: 'archived', tags: [] }, 'getOne("1") after replace');
    },
    can('canUpsert', 'upsert'),
  );

  // ---- honesty -------------------------------------------------------------

  add('capabilities are well-formed', async (_p, caps) => {
    for (const flag of ['canCreate', 'canUpdate', 'canDelete', 'canBulkUpdate', 'canBulkDelete', 'canUpsert', 'serverSearch', 'serverPagination'] as const) {
      if (typeof caps[flag] !== 'boolean') fail(`capabilities.${flag}: expected a boolean, got ${show(caps[flag])}`);
    }
    for (const flag of ['serverSort', 'serverFilter'] as const) {
      const v = caps[flag];
      if (typeof v !== 'boolean' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
        fail(`capabilities.${flag}: expected a boolean or string[], got ${show(v)}`);
      }
    }
  });

  add('a write the capabilities refuse is refused', async (p, caps) => {
    const refused: [keyof ProviderCapabilities, () => Promise<unknown>][] = [
      ['canCreate', () => p.create({ id: '9', name: 'x', status: 'draft', priority: 0, tags: [] })],
      ['canUpdate', () => p.update('1', { name: 'x' })],
      ['canDelete', () => p.delete('1')],
      ['canBulkUpdate', () => p.updateMany(['1'], { name: 'x' })],
      ['canBulkDelete', () => p.deleteMany(['1'])],
    ];
    for (const [flag, call] of refused) {
      if (!caps[flag]) await rejects(call, `${String(flag)} is false, so the call`);
    }
  });

  const probe = await fresh();
  const caps = probe.caps;
  await options.dispose?.(probe.provider);
  return cases.map(({ name, body, gate }) => {
    const skip = options.skip?.[name] ?? gate?.(caps);
    const out: ContractCase = {
      name,
      run: async () => {
        const { provider, caps: c } = await fresh();
        try {
          await body(provider, c);
        } finally {
          await options.dispose?.(provider);
        }
      },
    };
    if (skip) out.skip = skip;
    return out;
  });
}
