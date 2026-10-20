import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toOptionsFormConfig } from '../src/index.js';
import type { OptionsFormField } from '../src/index.js';

const byName = (fields: OptionsFormField[]) => Object.fromEntries(fields.map((f) => [f.name, f]));

describe('toOptionsFormConfig (#26)', () => {
  const s3Options = z.object({
    bucket: z.string(),
    region: z.enum(['us-east-1', 'eu-west-1']).default('us-east-1'),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    storageKey: z.string().optional(),
    retry: z.object({ attempts: z.number().default(3), backoff: z.boolean().optional() }).optional(),
    tags: z.array(z.string()).optional(),
    client: z.custom<object>(),
    onError: z.function().optional(),
  });

  it('keeps Id/Key-named options editable: no record-oriented name heuristics', () => {
    const f = byName(toOptionsFormConfig(s3Options));
    for (const name of ['accessKeyId', 'storageKey', 'bucket']) {
      expect(f[name].disabled).toBe(false);
      expect(f[name].hidden).toBe(false);
    }
    // core's isSecretName counts an access key id as a secret: editable, but masked.
    expect(f.accessKeyId).toMatchObject({ type: 'password', disabled: false });
    expect(f.storageKey.type).toBe('text');
  });

  it('renders secrets as password fields, by name, by mark and by caller-given path', () => {
    const schema = z.object({
      secretAccessKey: z.string(),
      dsn: z.string().meta({ sensitivity: 'secret' }),
      opaque: z.string(),
      plain: z.string(),
    });
    const f = byName(toOptionsFormConfig(schema, { secretPaths: [['opaque']] }));
    expect(f.secretAccessKey).toMatchObject({ type: 'password', secret: true });
    expect(f.dsn).toMatchObject({ type: 'password', secret: true });
    expect(f.opaque).toMatchObject({ type: 'password', secret: true });
    expect(f.plain.type).toBe('text');
    expect(f.plain.secret).toBeUndefined();
  });

  it('nests objects as fieldsets with dotted names and full paths', () => {
    const f = byName(toOptionsFormConfig(s3Options));
    expect(f.retry).toMatchObject({ type: 'fieldset', required: false, path: ['retry'] });
    const inner = byName(f.retry.fields!);
    expect(inner['retry.attempts']).toMatchObject({ type: 'number', required: false, defaultValue: 3, path: ['retry', 'attempts'] });
    expect(inner['retry.backoff']).toMatchObject({ type: 'checkbox', required: false });
  });

  it('masks every field under a secret container, and never lets a catchall * match declared keys', () => {
    const schema = z.object({ auth: z.object({ user: z.string(), pass: z.string() }), extra: z.object({ x: z.string() }) });
    const f = byName(toOptionsFormConfig(schema, { secretPaths: [['extra']] }));
    // core fails closed on `auth` (a container named like a credential): its children inherit.
    const auth = byName(f.auth.fields!);
    expect(auth['auth.user']).toMatchObject({ type: 'password', secret: true });
    expect(auth['auth.pass']).toMatchObject({ type: 'password', secret: true });
    expect(byName(f.extra.fields!)['extra.x']).toMatchObject({ type: 'password', secret: true });
    const withCatchall = byName(toOptionsFormConfig(z.object({ a: z.string() }).catchall(z.string().meta({ sensitivity: 'secret' }))));
    expect(withCatchall.a.type).toBe('text');
  });

  it.each([
    ['union', z.union([z.object({ password: z.string() }), z.string()])],
    ['tuple', z.tuple([z.string(), z.string().meta({ sensitivity: 'secret' })])],
    ['record', z.record(z.string(), z.object({ apiKey: z.string() }))],
    ['array of objects', z.array(z.object({ token: z.string() }))],
    ['intersection', z.intersection(z.object({ a: z.string() }), z.object({ clientSecret: z.string() }))],
  ])('a %s holding a secret is a secret, supplied in code, never a JSON box', (_kind, conn) => {
    const f = byName(toOptionsFormConfig(z.object({ conn })));
    expect(f.conn).toMatchObject({ type: 'code', secret: true, suppliedInCode: true, disabled: true });
  });

  it('a secret ignores editWidget and drops its default', () => {
    const schema = z.object({
      apiKey: z.string().default('sk-123').meta({ editWidget: 'textarea' }),
      dsn: z.string().meta({ sensitivity: 'secret', editWidget: 'textarea' }),
    });
    const f = byName(toOptionsFormConfig(schema));
    expect(f.apiKey).toMatchObject({ type: 'password', secret: true });
    expect(f.apiKey).not.toHaveProperty('defaultValue');
    expect(f.dsn.type).toBe('password');
  });

  it('takes caller live paths, a wrapped object schema, and rejects a non-object', () => {
    const schema = z.object({ fetchImpl: z.any(), timeout: z.number() }).optional();
    const f = byName(toOptionsFormConfig(schema, { livePaths: [['fetchImpl']] }));
    expect(f.fetchImpl).toMatchObject({ type: 'code', suppliedInCode: true, required: false });
    expect(f.timeout.type).toBe('number');
    expect(() => toOptionsFormConfig(z.string())).toThrow(/needs a Zod object schema/);
  });

  it('merges metadata from a middle wrapper', () => {
    const f = byName(toOptionsFormConfig(z.object({ x: z.string().optional().meta({ hidden: true }).default('x') })));
    expect(f.x).toMatchObject({ hidden: true, defaultValue: 'x', required: false });
  });

  it('marks values a form cannot produce as supplied in code, instead of dropping them', () => {
    const f = byName(toOptionsFormConfig(s3Options));
    expect(f.client).toMatchObject({ type: 'code', suppliedInCode: true, disabled: true });
    expect(f.onError).toMatchObject({ type: 'code', suppliedInCode: true, required: false });
    const marked = byName(toOptionsFormConfig(z.object({ fetch: z.any().meta({ serializable: false }) })));
    expect(marked.fetch).toMatchObject({ type: 'code', suppliedInCode: true });
  });

  it('infers widgets, requiredness, defaults and options from the schema', () => {
    const f = byName(toOptionsFormConfig(s3Options));
    expect(f.bucket).toMatchObject({ type: 'text', required: true, label: 'Bucket' });
    expect(f.region).toMatchObject({ type: 'select', required: false, defaultValue: 'us-east-1' });
    expect(f.region.options!.map((o) => o.value)).toEqual(['us-east-1', 'eu-west-1']);
    expect(f.tags).toMatchObject({ type: 'tags', allowCreate: true });
    expect(f.accessKeyId.label).toBe('Access Key Id');
  });

  it('honours metadata: title, description, editWidget, order, hidden, editable', () => {
    const schema = z.object({
      b: z.string().meta({ title: 'Bee', description: 'second', order: 2 }),
      a: z.string().meta({ order: 1, editWidget: 'textarea' }),
      c: z.string().optional().meta({ hidden: true, editable: false }),
    });
    const fields = toOptionsFormConfig(schema);
    expect(fields.map((f) => f.name)).toEqual(['a', 'b', 'c']);
    const f = byName(fields);
    expect(f.b).toMatchObject({ label: 'Bee', helpText: 'second' });
    expect(f.a.type).toBe('textarea');
    expect(f.c).toMatchObject({ hidden: true, disabled: true, required: false });
  });
});

describe('toOptionsFormConfig numeric bounds and step (#43)', () => {
  it('projects bounds and step onto number fields', () => {
    const fields = byName(
      toOptionsFormConfig(z.object({ retries: z.number().int().min(0).max(10).default(3), ratio: z.number().meta({ step: 0.05 }) })),
    );
    expect(fields.retries).toMatchObject({ bounds: { min: 0, max: 10 }, step: 1 });
    expect(fields.ratio.step).toBe(0.05);
  });
});
