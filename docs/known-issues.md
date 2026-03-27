# Known Issues & Limitations

## Zod v4 Metadata Survival

**Issue**: `.meta()` on a Zod schema returns a new instance. Wrapping with `.optional()`, `.nullable()`, `.refine()`, or `.transform()` creates yet another instance that doesn't carry the metadata.

**Workaround**: Use `affordanceRegistry.register(innerSchema, affordances)` on the unwrapped schema before wrapping. The registry uses a WeakMap and `unwrapZodSchema()` to find the inner schema through wrappers.

**Status**: By design in Zod v4. The `affordanceRegistry` is zodal's solution.

## Zod v4 Introspection is Undocumented

**Issue**: zodal accesses `schema._zod.def` which is not a public API. Zod v4 may change internal structure in minor versions.

**Workaround**: All introspection is isolated in `inference.ts` helper functions (`getZodBaseType`, `unwrapZodSchema`, `hasZodCheck`, `getEnumValues`, `getZodMeta`, `getNumericBounds`). If internals change, only these functions need updating.

**Status**: Tracking. The predecessor has been stable across Zod v4.x releases so far.

## FilterExpression ↔ TanStack Table Bridge

**Issue**: zodal uses structured `FilterExpression` objects internally, but TanStack Table uses `ColumnFilter[]` (`{ id, value }`) for its state. The two formats are not directly compatible.

**Current behavior**: `toColumnDefs()` produces `filterFn` strings that TanStack Table understands. The `FilterExpression` is zodal's internal/storage representation. Users must bridge between them when using TanStack Table directly.

**Future**: A `filterExpressionToColumnFilters()` utility could be added.

## createZustandStoreSlice fetchData Pagination

**Issue**: `fetchData()` converts `pageIndex` (0-based, TanStack convention) to `page` (1-based, DataProvider convention) automatically. If a custom DataProvider expects 0-based pages, results will be off by one.

**Workaround**: Override `fetchData` or use the pure-function store directly.

## WeakMap-based Registry Has No clear()

**Issue**: `affordanceRegistry.clear()` is a no-op because JavaScript's WeakMap doesn't support `clear()`. Registrations persist until the schema objects are garbage collected.

**Workaround**: Create a fresh registry with `createAffordanceRegistry()` if you need isolation. The default `affordanceRegistry` is a convenience for common use cases.

## Name Heuristics May Over-Infer

**Issue**: Aggressive name heuristics (e.g., `description` → detailOnly, `status` → groupable) may not match every domain. A field named `status_code` that's a number will match the status pattern and get `groupable: true`.

**Workaround**: Use `explain()` to see what was inferred, then override with `CollectionConfig.fields` or `.meta()`. The `explain()` trace shows exactly which pattern matched.

## No Schema Validation on defineCollection

**Issue**: `defineCollection()` accepts any `z.ZodObject<any>`. It doesn't validate that the schema is well-formed or that config field names match the schema's shape. Misspelled field names in `CollectionConfig.fields` are silently ignored.

**Future**: Add a `strict` mode that warns about config fields not present in the schema.

## ESM-Only Internal Imports

**Issue**: Internal imports use `.js` extensions for ESM compatibility (e.g., `'./types.js'`). This is correct for ESM but may confuse developers used to extensionless imports.

**Status**: This is standard practice for ESM-first TypeScript packages. tsup handles the CJS build.
