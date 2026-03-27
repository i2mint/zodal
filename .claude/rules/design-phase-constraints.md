# Implementation Phase Guidelines

These rules apply now that zodal is in active development.

## Research Reference
When making design decisions not covered by the approved architecture plan, check `docs/research/03-technology-research-takeaways.md` or the source research reports. Reference the specific report when the decision is non-obvious.

## Predecessor as Reference
The zod-collections-ui codebase is reference material. Patterns should be absorbed and improved, not blindly copied.

## No Premature Abstraction
Design for the current concrete use case (collections) first. Generalization to functions/dataflows (meshed-style) is future scope and should not drive current architecture unless explicitly discussed.

## Test Coverage
New functionality must have tests before or alongside implementation. Use the BDD story specs when appropriate (see `tests/stories/`). Unit tests go in each package's `tests/` directory.

## Approved Architecture
The approved design is at `.claude/plans/stateless-beaming-feather.md`. Significant deviations require discussion.
