/**
 * @zodal/ui-react — the React binding between zodal's headless form generators and a
 * renderer registry: `SchemaField` draws one field, `SchemaForm` a whole form.
 *
 * Every React host used to write this glue itself (`toFormConfig` → `formFieldAffordance`
 * → `registry.resolve(..., { mode: 'form' })` → render with `{ field, config, context,
 * affordance }`), and the copies drifted (zodal#73 gap 7, zodal#83). The binding knows no
 * component library: the registry is an argument (or comes from a `RendererRegistryProvider`),
 * so `@zodal/ui-shadcn`, `@zodal/ui-vanilla`-style sets, or an MUI set all get the same one.
 *
 * Written with `createElement`, not JSX, so the package needs no JSX transform.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ResolvedFieldAffordance } from '@zodal/core';
import {
  formFieldAffordance,
  toFormConfig,
  type FieldRenderProps,
  type FormFieldConfig,
  type RendererContext,
  type RendererRegistry,
} from '@zodal/ui';

/** A registry of React components, as `createShadcnRegistry()` returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- renderers' props vary by field
export type ReactRendererRegistry = RendererRegistry<ComponentType<any>>;

/** The parts of a zodal collection (`defineCollection`'s result) the binding reads. */
export interface FormCollection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the schema type is the host's
  schema: any;
  fieldAffordances: Record<string, ResolvedFieldAffordance>;
}

/** Extra render context for every field (`suggest`, `history`, host keys); `mode` is always `'form'`. */
export type FormRenderContext = Omit<RendererContext, 'mode'>;

// ============================================================================
// The registry, from a prop or a provider
// ============================================================================

const RegistryContext = createContext<ReactRendererRegistry | null>(null);

/** Makes `registry` the one every `SchemaField` / `SchemaForm` below uses when not given one. */
export function RendererRegistryProvider({
  registry,
  children,
}: {
  registry: ReactRendererRegistry;
  children?: ReactNode;
}): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, children);
}

/** The registry to render with: `registry` if given, else the nearest provider's. */
export function useRendererRegistry(registry?: ReactRendererRegistry): ReactRendererRegistry {
  const provided = useContext(RegistryContext);
  const resolved = registry ?? provided;
  if (!resolved) {
    throw new Error(
      'No renderer registry: pass `registry` (e.g. createShadcnRegistry()) or wrap the form in ' +
        '<RendererRegistryProvider registry={...}>.',
    );
  }
  return resolved;
}

// ============================================================================
// SchemaField
// ============================================================================

export interface SchemaFieldProps<V = unknown> {
  /** The field's config, as `toFormConfig` makes it (or as `adjust` changed it). */
  config: FormFieldConfig;
  /** The field's affordance (`collection.fieldAffordances[config.name]`). */
  affordance: ResolvedFieldAffordance;
  value: V;
  onChange: (value: V) => void;
  /** Defaults to the nearest `RendererRegistryProvider`'s. */
  registry?: ReactRendererRegistry;
  context?: FormRenderContext;
  /** A validation message to show. */
  error?: string;
  onBlur?: () => void;
  /** Drawn when the registry has no renderer for the field. Default: nothing. */
  fallback?: ComponentType<FieldRenderProps<FormFieldConfig>>;
}

/**
 * The renderer a form field resolves to (or `null`): what `SchemaField` draws, and what a
 * test can check without rendering.
 */
export function resolveFormField(
  registry: ReactRendererRegistry,
  config: FormFieldConfig,
  affordance: ResolvedFieldAffordance,
  context: FormRenderContext = {},
): { affordance: ResolvedFieldAffordance; Renderer: ComponentType<FieldRenderProps<FormFieldConfig>> | null } {
  const resolvedAffordance = formFieldAffordance(affordance, config);
  const Renderer = registry.resolve(resolvedAffordance, { ...context, mode: 'form' });
  return { affordance: resolvedAffordance, Renderer };
}

/** One form field, drawn by the component the registry picks for it. */
export function SchemaField<V = unknown>({
  config,
  affordance,
  value,
  onChange,
  registry,
  context,
  error,
  onBlur,
  fallback,
}: SchemaFieldProps<V>): ReactElement | null {
  const reg = useRendererRegistry(registry);
  const fullContext: RendererContext = { ...context, mode: 'form' };
  const { affordance: resolved, Renderer } = resolveFormField(reg, config, affordance, context);
  const Component = Renderer ?? fallback;
  if (!Component) return null;
  const props: FieldRenderProps<FormFieldConfig, V> = {
    field: { value, onChange, name: config.name, ...(onBlur ? { onBlur } : {}) },
    config,
    context: fullContext,
    affordance: resolved,
    disabled: config.disabled,
    required: config.required,
    ...(error !== undefined ? { error } : {}),
  };
  return createElement(Component as ComponentType<FieldRenderProps<FormFieldConfig, V>>, props);
}

// ============================================================================
// SchemaForm
// ============================================================================

/**
 * The form's field configs: `toFormConfig(collection, mode)` without hidden fields, in
 * `order`, or only `fields`, in that order. Memoised on its inputs.
 */
export function useFormConfigs(
  collection: FormCollection,
  { mode = 'edit', fields }: { mode?: 'create' | 'edit'; fields?: readonly string[] } = {},
): FormFieldConfig[] {
  const key = fields?.join('\u0000');
  return useMemo(() => {
    const all = toFormConfig(collection as never, mode).filter((c) => !c.hidden);
    if (!fields) return all;
    const byName = new Map(all.map((c) => [c.name, c]));
    return fields.flatMap((name) => {
      const config = byName.get(name);
      return config ? [config] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `fields`
  }, [collection, mode, key]);
}

export interface SchemaFormProps<T extends Record<string, unknown>> {
  collection: FormCollection;
  value: T;
  /** Called with the whole next value when one field changes. */
  onChange: (next: T) => void;
  /** Which fields `toFormConfig` surfaces. Default `'edit'`. */
  mode?: 'create' | 'edit';
  /** Only these fields, in this order. Default: every visible field, in `order`. */
  fields?: readonly string[];
  /** Changes a field's config from the current value (disable one, relabel options). */
  adjust?: (config: FormFieldConfig, value: T) => FormFieldConfig;
  registry?: ReactRendererRegistry;
  context?: FormRenderContext;
  /** Validation messages by field name. */
  errors?: Partial<Record<string, string>>;
  fallback?: ComponentType<FieldRenderProps<FormFieldConfig>>;
  /** The element around the fields. Default `'div'`. */
  as?: string;
  className?: string;
}

/**
 * A whole form from a zodal collection: one `SchemaField` per field. A field added to the
 * schema appears with no change to the host. Each field sits in a wrapper carrying
 * `data-field="<name>"`, for styling and tests; labels are the renderers' own.
 */
export function SchemaForm<T extends Record<string, unknown>>({
  collection,
  value,
  onChange,
  mode = 'edit',
  fields,
  adjust,
  registry,
  context,
  errors,
  fallback,
  as = 'div',
  className,
}: SchemaFormProps<T>): ReactElement {
  const reg = useRendererRegistry(registry);
  const configs = useFormConfigs(collection, { mode, fields });
  const children = configs.map((base) => {
    const affordance = collection.fieldAffordances[base.name];
    if (!affordance) return null;
    const config = adjust ? adjust(base, value) : base;
    return createElement(
      'div',
      { key: base.name, className: 'zodal-field', 'data-field': base.name },
      createElement(SchemaField, {
        config,
        affordance,
        value: value[base.name],
        onChange: (next: unknown) => onChange({ ...value, [base.name]: next }),
        registry: reg,
        context,
        error: errors?.[base.name],
        fallback,
      }),
    );
  });
  return createElement(as, { className: className ?? 'zodal-form' }, children);
}
