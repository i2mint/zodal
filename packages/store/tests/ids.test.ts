import { describe, it, expect } from 'vitest';
import { isSafeId, assertSafeId, encodeId, decodeId, unsafeIdReason, UnsafeIdError } from '../src/index.js';
import { HOSTILE_IDS } from '../src/testing.js';

describe('safe ids', () => {
  it('accepts plain ids', () => {
    for (const id of ['1', 'abc', 'a.b', 'a_b-c', 'sg_0123abcd', '_x']) expect(isSafeId(id)).toBe(true);
  });
  it('rejects every hostile id with a reason', () => {
    for (const [, id] of HOSTILE_IDS) {
      expect(isSafeId(id)).toBe(false);
      expect(unsafeIdReason(id)).toBeTypeOf('string');
      expect(() => assertSafeId(id)).toThrow(UnsafeIdError);
    }
    expect(unsafeIdReason('')).toMatch(/empty/);
    expect(unsafeIdReason('-rf')).toBeDefined();
    expect(unsafeIdReason(3)).toMatch(/string/);
  });
  it('honours maxLength', () => {
    expect(isSafeId('abc', { maxLength: 2 })).toBe(false);
  });
});

describe('encodeId / decodeId', () => {
  it('keeps safe ids unchanged', () => {
    expect(encodeId('abc-1.json')).toBe('abc-1.json');
    expect(decodeId('abc-1.json')).toBe('abc-1.json');
  });
  it('round-trips hostile ids into safe ids', () => {
    for (const [label, id] of HOSTILE_IDS) {
      if (label === 'very long') continue;
      const enc = encodeId(id);
      expect(isSafeId(enc.slice(1))).toBe(true);
      expect(enc.startsWith('~')).toBe(true);
      expect(decodeId(enc)).toBe(id);
    }
  });
  it('is injective across safe and encoded forms', () => {
    expect(encodeId('~tilde')).not.toBe('~tilde');
    expect(decodeId(encodeId('~tilde'))).toBe('~tilde');
  });
  it('can always encode', () => {
    expect(encodeId('abc', { always: true })).toBe('~YWJj');
    expect(decodeId('~YWJj')).toBe('abc');
  });
  it('refuses an id whose encoding is too long', () => {
    expect(() => encodeId('x'.repeat(1000))).toThrow(/longer than 200/);
    expect(encodeId('x'.repeat(1000), { maxLength: 2000 })).toBe('x'.repeat(1000));
  });
});
