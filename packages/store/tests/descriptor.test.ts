import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineProviderDescriptor,
  createFromDescriptor,
  isProviderSupported,
  secretOptionPaths,
  redactOptions,
  splitOptions,
  liveOptionPaths,
  LIVE,
  describedCapabilities,
  inMemoryDescriptor,
  bifurcatedDescriptor,
  type ProviderDescriptor,
} from '../src/descriptor.js';
import { createInMemoryProvider } from '../src/in-memory.js';
import { providerContract } from '../src/testing.js';

const s3Like = defineProviderDescriptor({
  name: 's3Like',
  label: 'S3-like',
  source: { module: 'example', export: 'descriptor' },
  runtime: 'node',
  options: z.object({
    bucket: z.string(),
    credentials: z.object({ accessKeyId: z.string(), secretAccessKey: z.string() }).optional(),
    sessionPin: z.string().meta({ sensitivity: 'secret' }).optional(),
    region: z.string().optional(),
    client: z.custom<object>().optional(),
  }),
  capabilities: (o) => ({ serverSearch: Boolean(o.region) }),
  create: (o) => {
    if (o.region === 'boom') throw new Error(`cannot reach with ${o.credentials?.secretAccessKey}`);
    return createInMemoryProvider([]);
  },
});

describe('provider descriptors', () => {
  it('rejects a malformed descriptor', () => {
    expect(() => defineProviderDescriptor({ ...s3Like, name: 'has space' })).toThrow(/identifier-like/);
  });

  it('validates options before create, naming the descriptor', async () => {
    await expect(createFromDescriptor(s3Like, { accessKeyId: 'x' })).rejects.toThrow(/provider "s3Like"/);
    await expect(createFromDescriptor(s3Like, { bucket: 'b', accessKeyId: 'x' })).resolves.toBeDefined();
  });

  it('finds nested and name-only secrets as paths', () => {
    // `credentials` is itself a secret-looking name, so the whole object is secret (fail-safe).
    expect(secretOptionPaths(s3Like).map((p) => p.join('.')).sort()).toEqual(['credentials', 'sessionPin']);
    const nested = defineProviderDescriptor({ ...s3Like, name: 'nested', options: z.object({ account: z.object({ accessKeyId: z.string(), region: z.string() }) }) });
    expect(secretOptionPaths(nested).map((p) => p.join('.'))).toEqual(['account.accessKeyId']);
    expect(secretOptionPaths(inMemoryDescriptor)).toEqual([]);
  });

  it('redacts and splits options for sharing; live options are left out', () => {
    const opts = { bucket: 'b', credentials: { accessKeyId: 'AKIA9999', secretAccessKey: 'shh-very' }, client: { x: 1 } };
    expect(redactOptions(s3Like, opts)).toEqual({ bucket: 'b', credentials: '[secret]', client: LIVE });
    expect(liveOptionPaths(s3Like)).toEqual([['client']]);
    const split = splitOptions(s3Like, opts);
    expect(split.data).toEqual({ bucket: 'b', credentials: '[secret]' });
    expect(split.live).toEqual([['client']]);
  });

  it('never puts a secret value in an error', async () => {
    const opts = { bucket: 'b', region: 'boom', credentials: { accessKeyId: 'AKIA9999', secretAccessKey: 'shh-very' } };
    const err = await createFromDescriptor(s3Like, opts).catch((e) => e as Error);
    expect(err.message).toMatch(/could not be created/);
    expect(err.message).not.toContain('shh-very');
    const refined = defineProviderDescriptor({
      ...s3Like,
      name: 'refined',
      options: z.object({ token: z.string().refine((v) => v.startsWith('ok'), { error: (i) => `bad ${i.input}` }) }),
    });
    const verr = await createFromDescriptor(refined, { token: 'LEAKME-123' }).catch((e) => e as Error);
    expect(verr.message).not.toContain('LEAKME-123');
  });

  it('refuses a secret with a default, a non-v4 schema, and an unknown runtime', () => {
    expect(() => defineProviderDescriptor({ ...s3Like, options: z.object({ apiKey: z.string().default('sk-live') }) })).toThrow(/would be published/);
    // a name-only match with a non-string default is not a secret leak (maxTokens is not a secret at all)
    expect(() => defineProviderDescriptor({ ...s3Like, name: 'llm', options: z.object({ maxTokens: z.number().default(1000), pinCount: z.number().default(3) }) })).not.toThrow();
    expect(() => defineProviderDescriptor({ ...s3Like, options: { safeParse: () => ({}) } as any })).toThrow(/Zod v4/);
    expect(() => defineProviderDescriptor({ ...s3Like, runtime: 'nodejs' as any })).toThrow(/runtime/);
  });

  it('regressions from the verification review: no leak paths', async () => {
    const mk = (name: string, options: any, create: any = () => createInMemoryProvider([])) =>
      defineProviderDescriptor({ ...s3Like, name, options, capabilities: undefined, create });
    // a transform that throws, with a secret in the options
    const tr = mk('tr', z.object({ apiKey: z.string(), url: z.string().transform((u) => { throw new Error(`bad key sk-LEAK-0001 for ${u}`); }) }));
    const e1 = await createFromDescriptor(tr, { apiKey: 'sk-LEAK-0001', url: 'x' }).catch((e) => e as Error);
    expect(e1.message).not.toContain('sk-LEAK-0001');
    // a short or numeric secret echoed by an object-level refine
    const ref = mk('ref', z.object({ pin: z.string(), n: z.number() }).refine(() => false, { error: (i: any) => `pin=${i.input.pin} n=${i.input.n}` }));
    const e2 = await createFromDescriptor(ref, { pin: '123', n: 987654 }).catch((e) => e as Error);
    expect(e2.message).not.toContain('123');
    // an encoded secret in a create() error
    const enc = mk('enc', z.object({ password: z.string() }), (o: any) => { throw new Error(`u:${encodeURIComponent(o.password)}@h ${JSON.stringify(o.password)}`); });
    const e3 = await createFromDescriptor(enc, { password: 'p@ss"word/1' }).catch((e) => e as Error);
    expect(e3.message).not.toMatch(/p%40ss|p@ss/);
    // redact never writes into the caller's object, even through a class instance
    class Auth { constructor(public password: string) {} }
    const live = mk('live', z.object({ auth: z.custom<Auth>() }));
    const o = { auth: new Auth('hunter2') };
    expect(JSON.stringify(redactOptions(live, o))).not.toContain('hunter2');
    expect(o.auth.password).toBe('hunter2');
    // a record of headers: the runtime key Authorization is redacted by name
    const hdr = mk('hdr', z.object({ headers: z.record(z.string(), z.string()) }));
    expect(redactOptions(hdr, { headers: { Authorization: 'Bearer zzz', Accept: 'json' } })).toEqual({ headers: { Authorization: '[secret]', Accept: 'json' } });
    // nested live options are paths
    const nl = mk('nl', z.object({ conn: z.object({ client: z.custom<object>(), region: z.string() }) }));
    expect(liveOptionPaths(nl)).toEqual([['conn', 'client']]);
    expect(splitOptions(nl, { conn: { client: { k: 1 }, region: 'eu' } }).data).toEqual({ conn: { region: 'eu' } });
    // a default inside a union branch, a container default, a catch and examples are all refused for marked secrets
    expect(() => mk('u', z.object({ a: z.union([z.object({ k: z.string().meta({ sensitivity: 'secret' }).default('sk-U') }), z.object({ j: z.number() })]) }))).toThrow(/would be published/);
    expect(() => mk('c', z.object({ auth: z.object({ apiKey: z.string() }).default({ apiKey: 'sk-C' }) }))).toThrow(/would be published/);
    expect(() => mk('k', z.object({ s: z.string().meta({ sensitivity: 'secret' }).catch('sk-K') }))).toThrow(/would be published/);
    expect(() => mk('x', z.object({ s: z.string().meta({ sensitivity: 'secret', examples: ['sk-X'] }) }))).toThrow(/would be published/);
  });

  it('round 2: record keys never printed; env-fallback secrets withheld; Map values; composites; intersections', async () => {
    const mk = (name: string, options: any, create: any = () => createInMemoryProvider([])) =>
      defineProviderDescriptor({ ...s3Like, name, options, capabilities: undefined, create });
    const S = 'sk-live-SECRET123';
    const rec = mk('rec', z.object({ apiKeys: z.record(z.string(), z.number()) }));
    const e1 = await createFromDescriptor(rec, { apiKeys: { [S]: 'x' } }).catch((e) => e as Error);
    expect(e1.message).not.toContain(S);
    expect(e1.message).toMatch(/apiKeys\.\*/);
    process.env.ZODAL_TEST_KEY = S;
    const env = mk('env', z.object({ apiKey: z.string().optional().transform((v) => v ?? process.env.ZODAL_TEST_KEY!) }),
      (o: any) => { throw new Error(`401 for key ${o.apiKey}`); });
    const e2 = await createFromDescriptor(env, {}).catch((e) => e as Error);
    expect(e2.message).not.toContain(S);
    const mp = mk('mp', z.object({ headers: z.map(z.string(), z.string().meta({ sensitivity: 'secret' })) }),
      (o: any) => { throw new Error(`bad header ${[...o.headers.values()][0]}`); });
    const e3 = await createFromDescriptor(mp, { headers: new Map([['Authorization', S]]) }).catch((e) => e as Error);
    expect(e3.message).not.toContain(S);
    const inter = mk('inter', z.object({ region: z.string() }).and(z.object({ client: z.custom<object>() })));
    expect(liveOptionPaths(inter)).toEqual([['client']]);
    const fnCaps = { ...bifurcatedDescriptor([inMemoryDescriptor]), name: 'fnCaps', capabilities: () => ({}) } as ProviderDescriptor;
    const outer = bifurcatedDescriptor([fnCaps, inMemoryDescriptor], { name: 'outer' });
    await expect(createFromDescriptor(outer, { metadata: { name: 'fnCaps' }, content: { name: 'inMemory' }, contentFields: ['b'] })).rejects.toThrow(/Invalid options/);
  });

  it('round 3: keys never printed, object secrets withhold messages, overrides for name matches', async () => {
    const mk = (name: string, options: any, create: any = () => createInMemoryProvider([])) =>
      defineProviderDescriptor({ ...s3Like, name, options, capabilities: undefined, create });
    const S = 'SECRET1234';
    const strict = mk('strict', z.strictObject({ region: z.string() }));
    const e1 = await createFromDescriptor(strict, { region: 'eu', [S]: 1 }).catch((e) => e as Error);
    expect(e1.message).not.toContain(S);
    expect(e1.message).toMatch(/1 unrecognized key/);
    const url = mk('url', z.object({ databaseUrl: z.instanceof(URL) }), (o: any) => { throw new Error(`cannot connect to ${o.databaseUrl}`); });
    const e2 = await createFromDescriptor(url, { databaseUrl: new URL('postgres://u:SECRETpw@h/db') }).catch((e) => e as Error);
    expect(e2.message).not.toContain('SECRETpw');
    const named = mk('named', z.object({ apiKey: z.string() }), (o: any) => { const err = new Error('x'); err.name = `Auth ${o.apiKey}`; throw err; });
    const e3 = await createFromDescriptor(named, { apiKey: 'sk-NAME-LEAK' }).catch((e) => e as Error);
    expect(e3.message).not.toContain('sk-NAME-LEAK');
    const mapKeys = mk('mapKeys', z.object({ m: z.map(z.number(), z.number()) }));
    const e4 = await createFromDescriptor(mapKeys, { m: new Map([[123456789, 'x']]) }).catch((e) => e as Error);
    expect(e4.message).not.toContain('123456789');
    // ordinary settings with secret-looking first words are fine, with defaults
    expect(() => mk('settings', z.object({ authMode: z.enum(['none', 'basic']).default('none'), tokenEndpoint: z.string().default('https://x/token'), storageKey: z.string().default('items') }))).not.toThrow();
    // a name match can be declared public
    const fetchy = mk('fetchy', z.object({ init: z.object({ credentials: z.enum(['include', 'omit']).default('include').meta({ sensitivity: 'public' }) }) }));
    expect(redactOptions(fetchy, { init: { credentials: 'include' } } as any)).toEqual({ init: { credentials: 'include' } });
  });

  it('bifurcated bulk ops: numeric ids, pagination defaults and duplicates', async () => {
    const { createBifurcatedProvider } = await import('../src/bifurcated-provider.js');
    const meta = createInMemoryProvider<any>(Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `t${i}` })));
    const paged = { ...meta, getList: (p: any) => meta.getList({ ...p, pagination: p.pagination ?? { page: 1, pageSize: 10 } }) };
    const p = createBifurcatedProvider<any>({ metadataProvider: paged as any, contentProvider: createInMemoryProvider<any>([]), contentFields: ['body'] });
    const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
    const updated = await p.updateMany([...ids, '1'], { title: 'x' });
    expect(updated.length).toBe(30);
  });

  it('bifurcated: duplicate child names refused; required child options validated up front; transforms run once', async () => {
    expect(() => bifurcatedDescriptor([inMemoryDescriptor, inMemoryDescriptor])).toThrow(/two child descriptors/);
    let runs = 0;
    const once = defineProviderDescriptor({ ...s3Like, name: 'once', capabilities: undefined,
      options: z.object({ endpoint: z.string().transform((s) => { runs++; return new URL(s); }) }),
      create: () => createInMemoryProvider([]) });
    const bif = bifurcatedDescriptor([inMemoryDescriptor, once]);
    await expect(createFromDescriptor(bif, { metadata: { name: 'once' }, content: { name: 'inMemory' }, contentFields: ['body'] })).rejects.toThrow(/metadata\.options\.endpoint/);
    await createFromDescriptor(bif, { metadata: { name: 'once', options: { endpoint: 'https://a.b' } }, content: { name: 'inMemory' }, contentFields: ['body'] });
    expect(runs).toBe(1);
  });

  it('resolves option-dependent capabilities', () => {
    expect(describedCapabilities(s3Like, { bucket: 'b', region: 'eu' })).toEqual({ serverSearch: true });
    expect(describedCapabilities(s3Like)).toEqual({});
  });

  it('checks runtime; supports() decides when present', async () => {
    expect(await isProviderSupported(s3Like, 'browser')).toBe(false);
    expect(await isProviderSupported(s3Like, 'node')).toBe(true);
    const flaky = { ...inMemoryDescriptor, supports: () => { throw new Error('private mode'); } } as ProviderDescriptor;
    expect(await isProviderSupported(flaky, 'browser')).toBe(false);
    const nodeButWorks = { ...s3Like, supports: () => true } as ProviderDescriptor;
    expect(await isProviderSupported(nodeButWorks, 'browser')).toBe(true);
  });

  it('the in-memory descriptor passes the DataProvider contract', async () => {
    const cases = await providerContract({ make: (seed) => createFromDescriptor(inMemoryDescriptor, { data: seed }) });
    for (const c of cases) if (!c.skip) await c.run();
  });

  it('bifurcated: a real union over its children, their secrets visible, unknown names rejected', async () => {
    const bif = bifurcatedDescriptor([inMemoryDescriptor, s3Like]);
    const p = await createFromDescriptor(bif, { metadata: { name: 'inMemory' }, content: { name: 'inMemory' }, contentFields: ['body'] });
    await p.create({ id: 'a', title: 'A', tags: ['x'], body: 'long text' } as any);
    const listed = await p.getList({ filter: { field: 'tags', operator: 'arrayContains', value: 'x' } });
    expect(listed.total).toBe(1);
    expect((listed.data[0] as any).body?._tag).toBe('ContentRef');
    await expect(
      createFromDescriptor(bif, { metadata: { name: 'nope' }, content: { name: 'inMemory' }, contentFields: ['body'] }),
    ).rejects.toThrow(/Invalid options/);
    const withSecret = { metadata: { name: 's3Like', options: { bucket: 'b', credentials: { accessKeyId: 'AKIA9999', secretAccessKey: 'shh-very' } } }, content: { name: 'inMemory' }, contentFields: ['body'] };
    expect(secretOptionPaths(bif, withSecret).map((p) => p.join('.'))).toContain('metadata.options.credentials');
    expect(JSON.stringify(redactOptions(bif, withSecret as any))).not.toContain('shh-very');
  });

  it('bifurcated refuses a child that cannot run here, and composites as children', async () => {
    const bif = bifurcatedDescriptor([inMemoryDescriptor, { ...s3Like, supports: () => false } as ProviderDescriptor]);
    await expect(
      createFromDescriptor(bif, { metadata: { name: 's3Like', options: { bucket: 'b' } }, content: { name: 'inMemory' }, contentFields: ['body'] }),
    ).rejects.toThrow(/cannot run here/);
    const nested = bifurcatedDescriptor([bif, inMemoryDescriptor], { name: 'outer' });
    await expect(
      createFromDescriptor(nested, { metadata: { name: 'bifurcated' }, content: { name: 'inMemory' }, contentFields: ['body'] }),
    ).rejects.toThrow(/Invalid options/);
  });

  it('a bifurcated provider built from descriptors passes the DataProvider contract', async () => {
    const bif = bifurcatedDescriptor([inMemoryDescriptor]);
    const cases = await providerContract({
      make: async (seed) => {
        const p = await createFromDescriptor(bif, { metadata: { name: 'inMemory' }, content: { name: 'inMemory' }, contentFields: ['body'] });
        for (const row of seed) await p.create(row as any);
        return p;
      },
    });
    for (const c of cases) if (!c.skip) await c.run();
    expect(cases.find((c) => c.name.startsWith('upsert'))!.skip).toMatch(/canUpsert: false/);
  });
});
