import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getVocabulary } from '../src/inference.js';

describe('getVocabulary', () => {
  it.each([
    ['enum', z.enum(['a', 'b']), ['a', 'b']],
    ['array of enum', z.array(z.enum(['a', 'b'])), ['a', 'b']],
    ['wrapped element', z.array(z.enum(['a', 'b']).optional()).default([]), ['a', 'b']],
    ['numeric enum', z.array(z.enum({ A: 0, B: 1 })), ['0', '1']],
    ['union of literals', z.array(z.union([z.literal('x'), z.literal('y')])), ['x', 'y']],
    ['multi-literal', z.array(z.literal(['x', 'y'])), ['x', 'y']],
    ['set of enum', z.set(z.enum(['p', 'q'])), ['p', 'q']],
    ['catch on element', z.array(z.enum(['a']).catch('a')), ['a']],
  ])('%s', (_label, schema, expected) => {
    expect(getVocabulary(schema as any)).toEqual(expected);
  });
  it.each([
    ['open strings', z.array(z.string())],
    ['union with an open member', z.array(z.union([z.literal('x'), z.string()]))],
    ['plain string', z.string()],
  ])('%s is open', (_label, schema) => {
    expect(getVocabulary(schema as any)).toBeNull();
  });
});
