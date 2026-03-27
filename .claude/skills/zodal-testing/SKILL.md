# Skill: zodal Testing Patterns

## Purpose
Testing conventions, BDD story spec format, and test organization for zodal.

## Test Organization

```
packages/*/tests/          Unit tests (per-package, fast, run on every commit)
tests/
  stories/                 BDD story specs (declarative, executor-agnostic)
  integration/             Cross-package integration tests
  heavy/                   Long-running or complex-setup tests (not in CI)
  heavy/README.md          Index of heavy tests for agent reference
  executors/               Executor backends for BDD stories
    store-executor.ts      API/store-level executor (fastest)
    component-executor.ts  React Testing Library executor (future)
    e2e-executor.ts        Playwright executor (future)
```

## BDD Story Spec Format

Stories are declared in `tests/stories/*.story.ts` using a Given/When/Then DSL:

```typescript
import { story, given, when, then } from '../executors/dsl.js';

export default story('Define a zero-config collection', {
  given: [
    given.schema('Project', {
      id: 'string.uuid',
      name: 'string',
      status: 'enum:draft,active,archived',
      priority: 'number.int.min(1).max(5)',
    }),
  ],
  when: [
    when.defineCollection(),
  ],
  then: [
    then.idFieldIs('id'),
    then.labelFieldIs('name'),
    then.fieldIs('name', { sortable: 'both', searchable: true }),
    then.fieldIs('status', { filterable: 'select', groupable: true }),
    then.fieldIs('id', { visible: false, editable: false }),
    then.visibleFieldsExclude('id', 'updatedAt'),
  ],
});
```

### Key principles
- Stories describe **user intent**, not implementation
- The same story can run against multiple executors
- Schema descriptions use a shorthand notation, not actual Zod code
- Actions are domain-level (`defineCollection`, `getList`, `addFilter`), not API calls

## Unit Test Conventions

- Use vitest with `describe`/`it`/`expect`
- Test file next to source: `packages/core/tests/inference.test.ts`
- One describe block per public function or major behavior
- Name tests as behavior: `'infers string defaults'`, not `'test string'`

## Integration Test Conventions

- In `tests/integration/` at monorepo root
- Test cross-package workflows: `defineCollection → toColumnDefs → createCollectionStore`
- Use real Zod schemas, not mocks

## Heavy Test Conventions

- In `tests/heavy/` — NOT discovered by vitest config
- Each file has a header comment explaining: what it tests, why it's heavy, when to run it
- `tests/heavy/README.md` indexes all heavy tests with descriptions
- Run manually: `npx vitest run tests/heavy/specific-test.test.ts`

## Test Pyramid

| Layer | Location | Speed | CI | When to add |
|-------|----------|-------|----|------------|
| Unit | `packages/*/tests/` | <1s | Every commit | Every new function |
| Integration | `tests/integration/` | <5s | Every commit | Cross-package features |
| Story (store) | `tests/stories/` + store executor | <2s | Every commit | User-facing workflows |
| Story (component) | `tests/stories/` + component executor | <10s | PR merge | UI rendering |
| Story (E2E) | `tests/stories/` + e2e executor | <30s | Nightly | Critical paths |
| Heavy | `tests/heavy/` | Variable | Never | Performance, edge cases |
