# Versioning and peer ranges

zodal is pre-1.0. Its packages (`@zodal/core`, `@zodal/store`, `@zodal/ui`) are released together at one version, and every satellite (`@zodal/store-*`, `@zodal/ui-*`, `@zodal/dials-*`, `@zodal/groups-*`, `@zodal/graph-*`) declares them as peer dependencies.

## The rules

1. **In `0.x`, the minor number is the breaking one.** An additive change, or a fix that brings behaviour in line with the documented contract, is a patch (`0.2.0` → `0.2.1`), even when code that relied on the bug breaks; such fixes are recorded in `docs/known-issues.md`. A change to the contract itself (an interface, a documented default) is a minor (`0.2.x` → `0.3.0`). This is what npm's caret already assumes: `^0.2.1` means `>=0.2.1 <0.3.0`.
2. **Satellites peer with a caret on the lowest version they need** (`"@zodal/core": "^0.2.1"`), and dev-depend on the same. Not `>=0.2.1 <1.0.0`: that range also accepts a breaking `0.3.0`, so the break would surface at runtime in an app instead of at install time. (This reverses `zodal-ui-vanilla`'s design decision 6, which predates the release check below.)
3. **A core release may not newly orphan a published satellite.** CI runs `scripts/check-satellite-peers.mjs`: for every published `@zodal` package, does its peer range accept the versions in this checkout? A range that accepted the published version but rejects this one fails the build. Ranges that were already broken are warnings (`--strict` makes them errors), and so are ranges wide enough to accept the next minor.

## Releasing a breaking minor

The check fails on purpose. Release it in this order:

1. For each satellite the check names: test it against the new version (a local `pnpm link`, or a `0.3.0-rc` prerelease), then widen its peer range to `^0.2.1 || ^0.3.0` and release the satellite.
2. Release core. The check now passes, because every satellite accepts both versions.
3. Later, narrow satellites to `^0.3.0` when they start using what changed.

## Where these live

- The check: `scripts/check-satellite-peers.mjs` (`pnpm check:peers`; `--json`, `--strict`).
- The release gate: `.github/workflows/ci.yml` (only a commit subject containing `[publish]` releases).
- The satellite list the check always includes, beside registry search: `KNOWN_SATELLITES` in the script. Add a satellite there when it is first published.
