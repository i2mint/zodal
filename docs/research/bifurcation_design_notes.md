# Content-Metadata Bifurcation: Design Notes for zodal

Design thinking for adding content-metadata bifurcation to zodal. Based on study of [The content-metadata bifurcation problem in software architecture](The%20content-metadata%20bifurcation%20problem%20in%20software%20architecture.md) and the [zodal-specific research notes](bifurcation_research_for_zodal.md).

---

## The Core Idea

A zodal collection sometimes represents items that have both **metadata** (title, tags, timestamps — small, structured, queryable) and **content** (files, images, documents — large, opaque, non-queryable). These should be stored differently, but presented through a single `DataProvider<T>` interface.

The schema is the single source of truth. Fields are classified as metadata or content through the existing 6-layer inference engine. A new `createBifurcatedProvider()` factory composes two standard `DataProvider<T>` instances (one for metadata, one for content) into a single unified provider.

---

## Ideas to Try

### 1. Schema-Driven Field Classification (Primary Idea)

Add `storageRole: 'metadata' | 'content'` to `FieldAffordance`. The 6-layer inference engine classifies fields automatically:
- Type layer: `z.instanceof(Blob)` → content
- Name layer: fields named `content`, `body`, `attachment`, `file`, etc. → content
- Everything else: metadata by default

**Why try this:** It follows zodal's existing convention-over-configuration principle. Zero annotations needed for common cases. Full override capability through `.meta()` or explicit config.

**Risk:** The name heuristic could misfire. A field named `content` that actually holds a short text string (like article content) would be classified as content. Mitigation: the heuristic only fires for exact name matches, and it can always be overridden at Layer 4-6.

### 2. ContentRef as the Universal Reference Type

Define a `ContentRef` type in `@zodal/core`:
```typescript
interface ContentRef {
  _tag: 'ContentRef';
  field: string;
  itemId: string;
  hash?: string;
  url?: string;
  mimeType?: string;
  size?: number;
}
```

List views return `ContentRef` objects instead of actual content. Detail views either return `ContentRef` (lazy) or actual content (eager), configurable.

**Why try this:** Keeps list queries fast (metadata-only). Gives the UI enough information to render download links and previews without loading content. The `_tag` discriminator makes it type-safe to distinguish from actual string/object content.

**Risk:** TypeScript generic type of `DataProvider<T>` — items returned by `getList` won't match the schema's types exactly (content fields become `ContentRef` instead of their declared type). Solutions:
- Option A: Define `WithContentRefs<T>` mapped type that replaces content fields with `ContentRef`
- Option B: Accept the type mismatch as a known trade-off, document it, use `isContentRef()` guard
- Option C: The schema itself uses `ContentRef` as the field type (user responsibility)

I lean toward **Option B** — pragmatic, minimal API surface, well-documented.

### 3. BifurcatedProvider as Provider Composition

`createBifurcatedProvider({ metadataProvider, contentProvider, contentFields })` returns a standard `DataProvider<T>`. Internally it routes operations:
- `getList` → metadata provider only
- `getOne` → metadata provider (+ content provider if `detailStrategy: 'eager'`)
- `create` → split fields, write metadata first, then content
- `update` → only touch the stores that have changed fields
- `delete` → delete content first, then metadata

**Why try this:** Follows the existing adapter composition pattern. Consumers don't know or care that two stores are involved. Existing adapters (S3, Supabase, in-memory) serve as metadata or content providers without any changes.

**Risk:** Eventual consistency between the two stores. If the metadata write succeeds but the content write fails, the item exists with missing content. Mitigation: the `ContentRef` will have no URL, making the missing content detectable and recoverable.

### 4. Optional `getContent`/`setContent` Methods on DataProvider

Add optional methods rather than changing the required interface:
```typescript
interface DataProvider<T> {
  // ... existing required methods ...
  getContent?(id: string, field: string): Promise<unknown>;
  setContent?(id: string, field: string, content: unknown): Promise<ContentRef>;
}
```

**Why try this:** Zero breaking changes to existing adapters. Only the `BifurcatedProvider` implements these methods. Runtime capability check via `typeof provider.getContent === 'function'` or `getCapabilities().bifurcated`.

### 5. Content-Aware UI Generators

Extend `toColumnDefs` and `toFormConfig` to handle content fields:
- Columns: `meta.storageRole = 'content'` signals renderers to show download links, not raw text
- Forms: infer `type: 'file'` widget for content fields, with `acceptMimeTypes` and `maxSize`
- State: track per-item content-loading status for lazy-load UIs

**Why try this:** The headless generators already produce all configuration needed by renderers. Adding bifurcation awareness is a natural extension, not a new concept.

---

## Ideas to Avoid

### 1. Separate "Attachments" API

Some systems (PouchDB, CouchDB) have a completely separate attachments API distinct from document fields. This would mean adding `provider.addAttachment(id, name, blob)` alongside `provider.create(data)`.

**Why avoid:** It breaks zodal's schema-driven approach. The schema defines the shape; the inference engine classifies fields. A separate attachments API is a parallel channel that the schema doesn't describe and the inference engine can't reason about. It would require every generator and renderer to handle two separate data models.

### 2. Automatic Size-Based Classification

Automatically routing fields to the content store based on value size at write time (e.g., "anything over 1MB goes to S3").

**Why avoid:** This makes storage role a *runtime* decision rather than a *schema* decision. The same field could be metadata for some items and content for others. This breaks type safety, makes caching unpredictable, and means the UI can't know at schema-definition time whether a field will be a download link or inline text.

### 3. Multi-Store Fan-Out for Queries

Querying both the metadata and content stores on every `getList` call and merging results.

**Why avoid:** This defeats the purpose of bifurcation. Content stores (S3, filesystem) are not queryable — they don't support filtering, sorting, or pagination. Querying them would mean listing all objects and filtering client-side, which is exactly the performance problem bifurcation is meant to solve.

### 4. Content-Addressing as a Requirement

Requiring all content to be content-addressed (stored by hash) as part of the core API.

**Why avoid:** While CAS is valuable for deduplication and integrity (and the `ContentRef.hash` field supports it), making it mandatory would complicate the simplest use cases. A user who just wants to store files in S3 shouldn't need to compute hashes. CAS should be an opt-in capability, perhaps as a provider wrapper.

### 5. Breaking the DataProvider Interface

Adding required methods like `getContent()` to the `DataProvider<T>` interface.

**Why avoid:** This would break every existing adapter. Optional methods preserve backward compatibility. The `BifurcatedProvider` is the only provider that needs content-specific methods; all other providers work unchanged.

---

## UI Considerations

### List Views
- Content fields default to `detailOnly: true` (not shown in lists)
- If overridden to visible, render as download/preview link using `ContentRef.url`
- Content columns: `enableSorting: false`, `enableColumnFilter: false`, `enableGlobalFilter: false`
- Column config carries `meta.storageRole` and `meta.isContentRef` for renderers

### Detail Views  
- Show content field with download button and/or inline preview
- Preview depends on `ContentRef.mimeType`: images can be `<img>`, PDFs can be `<iframe>`, others show download link
- File size displayed from `ContentRef.size`

### Create/Edit Forms
- Content fields render as `<input type="file">` 
- Show accepted MIME types and max size from schema constraints or `.meta()`
- On submit: create the item with metadata first, then upload content fields
- Show upload progress per content field

### State Management
- `CollectionState` tracks `contentLoading: { [itemId]: { [field]: boolean } }`
- Actions: `setContentLoading(itemId, field, loading)` 
- Enables "click to load" lazy-loading UIs

### Prompt/Code Generation
- `toPrompt()` annotates content fields as "Content (bifurcated)" in field notes
- `toCode()` includes `storageRole` in generated configs when non-default
- Prompts include hints about download/upload rendering for content fields

---

## Adapter Interaction Patterns

### Pattern: Supabase + S3 (Most Common)

```
Schema: { id, title, tags, createdAt, document }
                                              ↑ storageRole: 'content'

Supabase table:
| id | title | tags | createdAt | document_hash | document_mime | document_size |
                                  ↑ stored by BifurcatedProvider as content metadata

S3 bucket:
docs/{id}/document → actual file bytes
```

The Supabase table stores a few columns per content field (hash, mime, size) that the `BifurcatedProvider` uses to construct `ContentRef` objects. The actual bytes live in S3.

### Pattern: In-Memory + In-Memory (Testing)

Two `createInMemoryProvider` instances. One holds metadata fields, the other holds content fields. Enables complete bifurcation testing without any real infrastructure.

### Pattern: fs + fs (Development)

Two filesystem providers with different base directories:
- `./data/metadata/` — JSON files with metadata fields
- `./data/content/` — Binary files with content

### Pattern: localStorage + S3 (Browser)

- localStorage provider for metadata (small, queryable, offline-available)
- S3 presigned-URL provider for content (large, cloud-stored)
- Metadata contains `ContentRef` with presigned URLs for direct browser access

---

## Phasing Strategy

**Phase 1 — Types and Inference (core only):**
- `FieldStorageRole` type, `ContentRef` interface, `isContentRef()` guard
- Extend `FieldAffordance` with `storageRole`
- Extend inference engine with content-field heuristics
- Add `getContentFields()`, `getMetadataFields()`, `hasBifurcation()` to `CollectionDefinition`
- Zero breaking changes

**Phase 2 — BifurcatedProvider (store package):**
- `createBifurcatedProvider()` factory
- `splitFields()` and `createContentRefFactory()` utilities
- Optional `getContent?()` / `setContent?()` on `DataProvider`
- Extend `ProviderCapabilities` with `bifurcated`, `contentFields`
- Full test suite using two in-memory providers

**Phase 3 — UI Awareness (ui package):**
- Content-aware `toColumnDefs()` and `toFormConfig()`
- `storageRoleIs()` renderer tester predicate
- Content-loading state tracking in `CollectionState`
- Prompt and code generation extensions

**Phase 4 — Concrete Renderers (satellite ui packages):**
- Download link / preview cell renderers
- File upload form renderers
- Content-loading indicators

Each phase is independently testable and shippable. Phases 3 and 4 can proceed in parallel.
