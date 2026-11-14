import { describe, it, expect } from 'vitest';
import { createInMemoryBlobProvider, createBifurcatedProvider, createInMemoryProvider, wrapProvider } from '../src/index.js';
import { providerContract, contentContract } from '../src/testing.js';

const contract = await providerContract({ make: (seed) => createInMemoryBlobProvider(seed) });
const content = await contentContract({ make: (seed) => createInMemoryBlobProvider(seed) });

describe('in-memory blob provider: DataProvider contract', () => {
  for (const c of contract) (c.skip ? it.skip : it)(c.name, c.run);
});

describe('in-memory blob provider: content contract', () => {
  it('runs every content case', () => expect(content.filter((c) => c.skip)).toEqual([]));
  for (const c of content) (c.skip ? it.skip : it)(c.name, c.run);
});

describe('createInMemoryBlobProvider', () => {
  it('serves data URLs carrying the MIME type', async () => {
    const p = createInMemoryBlobProvider([{ id: 'a' }]);
    const ref = await p.setContent('a', 'img', '<svg/>', { mimeType: 'image/svg+xml', cacheControl: 'immutable', hash: 'h1' });
    expect(ref).toMatchObject({ mimeType: 'image/svg+xml', size: 6, hash: 'h1' });
    expect(ref.url).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(await p.getUrl('a', 'img')).toBe(ref.url);
    expect((await p.getContent('a', 'img')).type).toBe('image/svg+xml');
  });
  it('honours ifAbsent atomically under concurrency', async () => {
    const p = createInMemoryBlobProvider([]);
    const writes = await Promise.all(['a', 'b', 'c'].map((v) => p.setContent('x', 'f', v, { ifAbsent: true })));
    const body = await (await p.getContent('x', 'f')).text();
    expect(['a', 'b', 'c']).toContain(body);
    expect(p.contentCount()).toBe(1);
    expect(new Set(writes.map((w) => w.size)).size).toBe(1);
  });
  it('drops content with its item, and supports url strategies', async () => {
    const p = createInMemoryBlobProvider([{ id: 'a' }, { id: 'b' }], { url: (id, f) => `/blobs/${id}/${f}` });
    await p.setContent('a', 'f', 'x');
    await p.setContent('b', 'f', 'y');
    expect(await p.getUrl('a', 'f')).toBe('/blobs/a/f');
    await p.delete('a');
    expect(await p.headContent('a', 'f')).toBeNull();
    await p.deleteMany(['b']);
    expect(p.contentCount()).toBe(0);
    const none = createInMemoryBlobProvider([], { url: 'none' });
    await none.setContent('z', 'f', 'q');
    expect(await none.getUrl('z', 'f')).toBeNull();
  });
});

describe('content write options through composites', () => {
  it('bifurcated provider: headContent and ifAbsent', async () => {
    const p = createBifurcatedProvider<any>({
      metadataProvider: createInMemoryProvider([{ id: '1', name: 'n' }]),
      contentProvider: createInMemoryProvider([{ id: '1' }]),
      contentFields: ['body'],
    });
    expect(await p.headContent!('1', 'body')).toBeNull();
    const ref = await p.setContent!('1', 'body', 'first', { mimeType: 'text/plain', ifAbsent: true });
    expect(ref.mimeType).toBe('text/plain');
    await p.setContent!('1', 'body', 'second', { ifAbsent: true });
    expect(await p.getContent!('1', 'body')).toBe('first');
    expect(await p.headContent!('1', 'body')).toMatchObject({ itemId: '1', field: 'body' });
  });
  it('wrapProvider passes content methods through', async () => {
    const inner = createInMemoryBlobProvider([{ id: '1' }]);
    const w = wrapProvider(inner as any, { encode: (x: any) => x, decode: (x: any) => x });
    await w.setContent!('1', 'f', 'v', { mimeType: 'text/plain' });
    expect(await w.headContent!('1', 'f')).toMatchObject({ mimeType: 'text/plain' });
  });
});
