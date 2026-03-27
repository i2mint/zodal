import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '../src/in-memory.js';
import { wrapProvider } from '../src/wrap-provider.js';
import type { Codec } from '@zodal/core';

interface StoredItem {
  id: string;
  name: string;
  createdAt: string; // ISO string in storage
  score: number;
}

interface AppItem {
  id: string;
  name: string;
  createdAt: Date; // Date object in app
  score: number;
}

const storedData: StoredItem[] = [
  { id: '1', name: 'Alpha', createdAt: '2024-01-15T00:00:00.000Z', score: 85 },
  { id: '2', name: 'Beta', createdAt: '2024-06-01T00:00:00.000Z', score: 92 },
  { id: '3', name: 'Gamma', createdAt: '2024-03-10T00:00:00.000Z', score: 78 },
];

const codec: Codec<StoredItem, AppItem> = {
  decode: (stored) => ({
    ...stored,
    createdAt: new Date(stored.createdAt),
  }),
  encode: (app) => ({
    ...app,
    createdAt: app.createdAt.toISOString(),
  }),
};

describe('wrapProvider', () => {
  it('decodes items from getList', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const { data } = await wrapped.getList({});
    expect(data).toHaveLength(3);
    expect(data[0].createdAt).toBeInstanceOf(Date);
    expect(data[0].name).toBe('Alpha');
  });

  it('decodes item from getOne', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const item = await wrapped.getOne('2');
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.name).toBe('Beta');
  });

  it('encodes on create and decodes result', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const created = await wrapped.create({
      name: 'Delta',
      createdAt: new Date('2024-09-01T00:00:00.000Z'),
      score: 95,
    });

    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.name).toBe('Delta');

    // Verify it was stored as ISO string internally
    const innerList = await inner.getList({});
    const deltaStored = innerList.data.find(d => d.name === 'Delta');
    expect(deltaStored?.createdAt).toBe('2024-09-01T00:00:00.000Z');
  });

  it('encodes on update and decodes result', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const updated = await wrapped.update('1', {
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    } as Partial<AppItem>);

    expect(updated.createdAt).toBeInstanceOf(Date);

    // Check inner storage
    const innerItem = await inner.getOne('1');
    expect(innerItem.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('handles delete (no codec needed)', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    await wrapped.delete('2');
    const { data } = await wrapped.getList({});
    expect(data).toHaveLength(2);
  });

  it('passes through getCapabilities', () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const caps = wrapped.getCapabilities?.();
    expect(caps).toBeDefined();
    expect(caps!.canCreate).toBe(true);
  });

  it('handles upsert with codec', async () => {
    const inner = createInMemoryProvider(storedData);
    const wrapped = wrapProvider(inner, codec);

    const result = await wrapped.upsert!({
      id: '2',
      name: 'Beta Updated',
      createdAt: new Date('2025-06-01T00:00:00.000Z'),
      score: 99,
    });

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.name).toBe('Beta Updated');

    const { data } = await wrapped.getList({});
    expect(data).toHaveLength(3); // not duplicated
  });
});
