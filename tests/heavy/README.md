# Heavy Tests

Tests in this directory are NOT included in CI or `pnpm test`. They test edge cases, performance, or scenarios with complex setup.

Run a specific heavy test:
```bash
npx vitest run tests/heavy/<test-name>.test.ts
```

## Index

| File | What it tests | Why heavy | When to run |
|------|--------------|-----------|-------------|
| (none yet) | | | |

## Conventions

- Each file has a header comment explaining scope, cost, and trigger
- Use `vitest` with the same patterns as unit tests
- Heavy tests may use larger datasets, real network calls, or browser automation
