import { describe, it, expect } from 'vitest';
import {
  composeCodecs,
  identityCodec,
  createCodec,
  dateIsoCodec,
  dateEpochCodec,
  dateEpochMsCodec,
  jsonCodec,
} from '../src/codec-types.js';

describe('identityCodec', () => {
  it('passes values through unchanged', () => {
    const codec = identityCodec<number>();
    expect(codec.decode(42)).toBe(42);
    expect(codec.encode(42)).toBe(42);
  });
});

describe('createCodec', () => {
  it('creates a codec from functions', () => {
    const doubleCodec = createCodec(
      (n: number) => n * 2,
      (n: number) => n / 2,
    );
    expect(doubleCodec.decode(5)).toBe(10);
    expect(doubleCodec.encode(10)).toBe(5);
  });
});

describe('composeCodecs', () => {
  it('composes two codecs in sequence', () => {
    const addOne = createCodec(
      (n: number) => n + 1,
      (n: number) => n - 1,
    );
    const double = createCodec(
      (n: number) => n * 2,
      (n: number) => n / 2,
    );
    // decode: addOne.decode(5) = 6, double.decode(6) = 12
    const composed = composeCodecs(addOne, double);
    expect(composed.decode(5)).toBe(12);
    // encode: double.encode(12) = 6, addOne.encode(6) = 5
    expect(composed.encode(12)).toBe(5);
  });

  it('compose with identity is no-op', () => {
    const addOne = createCodec(
      (n: number) => n + 1,
      (n: number) => n - 1,
    );
    const composed = composeCodecs(identityCodec<number>(), addOne);
    expect(composed.decode(5)).toBe(6);
    expect(composed.encode(6)).toBe(5);
  });
});

describe('dateIsoCodec', () => {
  it('decodes ISO string to Date', () => {
    const date = dateIsoCodec.decode('2024-01-15T00:00:00.000Z');
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2024);
  });

  it('encodes Date to ISO string', () => {
    const iso = dateIsoCodec.encode(new Date('2024-01-15T00:00:00.000Z'));
    expect(iso).toBe('2024-01-15T00:00:00.000Z');
  });

  it('round-trips correctly', () => {
    const original = '2024-06-15T12:30:00.000Z';
    expect(dateIsoCodec.encode(dateIsoCodec.decode(original))).toBe(original);
  });
});

describe('dateEpochCodec', () => {
  it('decodes epoch seconds to Date', () => {
    const date = dateEpochCodec.decode(1705276800); // 2024-01-15 00:00:00 UTC
    expect(date).toBeInstanceOf(Date);
    expect(date.getUTCFullYear()).toBe(2024);
  });

  it('encodes Date to epoch seconds', () => {
    const epoch = dateEpochCodec.encode(new Date('2024-01-15T00:00:00.000Z'));
    expect(epoch).toBe(1705276800);
  });
});

describe('dateEpochMsCodec', () => {
  it('decodes epoch ms to Date', () => {
    const date = dateEpochMsCodec.decode(1705276800000);
    expect(date).toBeInstanceOf(Date);
  });

  it('round-trips correctly', () => {
    const original = Date.now();
    expect(dateEpochMsCodec.encode(dateEpochMsCodec.decode(original))).toBe(original);
  });
});

describe('jsonCodec', () => {
  it('decodes JSON string to object', () => {
    const codec = jsonCodec<{ x: number }>();
    expect(codec.decode('{"x":42}')).toEqual({ x: 42 });
  });

  it('encodes object to JSON string', () => {
    const codec = jsonCodec<{ x: number }>();
    expect(codec.encode({ x: 42 })).toBe('{"x":42}');
  });
});
