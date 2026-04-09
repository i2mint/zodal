# Content-Metadata Bifurcation: Implementation Notes for zodal

Deep-dive implementation notes for adding bifurcation support to zodal. Assumes familiarity with the [design notes](bifurcation_design_notes.md) and [research notes](bifurcation_research_for_zodal.md). This is *not* an implementation plan — it's the detailed thinking that supports one.

---

## 1. Core Package: Types and Inference

### 1.1 FieldStorageRole

A simple union type in `packages/core/src/types.ts`:

```typescript
export type FieldStorageRole = 'metadata' | 'content';
```

Two values, not three. There is no "both" or "auto" — every field is one or the other, and default is metadata. This is a classification, not a configuration. It tells the system *where* a field's data lives, not *how* to store it.

### 1.2 ContentRef

Must live in `@zodal/core`, not `@zodal/store`, because:
- `@zodal/ui` needs to know about it (for rendering decisions)
- `@zodal/ui` depends on `@zodal/core` but NOT on `@zodal/store`
- Putting `ContentRef` in core makes it accessible to both sides without dependency violations

The `_tag: 'ContentRef'` discriminator is essential. Without it, a content field of type `string` returning a `ContentRef` object would be ambiguous — is it a URL string or a reference object? The tag makes type narrowing reliable:

```typescript
if (isContentRef(value)) {
  // render as download link
} else {
  // render as inline text
}
```

### 1.3 Inference Engine Extension

The storageRole inference fits cleanly into the existing 6-layer engine. The key file is `packages/core/src/inference.ts`.

**Layer 1 (Type defaults):** The `getTypeDefaults()` function maps Zod base types to default affordances. We add:
- `z.instanceof(Blob)` → `{ storageRole: 'content' }`
- `z.instanceof(File)` → `{ storageRole: 'content' }`
- `z.instanceof(ArrayBuffer)` → `{ storageRole: 'content' }`
- `z.instanceof(Uint8Array)` → `{ storageRole: 'content' }`

**Layer 3 (Name heuristics):** The `refineByFieldName()` function applies name-based patterns. We add:
```
CONTENT_FIELD_PATTERNS = /^(content|body|attachment|file|blob|binary|payload|raw_?data|media|document|source)$/i
CONTENT_SUFFIX_PATTERNS = /_(content|body|blob|binary|file|data|payload|media)$/i
```

When matched, set `storageRole: 'content'` plus cascading implications:
- `sortable: false` (can't sort by content)
- `filterable: false` (can't filter by content)  
- `searchable: false` (can't search content)
- `detailOnly: true` (hide from list views by default)

**Layers 4-6 (`.meta()`, registry, config):** No engine changes needed — these already override any earlier layer. A user can write `fields: { content: { storageRole: 'metadata' } }` to suppress the name heuristic.

**Tracing:** Add `'storageRole'` to `TRACED_PROPS` array so `explain('content')` shows which layer classified the field.

### 1.4 Collection Definition Extensions

Add to `CollectionDefinition<T>`:

```typescript
getContentFields(): string[]     // fields where storageRole === 'content'
getMetadataFields(): string[]    // fields where storageRole !== 'content'
hasBifurcation(): boolean        // getContentFields().length > 0
```

Implementation is a simple filter over `fieldAffordances`. These are query methods, not state — they derive from the existing affordance map.

### 1.5 ContentConfig on CollectionConfig

```typescript
content?: {
  listStrategy?: 'reference' | 'omit';    // default: 'reference'
  detailStrategy?: 'eager' | 'reference'; // default: 'reference'
}
```

This configures how the `BifurcatedProvider` handles content fields in different read contexts. It lives on `CollectionConfig` because it's a collection-level concern, not a field-level concern.

---

## 2. Store Package: BifurcatedProvider

### 2.1 The Factory Function

```typescript
function createBifurcatedProvider<T extends Record<string, any>>(
  options: BifurcatedProviderOptions<T>
): DataProvider<T>
```

Returns a plain object implementing `DataProvider<T>`. Not a class. Follows the same pattern as `createInMemoryProvider`, `createFsProvider`, etc.

### 2.2 Operation Routing Details

**`getList(params)`**
1. Forward `params` to `metadataProvider.getList(params)` — this handles all sorting, filtering, pagination
2. For each item in the result:
   - If `listStrategy === 'reference'`: replace each content field value with a `ContentRef` constructed via `toContentRef(item[idField], fieldName, contentMeta)`
   - If `listStrategy === 'omit'`: delete content field keys from the item
3. Return the modified result with the same `total` count

Content metadata (hash, size, mimeType) might be stored as columns in the metadata provider's storage. The `BifurcatedProvider` reads these from the metadata result and uses them to construct `ContentRef` objects. This means the metadata table needs a few extra columns per content field — a design decision documented below.

**`getOne(id)`**
1. Fetch from metadata provider: `metadataProvider.getOne(id)`
2. If `detailStrategy === 'reference'`: replace content fields with `ContentRef` (same as getList)
3. If `detailStrategy === 'eager'`: 
   - For each content field, fetch from content provider: `contentProvider.getOne(id)` 
   - Merge: `{ ...metadataResult, ...contentResult }`
4. Return merged item

**`create(data)`**
1. Split: `const { metadata, content } = splitFields(data, contentFields)`
2. Write metadata first: `const created = await metadataProvider.create(metadata)`
3. If content is non-empty: 
   - Add ID to content: `content[idField] = created[idField]`
   - Write content: `await contentProvider.create(content)`
4. If content write fails: compensate by deleting metadata: `await metadataProvider.delete(created[idField])`
5. Return `created` (metadata result, not content)

**`update(id, data)`**
1. Split: `const { metadata, content } = splitFields(data, contentFields)`
2. If metadata is non-empty: `await metadataProvider.update(id, metadata)`
3. If content is non-empty: `await contentProvider.update(id, content)`
4. Return result from metadata update

Note: update is simpler than create because the item already exists in both stores. If the content update fails, the metadata update has already succeeded — the item has new metadata but old content. This is acceptable (content can be retried) and preferable to rolling back the metadata update.

**`delete(id)`**
1. Try content deletion first: `await contentProvider.delete(id).catch(() => {})` — swallow errors because orphaned content is less harmful than dangling metadata
2. Delete metadata: `await metadataProvider.delete(id)`

**`updateMany(ids, data)` / `deleteMany(ids)`**
Same patterns as single-item operations, applied in parallel across IDs.

**`getCapabilities()`**
```typescript
{
  ...metadataProvider.getCapabilities?.() ?? DEFAULT_CAPABILITIES,
  bifurcated: true,
  contentFields: options.contentFields,
  // CRUD capabilities: both providers must support them
  canCreate: metaCaps.canCreate && contentCaps.canCreate,
  canUpdate: metaCaps.canUpdate && contentCaps.canUpdate,
  canDelete: metaCaps.canDelete && contentCaps.canDelete,
}
```

### 2.3 The splitFields Utility

```typescript
function splitFields<T>(data: Partial<T>, contentFields: string[]): { metadata: Partial<T>; content: Partial<T> }
```

Pure function, no side effects. Uses a `Set` for O(1) field classification. Handles `undefined` values (missing fields are not included in either partition).

### 2.4 Content Metadata in the Metadata Store

When a content field is stored externally, the metadata store should still hold *about* the content:
- `{field}_hash` — content hash (for cache busting, deduplication)
- `{field}_mime` — MIME type (for rendering decisions)
- `{field}_size` — byte size (for display, quota management)
- `{field}_url` — pre-signed or public URL (for direct browser access)

This is a *convention*, not a requirement. The `BifurcatedProvider` accepts an optional `toContentRef` function that constructs `ContentRef` from whatever columns exist. The default implementation looks for `{field}_hash`, `{field}_mime`, `{field}_size`, `{field}_url` columns in the metadata result.

Alternative approach: store a single `{field}_ref` JSONB column containing `{ hash, mimeType, size, url }`. This is cleaner for databases that support JSONB (Supabase/PostgreSQL) but less portable.

### 2.5 Optional getContent/setContent

Adding to `DataProvider<T>`:

```typescript
getContent?(id: string, field: string): Promise<unknown>;
setContent?(id: string, field: string, content: unknown): Promise<ContentRef>;
```

The `BifurcatedProvider` implements these by routing to the content provider:
- `getContent(id, 'document')` → `contentProvider.getOne(id)` → extract `document` field
- `setContent(id, 'document', blob)` → `contentProvider.update(id, { document: blob })` → return `ContentRef`

These are convenience methods. The same result is achievable via `provider.update(id, { document: blob })` which routes to the content provider anyway. But `getContent`/`setContent` make the intent clearer and are essential for the UI's lazy-loading pattern.

---

## 3. UI Package: Content Awareness

### 3.1 Column Definitions

In `toColumnDefs`, for fields with `storageRole === 'content'`:

```typescript
{
  id: 'document',
  header: 'Document',
  enableSorting: false,
  enableColumnFilter: false,
  enableGlobalFilter: false,
  enableGrouping: false,
  meta: {
    storageRole: 'content',
    isContentRef: true,
    zodType: 'string', // or whatever the original type is
    // ... other existing meta ...
  }
}
```

Renderers use `meta.storageRole` and `meta.isContentRef` to decide rendering strategy. This is headless — no DOM decisions here, just configuration.

### 3.2 Form Configuration

For content fields, infer:
```typescript
{
  name: 'document',
  type: 'file',          // instead of 'text' or 'textarea'
  isContentField: true,
  acceptMimeTypes: ['application/pdf', 'image/*'],  // from .meta() or constraints
  maxSize: 10_000_000,  // from .meta() or constraints
}
```

The `acceptMimeTypes` and `maxSize` can be inferred from Zod refinements (if the schema uses them) or from `.meta({ mimeTypes: [...], maxSize: ... })`.

### 3.3 Renderer Tester Predicate

```typescript
export function storageRoleIs(role: FieldStorageRole): RendererTester {
  return (field) => field.storageRole === role ? PRIORITY.LIBRARY : -1;
}
```

Concrete renderers in `zodal-ui-vanilla` and `zodal-ui-shadcn` register:
- Cell renderer for `storageRoleIs('content')` — renders download link or thumbnail
- Form renderer for `storageRoleIs('content')` — renders file upload widget

### 3.4 State Management

Minimal addition to `CollectionState<T>`:

```typescript
contentLoading?: Record<string, Record<string, boolean>>;
// { [itemId]: { [fieldName]: true/false } }
```

This enables "click to load" UIs: user clicks a content cell, UI sets `contentLoading[id][field] = true`, calls `provider.getContent(id, field)`, displays the result, sets loading to false.

---

## 4. Cross-Cutting Concerns

### 4.1 Error Handling

Bifurcated operations can fail partially. The strategy:

| Operation | Metadata succeeds | Content fails | Outcome |
|---|---|---|---|
| create | Item exists | Content missing | Recoverable: retry content upload |
| update | Metadata updated | Content stale | Acceptable: old content + new metadata |
| delete | Item exists | Content orphaned | Invisible: metadata still references content |

The `BifurcatedProvider` should surface content-write failures as warnings, not hard errors, for create/update. For delete, content-write failures are swallowed (orphaned content is cleaned up by GC, if implemented).

### 4.2 TypeScript Typing Challenges

The `DataProvider<T>` generic parameter `T` describes the full item shape including content fields. But `getList` returns items where content fields are replaced with `ContentRef`. This creates a type mismatch.

Options:
- **Option A (Mapped type):** `type WithContentRefs<T, ContentKeys extends keyof T> = Omit<T, ContentKeys> & { [K in ContentKeys]: ContentRef }`. The `getList` return type becomes `GetListResult<WithContentRefs<T, ...>>`. This is type-safe but complex.
- **Option B (Runtime guard):** Keep `getList` returning `GetListResult<T>` and document that content fields may be `ContentRef` at runtime. Use `isContentRef()` to check. Simpler but less type-safe.
- **Option C (Schema-level):** The user defines content fields as `z.union([z.string(), ContentRefSchema])` in the schema. The schema itself reflects the runtime reality. Most honest but verbose.

**Recommendation:** Start with Option B for simplicity. It's the approach TanStack Query uses (data transforms happen at runtime, types are approximate). Add Option A as an enhancement if users request stricter typing.

### 4.3 Testing Strategy

**Unit tests for core:**
- `defineCollection(schemaWithContentField)` → `getContentFields()` returns correct fields
- Name heuristic fires for `content`, `body`, `attachment`, etc.
- Name heuristic does NOT fire for `contentType`, `contents`, `bodyWeight`
- Explicit override suppresses heuristic
- `explain()` traces storageRole classification

**Unit tests for store:**
- `splitFields()` correctly partitions metadata and content
- `createBifurcatedProvider()` with two in-memory providers:
  - `getList` returns `ContentRef` for content fields
  - `create` writes to both providers
  - `update` with only metadata fields doesn't touch content provider
  - `delete` removes from both providers
  - `getContent` returns actual content
  - `setContent` updates content and returns `ContentRef`
  - `getCapabilities()` reports `bifurcated: true`

**Integration tests:**
- Full flow: define collection → create bifurcated provider → create item → list items (content as refs) → get content → update content → delete item
- Error scenarios: content write fails on create → metadata is cleaned up
- Capability-driven UI: `getCapabilities().contentFields` used to adjust UI generation

### 4.4 Relationship to dol

The main document discusses dol's `wrap_kvs` pattern for codec composition. zodal already has this as `wrapProvider()`. The bifurcation feature builds on the same compositional principle but at a different level:
- `wrapProvider()` transforms *values* (encoding/decoding between storage and application formats)
- `createBifurcatedProvider()` transforms *structure* (routing fields to different stores)

These compose: a bifurcated provider can be wrapped with a codec, or each sub-provider can be individually wrapped before composition.

### 4.5 Future Considerations (Not for Initial Implementation)

- **Content-addressing:** Optional CAS wrapper that hashes content on write and uses the hash as the storage key. Could be implemented as a provider wrapper: `withContentAddressing(provider)`.
- **Garbage collection:** Periodic reconciliation between metadata and content stores to detect and clean up orphans. Could be a standalone utility: `reconcile(metadataProvider, contentProvider, contentFields)`.
- **Streaming:** Large content uploads/downloads via streams rather than full in-memory buffers. Would require extending `getContent`/`setContent` to accept/return `ReadableStream`.
- **Versioning:** Content versioning where metadata tracks a version history of content hashes. Combines CAS with a version log in the metadata store.
- **Presigned URLs:** For S3-backed content, generating short-lived presigned URLs in `ContentRef.url` so the browser can fetch content directly from S3 without going through the API layer.

These are all *composable additions* to the base bifurcation feature, not prerequisites.

---

## Summary of Files to Create/Modify

### New Files
| File | Package | Purpose |
|---|---|---|
| `packages/store/src/bifurcated-provider.ts` | store | `createBifurcatedProvider()`, `splitFields()`, `createContentRefFactory()` |

### Modified Files
| File | Package | Changes |
|---|---|---|
| `packages/core/src/types.ts` | core | `FieldStorageRole`, `ContentRef`, `isContentRef()`, extend `FieldAffordance`, `CollectionConfig` |
| `packages/core/src/inference.ts` | core | Content field name patterns, `refineByFieldName` extension, `TRACED_PROPS` |
| `packages/core/src/collection.ts` | core | `getContentFields()`, `getMetadataFields()`, `hasBifurcation()` |
| `packages/core/src/index.ts` | core | New exports |
| `packages/store/src/data-provider.ts` | store | Optional `getContent?()`, `setContent?()` |
| `packages/store/src/capabilities.ts` | store | `bifurcated?`, `contentFields?` |
| `packages/store/src/index.ts` | store | New exports |
| `packages/ui/src/generators/column-defs.ts` | ui | `meta.storageRole`, `meta.isContentRef` |
| `packages/ui/src/generators/form-config.ts` | ui | `'file'` widget inference, `isContentField`, `acceptMimeTypes`, `maxSize` |
| `packages/ui/src/prompt.ts` | ui | Content field annotations and hints |
| `packages/ui/src/codegen.ts` | ui | `storageRole` in `FIELD_PROP_ORDER` |
| `packages/ui/src/registry/tester.ts` | ui | `storageRoleIs()` predicate |
| `packages/ui/src/state/store.ts` | ui | `contentLoading` state, `setContentLoading` action |

### No Changes Required
- All satellite store adapters (fs, s3, supabase, localstorage) — they work as-is
- All satellite UI renderers — they gain content awareness via the extended `meta` on column/form configs
