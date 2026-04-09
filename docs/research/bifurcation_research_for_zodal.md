# Bifurcation Research Notes for zodal

Notes on what the acquired references for [The content-metadata bifurcation problem in software architecture](The%20content-metadata%20bifurcation%20problem%20in%20software%20architecture.md) teach us about implementing bifurcation tools in zodal specifically. See also the general reference synopses in the acquired_references folder.

---

## What zodal Already Has (Mapped to Literature Patterns)

| Literature Pattern | zodal Equivalent | Status |
|---|---|---|
| Repository/Facade [2][4] | `DataProvider<T>` — single CRUD interface hiding storage | Implemented |
| Anti-Corruption Layer [19] | Satellite adapters + codec `wrapProvider()` | Implemented |
| Capability Discovery | `getCapabilities()` on every provider | Implemented |
| Codec Composition | `Codec<TEncoded, TDecoded>` + `wrapProvider()` | Implemented |
| Field-level Inference | 6-layer inference engine for affordances | Implemented |
| Headless Config Generation | `toColumnDefs()`, `toFormConfig()` — data structures, not DOM | Implemented |

zodal is *architecturally ready* for bifurcation. The remaining work is to classify fields by storage role and coordinate two providers behind the existing `DataProvider<T>` interface.

---

## Key Lessons from References, Applied to zodal

### 1. Git's Four-Object Model [8] → zodal's Schema-Driven Approach

Git proves that rigorous content-metadata separation enables version control, deduplication, and integrity verification. zodal's Zod schema is analogous to Git's tree object: it maps field names to types (and now, storage roles). The schema *is* the metadata structure, and it can reference content by hash or URL rather than embedding it.

**zodal implication:** Add `storageRole: 'content' | 'metadata'` to `FieldAffordance`. The schema becomes the authoritative declaration of what is metadata (queryable, small) and what is content (opaque, large).

### 2. DVC's `.dvc` Files [10] → zodal's `ContentRef` Type

DVC commits tiny YAML files to Git that contain content hashes pointing to remote storage. This is exactly the "reference" pattern zodal needs for list views.

**zodal implication:** Define a `ContentRef` type (hash, URL, MIME type, size) that stands in for actual content in `getList` results. Consumers see `ContentRef` objects for content fields, not multi-MB blobs. This maps to DVC's `.dvc` files but expressed as TypeScript types.

### 3. PouchDB's Document/Attachment Model [30] → zodal's Field Classification

PouchDB is the most direct precedent: document fields are queryable metadata, attachments are binary content. Both are accessible through a single API. The distinction is structural (fields vs. attachments), not ad-hoc.

**zodal implication:** Rather than a separate "attachments" concept, zodal can use the schema itself to classify fields. A field named `content` or typed as `z.instanceof(Blob)` is automatically classified as content. This is more ergonomic than PouchDB's explicit attachment API because it flows through the existing inference engine.

### 4. S3 Strong Consistency [21] → Simpler Bifurcated Writes

S3's 2021 strong read-after-write consistency eliminates the eventual-consistency gap that previously complicated bifurcated writes. A "write metadata, then write content" sequence is now safe because the content is visible immediately after PUT completes.

**zodal implication:** The `createBifurcatedProvider` can use a simple sequential write strategy (metadata first, then content) without needing complex outbox or saga mechanisms for the common case. Error handling still needs compensating actions (delete metadata if content upload fails), but the consistency model is simpler.

### 5. Saga Pattern [14] → Write Ordering in BifurcatedProvider

The Saga pattern's compensating-action model defines how bifurcated writes should handle failures.

**zodal implication:** For `create`: write metadata → upload content. If content fails, compensate by deleting metadata. For `delete`: remove content → remove metadata. If metadata deletion fails, compensate by re-uploading content (or accept the orphan as less harmful). This is the write-ordering strategy for `createBifurcatedProvider`.

### 6. CQRS [16] → Already Implicit in Bifurcation

The metadata provider is essentially the "query model" (optimized for filtering, sorting, pagination). The content provider is the "storage model" (optimized for large-object read/write). This maps directly to CQRS without requiring a separate event store.

**zodal implication:** `getList` always hits only the metadata provider. Content is never involved in queries. This is the fundamental performance guarantee of bifurcation — listing 10,000 items never touches the content store.

### 7. TanStack Query [28] → Frontend Integration Pattern

TanStack Query's query-key system supports different cache policies per query.

**zodal implication:** When zodal generates UI state, metadata queries and content queries should use different query keys with different stale times. Metadata: aggressive caching, short stale time (changes often). Content: lazy fetching, long stale time (changes rarely). The `CollectionState` should track content-loading status per item per field.

### 8. Electric SQL / Triplit [32][36] → Sync Strategy

Both Electric SQL and Triplit sync structured metadata to clients but defer binary content to separate systems (S3 + presigned URLs).

**zodal implication:** For future sync/real-time features, sync the metadata store only. Content changes propagate via URL updates in the metadata (new URL → new content version). This keeps sync bandwidth proportional to metadata volume, not content volume.

### 9. Inference Engine Alignment [8][10][30]

Across Git, DVC, and PouchDB, the content/metadata distinction is *structural* — it follows from the data model, not from runtime heuristics.

**zodal implication:** The inference engine should classify fields by storage role using the same 6-layer cascade:
1. **Type defaults:** `z.instanceof(Blob)`, `z.instanceof(File)`, `z.instanceof(ArrayBuffer)` → `storageRole: 'content'`
2. **Validation refinements:** (none currently apply)
3. **Name heuristics:** `content`, `body`, `attachment`, `file`, `blob`, `binary`, `payload`, `media` → `storageRole: 'content'`
4. **`.meta()`:** `schema.meta({ storageRole: 'content' })`
5. **Affordance registry:** `registry.register(schema, { storageRole: 'content' })`
6. **Explicit config:** `fields: { myField: { storageRole: 'content' } }`

Any field not classified as content is metadata by default. This follows zodal's convention-over-configuration principle.

---

## What the References Say NOT to Do (zodal Anti-Patterns)

### Content in the Database Anti-Pattern
The main document [1] warns against storing binary content as BLOB columns in relational databases (5-10x cost, buffer pool pollution, MVCC write amplification).

**zodal implication:** The Supabase adapter should never be used to store large binary content. When a collection has content fields, the Supabase adapter should be the metadata provider, not the content provider. The `BifurcatedProvider` enforces this separation.

### Leaky Bifurcation Anti-Pattern
Consumers should never call `s3.getObject()` and `db.query()` directly.

**zodal implication:** The `DataProvider<T>` interface must remain the single entry point. Consumers call `provider.getOne(id)` and `provider.getContent(id, field)`, never the underlying S3 or Supabase clients directly. The `createBifurcatedProvider` factory encapsulates both stores.

### Union Key Semantics Anti-Pattern
Presenting `keys()` as the union of both stores masks inconsistency.

**zodal implication:** The `getList` method queries only the metadata provider. Items exist if and only if they have a metadata record. Content-only orphans (items in S3 but not in the metadata DB) are invisible and can be garbage-collected. Metadata-only items (metadata exists but content is missing) are visible but marked with a `ContentRef` that has no URL — consumers can detect this and show "content unavailable."

### Uncoordinated Writes Anti-Pattern
Direct `db.insert(); s3.put()` without coordination produces orphans.

**zodal implication:** `createBifurcatedProvider` coordinates writes in a specific order with compensating actions. It never exposes the two stores as independent write targets.

---

## Concrete Adapter Notes

### zodal-store-supabase as Metadata Provider
- Full server-side sort, filter, search, pagination → ideal for metadata queries
- PostgREST filter translation already implemented
- For bifurcated collections: store only metadata fields in the Supabase table
- Content references (hash, URL, mimeType, size) can be stored as JSONB columns or separate columns in the metadata table

### zodal-store-s3 as Content Provider
- Designed for large objects → ideal for content storage
- Item keys: `{prefix}/{itemId}/{fieldName}` (one S3 object per content field per item)
- `getOne(id)` returns the blob content
- `getCapabilities()` reports `serverSort: false, serverFilter: false` — correct, because content is not queryable
- Presigned URLs can be returned as `ContentRef.url` for direct browser access

### zodal-store-fs as Either Role
- In `'directory'` mode: each item is a directory, content fields are files within it
- Can serve as both metadata and content provider for development/testing
- For bifurcated testing: use two fs providers with different base directories

### In-Memory Adapter for Testing
- Two `createInMemoryProvider` instances can serve as metadata and content providers in tests
- Enables testing `createBifurcatedProvider` without any real storage backends
- All bifurcation logic (splitting, merging, reference generation) is testable in-memory

---

## Capability Reporting for Bifurcated Providers

A bifurcated provider should report composite capabilities:

```
{
  bifurcated: true,
  contentFields: ['content', 'attachment'],
  
  // Query capabilities come from the METADATA provider
  serverSort: true,        // from Supabase
  serverFilter: true,      // from Supabase
  serverSearch: true,      // from Supabase
  serverPagination: true,  // from Supabase
  
  // CRUD capabilities require BOTH providers to support them
  canCreate: true,   // both support create
  canUpdate: true,   // both support update
  canDelete: true,   // both support delete
  
  // Content-specific capabilities
  canStreamContent: false,  // future: streaming uploads/downloads
}
```

This allows the UI layer to adjust its behavior: show download links for content fields, use file-upload widgets in forms, disable sorting/filtering on content fields.

---

## Summary: What to Build

1. **Core types:** `FieldStorageRole`, `ContentRef`, `isContentRef()`, `ContentConfig` — plus inference-engine extension for storageRole
2. **Store coordination:** `createBifurcatedProvider()` factory composing two `DataProvider<T>` instances, plus `splitFields()` and `createContentRefFactory()` utilities
3. **UI awareness:** Content-aware column rendering (download links, previews), file-upload form widgets, content-loading state tracking
4. **No adapter changes required:** Existing adapters work as-is; the bifurcated provider composes them
