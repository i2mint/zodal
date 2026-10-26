import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCollection } from '../src/index.js';
import {
  inferFieldAffordances,
  getZodBaseType,
  unwrapZodSchema,
  getEnumValues,
  humanizeFieldName,
  getNumericStep,
  getNumericBounds,
  getVocabulary,
} from '../src/inference.js';

// ============================================================================
// getZodBaseType
// ============================================================================

describe('getZodBaseType', () => {
  it('identifies basic types', () => {
    expect(getZodBaseType(z.string())).toBe('string');
    expect(getZodBaseType(z.number())).toBe('number');
    expect(getZodBaseType(z.boolean())).toBe('boolean');
    expect(getZodBaseType(z.date())).toBe('date');
  });

  it('identifies enum types', () => {
    expect(getZodBaseType(z.enum(['a', 'b', 'c']))).toBe('enum');
  });

  it('identifies array types', () => {
    expect(getZodBaseType(z.array(z.string()))).toBe('array');
  });

  it('identifies object types', () => {
    expect(getZodBaseType(z.object({ x: z.number() }))).toBe('object');
  });

  it('unwraps optional types', () => {
    expect(getZodBaseType(z.string().optional())).toBe('string');
  });

  it('unwraps nullable types', () => {
    expect(getZodBaseType(z.string().nullable())).toBe('string');
  });

  it('unwraps readonly, catch, prefault and nonoptional wrappers (#35)', () => {
    expect(getZodBaseType(z.string().readonly())).toBe('string');
    expect(getZodBaseType(z.string().catch('x'))).toBe('string');
    expect(getZodBaseType(z.string().prefault('x'))).toBe('string');
    expect(getZodBaseType(z.string().optional().nonoptional())).toBe('string');
    expect(getZodBaseType(z.number().optional().readonly().catch(0))).toBe('number');
  });

  it('resolves z.lazy and reads a pipe by the type its rows hold (#35)', () => {
    expect(getZodBaseType(z.lazy(() => z.string()))).toBe('string');
    // A codec or preprocess field holds its output type; a .transform() output is untyped,
    // so the input side stands in.
    expect(getZodBaseType(z.codec(z.string(), z.date(), { decode: (s) => new Date(s), encode: (d) => d.toISOString() }))).toBe('date');
    expect(getZodBaseType(z.preprocess((v) => Number(v), z.number()))).toBe('number');
    expect(getZodBaseType(z.string().transform((s) => s.trim()))).toBe('string');
    expect(getZodBaseType(z.string().email().transform((s) => s.trim()).optional())).toBe('string');
  });

  it('leaves a z.lazy whose getter throws as it is', () => {
    const broken = z.lazy((): z.ZodType => { throw new ReferenceError('not yet initialised'); });
    expect(getZodBaseType(broken)).toBe('lazy');
  });

  it('sees a vocabulary through z.lazy and pipes, as getZodBaseType does', () => {
    expect(getVocabulary(z.lazy(() => z.enum(['a', 'b'])))).toEqual(['a', 'b']);
    expect(getVocabulary(z.enum(['a', 'b']).transform((x) => x))).toEqual(['a', 'b']);
    expect(getVocabulary(z.array(z.enum(['x', 'y'])).readonly())).toEqual(['x', 'y']);
  });

  it('makes a .readonly() field non-editable', () => {
    expect(inferFieldAffordances('name', z.string().readonly()).editable).toBe(false);
    expect(inferFieldAffordances('name', z.string().optional().readonly()).editable).toBe(false);
    expect(inferFieldAffordances('name', z.string()).editable).toBe(true);
  });

  it('gives up on a self-referencing z.lazy instead of looping', () => {
    const loop: z.ZodType = z.lazy(() => loop);
    expect(() => getZodBaseType(loop)).not.toThrow();
  });

  it('unwraps default types', () => {
    expect(getZodBaseType(z.string().default('hello'))).toBe('string');
  });

  it('unwraps multiple layers', () => {
    expect(getZodBaseType(z.string().optional().nullable())).toBe('string');
  });
});

// ============================================================================
// getEnumValues
// ============================================================================

describe('getEnumValues', () => {
  it('returns values for enum schemas', () => {
    const values = getEnumValues(z.enum(['draft', 'active', 'archived']));
    expect(values).toEqual(['draft', 'active', 'archived']);
  });

  it('returns null for non-enum schemas', () => {
    expect(getEnumValues(z.string())).toBeNull();
    expect(getEnumValues(z.number())).toBeNull();
  });

  it('works with optional enums', () => {
    const values = getEnumValues(z.enum(['a', 'b']).optional());
    expect(values).toEqual(['a', 'b']);
  });
});

// ============================================================================
// humanizeFieldName
// ============================================================================

describe('humanizeFieldName', () => {
  it('handles camelCase', () => {
    expect(humanizeFieldName('firstName')).toBe('First Name');
    expect(humanizeFieldName('createdAt')).toBe('Created At');
    expect(humanizeFieldName('isPublished')).toBe('Is Published');
  });

  it('handles snake_case', () => {
    expect(humanizeFieldName('first_name')).toBe('First Name');
    expect(humanizeFieldName('created_at')).toBe('Created At');
  });

  it('handles kebab-case', () => {
    expect(humanizeFieldName('first-name')).toBe('First Name');
  });

  it('handles single words', () => {
    expect(humanizeFieldName('name')).toBe('Name');
    expect(humanizeFieldName('id')).toBe('Id');
  });

  it('handles already capitalized', () => {
    expect(humanizeFieldName('ID')).toBe('ID');
  });
});

// ============================================================================
// inferFieldAffordances: Type-based inference
// ============================================================================

describe('inferFieldAffordances - type-based', () => {
  it('infers string defaults', () => {
    const aff = inferFieldAffordances('title', z.string());
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('search');
    expect(aff.searchable).toBe(true);
    expect(aff.editable).toBe(true);
    expect(aff.visible).toBe(true);
  });

  it('infers number defaults', () => {
    const aff = inferFieldAffordances('price', z.number());
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('range');
    expect(aff.searchable).toBe(false);
    expect(aff.editable).toBe(true);
    expect(aff.aggregatable).toEqual(['sum', 'avg', 'min', 'max']);
  });

  it('infers boolean defaults', () => {
    const aff = inferFieldAffordances('isActive', z.boolean());
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('boolean');
    expect(aff.searchable).toBe(false);
    expect(aff.groupable).toBe(true);
  });

  it('infers enum defaults', () => {
    const aff = inferFieldAffordances('status', z.enum(['draft', 'active']));
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('select');
    expect(aff.groupable).toBe(true);
  });

  it('infers date defaults', () => {
    const aff = inferFieldAffordances('startDate', z.date());
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('range');
    expect(aff.searchable).toBe(false);
  });

  it('infers array defaults', () => {
    const aff = inferFieldAffordances('tags', z.array(z.string()));
    expect(aff.sortable).toBe(false);
    expect(aff.filterable).toBe('contains');
  });

  it('infers object defaults', () => {
    const aff = inferFieldAffordances('metadata', z.object({ key: z.string() }));
    expect(aff.sortable).toBe(false);
    expect(aff.filterable).toBe(false);
    expect(aff.detailOnly).toBe(true);
  });

  it('handles optional wrappers', () => {
    const aff = inferFieldAffordances('color', z.string().optional());
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('search');
  });

  it('handles nullable wrappers', () => {
    const aff = inferFieldAffordances('description', z.string().nullable());
    expect(aff.editWidget).toBe('textarea');
    expect(aff.truncate).toBe(100);
    expect(aff.sortable).toBe(false);
  });
});

// ============================================================================
// inferFieldAffordances: Name-based heuristics
// ============================================================================

describe('inferFieldAffordances - name heuristics', () => {
  it('marks "id" as not editable and hidden', () => {
    const aff = inferFieldAffordances('id', z.string());
    expect(aff.editable).toBe(false);
    expect(aff.visible).toBe(false);
    expect(aff.filterable).toBe('exact');
    expect(aff.searchable).toBe(false);
  });

  it('marks fields ending with Id as not editable', () => {
    const aff = inferFieldAffordances('userId', z.string());
    expect(aff.editable).toBe(false);
    expect(aff.filterable).toBe('exact');
  });

  it('marks "createdAt" as not editable, sortable, range-filterable', () => {
    const aff = inferFieldAffordances('createdAt', z.date());
    expect(aff.editable).toBe(false);
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('range');
  });

  it('marks "updatedAt" as not editable and hidden', () => {
    const aff = inferFieldAffordances('updatedAt', z.date());
    expect(aff.editable).toBe(false);
    expect(aff.visible).toBe(false);
  });

  it('marks "password" as not readable, not searchable, hidden', () => {
    const aff = inferFieldAffordances('password', z.string());
    expect(aff.readable).toBe(false);
    expect(aff.searchable).toBe(false);
    expect(aff.sortable).toBe(false);
    expect(aff.filterable).toBe(false);
    expect(aff.visible).toBe(false);
  });

  it('marks "email" as searchable with email widget', () => {
    const aff = inferFieldAffordances('email', z.string());
    expect(aff.searchable).toBe(true);
    expect(aff.editWidget).toBe('email');
    expect(aff.filterable).toBe('search');
  });

  it('marks "name" as searchable and summary field', () => {
    const aff = inferFieldAffordances('name', z.string());
    expect(aff.searchable).toBe(true);
    expect(aff.summaryField).toBe(true);
    expect(aff.sortable).toBe('both');
  });

  it('marks "description" as textarea with truncation', () => {
    const aff = inferFieldAffordances('description', z.string());
    expect(aff.editWidget).toBe('textarea');
    expect(aff.truncate).toBe(100);
    expect(aff.tooltip).toBe(true);
    expect(aff.sortable).toBe(false);
  });

  it('marks "status" as groupable with select filter', () => {
    const aff = inferFieldAffordances('status', z.string());
    expect(aff.groupable).toBe(true);
    expect(aff.filterable).toBe('select');
  });

  it('marks image fields as not sortable/filterable/searchable', () => {
    const aff = inferFieldAffordances('avatarUrl', z.string());
    expect(aff.sortable).toBe(false);
    expect(aff.filterable).toBe(false);
    expect(aff.searchable).toBe(false);
  });

  it('handles snake_case field names', () => {
    const aff = inferFieldAffordances('created_at', z.date());
    expect(aff.editable).toBe(false);
    expect(aff.sortable).toBe('both');
  });
});

// ============================================================================
// inferFieldAffordances: Zod metadata (.meta())
// ============================================================================

describe('inferFieldAffordances - Zod metadata', () => {
  it('applies .meta() overrides on top of inferred defaults', () => {
    const schema = z.string().meta({
      sortable: false,
      filterable: 'exact',
      title: 'Custom Title',
    });
    const aff = inferFieldAffordances('anyField', schema);
    expect(aff.sortable).toBe(false);
    expect(aff.filterable).toBe('exact');
    expect(aff.title).toBe('Custom Title');
  });

  it('uses standard meta fields', () => {
    const schema = z.string().meta({
      title: 'User Name',
      description: 'The display name of the user',
    });
    const aff = inferFieldAffordances('username', schema);
    expect(aff.title).toBe('User Name');
    expect(aff.description).toBe('The display name of the user');
  });

  it('supports nested affordances object in meta', () => {
    const schema = z.string().meta({
      affordances: {
        sortable: 'asc',
        editable: false,
      },
    });
    const aff = inferFieldAffordances('whatever', schema);
    expect(aff.sortable).toBe('asc');
    expect(aff.editable).toBe(false);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('inferFieldAffordances - edge cases', () => {
  it('always sets a title', () => {
    const aff = inferFieldAffordances('someWeirdField', z.string());
    expect(aff.title).toBe('Some Weird Field');
  });

  it('works with deeply nested optional/nullable/default', () => {
    const schema = z.number().optional().nullable().default(0);
    const aff = inferFieldAffordances('count', schema);
    expect(aff.sortable).toBe('both');
    expect(aff.filterable).toBe('range');
  });
});

describe('getNumericStep (#43)', () => {
  it('reads .multipleOf(), else 1 for an integer, else nothing', () => {
    expect(getNumericStep(z.number().multipleOf(5))).toBe(5);
    expect(getNumericStep(z.int().optional())).toBe(1);
    expect(getNumericStep(z.number().int())).toBe(1);
    expect(getNumericStep(z.number())).toBeUndefined();
  });
});

describe('union of T and null/undefined unwraps to T (#63)', () => {
  it('matches .nullable()', () => {
    expect(getZodBaseType(z.union([z.string(), z.null()]))).toBe('string');
    expect(getZodBaseType(z.union([z.null(), z.number(), z.undefined()]))).toBe('number');
    expect(getZodBaseType(z.union([z.enum(['a', 'b']), z.null()]))).toBe('enum');
  });
  it('keeps a real union as a union', () => {
    expect(getZodBaseType(z.union([z.string(), z.number(), z.null()]))).toBe('union');
    expect(getZodBaseType(z.union([z.null(), z.undefined()]))).toBe('union');
  });
});

describe('union with an empty member, more cases (#63)', () => {
  it('does not recurse forever on a self-referencing union', () => {
    const A: z.ZodType = z.lazy(() => z.union([A, z.null()]));
    expect(() => getZodBaseType(A)).not.toThrow();
  });
  it('treats wrapped and literal empties as empty', () => {
    expect(getZodBaseType(z.union([z.string(), z.null().optional()]))).toBe('string');
    expect(getZodBaseType(z.union([z.string(), z.literal(null)]))).toBe('string');
  });
  it('a nullable-union field gets the same widget as .nullable()', () => {
    const c = defineCollection(z.object({ a: z.union([z.string(), z.null()]), b: z.string().nullable() }));
    const { zodType: za, ...a } = c.fieldAffordances.a as any;
    const { zodType: zb, ...b } = c.fieldAffordances.b as any;
    expect(za).toBe(zb);
    expect(a).toEqual({ ...b, label: a.label });
  });
});
