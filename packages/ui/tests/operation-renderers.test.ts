import { describe, it, expect, expectTypeOf } from 'vitest';
import type { OperationDefinition } from '@zodal/core';
import {
  createRendererRegistry, operationIs, operationScopeIs, operationVariantIs, and, or, PRIORITY, zodTypeIs,
  type OperationRenderProps, type RendererContext,
} from '../src/index.js';

const archive: OperationDefinition = { name: 'archive', label: 'Archive', scope: 'item' };
const purge: OperationDefinition = { name: 'purge', label: 'Delete all', scope: 'collection', variant: 'destructive', confirm: true };
const op: RendererContext = { mode: 'operation' };

describe("renderers for operations ('operation' mode, #80)", () => {
  const registry = createRendererRegistry<string, OperationDefinition>();
  registry.register({ tester: operationScopeIs('item', 'selection', 'collection'), renderer: 'Button', name: 'Button' });
  registry.register({ tester: operationVariantIs('destructive'), renderer: 'DangerButton', name: 'DangerButton' });
  registry.register({ tester: operationIs('archive'), renderer: 'ArchiveButton', name: 'ArchiveButton' });

  it('resolves by name, then variant, then scope', () => {
    expect(registry.resolve(archive, op)).toBe('ArchiveButton');
    expect(registry.resolve(purge, op)).toBe('DangerButton');
    expect(registry.resolve({ name: 'x', label: 'X', scope: 'selection' }, op)).toBe('Button');
    expect(registry.explain(purge, op).map((e) => e.name)).toEqual(['DangerButton', 'Button', 'ArchiveButton']);
  });
  it('operation testers match only in operation mode', () => {
    expect(operationIs('archive')(archive, { mode: 'form' })).toBe(-1);
    expect(registry.resolve(archive, { mode: 'cell' })).toBeNull();
  });
  it('combinators work over operations', () => {
    const t = and(operationScopeIs('collection'), operationVariantIs('destructive'));
    expect(t(purge, op)).toBe(PRIORITY.DEFAULT + PRIORITY.LIBRARY);
    expect(or(operationIs('nope'), operationScopeIs('item'))(archive, op)).toBe(PRIORITY.DEFAULT);
  });
  it('a field registry is unchanged: its default subject is a field', () => {
    const fields = createRendererRegistry<string>();
    fields.register({ tester: zodTypeIs('string'), renderer: 'Text' });
    expect(fields.resolve({ zodType: 'string' } as any, { mode: 'form' })).toBe('Text');
  });
  it('OperationRenderProps carries the definition and a dispatch', () => {
    expectTypeOf<OperationRenderProps<{ reason: string }>['dispatch']>().parameters.toEqualTypeOf<[params?: { reason: string }]>();
    expectTypeOf<OperationRenderProps['operation']>().toEqualTypeOf<OperationDefinition<unknown>>();
  });
});
