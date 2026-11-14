/**
 * In-memory blob provider: records plus content, with no backend.
 *
 * For tests, demos and Node scripts that store content (`setContent` /
 * `getContent` / `getUrl` / `headContent`) without IndexedDB, HTTP or a file
 * system. Records delegate to {@link createInMemoryProvider}; content is kept in a
 * Map per (id, field) and served as `data:` URLs (which work in Node and the
 * browser) or, on request, as object URLs.
 *
 * Content values are normalized to a `Blob` (whose `type` is the MIME type), and
 * `getContent` returns that Blob. Writes honour every {@link ContentWriteInit}
 * option, `ifAbsent` atomically.
 */

import type { ContentRef } from '@zodal/core';
import type { ContentWriteInit, DataProvider } from './data-provider.js';
import { createInMemoryProvider } from './in-memory.js';
import type { InMemoryProviderOptions } from './in-memory.js';

/** How `getUrl` / `ContentRef.url` address stored content. */
export type BlobUrlStrategy =
  | 'data'
  | 'object'
  | 'none'
  | ((id: string, field: string, entry: StoredBlob) => string | null);

/** One stored content value. */
export interface StoredBlob {
  blob: Blob;
  mimeType: string;
  size: number;
  hash?: string;
  cacheControl?: string;
}

export interface InMemoryBlobProviderOptions extends InMemoryProviderOptions {
  /**
   * How content is addressed. `'data'` (default): a `data:` URL; `'object'`: a
   * `blob:` object URL (browser; revoked when the content is replaced or deleted);
   * `'none'`: `getUrl` resolves `null`; or a function of (id, field, entry).
   */
  url?: BlobUrlStrategy;
}

/** The in-memory blob provider: a DataProvider with every content method, plus a count. */
export interface InMemoryBlobProvider<T> extends DataProvider<T> {
  setContent(id: string, field: string, content: unknown, init?: ContentWriteInit): Promise<ContentRef>;
  getContent(id: string, field: string): Promise<Blob>;
  getUrl(id: string, field: string): Promise<string | null>;
  headContent(id: string, field: string): Promise<ContentRef | null>;
  /** How many content values are stored. */
  contentCount(): number;
  /** Drop all content (revoking object URLs). Records are kept. */
  dispose(): void;
}

function toBlob(content: unknown, mimeType: string | undefined): Blob {
  if (content instanceof Blob) {
    return mimeType && mimeType !== content.type ? new Blob([content], { type: mimeType }) : content;
  }
  const type = mimeType ?? (typeof content === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream');
  if (typeof content === 'string' || content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
    return new Blob([content as BlobPart], { type });
  }
  return new Blob([JSON.stringify(content)], { type: mimeType ?? 'application/json' });
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/**
 * Create an in-memory provider with content methods.
 *
 * @example
 * ```ts
 * const p = createInMemoryBlobProvider<{ id: string }>([{ id: 'a' }]);
 * await p.setContent('a', 'image', svgText, { mimeType: 'image/svg+xml', ifAbsent: true });
 * const url = await p.getUrl('a', 'image'); // data:image/svg+xml;base64,...
 * ```
 */
export function createInMemoryBlobProvider<T extends Record<string, any>>(
  initialData: T[] = [],
  options: InMemoryBlobProviderOptions = {},
): InMemoryBlobProvider<T> {
  const { url: urlStrategy = 'data', ...recordOptions } = options;
  const records = createInMemoryProvider<T>(initialData, recordOptions);
  const blobs = new Map<string, StoredBlob & { url?: string | null }>();
  const k = (id: string, field: string) => `${id}\u0000${field}`;

  const revoke = (entry: { url?: string | null } | undefined) => {
    if (urlStrategy === 'object' && entry?.url) URL.revokeObjectURL(entry.url);
  };
  const urlOf = async (id: string, field: string, entry: StoredBlob & { url?: string | null }) => {
    if (entry.url !== undefined) return entry.url;
    entry.url =
      urlStrategy === 'none'
        ? null
        : urlStrategy === 'data'
          ? await toDataUrl(entry.blob)
          : urlStrategy === 'object'
            ? URL.createObjectURL(entry.blob)
            : urlStrategy(id, field, entry);
    return entry.url;
  };
  const refOf = async (id: string, field: string, entry: StoredBlob & { url?: string | null }): Promise<ContentRef> => {
    const ref: ContentRef = { _tag: 'ContentRef', field, itemId: id, mimeType: entry.mimeType, size: entry.size };
    if (entry.hash !== undefined) ref.hash = entry.hash;
    // A data URL is ~1.4x the bytes, so it is built only when asked for (getUrl);
    // a cheap URL (object URL, a function) is put on every reference.
    const url = urlStrategy === 'data' ? entry.url : await urlOf(id, field, entry);
    if (url) ref.url = url;
    return ref;
  };
  const dropContent = (ids: Iterable<string>) => {
    const gone = new Set(ids);
    for (const [key, entry] of blobs) {
      if (gone.has(key.slice(0, key.indexOf('\u0000')))) {
        revoke(entry);
        blobs.delete(key);
      }
    }
  };

  return {
    ...records,
    async delete(id) {
      // Content may exist for an id with no record (content-only use): drop it either way.
      try {
        await records.delete(id);
      } finally {
        dropContent([id]);
      }
    },
    async deleteMany(ids) {
      try {
        await records.deleteMany(ids);
      } finally {
        dropContent(ids);
      }
    },
    dispose() {
      for (const entry of blobs.values()) revoke(entry);
      blobs.clear();
    },
    getCapabilities: () => ({ ...records.getCapabilities!(), contentIfAbsent: 'atomic' as const }),
    async setContent(id, field, content, init = {}) {
      const key = k(id, field);
      // Check-and-set with no await in between: atomic within this process.
      const existing = blobs.get(key);
      if (init.ifAbsent && existing) return refOf(id, field, existing);
      const blob = toBlob(content, init.mimeType);
      const entry: StoredBlob & { url?: string | null } = { blob, mimeType: blob.type, size: blob.size };
      if (init.hash !== undefined) entry.hash = init.hash;
      if (init.cacheControl !== undefined) entry.cacheControl = init.cacheControl;
      blobs.set(key, entry);
      revoke(existing);
      return refOf(id, field, entry);
    },
    async getContent(id, field) {
      const entry = blobs.get(k(id, field));
      if (!entry) throw new Error(`No content stored for ${id}/${field}`);
      return entry.blob;
    },
    async getUrl(id, field) {
      const entry = blobs.get(k(id, field));
      return entry ? urlOf(id, field, entry) : null;
    },
    async headContent(id, field) {
      const entry = blobs.get(k(id, field));
      return entry ? refOf(id, field, entry) : null;
    },
    contentCount: () => blobs.size,
  };
}
