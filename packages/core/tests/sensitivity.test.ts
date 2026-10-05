import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  secretPaths, isSecretName, redact, secretValues, scrubSecrets, REDACTED, SchemaIntrospectionError, hasDefault,
} from '../src/sensitivity.js';

const secret = z.string().meta({ sensitivity: 'secret' });

describe('isSecretName', () => {
  it.each(['apiKey', 'api_key', 'password', 'client_secret', 'refreshToken', 'secretAccessKey', 'accessKeyId', 'privateKey', 'appKey', 'subscriptionKey', 'Ocp-Apim-Subscription-Key', 'key'])(
    '%s is secret', (k) => expect(isSecretName(k)).toBe(true));
  it.each(['keyboard', 'tokenize', 'secretary', 'bucket', 'region', 'name', 'privateKeyPath',
    'authMode', 'authType', 'authDomain', 'authUrl', 'useAuth', 'tokenType', 'tokenUrl', 'tokenEndpoint', 'jwtAlgorithm',
    'cookieName', 'cookieDomain', 'passwordPolicy', 'secretName', 'secretRef', 'credentialsProvider', 'otpLength',
    'storageKey', 'sortKey', 'primaryKey', 'cacheKey', 'pinned', 'tokenizer'])('%s is not', (k) => expect(isSecretName(k)).toBe(false));
});

describe('secretPaths', () => {
  it('finds marked, nested, wrapped, collection, union and name-only secrets (the review scenarios)', () => {
    const s = z.object({
      bucket: z.string(),
      top: secret,
      nullableDefault: secret.nullable().default(null),
      auth: z.object({ apiKey: z.string() }),
      init: z.object({ headers: z.record(z.string(), secret) }).optional(),
      creds: z.array(z.object({ token: z.string() })),
      either: z.union([z.object({ kind: z.literal('a'), pin: secret }), z.object({ kind: z.literal('b') })]),
      piped: secret.transform((x) => x.trim()),
      lazyS: z.lazy(() => secret),
      password: z.string(),
      tuple: z.tuple([z.string(), secret]),
    });
    const got = secretPaths(s).map((p) => p.join('.')).sort();
    // `auth` and `creds` are secret names themselves, so those whole containers are secret.
    expect(got).toEqual([
      'auth', 'creds', 'either.pin', 'init.headers.*', 'lazyS', 'nullableDefault',
      'password', 'piped', 'top', 'tuple.1',
    ]);
  });

  it('a top-level union of option objects or a refined object still reports secrets', () => {
    const u = z.discriminatedUnion('kind', [z.object({ kind: z.literal('k'), apiKey: z.string() }), z.object({ kind: z.literal('n') })]);
    expect(secretPaths(u).map((p) => p.join('.'))).toEqual(['apiKey']);
    const r = z.object({ token: z.string() }).refine(() => true);
    expect(secretPaths(r).map((p) => p.join('.'))).toEqual(['token']);
  });

  it('a whole-value secret is the empty path', () => {
    expect(secretPaths(secret)).toEqual([[]]);
  });

  it('fails closed on a schema it cannot inspect', () => {
    expect(() => secretPaths({ parse: () => 1 })).toThrow(SchemaIntrospectionError);
  });

  it('hasDefault sees a default through wrappers', () => {
    expect(hasDefault(secret.default('sk'))).toBe(true);
    expect(hasDefault(secret.optional())).toBe(false);
  });
});

describe('redact / secretValues / scrubSecrets', () => {
  const paths = [['account', 'apiKey'], ['list', '*', 'token'], ['init', 'headers', '*']];
  const value = { bucket: 'b', account: { apiKey: 'AKIA1234' }, list: [{ token: 'tok-1' }, { token: 'tok-2' }], init: { headers: { Authorization: 'Bearer zzz' } } };

  it('redacts every path, wildcards included, without touching the input', () => {
    const r = redact(value, paths);
    expect(r).toEqual({ bucket: 'b', account: { apiKey: REDACTED }, list: [{ token: REDACTED }, { token: REDACTED }], init: { headers: { Authorization: REDACTED } } });
    expect(value.account.apiKey).toBe('AKIA1234');
  });

  it('collects secret strings and scrubs them from text', () => {
    const vals = secretValues(value, paths);
    expect(vals.sort()).toEqual(['AKIA1234', 'Bearer zzz', 'tok-1', 'tok-2']);
    expect(scrubSecrets('bad key AKIA1234 for tok-1', vals)).toBe(`bad key ${REDACTED} for ${REDACTED}`);
  });

  it('a whole-value secret path redacts the whole value', () => {
    expect(redact('sk-live', [[]])).toBe(REDACTED);
  });
});

describe('round 2 of the leak hunt', () => {
  it('names: database URLs, plural tokens, short forms; not token budgets', () => {
    for (const k of ['databaseUrl', 'mongoUri', 'apiTokens', 'accessTokens', 'pwd', 'accountKey', 'passcode', 'otp', 'jwt', 'auth', 'creds']) expect(isSecretName(k), k).toBe(true);
    for (const k of ['maxTokens', 'tokenCount', 'tokenLimit', 'numTokens']) expect(isSecretName(k), k).toBe(false);
  });
  it('a secret record key makes the whole record secret', () => {
    expect(secretPaths(z.object({ q: z.record(z.string().meta({ sensitivity: 'secret' }), z.number()) })).map((p) => p.join('.'))).toEqual(['q']);
  });
  it('container defaults, tuple defaults and meta.default are found', async () => {
    const { inspectSecrets } = await import('../src/sensitivity.js');
    const pub = (s: any) => inspectSecrets(s).published.map((p) => p.join('.'));
    expect(pub(z.object({ list: z.array(z.object({ token: z.string() })).default([{ token: 'sk-L' }]) }))).toEqual(['list.*.token']);
    expect(pub(z.object({ m: z.record(z.string(), z.object({ apiKey: z.string() })).default({ prod: { apiKey: 'sk-R' } }) }))).toEqual(['m.*.apiKey']);
    expect(pub(z.object({ t: z.tuple([z.string(), z.string().meta({ sensitivity: 'secret' })]).default(['a', 'sk-T']) }))).toEqual(['t.1']);
    expect(pub(z.object({ s: z.string().meta({ sensitivity: 'secret', default: 'sk-M' }) }))).toEqual(['s']);
    expect(pub(z.object({ maxTokens: z.number().default(1000) }))).toEqual([]);
  });
  it('Map values and header pairs; Headers-like objects; cycles terminate', () => {
    expect(secretValues({ h: new Map([['k', 'sk-MAP']]) }, [['h', '*']])).toContain('sk-MAP');
    expect(redact({ headers: [['Authorization', 'Bearer x'], ['Accept', 'json']] }, [])).toEqual({ headers: [['Authorization', REDACTED], ['Accept', 'json']] });
    class Headers2 { get() { return 'Bearer x'; } }
    expect(redact({ h: new Headers2() }, [])).toEqual({ h: REDACTED });
    const a: any = { name: 'n' }; a.x = a; a.y = a;
    const t0 = Date.now();
    expect(redact(a, []).x).toBe(REDACTED);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('round 3: defaults and constants inside a secret are published', () => {
  it('nested defaults, unions, lazy, pipes, literal/enum constants', async () => {
    const { inspectSecrets } = await import('../src/sensitivity.js');
    const pub = (s: any) => inspectSecrets(s).published.map((p) => p.join('.'));
    const S = 'sk-live-X';
    expect(pub(z.object({ credentials: z.object({ secretAccessKey: z.string().default(S) }) }))).toEqual(['credentials']);
    expect(pub(z.object({ conn: z.object({ k: z.string().default(S) }).meta({ sensitivity: 'secret' }) }))).toEqual(['conn']);
    expect(pub(z.object({ apiKey: z.union([z.string().default(S), z.number()]) }))).toEqual(['apiKey']);
    expect(pub(z.object({ apiKey: z.lazy(() => z.string().default(S)) }))).toEqual(['apiKey']);
    expect(pub(z.object({ apiKey: z.literal(S) }))).toEqual(['apiKey']);
    expect(pub(z.object({ apiKey: z.enum([S, 'other']) }))).toEqual(['apiKey']);
    expect(pub(z.object({ authMode: z.enum(['none', 'basic']).default('none'), tokenEndpoint: z.string().default('https://x/token') }))).toEqual([]);
  });
});
