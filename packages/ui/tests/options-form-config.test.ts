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

  it('matches secret paths inside nested objects, with * as any key', () => {
    const schema = z.object({ auth: z.object({ apiKey: z.string(), user: z.string() }), extra: z.object({ x: z.string() }) });
    const f = byName(toOptionsFormConfig(schema, { secretPaths: [['*', 'x']] }));
    const auth = byName(f.auth.fields!);
    expect(auth['auth.apiKey'].type).toBe('password');
    expect(auth['auth.user'].type).toBe('text');
    expect(byName(f.extra.fields!)['extra.x'].type).toBe('password');
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
