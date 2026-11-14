/**
 * Safe store ids: an item id used as a filename, an S3 key segment or a URL segment.
 *
 * An id like `../x` escapes a storage folder when joined into a path, and `a/b`
 * silently nests an S3 key. Adapters either refuse such ids ({@link assertSafeId})
 * or encode them ({@link encodeId} / {@link decodeId}).
 *
 * The encoding is reversible and leaves safe ids unchanged, so data stored before
 * an adapter adopted it keeps its names. A safe id is `[A-Za-z0-9_][A-Za-z0-9._-]*`,
 * at most `maxLength` characters, not a Windows device name (`CON`, `nul.txt`...)
 * and not ending in `.`; anything else becomes `~` + base64url(UTF-8). A safe id
 * never starts with `~`, so the two forms cannot collide, and {@link decodeId}
 * accepts only the canonical encoding, so two stored names never decode to one id.
 *
 * Options for particular backends:
 * - `caseInsensitive: true` for case-insensitive file systems (macOS and Windows by
 *   default): ids with upper-case letters count as unsafe, and the encoding is
 *   lower-case base32, so `A` and `a` stay distinct on disk. Pass the same option
 *   to `decodeId`.
 * - `allowDot: false` when the adapter builds names like `${id}.${field}.json`, so
 *   an id containing `.` cannot alias another id's file.
 */

/** Default longest id kept as-is (leaves room for a suffix within a 255-byte filename). */
export const DEFAULT_MAX_ID_LENGTH = 200;

const ESCAPE = '~';
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Options shared by the id helpers. */
export interface SafeIdOptions {
  /** Longest id kept as-is. Default: {@link DEFAULT_MAX_ID_LENGTH}. */
  maxLength?: number;
  /** Treat upper-case letters as unsafe and encode in lower-case base32. Default: false. */
  caseInsensitive?: boolean;
  /** Whether `.` may appear in a safe id. Default: true. */
  allowDot?: boolean;
}

function safePattern({ caseInsensitive = false, allowDot = true }: SafeIdOptions): RegExp {
  const letters = caseInsensitive ? 'a-z' : 'A-Za-z';
  return new RegExp(`^[${letters}0-9_][${letters}0-9_${allowDot ? '.' : ''}-]*$`);
}

/** Why `id` is not safe as a path or key segment, or `undefined` when it is. */
export function unsafeIdReason(id: unknown, options: SafeIdOptions = {}): string | undefined {
  const { maxLength = DEFAULT_MAX_ID_LENGTH, caseInsensitive = false, allowDot = true } = options;
  if (typeof id !== 'string') return `id must be a string, got ${typeof id}`;
  if (id === '') return 'id is empty';
  if (id.length > maxLength) return `id is longer than ${maxLength} characters`;
  if (id === '.' || id === '..') return `id "${id}" is a relative path`;
  if (!safePattern(options).test(id)) {
    if (/[/\\]/.test(id)) return 'id contains a path separator';
    if (id.includes('\u0000')) return 'id contains a NUL character';
    if (id.startsWith('.')) return 'id starts with "."';
    if (caseInsensitive && /[A-Z]/.test(id)) return 'id has upper-case letters (case-insensitive store)';
    if (!allowDot && id.includes('.')) return 'id contains "."';
    return 'id has characters outside [A-Za-z0-9._-] or starts with "-"';
  }
  if (id.endsWith('.')) return 'id ends with "." (dropped by Windows)';
  if (WINDOWS_DEVICE_RE.test(id)) return `id "${id}" is a Windows device name`;
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

// ---- byte encodings ---------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return undefined;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function toBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Uint8Array | undefined {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return undefined;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---- encodeId / decodeId ------------------------------------------------------

/** Options for {@link encodeId}. */
export interface EncodeIdOptions extends SafeIdOptions {
  /** Encode every id, safe or not. Default: false (safe ids are kept as-is). */
  always?: boolean;
}

/**
 * A reversible, path-safe form of `id`: unchanged when {@link isSafeId}, else
 * `~` + base64url (base32 with `caseInsensitive`) of its UTF-8 bytes. Throws
 * {@link UnsafeIdError} when `id` is not a non-empty string or the encoded form is
 * longer than `maxLength`.
 */
export function encodeId(id: string, options: EncodeIdOptions = {}): string {
  const { always = false, maxLength = DEFAULT_MAX_ID_LENGTH, caseInsensitive = false } = options;
  if (typeof id !== 'string' || id === '') throw new UnsafeIdError(id, 'id must be a non-empty string');
  if (!always && isSafeId(id, options)) return id;
  // Every UTF-16 unit is at least one byte, and the encodings expand bytes by 4/3
  // (base64url) or 8/5 (base32): refuse an id too long to fit before encoding it.
  const ratio = caseInsensitive ? 8 / 5 : 4 / 3;
  if (ESCAPE.length + Math.ceil(id.length * ratio) > maxLength) {
    throw new UnsafeIdError(id, `encoded id would be longer than ${maxLength} characters`);
  }
  const bytes = new TextEncoder().encode(id);
  const encoded = ESCAPE + (caseInsensitive ? toBase32(bytes) : toBase64Url(bytes));
  if (encoded.length > maxLength) {
    throw new UnsafeIdError(id, `encoded id is ${encoded.length} characters, longer than ${maxLength}`);
  }
  return encoded;
}

/**
 * The id a stored name stands for, or `undefined` when the name starts with `~` but
 * is not an encoding {@link encodeId} produces with these options (a stray file, a
 * non-canonical encoding): adapters listing a folder or a prefix skip such names.
 * A name not starting with `~` is returned as-is, so data stored before an adapter
 * adopted encoding stays readable.
 */
export function tryDecodeId(stored: string, options: SafeIdOptions = {}): string | undefined {
  if (!stored.startsWith(ESCAPE)) return stored;
  const body = stored.slice(ESCAPE.length);
  const bytes = options.caseInsensitive ? fromBase32(body) : fromBase64Url(body);
  if (!bytes || bytes.length === 0) return undefined;
  // Only the canonical encoding decodes: `~YQ` and `~YR` must not both mean "a".
  const canonical = ESCAPE + (options.caseInsensitive ? toBase32(bytes) : toBase64Url(bytes));
  if (canonical !== stored) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The id {@link encodeId} encoded. Throws {@link UnsafeIdError} for a name it would
 * not have produced; use {@link tryDecodeId} to skip such names instead.
 */
export function decodeId(stored: string, options: SafeIdOptions = {}): string {
  const id = tryDecodeId(stored, options);
  if (id === undefined) throw new UnsafeIdError(stored, 'not a name encodeId produces');
  return id;
}
