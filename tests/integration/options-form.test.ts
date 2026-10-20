import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createInMemoryProvider } from '@zodal/store';
import { defineProviderDescriptor, liveOptionPaths, secretOptionPaths } from '@zodal/store/descriptor';
import { toOptionsFormConfig } from '@zodal/ui';
import type { OptionsFormField } from '@zodal/ui';

const flat = (fields: OptionsFormField[]): Record<string, OptionsFormField> =>
  Object.fromEntries(fields.flatMap((f) => [[f.name, f], ...Object.entries(flat(f.fields ?? []))]));

describe('An options form for a provider descriptor (#26)', () => {
  const descriptor = defineProviderDescriptor({
    name: 'example-s3',
    source: { module: 'example', export: 'exampleS3' },
    runtime: 'any',
    options: z.object({
      bucket: z.string(),
      accessKeyId: z.string(),
      storageKey: z.string().optional(),
      opaque: z.string().optional(),
      connection: z.object({ endpoint: z.string().url(), sessionToken: z.string().optional() }).optional(),
      client: z.custom<object>().optional(),
    }),
    // Descriptor-specific secret: a field whose name does not look secret.
    secretPaths: () => [['opaque']],
    create: () => createInMemoryProvider([]),
  });

  it('masks what the descriptor says is secret and marks what is supplied in code', () => {
    const options = { bucket: 'b', accessKeyId: 'AKIA', opaque: 'x' };
    const f = flat(toOptionsFormConfig(descriptor.options, {
      secretPaths: secretOptionPaths(descriptor, options),
      livePaths: liveOptionPaths(descriptor),
    }));
    expect(f.bucket.type).toBe('text');
    expect(f.storageKey).toMatchObject({ type: 'text', disabled: false });
    expect(f.opaque).toMatchObject({ type: 'password', secret: true });
    expect(f['connection.sessionToken']).toMatchObject({ type: 'password', secret: true });
    expect(f['connection.endpoint'].type).toBe('text');
    expect(f.client).toMatchObject({ type: 'code', suppliedInCode: true });
  });
});
