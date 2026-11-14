/**
 * Safe store ids: an item id used as a filename, an S3 key segment or a URL segment.
 *
 * An id like `../x` escapes a storage folder when joined into a path, and `a/b`
 * silently nests an S3 key. Adapters either refuse such ids ({@link assertSafeId})
 * or encode them ({@link encodeId} / {@link decodeId}).
 *
 * The encoding is reversible and leaves safe ids unchanged, so data stored before
 * an adapter adopted it keeps its names: a safe id is `[A-Za-z0-9_][A-Za-z0-9._-]*`,
 * at most `maxLength` characters; anything else becomes `~` + base64url(UTF-8). A
 * safe id never starts with `~`, so the two forms cannot collide.
 *
 * Not covered: case-insensitive file systems (macOS and Windows by default)
 * conflate `A` and `a`, and base64url is case-sensitive too, so an adapter there
 * that must keep both needs a case-folding scheme of its own.
 */

/** Default longest id kept as-is (leaves room for a suffix within a 255-byte filename). */
export const DEFAULT_MAX_ID_LENGTH = 200;

const SAFE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const ESCAPE = '~';

/** Options shared by the id helpers. */
export interface SafeIdOptions {
  /** Longest id kept as-is. Default: {@link DEFAULT_MAX_ID_LENGTH}. */
  maxLength?: number;
}

/** Why `id` is not safe as a path or key segment, or `undefined` when it is. */
export function unsafeIdReason(id: unknown, { maxLength = DEFAULT_MAX_ID_LENGTH }: SafeIdOptions = {}): string | undefined {
  if (typeof id !== 'string') return `id must be a string, got ${typeof id}`;
  if (id === '') return 'id is empty';
  if (id.length > maxLength) return `id is longer than ${maxLength} characters`;
  if (id === '.' || id === '..') return `id "${id}" is a relative path`;
  if (!SAFE_ID_RE.test(id)) {
    if (/[/\\]/.test(id)) return 'id contains a path separator';
    if (id.includes('\u0000')) return 'id contains a NUL character';
    if (id.startsWith('.')) return 'id starts with "."';
    return 'id has characters outside [A-Za-z0-9._-] or starts with "-"';
  }
  return undefined;
}

/** Whether `id` can be used as-is as a filename, an S3 key segment and a URL segment. */
export function isSafeId(id: unknown, options?: SafeIdOptions): id is string {
  return unsafeIdReason(id, options) === undefined;
}

/** Thrown by {@link assertSafeId} and by {@link encodeId} when the encoded id is too long. */
export class UnsafeIdError extends Error {
  constructor(
    readonly id: unknown,
    readonly reason: string,
  ) {
    super(`unsafe id ${JSON.stringify(typeof id === 'string' && id.length > 60 ? `${id.slice(0, 60)}…` : id)}: ${reason}`);
    this.name = 'UnsafeIdError';
  }
}

/** Throw an {@link UnsafeIdError} unless `id` is safe; for adapters that refuse rather than encode. */
export function assertSafeId(id: unknown, options?: SafeIdOptions): asserts id is string {
  const reason = unsafeIdReason(id, options);
  if (reason !== undefined) throw new UnsafeIdError(id, reason);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Options for {@link encodeId}. */
export interface EncodeIdOptions extends SafeIdOptions {
  /** Encode every id, safe or not. Default: false (safe ids are kept as-is). */
  always?: boolean;
}

/**
 * A reversible, path-safe form of `id`: unchanged when {@link isSafeId}, else
 * `~` + base64url of its UTF-8 bytes. Throws {@link UnsafeIdError} when `id` is not
 * a non-empty string or the encoded form is longer than `maxLength`.
 */
export function encodeId(id: string, options: EncodeIdOptions = {}): string {
  const { always = false, maxLength = DEFAULT_MAX_ID_LENGTH } = options;
  if (typeof id !== 'string' || id === '') throw new UnsafeIdError(id, 'id must be a non-empty string');
  if (!always && isSafeId(id, { maxLength })) return id;
  const encoded = ESCAPE + toBase64Url(new TextEncoder().encode(id));
  if (encoded.length > maxLength) {
    throw new UnsafeIdError(id, `encoded id is ${encoded.length} characters, longer than ${maxLength}`);
  }
  return encoded;
}

/** The id {@link encodeId} encoded (a string not starting with `~` is returned as-is). */
export function decodeId(stored: string): string {
  if (!stored.startsWith(ESCAPE)) return stored;
  return new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(stored.slice(ESCAPE.length)));
}
