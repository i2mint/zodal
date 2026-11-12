# Field input history and sticky fields

Research report, 2026-11-12. Scope: per-field "input history" on free-text form fields, which fields survive a form reset, and a design for both in zodal.

## Summary and recommendation

**The pattern.** A text field that remembers what was typed into it and offers those values back is Jenifer Tidwell's **Remembered State** pattern, whose first example is "text boxes that retain the last text entered into them" [1]. Browsers call the per-field store **form history** or **autocomplete**, keyed by the field's `name` [4][5]. Search boxes call it **recent searches** [6][7][8]. Shells and VS Code call it **history** [20][30]. The justification is NN/g's recognition over recall: picking a past value is easier than retyping it [2]. Fields that keep their value into the next item have no name in NN/g, Baymard, GOV.UK or Material. Form builders and their users say **sticky fields** [9][10], ODK says **last-saved** values [12], Lightroom says **Previous** [37], and data-entry tools say **reload last values** [14].

**Names for zodal.**
- `history` is the list of a field's past values: the word every surveyed field-level implementation and the icon libraries use.
- `sticky` is the flag for a field that keeps its value when the form starts a new item.

**The icon.**
- The clock with a counterclockwise arrow is the de facto history glyph: Material Symbols `history` [39], Font Awesome `clock-rotate-left` (formerly `history`) [41], Fluent `History` [43].
- In **lucide**, `history` is now a deprecated alias: use `rotate-ccw-clock` (`RotateCcwClock`) [40].
- Heroicons has no history icon [42].
- Accessible name: "<Field label> history" or "Previous <field label> values" [44].

**Interaction rules that matter most.**
1. Record a value when the form is **used** (Generate) and when it is **reset** (before clearing), never per keystroke or on blur. Browsers record on submit [5], shells on execute [30].
2. **Dedupe by moving the repeated value to the top** (bash `erasedups`, zsh `HIST_IGNORE_ALL_DUPS`) [30][31]. Cap the list per field, with pinned entries exempt [36].
3. Order by **most recent first, pinned first**. Frecency is worth it only for long lists of navigational targets [49][51].
4. Every entry can be **removed one at a time** (Shift+Delete, the browser convention [17][18]), and the whole list can be cleared with an **Undo** rather than a confirmation [55][57].
5. Picking an entry **replaces** the field's value, after saving the replaced value to history, so a pick never loses anything. Multi-line values show their first line plus "+N lines", with a full preview before choosing.

**Reset.** Nielsen's case against Reset buttons [53] has one stated exception, a form "filled-in repeatedly by the same user" whose data "differs significantly from one use to the next", which is the studio's case. Make the reset automatic on a new source item and undoable, not confirmed [54][55][56], and save every cleared value to history first.

**Recommendation for zodal.** Add two field affordances:
- `sticky?: boolean`, inferred `false` for free text and `true` for knobs.
- `history?: boolean | { max?, scope? }`, opt-in and refused on secret fields.

Then add:
- a headless `createFieldHistory({ provider })` store over `DataProvider<HistoryEntry>` in `@zodal/store`;
- a pure `startNewItem(fields, values, { history })` in `@zodal/ui`;
- a `context.history` slot in `RendererContext`, beside the existing `suggest`;
- a `HistoryButton` and `HistoryList` in `zodal-ui-shadcn` and `zodal-ui-vanilla`, built from plain HTML with the native `popover` attribute and no new dependency.

**Where the plan needs adjusting** (section 7):
- "styles" and "exclude styles" are taste rather than content and arguably should be sticky;
- submit-time recording matters as much as reset-time recording;
- a past generation's "reuse settings" action (Suno, Midjourney) complements per-field history and shares its data.

---

## 1. Terminology

| Term | Where it is used | What it names |
|---|---|---|
| Remembered State | Tidwell's pattern language [1] | The general pattern: an interface element that keeps the user's last input because "the artifact is likely to be used again soon by the same user". It also seeds "Good Defaults". |
| Form history / autocomplete | Browsers (Chromium's `AutocompleteHistoryManager`, Firefox "Form & Search History") [5][17] | Past values of a field, keyed by the field's `name`, offered while typing. |
| Autofill | Browsers, web.dev [4] | Filling *structured* data (address, card) by `autocomplete` token. This is distinct from per-field history. |
| Recent searches / recents | Algolia, GitHub, Slack [6][7][8] | A short recency-ordered list of past queries in a search box. |
| Historical search suggestions | Material Design (v1) [3] | Past queries shown before a query is complete. |
| (Command) history | bash, zsh, fzf, Atuin [30][31][32][33] | Every executed line, recalled with ArrowUp or searched with Ctrl-R. |
| Find history | VS Code [20][21] | Past search and replace strings of the find widget, recalled with ArrowUp/ArrowDown. |
| Sticky fields / sticky contact | Smartsheet users, Help Scout [9][10] | Fields whose last submitted value pre-fills the next blank form; Drupal's webform_resubmit adds an explicit "resubmit with previous values" link instead [11]. |
| last-saved | ODK XLSForm [12] | `${last-saved#field}`: a field's default taken from the last saved record. |
| Favorite answers | ArcGIS Survey123 [13] | A user-set snapshot of answers that pre-fills the next survey. |
| Reload last values | Knack (KTL) [14] | Re-filling chosen fields from the previous submission, kept separate from draft persistence. |
| Previous | Lightroom Classic [37] | Apply the settings of the previously edited photo to this one. |

**Choice for zodal.**
- **`history`** names the per-field list. It is the term in browsers' storage, shells, VS Code and every icon set (section 3). "Recents" implies a short, unmanaged search-box list, which is too narrow for lyrics a user wants to pin.
- **`sticky`** names "keeps its value into the next item". The word is what users ask for [9] and what desktop tools use for remembered tool settings, it reads as a plain boolean, and it is shorter than `retainOnReset` or `keepOnNew`.
- Avoid **`persist`**. In form libraries it means saving a draft across a page reload [14], a different concern.
- Avoid **`autocomplete`**. It is an HTML attribute with fixed semantics [61].

---

## 2. Prior art

### 2.1 Browser form history

**Chromium** [5]
- **Trigger and placement.** Focus, typing, or ArrowDown opens a dropdown under the field.
- **Scope.** Per browser profile, keyed by the field's `name`. Some browsers also use `id` [4]. Two sites with a field named `q` share one history.
- **Recording.** Values are recorded on form submission, and only for a non-empty, named, focusable text, search, tel, url or email field that does not have `autocomplete="off"`. Card numbers and SSNs are never recorded.
- **Display.** At most 6 suggestions, `kMaxAutocompleteMenuItems` (in the code snapshot examined).
- **Deletion.** Highlight an entry and press Shift+Delete (Shift+Fn+Delete on a Mac) [67].

**Firefox**
- Uses the same Shift+Delete gesture [17]. Plain Delete was rejected because it edits the field text [18].
- Clearing goes through "Clear recent history > Form & Search History" [17].
- Firefox for Android has no per-entry delete.

**Neither browser**
- has pinning;
- has an icon (the list is implicit, opened by typing or ArrowDown);
- has search beyond prefix matching on what is typed.

**Lesson.** Browser history is invisible until the user types, so many people never discover it, and it cannot be scoped to one app's semantics. A visible button fixes the first problem. An app-owned store fixes the second.

### 2.2 Search boxes

**Google**
- Shows recent searches mixed into the suggestion dropdown with a clock glyph and a per-item remove. This is documented by third parties [68]; Google's own help covers only bulk deletion through My Activity [19].
- Scope: per account when signed in, otherwise per device.

**GitHub**
- The search bar's suggestions are grouped by category, and recent searches are one category, next to saved searches (`saved:`) [7].

**Slack**
- A clock icon in the search bar shows and hides previous searches [8]. No per-item delete is documented.

**VS Code** [20][21]
- **Trigger.** In the Find and Replace widgets, the Search view, terminal find and tree find, ArrowUp/ArrowDown (`history.showPrevious` / `history.showNext`) step through past inputs in place. There is no dropdown and no icon.
- **Scope.** `editor.find.history` and `editor.find.replaceHistory` take `"never"` or `"workspace"`, default `"workspace"`, so history is per workspace with an off switch.

**Lesson.** Suggestions while typing are expected by users [16]. A search box's recents are short (5 to 10), recency-ordered, deletable one by one, and opened by focusing the box. Stepping with ArrowUp in place, VS Code's way, is the power-user complement.

### 2.3 Prompt UIs

**Midjourney (web)** [22]
- The creation feed *is* the history.
- Each past job has a Rerun control and "Use" controls that send its prompt text and/or images back to the Imagine bar.
- Remix offers "Reset Prompt".
- There is no dedicated history icon.

**Suno** [23][24]
- "Reuse Prompt" sits in a song's More Actions menu, under Remix (since 2025-05).
- It reloads lyrics, style and title into the create form for editing. It does not restore the audio.
- History is per song, not per field.

**Udio** [25]
- Edit has a "Replacement Prompt" box with an "Include original prompt" checkbox. The remix/extend/edit menu is per track [66].

**AUTOMATIC1111 Stable Diffusion WebUI** [26][27]
- No list of past prompts.
- The "Read generation parameters" button fills the UI from the prompt box or, when it is empty, from the last generation.
- Styles (`styles.csv`) are named, saved prompt fragments applied by a button.
- Every PNG embeds its parameters, so dragging an image back in restores them.

**ComfyUI** [28]
- A Job History sidebar with search, an "All / Current workflow" filter, sorting by "Most recent" or by generation time, "Open as workflow in a new tab", and a "Clear history" that asks for confirmation.

**Leonardo.ai** [29]
- "Generation History" appears below the prompt bar.
- Runway and ChatGPT are omitted: their reuse controls could not be confirmed from primary sources.

**Lesson.** Generative tools put history at the level of the **output** (reuse this song's or image's settings), not the field. None has a per-field history button. Per-field history is the finer grain: it brings back one field's value without overwriting the rest of the form. The two complement each other (section 7).

### 2.4 Terminals

**bash** [30]
- Configuration:
  - `HISTSIZE` defaults to 500.
  - `HISTCONTROL` takes `ignorespace` (a line starting with a space is not saved), `ignoredups`, `ignoreboth`, and `erasedups` (earlier copies are removed before the line is saved).
  - `HISTIGNORE` excludes lines by pattern.
- Recall:
  - ArrowUp steps back.
  - Ctrl-R starts reverse incremental search.

**zsh** [31]
- `HIST_IGNORE_SPACE` and `HIST_IGNORE_ALL_DUPS` (the older copy is removed).
- `HIST_EXPIRE_DUPS_FIRST` trims duplicates first when the history is full.
- `SHARE_HISTORY` shares history across live sessions.

**fzf** [32]
- Ctrl-R opens a fuzzy-searchable full-screen list, ranked by relevance; a second Ctrl-R toggles chronological order.

**Atuin** [33][34]
- `filter_mode`: global (default), host, session, directory, workspace (git repo).
- Fuzzy search by default.
- `history_filter` excludes commands by regex; `secrets_filter` (on by default) refuses to save commands that look like they contain secrets.
- End-to-end encrypted sync across machines.

**zsh-autosuggestions** [35]
- Shows the most recent matching entry as grey ghost text, accepted with ArrowRight or End.

**Lessons.**
- Move-to-top deduplication is the standard.
- A per-entry opt-out (a leading space) and automatic secret filtering are standard privacy tools.
- Scope is a real choice (session, directory, global).
- Cross-device sync is a separate, optional layer over local history.

### 2.5 DAWs and creative tools

- **Photoshop's History panel** [36] keeps 50 states by default (configurable 1 to 1000). Snapshots are exempt from that limit but are lost when the document closes. It is undo history rather than input history, but it is the source of the "cap, with pinned items exempt" rule.
- **Lightroom Classic** [37]:
  - With one photo selected, Sync becomes "Previous", which copies the previous photo's settings.
  - Copy/Paste Settings lets the user tick which settings carry over.
  - This is the closest creative-tool precedent for "knobs carry over to the next item, chosen per setting".
- **Illustrator** [38] has a Recent Fonts menu whose length is a preference.
- Ableton, Logic and FL Studio were not researched. Their browsers and "recently used" lists are file-level, not field-level.

### 2.6 Comparison

| Product | Trigger | Icon | Where | Order | Search | Delete / pin | Scope | Limit | Dedupe |
|---|---|---|---|---|---|---|---|---|---|
| Chromium form history [5] | Typing, ArrowDown | None | Dropdown under field | Prefix match | Prefix | Shift+Delete / no pin | Profile, by `name` | 6 shown | Yes |
| Firefox form history [17] | Typing, ArrowDown | None | Dropdown | Prefix match | Prefix | Shift+Delete / no pin | Profile, by `name` | Not documented | Yes |
| Google search [68] | Focus | Clock per item | Dropdown | Recent | Prefix | Per item / no pin | Account or device | Not documented | Yes |
| Slack search [8] | Click clock icon | Clock | Panel under bar | Recent | No | Not documented | Account | Not documented | Not documented |
| VS Code find [20][21] | ArrowUp/ArrowDown | None | In place | Recent | No | No | Workspace (or never) | Not documented | Yes |
| Suno [23] | Song menu, "Reuse Prompt" | Menu item | Fills whole form | Per song | Library search | n/a | Account | n/a | n/a |
| ComfyUI [28] | Sidebar | Panel tab | Sidebar | Recent or duration | Yes | Clear all (confirmed) | Install | Not documented | No |
| bash / zsh [30][31] | ArrowUp, Ctrl-R | None | In place | Recent | Incremental | Edit file / no pin | User, per shell | 500 (bash default) | Optional |
| Atuin [33] | Ctrl-R | None | Full screen | Recent, fuzzy | Fuzzy | Delete / no pin | Global, host, session, directory | Unbounded | Yes |
| Photoshop History [36] | Panel | Panel | Panel | Chronological | No | Snapshots act as pins | Document | 50 default | n/a |

---

## 3. The icon

### 3.1 It is the standard history glyph

| Library | Name | Notes |
|---|---|---|
| Material Symbols | `history` | Clock with a counterclockwise arrow. Related: `manage_history`, `history_toggle_off`, `restore`, `update` (clockwise, meaning "update / later"), `work_history` [39]. |
| lucide | `rotate-ccw-clock` (`RotateCcwClock`) | `history` is now a **deprecated alias** of it. Lucide lists "showing recent actions such as recently visited pages" as a use. Related: `rotate-ccw` (undo-like), `clock`, `clock-arrow-up`, `list-clock` [40]. |
| Font Awesome | `clock-rotate-left` | "A clock with a counterclockwise arrow"; `history` is its old name [41]. |
| Fluent UI System Icons | `History` (`history_24_regular`) | Also `history_dismiss` [43]. |
| Heroicons | none | Only `clock`, `arrow-uturn-left` and `arrow-path` [42]. Use `clock`, or bring lucide's path. |
| SF Symbols | `clock.arrow.circlepath` | In common use for history; not verified against Apple's catalogue for this report. |

### 3.2 How it differs from undo and from "recent"

- **Undo** (`undo`, lucide `undo-2`, Heroicons `arrow-uturn-left`) is an arrow alone. It reverses the last *action* on the current document, one step at a time, and opens nothing.
- **History** (clock plus counterclockwise arrow) opens a *list of past states or inputs* to choose from. The clock says "time", the arrow says "back". Picking an entry is itself undoable.
- **Recent** is usually a plain clock (`schedule`, lucide `clock`). It labels time-ordered *items* (recent files, recently used colours) and carries no idea of going back.
- **`rotate-ccw`** without the clock reads as "reset" or "rotate". Next to a text field it would be misread as "clear this field", which is the opposite of what the button does.

### 3.3 Accessible name

WCAG 4.1.2 needs an accessible name that says what the button does [44]. Use:
- `aria-label="<Field label> history"`, for example "Lyrics history", or the more literal "Previous lyrics";
- `aria-hidden="true"` on the SVG;
- a tooltip with the same text plus the shortcut ("Lyrics history (Alt+ArrowDown)");
- `aria-haspopup` and `aria-expanded` on the button.

---

## 4. Interaction best practices

### 4.1 Trigger affordances

Offer three triggers to one list, each found by a different person:
1. **A visible icon button** next to the field. This is the discoverable one: browser history fails mostly because nobody knows it is there (section 2.1). Put it at the inline end of a single-line input and at the top-right corner of a textarea, outside the text box so it never covers text.
2. **Alt+ArrowDown** with focus in the field. This is the APG combobox convention for opening a popup without moving focus [45].
3. **ArrowUp in an empty single-line field** fills the most recent value in place, the shell and VS Code habit [20][30]. Never capture ArrowUp in a non-empty field or in a textarea, where it moves the caret.

A `<datalist>` is not a fit. It offers no per-item delete, no custom rendering, no multi-line preview, poor zoom and contrast behaviour, and is not announced by some screen-reader and browser pairs [48].

### 4.2 ARIA pattern

- **The trigger is a button** (`aria-haspopup`, `aria-expanded`, `aria-controls`). The field itself stays an ordinary textbox or textarea, so typing and screen-reader behaviour are unchanged.
- **The popup is a list of values to choose from.** That is a listbox, not a menu. A menu is for commands [46], and a history entry is a value.
- **Row actions rule out a plain listbox.** APG forbids interactive elements inside listbox options and points to a grid for that case [47]. So:
  - **v1, no visible row buttons:** a `role="listbox"`. Remove is on the keyboard (Shift+Delete on the active option, the browser convention), and pin is in a context menu.
  - **v1 with visible remove and pin buttons** (better on touch): a `role="grid"` popup, one row per entry, one gridcell for the value and one for the actions. This is APG's "editable combobox with grid popup" [45].
- **The filter input** (shown only once the list is long) is a combobox with `aria-autocomplete="list"` controlling that listbox or grid.
- **Keyboard:**
  - ArrowUp and ArrowDown move.
  - Home and End jump.
  - Typing filters.
  - Enter picks.
  - Escape closes and returns focus to the field.
  - Shift+Delete removes the active entry.

### 4.3 Touch and mobile

- The button's target is at least 44 by 44 CSS px (WCAG 2.5.5 enhanced; 24 px is the AA minimum).
- On a narrow viewport the list opens as a bottom sheet rather than a popover anchored to a small field.
- Hover preview does not exist on touch. Instead, a tap on a row's chevron expands the full value in place, and a tap on the row picks it.
- No swipe-to-delete without a visible alternative.

### 4.4 Preview on hover and focus

- For short values the row is the preview.
- For long values (lyrics, a long description), show the active entry's full text in a read-only pane beside the list, or below it on narrow screens, as the selection moves.
- Do **not** write the hovered value into the field live. That changes the form under the pointer, and leaves it changed if the user moves away without choosing.

### 4.5 Insert versus replace, and multi-line values

- **Replace**, not insert. A history entry is a whole past value of this field, and every surveyed tool restores it whole [5][20][23].
- Before replacing, record the current value in history (reason `pick`). The replace then loses nothing, and the history is itself the undo.
- Return focus to the field with the caret at the end.
- **Multi-line display:** the first non-empty line, truncated to the row width, then a muted "+12 lines", then a relative time ("2 h ago"). This reads as "these lyrics, that long, from then" without the list becoming a wall of text.

### 4.6 Dedupe, limits, ordering, pins, deletion

- **Dedupe:** compare trimmed values. Keep internal whitespace and case, which matter in lyrics and styles. An equal value moves to the top and its use count goes up (`erasedups` [30], `HIST_IGNORE_ALL_DUPS` [31]).
- **Limits:**
  - Store about 50 per field by default (Photoshop's 50 states [36]).
  - Show about 7 to 10 at once, with a filter beyond that: search-box lists stay under 10 [52], Chromium shows 6 [5], and APG recommends type-ahead above 7 [47].
  - Pinned entries do not count toward eviction.
- **Ordering:** pinned first, then most recent. Frecency (Firefox's 30-day half-life decay [49][50], Slack's quick switcher [51]) is for ranking many navigation targets by habit. For "what did I type in this box", recency is what users expect, and it is what every field-level history surveyed uses. Store a use count anyway, so frecency can be added later without a migration.
- **Pin:** the "favourite answers" need [13], for a style string or a lyric template the user returns to.
- **Delete one:** always available (section 4.2).
- **Clear all:** a footer action in the list. Offer Undo for a few seconds instead of a confirmation [55][57]. ComfyUI confirms instead [28], which is the weaker choice by Raskin's argument.

### 4.7 What counts as an entry

| Event | Record? | Why |
|---|---|---|
| Every keystroke | No | Floods the list with prefixes. |
| Blur | No | Records half-finished text every time focus moves, and nothing marks it as meaningful. |
| **Submit / use** (Generate) | **Yes** | The browser rule [5] and the shell rule [30]: a value the user committed to. |
| **Reset** (new item) | **Yes**, before clearing | The safety net: text typed but never used must not vanish. |
| **Pick** (replacing a value) | **Yes**, the replaced value | Makes the pick non-destructive. |

Record trimmed, non-empty values only.

### 4.8 Privacy

- **Sensitive fields never get history.**
  - WHATWG: with `autocomplete="off"` the browser "should not remember the control's data, and should not offer past values" [61].
  - Browsers override `off` for login fields, but only to offer their password manager [62][63]. That is not a precedent for app history.
  - zodal already detects secret fields (`sensitivity.ts`), so history on a secret is refused, failing closed.
  - Chromium likewise never stores card numbers or SSNs [5], and Atuin filters secrets by default [33].
- **Scope:**
  - Per device by default, because local storage is the default store.
  - Per user when the app passes a server-backed provider.
  - Never shared across users.
- **Visibility:** a shared machine shows its history to the next person. That is the reason for per-entry delete and clear-all.
- **Opt-out:** a field may set `history: false` even when a profile turns it on, and an app may expose a global "remember my inputs" switch by not passing a history store at all.
- **Keep the field's own `autocomplete` and `spellcheck` attributes as GOV.UK advises for the field's purpose [60].**
- **Do not set `autocomplete="off"` on the field just because zodal has its own history.** It also disables the browser's back/forward cache for the page [62], and the two histories do not conflict.

### 4.9 Syncing across devices

Treat sync as a storage concern, not a UI one:
- the UI reads and writes one store;
- the store's provider decides where entries live;
- the shell world's shape fits: Atuin keeps local history and adds encrypted sync as a layer [34].

In zodal this is `createTieredProvider({ hot: localStorage, cold: http })`. The local tier serves the list instantly and offline, and the remote tier carries it to other devices. Conflicts are trivial: entries are append-mostly, and dedupe by value merges them.

---

## 5. Form reset best practice

### 5.1 Is a reset wanted at all?

Nielsen [53]:
- Reset buttons "almost never help users, but often hurt them";
- the stated exception is a form "filled-in repeatedly by the same user" with data that "differs significantly from one use to the next".

A generation studio starting a new piece is that exception. The rest of his argument still applies: an explicit Reset button is easy to hit by mistake, and a reset that loses typing is a data-loss bug.

### 5.2 Which fields to keep across "new item"

Split by **what the value describes**:
- **Settings about the user's way of working** carry over: the model, duration, sliders, toggles, output format.
  - Lightroom carries develop settings to the next photo on request [37].
  - Data-entry users ask for sticky fields because many values repeat from record to record [9][14].
- **Content about this item** resets: its title, its lyrics, a description of this particular piece.
- **Between the two**, judge per field. A style string ("dark synthwave, female vocal") is often the user's taste rather than the item's content. Make it a declared choice per field, with the type default only as a starting point.

### 5.3 Triggers

- **Reset on:**
  - a new source item (a different song uploaded);
  - an explicit New.
- **Never reset on:**
  - switching provider or model;
  - switching a tab or a view;
  - a failed generation;
  - a page reload, which should restore the draft rather than clear it.

Tying a reset to anything the user does not think of as "starting over" turns it into data loss. GOV.UK's principle is the same: going back to an earlier step must find the answers still filled in [59].

### 5.4 Undo, not confirmation

- **Raskin:** "Never use a warning when you mean undo" [55].
- **NN/g:** confirmations work only when rare and specific [54].
- **Apple:** undo should be predictable, name the action, and revert a batch of related changes as one step [56].
- **Material:** the snackbar's single action is Undo [57]. Angular Material warns against auto-dismissing a snackbar that carries an action, because screen-reader users need time to reach it [58].

So: reset at once, then show "Started a new piece. Undo". Undo restores every reset field's previous value in one step. Keep the Undo up long enough to reach by keyboard (about 10 seconds, or until the next edit).

### 5.5 Never lose input

The reset records every non-sticky field's non-empty value to history **before** clearing it. Undo then covers the next ten seconds, and history covers the time after that.

---

## 6. A design proposal for zodal

### 6.1 What zodal already has, and where this fits

Each part of the design has a precedent in zodal's code, so the proposal adds at existing seams instead of inventing new ones.

**Field affordances** (`packages/core/src/types.ts`, `FieldAffordance`)
- They are flat, exclusion-based and inferred in layers: Zod type, then name heuristics (`refineByFieldName`), then `.meta()`, then the registry, then the collection config (`packages/core/src/inference.ts`).
- A new affordance must be added to the `.meta()` key list in `extractAffordancesFromMeta` and to `TRACED_PROPS`, so `explain()` traces it.

**Name heuristics already find the free-text fields**
- `DESCRIPTION_PATTERNS` (`description|summary|body|content|text|bio|about|notes`) sets `editWidget: 'textarea'`.
- `NAME_PATTERNS` covers `title`.

**Secrets are already detected**
- `packages/core/src/sensitivity.ts`: `secretPaths`, `.meta({ sensitivity: 'secret' })`, and the key heuristic.
- History must fail closed against them.

**The render context already carries an app-injected value source**
- `RendererContext.suggest` (`packages/ui/src/registry/tester.ts`) is a `SuggestionSource` the app injects "so no renderer imports a store".
- Input history is the same kind of thing (a per-field value source) and goes in the same place.

**`DataProvider<T>` is the storage seam** (`packages/store/src/data-provider.ts`)
- `createInMemoryProvider` is the default.
- `zodal-store-localstorage` provides the browser store, `createLocalStorageProvider({ storageKey })`.
- `createTieredProvider` (`packages/store/src/tiered-provider.ts`) is "the recent part on this device, the source of truth remote", which is exactly cross-device history. Its `leastRecentlyUsed` eviction is the cap policy this store needs.

**Undo already exists as an affordance**
- `OperationDefinition.undoable?: boolean | { seconds }`, documented as an alternative to a confirmation.

**Renderer packages are dependency-free baselines**
- `zodal-ui-shadcn` draws plain HTML through React. `GhostSlider` is a native range input, with no Radix.
- `zodal-ui-vanilla` builds DOM with `el()`.
- Neither depends on lucide, Radix or cmdk.

**Feedback rules apply to the new button like any pressable**
- `FEEDBACK_MS` in `packages/ui/src/feedback.ts`, and `usePress` in `zodal-ui-shadcn`.

### 6.2 (a) The affordances

```ts
// packages/core/src/types.ts, in FieldAffordance

// --- Value lifecycle ---
/**
 * Does the field keep its value when the form starts a new item (an explicit New, a new
 * source item)? Default: false for free text (a string field that is not a closed choice),
 * true for everything else (numbers, booleans, closed choices, dates). Ordinary edits ignore it.
 */
sticky?: boolean;
/**
 * Remember the field's past values and offer them back (a history button, Alt+ArrowDown,
 * ArrowUp in an empty single-line field). `true` takes the defaults. Default: false.
 * Refused on a secret field, whatever layer set it.
 */
history?: boolean | FieldHistorySpec;

/** A field's history settings (see `FieldAffordance.history`). */
export interface FieldHistorySpec {
  /** Most unpinned entries kept. Default: 50. */
  max?: number;
  /**
   * The history this field reads and writes. Default: the field's key. Fields given the same
   * scope share one list (a style field and an exclude-style field may want to); two forms
   * that both have a `title` field share it unless one sets a scope.
   */
  scope?: string;
}
```

**Inference**
- `sticky` is `false` when `zodType === 'string'` and the field is not a closed choice (`choice === null`), and `true` otherwise. The type layer sets it; `.meta({ sticky: true })` overrides it per field.
- `history` is never inferred `true`. It stores what people typed, so it is opt-in per field, like `copyable`. Declaring it stays one line: `fields: { lyrics: { history: true }, styles: { history: { scope: 'style' } } }`.
- `defineCollection` throws when `history` is set on a path that `secretPaths` reports, naming the field.

**`toFormConfig` and `toOptionsFormConfig`** resolve both onto `FormFieldConfig`, so renderers never re-derive them:

```ts
/** Keeps its value when the form starts a new item (the resolved `sticky` affordance). */
sticky: boolean;
/** The resolved history settings, or absent when the field has no history. */
history?: { max: number; scope: string };
```

### 6.3 (b) A headless history store over `DataProvider`

The factory goes in `@zodal/store`, which depends only on `@zodal/core`. Renderers and `@zodal/ui` type against a structural interface, so none of them imports the store.

```ts
// @zodal/store: field-history.ts

/** One remembered value of one history scope. */
export interface HistoryEntry {
  id: string;
  /** The history it belongs to (`FieldHistorySpec.scope`). */
  scope: string;
  value: string;
  /** When it was last recorded or picked, ms since the epoch. */
  at: number;
  /** How many times it was recorded or picked (kept for a later frecency order). */
  uses: number;
  pinned?: boolean;
}

/** Why a value is recorded: it was used, it was saved before a reset, or a pick replaced it. */
export type HistoryReason = 'submit' | 'reset' | 'pick';

/** What forms and renderers need from a history (structural: @zodal/ui and renderers declare the same shape). */
export interface FieldHistoryStore {
  /** Remember `value` (trimmed; empty is ignored). An equal value moves to the top instead of repeating. */
  record(scope: string, value: string, options?: { reason?: HistoryReason; max?: number }): Promise<void>;
  /** Pinned first, then most recent first. `query` keeps entries containing it, ignoring case. */
  list(scope: string, options?: { query?: string; limit?: number }): Promise<HistoryEntry[]>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned?: boolean): Promise<void>;
  /** Forget one scope, or every scope; resolves with what was removed, for an Undo. */
  clear(scope?: string): Promise<HistoryEntry[]>;
  /** Put entries back (the Undo of `clear` or `remove`). */
  restore(entries: readonly HistoryEntry[]): Promise<void>;
}

export interface CreateFieldHistoryOptions {
  /**
   * Where entries live. Default: in memory (gone on reload). A localStorage provider keeps them
   * on this device; a tiered provider (local hot, HTTP cold) syncs them across devices.
   */
  provider?: DataProvider<HistoryEntry>;
  /** Default cap per scope when a field gives none. Default: 50. */
  max?: number;
  /** The clock. Default: Date.now. */
  now?: () => number;
}

export function createFieldHistory(options?: CreateFieldHistoryOptions): FieldHistoryStore;
```

**Behaviour (each rule from section 4)**
- **Dedupe:** `record` looks for an entry with the same `scope` and the same trimmed value. If there is one, it updates `at` and `uses`; otherwise it creates an entry.
- **Cap:** after a `record`, unpinned entries beyond the cap are deleted, least recent first (`leastRecentlyUsed`).
- **Order:** pinned, then `at` descending. Frecency is not a seam in v1 because nothing asks for it yet. `uses` is stored so it can become one.
- **One provider holds every scope.** The app names its storage key (for example `'studio.field-history'`), so two apps on one origin never share a history.

**Wiring in an app.** Moving history to a server later changes only the `provider` line.

```ts
const history = createFieldHistory({
  provider: createLocalStorageProvider<HistoryEntry>({ storageKey: 'studio.field-history' }),
  // later: provider: createTieredProvider({ hot: localProvider, cold: httpProvider }),
});
// rendered with: context = { mode: 'form', history }
```

**The reset and the submit-time record.** Both are pure functions in `@zodal/ui`, beside `toFormConfig`, so any host form library (react-hook-form's `reset(values)` [15], a zustand store, the vanilla DOM) can use them:

```ts
/**
 * The values a form starts its next item with: sticky fields keep theirs; the others go back
 * to their default value (or empty). Before anything is cleared, every non-sticky field with
 * history and a non-empty value is recorded (reason 'reset'), so starting over never loses
 * typing. Returns the new values and the previous ones, for an Undo.
 */
export async function startNewItem(
  fields: readonly FormFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options?: { history?: FieldHistoryStore },
): Promise<{ values: Record<string, unknown>; previous: Record<string, unknown> }>;

/** Record every history field's current value (reason 'submit'). Call it when the form is used. */
export async function recordUse(
  fields: readonly FormFieldConfig[],
  values: Readonly<Record<string, unknown>>,
  options: { history: FieldHistoryStore },
): Promise<void>;
```

**Exposing the reset to the user.** An app exposes `startNewItem` as an `OperationDefinition` named, for example, `newItem`, with `undoable: { seconds: 10 }` and no `confirm`. Its Undo writes `previous` back. The app calls it from its own triggers (a new source uploaded, the New button), never from a provider switch.

**`RendererContext` gains one optional slot, beside `suggest`:**

```ts
/** Where a field with `config.history` reads and writes its past values. Absent: no history UI. */
history?: FieldHistoryStore;
```

### 6.4 (c) Renderer pieces

The decisions below are shared. Each renderer package draws them its own way.

**`HistoryButton`**
- A ghost icon button showing lucide's `rotate-ccw-clock` drawn as an inline SVG. Lucide is ISC-licensed, so this adds no runtime dependency.
- Placed at the inline end of a single-line input, or the top-right of a textarea.
- `aria-label="<label> history"`, `aria-haspopup="listbox"` (or `"grid"`), `aria-expanded`, `aria-controls`. Its tooltip names Alt+ArrowDown.
- **Hidden, not disabled**, while the field's history is empty, so it never opens onto nothing. It appears after the first record.
- Press feedback comes from `usePress` (shadcn) or the vanilla `press`. A local list opens well inside `FEEDBACK_MS.instant`, so it needs no indicator.

**`HistoryList`**: a native `popover="auto"` element, which gives light dismiss and Escape for free. It reached Baseline in January 2025, once iOS light dismiss was fixed [64][65]. It contains:
1. a filter input (combobox, `aria-autocomplete="list"`), shown only above about 7 entries;
2. the entries as a `grid`, each row showing the first line plus "+N lines" plus a relative time, with pinned rows first under a "Pinned" heading, and pin and remove buttons in the row's action cell;
3. a preview pane with the active row's full value (beside the list on wide screens, under it on narrow ones);
4. a "Clear history" footer that clears at once and offers Undo through the store's `clear`/`restore`.

**Picking an entry**
- Records the current value (reason `pick`), replaces the field's value, closes the popover and returns focus to the field.

**Keyboard on the field**
- Alt+ArrowDown opens the list.
- ArrowUp in an empty single-line input fills the most recent entry.
- A textarea's arrows are never captured.

**Narrow screens**
- The popover becomes a bottom sheet.
- The button's target is at least 44 px. That should be an option of the renderer set (`createXRegistry({ minTarget })`), not a constant.

**Placement in the two renderer packages**
- **`zodal-ui-shadcn`:** `HistoryButton` and `HistoryList` components, plus a renderer entry at `PRIORITY.LIBRARY` whose tester matches `ctx.mode === 'form' && ctx.history && config.history`. It renders the field's text or textarea input with the button attached. An app that already uses shadcn's `Popover` and `Command` can register its own entry at a higher priority. Nothing in zodal changes for that.
- **`zodal-ui-vanilla`:** the same two pieces built with `el()`, attached by the text and textarea renderers when `context.history` is present.

### 6.5 Deliberately left out

- **No plugin system, no ordering strategy, no event bus.** There is one store factory with one `provider` argument. Ordering is fixed until a second one is asked for.
- **No history on knobs.** Knobs are sticky instead. "Bring back that whole combination of settings" is **presets** (named snapshots of the whole form, like `FilterPreset`), a separate feature.
- **No recording on blur or per keystroke** (section 4.7).
- **No reliance on the browser's form history** (`name`-keyed, invisible, not scoped to the app, not syncable).

---

## 7. Where the plan needs adjusting

The plan is: reset free text on a new source, keep the knobs, put history on the reset fields. The research supports its core, an undoable reset of item-specific text, saved to history first, with knobs kept. Four refinements:

1. **"Styles" and "exclude styles" are closer to knobs than to content.**
   - A style string often describes the user's taste and is reused across sources: the Suno "Reuse Prompt" and A1111 "Styles" precedents exist because style prompts get reapplied [23][27].
   - Uploading a different song to give it the same treatment is a common move, and resetting the style then costs a pick every time.
   - Suggestion: make lyrics, title and the piece description non-sticky; make styles sticky, or at least decide per field with `sticky` (that is why it is a field affordance) and watch which one users keep re-picking.
   - Either way, styles should have history.
2. **Record on Generate, not only on reset.**
   - History filled only at reset time misses every value typed, used, then edited before the next reset.
   - The browser and shell rule is "record what was used" [5][30]. Reset-time recording is the safety net on top.
3. **Undo the reset; do not confirm it.**
   - An automatic reset on upload, with Undo for about 10 seconds and every cleared value in history, follows Raskin, NN/g and Apple [54][55][56].
   - A confirmation dialog on every upload would be the overused confirmation NN/g warns against.
4. **The past generations are a history too.**
   - The prompt-tool precedent is per-output reuse (Suno's "Reuse Prompt", Midjourney's "Use", A1111's "read generation parameters") [22][23][26].
   - If the studio keeps each generation's parameters, a "Reuse settings" action on a past generation restores all fields at once. Per-field history restores one.
   - The two share data: submitted values are already in the generation records. Keep the field history store anyway, because reset-time drafts were never submitted and exist nowhere else.

One smaller point: hide the history button until a field has history, rather than showing a disabled one, so the first-run form is not cluttered with buttons that do nothing.

---

## References

1. [Tidwell J. Remembered State. Common Ground: A Pattern Language for Human-Computer Interface Design, 1999](https://www.mit.edu/~jtidwell/language/remembered_state.html)
2. [Budiu R. Memory Recognition and Recall in User Interfaces. Nielsen Norman Group, 2024](https://www.nngroup.com/articles/recognition-and-recall/)
3. [Material Design (v1). Search patterns](https://m1.material.io/patterns/search.html)
4. [web.dev. Help users avoid re-entering data in forms (Learn Forms: Autofill)](https://web.dev/learn/forms/autofill)
5. [Chromium source. autocomplete_history_manager.cc](https://chromium.googlesource.com/chromium/src/+/34abaad72e48648518e276a68ba546804dd6ff6a/components/autofill/core/browser/autocomplete_history_manager.cc)
6. [Algolia. Adding recent searches (Autocomplete)](https://www.algolia.com/doc/ui-libraries/autocomplete/guides/adding-recent-searches)
7. [GitHub Docs. Using GitHub code search](https://docs.github.com/en/search-github/github-code-search/using-github-code-search)
8. [Slack Help Center. Search in Slack](https://slack.com/help/articles/202528808-Search-in-Slack)
9. [Smartsheet Community. "Sticky" fields on forms](https://community.smartsheet.com/discussion/68180/sticky-fields-on-forms)
10. [Help Scout docs. How the Sticky Contact feature works](https://mastermind.helpscoutdocs.com/article/344-how-the-sticky-contact-feature-works)
11. [Drupal. Webform Resubmit module](https://www.drupal.org/project/webform_resubmit)
12. [ODK Forum. ODK XLSForm Online v2.0.0 release highlights (last-saved)](https://forum.getodk.org/t/odk-xlsform-online-v2-0-0/24730)
13. [Esri Community. Retain value from day to day between surveys (Survey123 favorite answers)](https://community.esri.com/t5/arcgis-survey123-questions/retain-value-from-day-to-day-between-surveys/m-p/1156880)
14. [Knack Forums. Form data sticking (Persistent Forms vs Reload Last Values)](https://forums.knack.com/t/form-data-sticking-since-adding-ktl/18296)
15. [React Hook Form. reset API](https://www.react-hook-form.com/api/useform/reset)
16. [Baymard Institute. Autocomplete query suggestions (guideline 359)](https://baymard.com/guidelines/359-autocomplete-query-suggestions)
17. [Mozilla Support. Control whether Firefox automatically fills in forms](https://support.mozilla.org/en-US/kb/control-whether-firefox-automatically-fills-forms)
18. [Mozilla Bugzilla. Bug 310612 (deleting form history entries)](https://bugzilla.mozilla.org/show_bug.cgi?id=310612)
19. [Google Search Help. Delete your search history](https://support.google.com/websearch/answer/6096136)
20. [Visual Studio Code. Release notes, version 1.25 (input history in find widgets)](https://code.visualstudio.com/updates/v1_25)
21. [VS Code source. editorOptions.ts (editor.find.history, editor.find.replaceHistory)](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorOptions.ts)
22. [Midjourney Docs. Create page](https://docs.midjourney.com/docs/create-page)
23. [Suno Help. Reuse Prompt](https://help.suno.com/en/articles/2551041)
24. [Suno release notes. Remix any track across Suno](https://suno.com/release-notes/remix-any-track-across-suno)
25. [Udio Help. Edit your song music and lyrics](https://help.udio.com/en/articles/10732667-edit-your-song-music-and-lyrics)
26. [AUTOMATIC1111 stable-diffusion-webui. hints.js (button tooltips)](https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui/master/javascript/hints.js)
27. [AUTOMATIC1111 stable-diffusion-webui wiki. Features](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Features)
28. [ComfyUI Docs. Job History](https://docs.comfy.org/interface/job-history)
29. [Leonardo.ai Help. Getting started](https://intercom.help/leonardo-ai/en/articles/8067649-getting-started)
30. [bash(1) manual page](https://man7.org/linux/man-pages/man1/bash.1.html)
31. [zsh manual. Options (History)](https://zsh.sourceforge.io/Doc/Release/Options.html)
32. [fzf (README: key bindings, CTRL-R)](https://github.com/junegunn/fzf)
33. [Atuin docs. Configuration](https://docs.atuin.sh/latest/configuration/config/)
34. [Atuin. Magical shell history](https://atuin.sh/)
35. [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions)
36. [Kost J. Working with undo, the History panel, History and Art History brushes in Photoshop](https://jkost.com/blog/2021/02/working-with-undo-the-history-panel-history-and-art-history-brushes-in-photoshop.html)
37. [Adobe. Lightroom Classic Develop module options (Previous)](https://helpx.adobe.com/lightroom-classic/help/develop-module-options.html)
38. [Adobe. Illustrator fonts (Recent Fonts)](https://helpx.adobe.com/illustrator/using/fonts.html)
39. [Google material-design-icons. current_versions.json (Material Symbols names)](https://raw.githubusercontent.com/google/material-design-icons/master/update/current_versions.json)
40. [Lucide. rotate-ccw-clock (formerly history)](https://lucide.dev/icons/rotate-ccw-clock)
41. [Font Awesome. clock-rotate-left (history)](https://fontawesome.com/v6/icons/history)
42. [Heroicons. 24/outline icon set (source)](https://github.com/tailwindlabs/heroicons/tree/master/src/24/outline)
43. [Fluent UI System Icons. history_24_regular](https://pub.dev/documentation/fluentui_system_icons/1.1.257/fluentui_system_icons/FluentIcons/history_24_regular-constant.html)
44. [W3C. Understanding WCAG SC 4.1.2 Name, Role, Value](https://w3c.github.io/wcag/understanding/name-role-value.html)
45. [W3C WAI-ARIA APG. Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
46. [W3C WAI-ARIA APG. Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
47. [W3C WAI-ARIA APG. Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
48. [MDN. The datalist element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/datalist)
49. [Firefox source docs. Address bar ranking (frecency)](https://firefox-source-docs.mozilla.org/browser/urlbar/ranking.html)
50. [Mozilla Bugzilla. Bug 704025 (frecency decay)](https://bugzilla.mozilla.org/show_bug.cgi?id=704025)
51. [Slack Engineering. A faster, smarter Quick Switcher](https://slack.engineering/a-faster-smarter-quick-switcher/)
52. [UX Magazine. Best practices for designing autosuggest experiences](https://uxmag.com/articles/best-practices-designing-autosuggest-experiences)
53. [Nielsen J. Reset and Cancel Buttons. Nielsen Norman Group, 2000](https://www.nngroup.com/articles/reset-and-cancel-buttons/)
54. [Nielsen Norman Group. Confirmation dialogs can prevent user errors (if not overused)](https://www.nngroup.com/articles/confirmation-dialog/)
55. [Raskin A. Never use a warning when you mean undo. A List Apart, 2007](https://alistapart.com/article/neveruseawarning)
56. [Apple Human Interface Guidelines. Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
57. [Material Design. Snackbars](https://material.io/components/snackbars)
58. [Angular Material. Snackbar (accessibility)](https://material.angular.io/components/snack-bar)
59. [GOV.UK Design System. Check answers pattern](https://design-system.service.gov.uk/patterns/check-answers/)
60. [GOV.UK Design System. Text input](https://design-system.service.gov.uk/components/text-input/)
61. [WHATWG HTML. Autofill (the autocomplete attribute)](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete)
62. [MDN. How to turn off form autocompletion](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion)
63. [Stade E. Chrome's handling of autocomplete=off. WHATWG mailing list, 2014](https://lists.w3.org/Archives/Public/public-whatwg-archive/2014Nov/0104.html)
64. [MDN. The popover global attribute](https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/popover)
65. [web.dev. The Popover API is now Baseline Newly available](https://web.dev/blog/popover-baseline)
66. [Udio Help. Changelog](https://help.udio.com/en/articles/10748731-changelog-what-s-new-with-udio)
67. [Winaero. Remove individual autocomplete suggestions in Google Chrome](https://winaero.com/remove-individual-autocomplete-suggestions-google-chrome)
68. [WinBuzzer. How to delete Google search bar history in Chrome, Edge and Firefox](https://winbuzzer.com/2023/12/11/how-to-delete-google-search-bar-history-on-chrome-edge-and-firefox-xcxwbt/)
