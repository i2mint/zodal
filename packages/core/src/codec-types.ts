/**
 * Codec Types: Bidirectional field-level and provider-level transforms.
 *
 * Two levels of codecs:
 * 1. Field-level: Zod v4 z.codec() — detected by inference engine
 * 2. Provider-level: wrapProvider() — wraps DataProvider with key/value transforms
 */

/** A bidirectional transform pair. */
export interface Codec<TEncoded, TDecoded> {
  /** Transform from storage/wire format to application format. */
  decode: (encoded: TEncoded) => TDecoded;
  /** Transform from application format to storage/wire format. */
  encode: (decoded: TDecoded) => TEncoded;
}

/** Compose two codecs: A→B then B→C = A→C */
export function composeCodecs<A, B, C>(
  first: Codec<A, B>,
  second: Codec<B, C>,
): Codec<A, C> {
  return {
    decode: (a: A) => second.decode(first.decode(a)),
    encode: (c: C) => first.encode(second.encode(c)),
  };
}

/** Create an identity codec that passes values through unchanged. */
export function identityCodec<T>(): Codec<T, T> {
  return {
    decode: (v: T) => v,
    encode: (v: T) => v,
  };
}

/** Create a codec from a pair of functions. */
export function createCodec<TEncoded, TDecoded>(
  decode: (encoded: TEncoded) => TDecoded,
  encode: (decoded: TDecoded) => TEncoded,
): Codec<TEncoded, TDecoded> {
  return { decode, encode };
}

// Common pre-built codecs

/** Date ↔ ISO string codec */
export const dateIsoCodec: Codec<string, Date> = {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
};

/** Date ↔ Unix epoch (seconds) codec */
export const dateEpochCodec: Codec<number, Date> = {
  decode: (n) => new Date(n * 1000),
  encode: (d) => Math.floor(d.getTime() / 1000),
};

/** Date ↔ Unix epoch (milliseconds) codec */
export const dateEpochMsCodec: Codec<number, Date> = {
  decode: (n) => new Date(n),
  encode: (d) => d.getTime(),
};

/** JSON string ↔ object codec */
export function jsonCodec<T>(): Codec<string, T> {
  return {
    decode: (s) => JSON.parse(s) as T,
    encode: (v) => JSON.stringify(v),
  };
}
