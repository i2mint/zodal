import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  secretPaths, isSecretName, redact, secretValues, scrubSecrets, REDACTED, SchemaIntrospectionError, hasDefault,
} from '../src/sensitivity.js';

const secret = z.string().meta({ sensitivity: 'secret' });

describe('isSecretName', () => {
  it.each(['apiKey', 'api_key', 'password', 'client_secret', 'refreshToken', 'secretAccessKey', 'accessKeyId', 'privateKeyPath'])(
    '%s is secret', (k) => expect(isSecretName(k)).toBe(true));
  it.each(['keyboard', 'tokenize', 'secretary', 'bucket', 'region', 'name'])('%s is not', (k) => expect(isSecretName(k)).toBe(false));
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
    expect(got).toEqual([
      'auth.apiKey', 'creds.*.token', 'either.pin', 'init.headers.*', 'lazyS', 'nullableDefault',
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
  const paths = [['auth', 'apiKey'], ['creds', '*', 'token'], ['init', 'headers', '*']];
  const value = { bucket: 'b', auth: { apiKey: 'AKIA1234' }, creds: [{ token: 'tok-1' }, { token: 'tok-2' }], init: { headers: { Authorization: 'Bearer zzz' } } };

  it('redacts every path, wildcards included, without touching the input', () => {
    const r = redact(value, paths);
    expect(r).toEqual({ bucket: 'b', auth: { apiKey: REDACTED }, creds: [{ token: REDACTED }, { token: REDACTED }], init: { headers: { Authorization: REDACTED } } });
    expect(value.auth.apiKey).toBe('AKIA1234');
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
