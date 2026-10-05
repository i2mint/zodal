import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineProviderDescriptor,
  createFromDescriptor,
  isProviderSupported,
  secretOptionKeys,
  inMemoryDescriptor,
  bifurcatedDescriptor,
  type ProviderDescriptor,
} from '../src/descriptor.js';
import { createInMemoryProvider } from '../src/in-memory.js';
import { providerContract } from '../src/testing.js';

const s3Like = defineProviderDescriptor({
  name: 's3Like',
  label: 'S3-like',
  package: 'example',
  runtime: 'node',
  options: z.object({
    bucket: z.string(),
    accessKeyId: z.string().meta({ sensitivity: 'secret' }),
    secretAccessKey: z.string().meta({ secret: true }).optional(),
    region: z.string().optional(),
  }),
  create: () => createInMemoryProvider([]),
});

describe('provider descriptors', () => {
  it('rejects a malformed descriptor', () => {
    expect(() => defineProviderDescriptor({ ...s3Like, name: 'has space' })).toThrow(/identifier-like/);
  });

  it('validates options before create, naming the descriptor', async () => {
    await expect(createFromDescriptor(s3Like, { accessKeyId: 'x' })).rejects.toThrow(/provider "s3Like"/);
    await expect(createFromDescriptor(s3Like, { bucket: 'b', accessKeyId: 'x' })).resolves.toBeDefined();
  });

  it('finds secret options, including ones wrapped in .optional()', () => {
    expect(secretOptionKeys(s3Like).sort()).toEqual(['accessKeyId', 'secretAccessKey']);
    expect(secretOptionKeys(inMemoryDescriptor)).toEqual([]);
  });

  it('checks runtime, then supports()', async () => {
    expect(await isProviderSupported(s3Like, 'browser')).toBe(false);
    expect(await isProviderSupported(s3Like, 'node')).toBe(true);
    const flaky = { ...inMemoryDescriptor, supports: () => { throw new Error('private mode'); } } as ProviderDescriptor;
    expect(await isProviderSupported(flaky, 'browser')).toBe(false);
  });

  it('the in-memory descriptor passes the DataProvider contract', async () => {
    const cases = await providerContract({ make: (seed) => createFromDescriptor(inMemoryDescriptor, { data: seed }) });
    for (const c of cases) if (!c.skip) await c.run();
  });

  it('bifurcated composes two named providers through the caller-supplied resolver', async () => {
    const catalog = new Map([[inMemoryDescriptor.name, inMemoryDescriptor]]);
    const bif = bifurcatedDescriptor((n) => catalog.get(n));
    const p = await createFromDescriptor(bif, {
      metadata: { name: 'inMemory' },
      content: { name: 'inMemory' },
      contentFields: ['body'],
    });
    await p.create({ id: 'a', title: 'A', tags: ['x'], body: 'long text' } as any);
    const listed = await p.getList({ filter: { field: 'tags', operator: 'arrayContains', value: 'x' } });
    expect(listed.total).toBe(1);
    expect((listed.data[0] as any).body?._tag).toBe('ContentRef');
    await expect(
      createFromDescriptor(bif, { metadata: { name: 'nope' }, content: { name: 'inMemory' }, contentFields: ['body'] }),
    ).rejects.toThrow(/unknown metadata provider "nope"/);
  });
});
