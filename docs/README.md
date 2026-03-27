# zodal Documentation

## Project Summary
zodal is a TypeScript/JavaScript monorepo for declarative, schema-driven collection interfaces. Define a collection's data shape and capabilities once via Zod schemas; zodal generates UI configuration, state management, data access, and API interfaces from that declaration.

**Status**: Active development. Core packages implemented, 287+ tests passing.

## Documentation Index

### Current
| Doc | Purpose |
|-----|---------|
| [architecture.md](architecture.md) | Package structure, dependency graph, API surfaces |
| [ideas-and-future.md](ideas-and-future.md) | Unimplemented ideas, future directions, deferred features |
| [known-issues.md](known-issues.md) | Known limitations, gotchas, workarounds |

### Research & Design (reference)
Original research documents that informed the design, now in `docs/research/`:

| Doc | Purpose |
|-----|---------|
| [research/01-vision-and-scope.md](research/01-vision-and-scope.md) | Original vision statement and scope boundaries |
| [research/02-existing-implementation.md](research/02-existing-implementation.md) | Predecessor (zod-collections-ui) analysis |
| [research/03-technology-research-takeaways.md](research/03-technology-research-takeaways.md) | Findings from 16 research reports |
| [research/04-affordance-taxonomy-summary.md](research/04-affordance-taxonomy-summary.md) | Universe of capabilities zodal supports |
| [research/05-architecture-and-patterns.md](research/05-architecture-and-patterns.md) | Architectural patterns from research |
| [research/06-prior-art-and-landscape.md](research/06-prior-art-and-landscape.md) | Ecosystem context and tool comparison |
| [research/07-open-questions.md](research/07-open-questions.md) | Design decisions (most now resolved) |
| [research/sources.md](research/sources.md) | Index of all source files with locations |

## Agent Resources

- `.claude/CLAUDE.md` — Agent operations guide
- `.claude/skills/zodal-dev/SKILL.md` — Development patterns and conventions
- `.claude/skills/zodal-testing/SKILL.md` — Testing patterns and BDD story format
- `.claude/skills/research-lookup.md` — Find the right research report for any topic
- `.claude/plans/stateless-beaming-feather.md` — Approved architecture plan

## Raw Source Material

- **Research corpus**: `/Users/thorwhalen/Dropbox/_odata/ai_contexts/projects/zodal/`
- **Predecessor code**: `/Users/thorwhalen/Dropbox/py/proj/tt/zod-collections-ui/`
