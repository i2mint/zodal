/**
 * SchemaField / SchemaForm: the shared React binding of toFormConfig + resolve (zodal#83).
 * The registry here is a tiny fake, so the binding is tested with no component library.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { PRIORITY, createRendererRegistry, toFormConfig, type FieldRenderProps, type FormFieldConfig } from '@zodal/ui';
import {
  RendererRegistryProvider,
  SchemaField,
  SchemaForm,
  resolveFormField,
  type ReactRendererRegistry,
} from '../src/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema = z.object({
  name: z.string().max(20),
  size: z.enum(['s', 'm', 'l']),
  count: z.number(),
  secretNote: z.string().optional(),
});
const collection = defineCollection(schema, { fields: { secretNote: { hidden: true } } } as never);

type Props = FieldRenderProps<FormFieldConfig>;

function TextInput({ field, config, error }: Props) {
  return createElement('input', {
    'data-widget': 'text',
    name: config.name,
    maxLength: config.maxLength,
    value: String(field.value ?? ''),
    'data-error': error,
    onChange: (e: { target: { value: string } }) => field.onChange(e.target.value),
  });
}

function SelectInput({ field, config }: Props) {
  return createElement('select', { 'data-widget': 'select', name: config.name, value: String(field.value ?? ''), onChange: () => {} });
}

function ReadOnly({ config }: Props) {
  return createElement('output', { 'data-widget': 'readonly', name: config.name });
}

function makeRegistry(): ReactRendererRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry = createRendererRegistry<ComponentType<any>>();
  registry.register({ name: 'TextInput', tester: (a, c) => (c.mode === 'form' && a.zodType === 'string' ? 10 : -1), renderer: TextInput });
  registry.register({ name: 'SelectInput', tester: (a, c) => (c.mode === 'form' && a.editWidget === 'select' ? 50 : -1), renderer: SelectInput });
  // A catch-all, as renderer sets have (shadcn's ReadOnlyInput): `fallback` must still win over it.
  registry.register({ name: 'ReadOnly', tester: (_a, c) => (c.mode === 'form' ? PRIORITY.FALLBACK : -1), renderer: ReadOnly });
  return registry;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(element: ReturnType<typeof createElement>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('SchemaForm', () => {
  it('draws one field per visible schema field, picked by the registry', () => {
    const html = renderToStaticMarkup(
      createElement(SchemaForm, { collection, value: { name: 'a', size: 'm', count: 1 }, onChange: () => {}, registry: makeRegistry() }),
    );
    expect(html).toContain('data-field="name"');
    expect(html).toContain('data-widget="text"');
    // The closed choice is drawn by the select: the config's widget reaches the tester (formFieldAffordance).
    expect(html).toMatch(/data-field="size"><select data-widget="select"/);
    // No specific renderer for a number: the registry's catch-all. Hidden fields never appear.
    expect(html).toContain('data-field="count"><output data-widget="readonly"');
    expect(html).not.toContain('secretNote');
  });

  it('passes the config through, so renderers see schema facts like maxLength', () => {
    const html = renderToStaticMarkup(
      createElement(SchemaForm, { collection, value: {}, onChange: () => {}, registry: makeRegistry(), fields: ['name'] }),
    );
    expect(html).toContain('maxLength="20"');
  });

  it('writes the whole next value when a field changes', () => {
    const seen: unknown[] = [];
    const el = mount(
      createElement(SchemaForm, {
        collection,
        value: { name: 'a', size: 'm', count: 1 },
        onChange: (next: unknown) => seen.push(next),
        registry: makeRegistry(),
      }),
    );
    const input = el.querySelector('input[name="name"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'ab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toEqual([{ name: 'ab', size: 'm', count: 1 }]);
  });

  it('composes two changes made in one tick, and says which field changed', () => {
    const seen: unknown[][] = [];
    let fire: Array<(v: unknown) => void> = [];
    const Capture = ({ field }: Props) => {
      fire.push(field.onChange as (v: unknown) => void);
      return null;
    };
    const registry = makeRegistry();
    registry.register({ name: 'Capture', tester: () => 999, renderer: Capture });
    mount(
      createElement(SchemaForm, {
        collection,
        value: { name: 'a', size: 'm', count: 1 },
        onChange: (next: unknown, change: unknown) => seen.push([next, change]),
        registry,
        fields: ['name', 'count'],
      }),
    );
    const [setName, setCount] = fire.slice(-2);
    act(() => {
      setName('x');
      setCount(2);
    });
    expect(seen.at(-1)).toEqual([{ name: 'x', size: 'm', count: 2 }, { name: 'count', value: 2 }]);
  });

  it('draws errors under their fields, and as a form does not reload on submit', () => {
    const el = mount(
      createElement(SchemaForm, {
        collection,
        value: {},
        onChange: () => {},
        registry: makeRegistry(),
        fields: ['name'],
        errors: { name: 'Required' },
        as: 'form',
      }),
    );
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Required');
    expect(el.querySelector('[data-field="name"]')!.getAttribute('aria-describedby')).toBe(alert.id);
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      el.querySelector('form')!.dispatchEvent(submit);
    });
    expect(submit.defaultPrevented).toBe(true);
  });

  it('keeps only `fields`, in their order, and applies `adjust` and `errors`', () => {
    const html = renderToStaticMarkup(
      createElement(SchemaForm, {
        collection,
        value: {},
        onChange: () => {},
        registry: makeRegistry(),
        fields: ['size', 'name', 'nope'],
        adjust: (c: FormFieldConfig) => (c.name === 'name' ? { ...c, maxLength: 5 } : c),
        errors: { name: 'Too long' },
      }),
    );
    expect(html.indexOf('data-field="size"')).toBeLessThan(html.indexOf('data-field="name"'));
    expect(html).not.toContain('data-field="count"');
    expect(html).toContain('maxLength="5"');
    expect(html).toContain('data-error="Too long"');
  });

  it('takes the registry from a provider, and says what to do without one', () => {
    const form = createElement(SchemaForm, { collection, value: {}, onChange: () => {}, fields: ['name'] });
    const html = renderToStaticMarkup(createElement(RendererRegistryProvider, { registry: makeRegistry() }, form));
    expect(html).toContain('data-widget="text"');
    expect(() => renderToStaticMarkup(form)).toThrow(/RendererRegistryProvider/);
  });
});

describe('SchemaField', () => {
  const configs = toFormConfig(collection, 'edit');
  const count = configs.find((c) => c.name === 'count')!;

  it('draws the fallback when the registry has only a catch-all', () => {
    const Fallback = ({ config }: Props) => createElement('span', { 'data-fallback': config.name });
    const html = renderToStaticMarkup(
      createElement(SchemaField, {
        config: count,
        affordance: collection.fieldAffordances.count,
        value: 1,
        onChange: () => {},
        registry: makeRegistry(),
        fallback: Fallback,
      }),
    );
    expect(html).toBe('<span data-fallback="count"></span>');
  });

  it('resolveFormField says which renderer a field gets, without rendering', () => {
    const size = configs.find((c) => c.name === 'size')!;
    const { Renderer, affordance } = resolveFormField(makeRegistry(), size, collection.fieldAffordances.size);
    expect(Renderer).toBe(SelectInput);
    expect(affordance.editWidget).toBe('select');
  });
});
