# ADR 0001: The feedback principle is a default of the renderers, not advice

*Status: accepted, 2026-11-02 · packages: `@zodal/ui`, `@zodal/ui-vanilla`, `@zodal/ui-shadcn`*

## Context

Don Norman's feedback principle: "Feedback must be immediate: even a delay of a tenth of a second can be disconcerting" [1]. The response-time limits give its scale: about 0.1 s feels instantaneous, 1 s keeps the flow of thought, 10 s is the limit of attention [2][3]. Two obligations follow, and they are often confused. The *result* may take seconds; the *acknowledgement* that the input registered is owed within about 0.1 s regardless. The browser's own responsiveness metric, INP, measures the second one: the time from an input to the next paint, not to completion [4].

The failure that prompted this record: on an iPad, tapping a tile whose work took a few seconds changed nothing on the tile, so the person tapped again, several times. On touch devices the usual desktop habits fail. iOS Safari applies CSS `:active` only when a touch listener exists [5], and keeps `:hover` applied after a tap [6].

What zodal had:

- `OperationRenderProps.dispatch` already returned a promise, documented as "await it to show progress".
- Both view renderers typed `onOperation`, `onCollectionOperation` and `onOpen` as `=> void`, called them, and ignored the result.
- No renderer had a pressed or pending state, or a guard against a second press. i2mint/zodal#73 asked for a tap guard.
- `CollectionState` has one `loading: boolean` for the whole collection.

The question: where should the principle live so that every element built with zodal applies it? The candidates were docs, comments in the render code, a slot or default in the code, and a test or lint rule.

## Decision

All four, each doing the job it is good at, with the code default as the load-bearing one.

1. **One headless state machine and one set of numbers, in `@zodal/ui`** (`src/feedback.ts`):
   - `FEEDBACK_MS = { instant: 100, indicator: 400, flow: 1000, attention: 10000 }`: the limits, stated once.
   - `feedbackFor(expectedMs)`: the ladder, from `'none'` through `'pending'`, `'indicator'`, `'skeleton'` and `'progress'` to `'background'`.
   - `createActionFeedback(action, options)`:
     - it goes `idle → pending → success | error`, and turns `pending` synchronously, before the action is called;
     - `run()` returns `null` while pending, which is the double-tap guard;
     - a busy `indicator` appears after `FEEDBACK_MS.indicator` and is then held at least 500 ms, so a fast action never flashes a spinner and a slow one never flickers;
     - a `{ ok: false }` command result reads as an error, and `run()` never rejects;
     - `reset()` serves a back/forward-cache restore.

   It is framework-free and has no DOM, so it holds design principle 1 (headless first).
2. **The default in both renderers.** Every pressable a renderer draws applies the machine with no host code. That covers operation buttons, collection and selection operations, and items with `onOpen`. The vanilla renderer uses `wirePress(element, action)`; the React/shadcn renderer uses `usePress(action)`. Either one:
   - sets `data-pressed` on `pointerdown` and clears it on `pointerup`, `pointercancel` and `pointerleave`;
   - runs the action on `click` (and on Enter for a non-button), never on `pointerdown`, per WCAG 2.5.2 [7];
   - sets `data-pending`, `aria-busy` and `aria-disabled` while the action is pending, and never native `disabled`, which drops focus;
   - sets `data-indicator` after the delay, and `data-status` when the action settles;
   - ignores repeat presses while pending, and clears pending on `pageshow` with `persisted`.

   Each renderer also styles these attributes by default. Vanilla ships `FEEDBACK_CSS`: zero-specificity `:where()` rules installed once, with a reduced-motion variant and `touch-action: manipulation`; a page opts out by supplying its own `<style data-zodal-feedback>`. shadcn ships `PRESS_CLASS` (Tailwind `data-[...]` variants) and `PressIndicator`. The callbacks are typed `void | PromiseLike<unknown>`, which is backwards compatible: return the work's promise to get the pending state.
3. **A conformance test in each renderer package** (`tests/feedback.test.ts`). For every pressable it asserts:
   - pressed on `pointerdown`;
   - pending, `aria-busy` and `aria-disabled` synchronously with the click;
   - the handler runs once when clicked three times while pending;
   - cleared on settle;
   - no indicator before the delay, and the indicator at it;
   - `{ ok: false }` reads as an error;
   - a bfcache restore clears pending.

   A behavioural test is the gate because a declared capability is only as good as each renderer's honouring of it [8]. No lint rule checks for a pending state [9]. typescript-eslint's `no-misused-promises` is recommended to hosts as support.
4. **Docs where authors look**:
   - design principle 6 in `docs/architecture.md`;
   - the "Feedback contract" section and checklist of the `zodal-ui-renderer` skill, which new renderer packages are built from;
   - the `zodal-collection-ui` skill: return promises, and the corrected optimistic-update pattern;
   - the renderers' module docstrings and READMEs.

## Options considered

| Option | For | Against | Verdict |
|---|---|---|---|
| Docs and comments only | cheap | advisory; the bug happened in code written by people who knew the principle | rejected as the only layer |
| Renderer-local state only (each button tracks its own promise) | no core change | each renderer re-implements timing; vanilla views are rebuilt on every state change, which would drop a pending state mid-flight | rejected as stated; kept as the *default source* of state |
| Store-owned status (`operationStatus` in `CollectionState`, a `runOperation` action) | survives rebuilds; visible to every surface (palette, hotkeys, AI tools) | makes the headless store an executor; touches every host | deferred: filed as a seam (below) |
| **One machine in `@zodal/ui`, local default in each renderer, conformance test** | SSOT for timing; works with no host code; testable | renderers carry a copy until `@zodal/ui` is republished (below) | **chosen** |
| Affordance metadata for runtime state | | runtime state does not belong in static metadata | rejected; a static hint (`OperationDefinition.duration?`) is possible later |

Report 05 of the research recommended the same split independently. Its prompt did not contain this conclusion.

## Consequences

- **Rebuilt vanilla views keep pending.** A vanilla view is rebuilt on every state change. `wirePress`'s `share: { scope, key }` keys a pending action to the view config plus the item and operation, so a button rebuilt mid-flight comes back pending and still guarded. Hosts should keep the `ViewConfig` object stable (compute it once).
- **Interim copy.** The renderer packages build against `@zodal/ui` 0.2.0 from npm, which predates `feedback.ts`, because publishing is blocked (i2mint/zodal#23). Each renderer carries `src/action-feedback.ts`, a byte-for-byte copy of the body, and a test fails if the copy drifts from the sibling checkout. Once a `@zodal/ui` with `createActionFeedback` is published, the copies become re-exports.
- **Timing is an option.** `indicatorDelayMs` and `minIndicatorMs` can be set on `createActionFeedback`, `wirePress` and `usePress`; renderer sets can expose them through `defineRendererSet` options. 400 ms sits inside the 300-500 ms conventions [10]; Adobe Spectrum 2 waits 1 s.
- **The Doherty threshold is a budget, not a law.** The 1982 IBM brief shows productivity rising smoothly below one second, with no 400 ms cliff in its readable text [11]. `FEEDBACK_MS.indicator` is documented that way.

## Follow-ups (issues)

- A store-layer `mutationMode` (`pessimistic | optimistic | undoable`) with inverse-patch rollback and a feedback sink, keeping `DataProvider<T>` a pure transport, as refine and react-admin do [12][13].
- A load status instead of `loading: boolean` (`first-load | refreshing | ready | error`), so renderers show a skeleton on the first load but a dimmed-stale cue on a refresh [14].
- A `statusOf` seam on renderer props, so a store or command layer can share an operation's status with every surface that triggers it. Today a palette or AI dispatch shows nothing on the button.

## References

[1] [Norman D. The Design of Everyday Things, revised edition, pp. 23-24. 2013 (excerpt)](https://media.aanda.psu.edu/sites/media/aa/files/documents/norman_design-of-everyday-things.pdf)
[2] [Nielsen J. Response Times: The 3 Important Limits. NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)
[3] [Card SK, Robertson GG, Mackinlay JD. The information visualizer. CHI '91](https://courses.ischool.berkeley.edu/i213/s99/Readings/p181-card.pdf)
[4] [Interaction to Next Paint. web.dev](https://web.dev/articles/inp)
[5] [WebKit Bugzilla 138816: :active on iOS requires a touch handler](https://bugs.webkit.org/show_bug.cgi?id=138816)
[6] [WebKit Bugzilla 158517: sticky :hover in mobile WebKit](https://bugs.webkit.org/show_bug.cgi?id=158517)
[7] [Understanding SC 2.5.2 Pointer Cancellation. W3C](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
[8] [Custom renderers (enabled / visible state props). JSON Forms](https://jsonforms.io/docs/tutorial/custom-renderers)
[9] [no-misused-promises. typescript-eslint](https://typescript-eslint.io/rules/no-misused-promises)
[10] [spin-delay. GitHub](https://github.com/smeijer/spin-delay)
[11] [Doherty WJ, Thadhani AJ. The economic value of rapid response time. IBM, 1982 (Computer History Museum scan)](https://archive.computerhistory.org/resources/access/text/2024/03/102751398-05-01-acc.pdf)
[12] [Mutation mode. refine](https://refine.dev/docs/advanced-tutorials/mutation-mode/)
[13] [Edit, mutationMode. react-admin](https://marmelab.com/react-admin/Edit.html)
[14] [Skeleton screens 101. NN/g](https://www.nngroup.com/articles/skeleton-screens/)
