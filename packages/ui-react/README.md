# @zodal/ui-react

The React binding for zodal forms: `SchemaForm` draws a whole form from a zodal collection, `SchemaField` one field, each with the component your renderer registry picks. It knows no component library, so the same binding serves `@zodal/ui-shadcn` or any other React renderer set.

```bash
npm install @zodal/ui-react @zodal/core @zodal/ui react zod
```

## Quick start

```tsx
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createShadcnRegistry } from '@zodal/ui-shadcn';
import { SchemaForm } from '@zodal/ui-react';

const settings = defineCollection(z.object({ name: z.string(), size: z.enum(['s', 'm', 'l']) }));
const registry = createShadcnRegistry();

function SettingsForm({ value, onChange }) {
  return <SchemaForm collection={settings} value={value} onChange={onChange} registry={registry} />;
}
```

A field added to the schema appears with no change to the form. Each field sits in a `<div class="zodal-field" data-field="<name>">`; labels and help text are the renderers' own.

## Details

- **The registry** comes from the `registry` prop or from the nearest `<RendererRegistryProvider registry={...}>`; with neither, rendering throws an error saying so.
- **`SchemaForm` props**: `mode` (`'edit'` by default; `'create'` surfaces the fields `toFormConfig` shows on create), `fields` (only these, in this order), `adjust(config, value)` (change a field's config from the current value: disable one, relabel options), `errors` (messages by field name), `context` (extra render context, e.g. `suggest` or `history`), `fallback` (drawn when no renderer matches; nothing by default), `as` and `className` for the wrapper.
- **`SchemaField`** draws one field from its `config` (a `toFormConfig` entry) and `affordance`, with `value` and `onChange`. It resolves with `formFieldAffordance(affordance, config)`, so the widget `toFormConfig` chose (a closed choice's select, for instance) reaches the renderer testers.
- **`resolveFormField(registry, config, affordance)`** returns the renderer a field gets without rendering it, for tests.
- **`useFormConfigs(collection, { mode, fields })`** is the memoised config list `SchemaForm` uses, for hosts that lay out fields themselves.

Part of [zodal](https://github.com/i2mint/zodal); why it is its own package: [ADR 0002](../../docs/adr/0002-react-form-binding-package.md).
