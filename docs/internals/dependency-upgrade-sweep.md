# Dependency Upgrade Sweep Record (2.15.0)

The closing record of the dependency upgrade sweep (parent spec: issue #64,
closing ticket: issue #73): what moved, what was declined and why, what is
verified by which command, what still needs a human, and what the next person
should run before touching a dependency again. Per-bump diff classifications
live in `harness/README.md`; this document does not repeat them.

## What moved

Base: commit `59d31af` (version 2.14.0, Tiptap 3.26.0). Head: the commit that
references this file.

| Area | Before | After | Commit / ticket |
| --- | --- | --- | --- |
| Markdown roundtrip harness (corpus + goldens, 4 seams) | none | `harness/` | `16fde3b`, `0431713`, `10ffeff` (issues #65, #66) |
| VS Code floor check (runs the extension on `engines.vscode`) | none | `harness/vscode-floor/` | this ticket |
| `@tiptap/*` (14 packages) | `^3.26.0` | `3.30.1` exact pins | `e956174` (issue #67) |
| `esbuild` / `typescript` | 0.20.2 / 5.9.3 | 0.28.2 / 7.0.2 | `aa64e2d` |
| `js-yaml` (+ drop `@types/js-yaml`, empty-frontmatter guard) | `^4.1.1` | `5.3.0` exact pin | `8ccf9da` (issue #69) |
| `fuzzysort` (+ remove redundant diacritic pass, threshold fix) | `^3.1.0` | `4.0.2` exact pin | `7af313c` (issue #70) |
| `mermaid` 11.12.2→11.17.2, `@mermaid-js/layout-elk` 0.2.1→0.2.3, `@types/node`, `@types/vscode` | in-range floors | latest in range | `5008846` (issue #71) |
| Mermaid lazy-load artifact + `@types/vscode` pinned back to `~1.85.0` | eager 9.2 MB webview bundle | lazy 8.46 MB artifact | `3c7c695` (Refs #71) |
| Search: `prosemirror-search` → `@tiptap/extension-find-and-replace` 3.30.1 | direct PM integration | Tiptap extension | `df996e1` (issue #72) |
| `puppeteer-core` | 24.42.0 | 24.43.1 | major held, see below |

Verified sweep outcomes with direct evidence (full classification per bump in
`harness/README.md`):

- A table cell containing a backtick code span with a pipe no longer splits
  the column (golden diff, intended fix).
- A heading immediately after an ordered list keeps proper block structure
  (golden diff, intended fix).
- A trailing blank line after a table at end of file is preserved (golden
  diff, intended fix).
- Empty or comment-only frontmatter stays valid under js-yaml 5 (frontmatter
  seam).
- YAML error reporting became more precise: the error mark moved from `3:1`
  to `2:16`, so the metadata panel now reports line 2 — the line that
  actually carries the error — where it previously reported line 3.
- File mention / wiki link suggestions all carry match indices now that the
  redundant second search pass is gone (one ranking path).
- The search match counter reads the authoritative index from plugin storage
  instead of a position heuristic.
- Webview startup bundle: `out/webview/main.js` went from 5,023,289 B
  (pre-sweep) to **933,347 B** (the search migration added ~150 KB on top of
  the 783,157 B measured at the lazy-load commit), because mermaid moved to a
  lazily injected artifact (`out/webview/mermaid-loader.js`, 8,457,219 B)
  fetched only when a document contains a diagram. The figure is a fresh
  `rm -rf out && npm run build` on this tree; an earlier revision of this
  record said 932,754 B, which no longer reproduces.
- Type checking (`npm run lint`, `tsc --noEmit`): median 0.94 s pre-sweep →
  median 0.27 s at final HEAD (5-run sample: 0.27/0.27/0.27/0.28/0.37 s).
- js-yaml 4 → 5 removes exposure to the two published parser
  denial-of-service defects.
- Final harness run on this tree: 34 markdown fixtures + 4 seams = **38
  passed / 0 failed** (the table column-width and placeholder seams are the
  two later additions; before them it was 36 passed / 0 failed).

## Declined upgrades

Each entry is self-contained; re-evaluate from here, not from the parent spec.

### puppeteer-core: next major held at 24

puppeteer-core 25.x requires Node ≥ 22.12, while `engines.vscode` is
`^1.85.0` and the VS Code version at that floor runs its extension host on
Node 18 — the new major cannot load there. The only benefit of the major is
bundle size: a bundling workaround exists (marking the CLI argument parser
as external in the esbuild export bundle roughly halves the export bundle),
and the export code path uses an API surface that is byte-for-byte identical
across both majors. The size win can be pursued separately without taking
the Node floor risk; the major stays declined until `engines.vscode` rises
to a floor whose extension host ships Node ≥ 22.12.

### Tiptap 3.30.0 decorations hook: not adopted

Tiptap 3.30.0 introduces a hook for declaring decorations without managing
ProseMirror plugins manually; three plugins in this codebase are candidates
(heading level badges, heading collapse toggles, code block header). It is
declined because the change is behaviour-neutral for users, and widget
decorations render inside the editor element, which carries a CSS `zoom`
transform (see the zoom convention in `AGENTS.md`); the two candidate
plugins that would use widgets render positioned badges and toggles and
would be exposed to that transform. If pursued later, it should be a
separate change with the zoom interaction tested by hand.

### File search result filtering: threshold corrected, filtering still off

The `threshold` option in `src/webview/file-search-utils.ts` carried a
v1/v2-era value (`-1000`) that evaluates to `NaN` under fuzzysort 4, making
every comparison false and silently disabling filtering. It was corrected to
`0`, the documented value that admits every match — i.e. it now expresses
today's behaviour honestly instead of by accident. Enabling filtering
(a non-zero threshold) is a user-experience decision that changes which
suggestions users see, and was deliberately not taken as part of the
upgrade. See the finding below for how the `NaN` went unnoticed.

### Diacritic ranking "reversal": measured correction — the premise was false

Issues #64 and #70 both claim that today's ordering puts the accented
filename first and that fuzzysort 4 reverses it (an "accepted regression").
**The harness measured the opposite.** The pre-upgrade golden, captured on
fuzzysort 3.1.0, already ranks `docs/cafe.md` above `docs/café.md` for the
query `café`; fuzzysort 4.0.2 produced a byte-identical ordering, with both
files tie-ing at score 0.9552 and both carrying match indices. There was no
reversal and therefore no regression to accept: the parent-spec item
"reverse the diacritic ranking" (by pinning the old major or adding
compensating scoring) is **moot, not declined**. This entry exists so the
next person does not re-litigate a decision that was never actually needed.

### Table column alignment: not undertaken

Tiptap's upstream table serializer supports column alignment
(`:---:` / `---:` syntax); the retained custom serializer
(`src/webview/table-markdown-serializer.ts`, kept because the upstream one
flattens lists inside table cells) does not emit or consume alignment.
Adding alignment is possible future work on the custom serializer; it was
not part of the sweep.

## Manual verification checklist

The harness is jsdom-based and blind to anything positional, so the following
items are verified by hand. Method for this record (2026-08-28):
an isolated VS Code **1.134.0** Extension Development Host (separate
`--user-data-dir`/`--extensions-dir`) launched with the built extension and
driven via Chrome DevTools Protocol — real input events into the webview
iframe, DOM-state assertions, and screenshots evaluated per item. Evidence
artifacts (screenshots `shot1`–`shot10`, CDP console watchers) were captured
during the run and are summarized below; they are not committed.

Since this record was first written, the mermaid and content-rendering rows
below are additionally covered by `npm run verify:vscode-floor`, which
re-checks them on the `engines.vscode` floor without a human (see the section
after next). The rows stay because they were also verified interactively, and
because a few of them — real input events, click coordinates, theme legibility
by eye — remain human-only.

### Mermaid (lazy-load change, issue #71 follow-up + #71 deferrals)

| Check | Result | Evidence |
| --- | --- | --- |
| Diagram renders in the running extension via the lazily injected artifact | **PASS** | `.mermaid-preview[data-rendered=true]` contains a flowchart SVG; `window.__tuiMermaidBundle` is an object (the 8,457,219 B artifact executed); no `.mermaid-loading` placeholder stuck, no `.mermaid-err-msg`. Verified both on first open and on a fresh close/reopen of the editor |
| View/edit mode toggle still works | **PASS** | Double-click on the preview adds `.mermaid-editing` and exposes the code block; moving the selection out of the block removes it (enter and exit both exercised) |
| Copy-as-PNG still works | **PASS** | Copy button disables during conversion, then flashes `is-copied` (feedback window observed at 1.4 s); no `mermaid-copy-error` event fired |
| Mermaid lightbox still works | **PASS** | Expand button activates `#lightbox-overlay` with the SVG; zoom-in button 100 % → 125 %; close deactivates |
| No CSP violation when the artifact is injected | **PASS** | The injected `mermaid-loader.js` `<script>` carries the nonce and executed (bundle object exists — a blocked script could not have produced it); CDP console watchers on the workbench page, the webview target, and a freshly reopened webview captured **zero** CSP / "Refused to …" / security-violation entries during the whole session |

### Search (issue #72)

| Check | Result | Evidence |
| --- | --- | --- |
| Match counter shows correct position and total in a document with many matches | **PASS** | Document with exactly 20 occurrences of `alpha`: counter read `N/20` at every step; 20 `find-and-replace-result` decorations in the DOM, exactly 1 `…-current` |
| Stepping through matches scrolls the editor to each one — by button | **PASS** | 6 consecutive `#search-next` clicks: counter 4→10/20, editor-container `scrollTop` 0 → 205 → 501 → 811 → 964 px (match-centred scrolling) |
| Stepping through matches — by keyboard | **PASS** | With focus in the search input (the exact condition of the previously fixed scroll defect): Enter → next (11→12/20, scrollTop 1032 px), Shift+Enter → previous (12→11) |
| Highlights legible in light and dark themes | **PASS** | VS Code theme switched dark → light (`theme-frame-dark dark-theme` → `theme-frame light-theme` on the webview body); screenshots show pale-blue non-current vs deeper blue-purple current highlights in light theme, blue-gray vs warmer current in dark theme, text legible in both |
| Active match visually distinguished | **PASS** | Distinct decoration class in DOM (`find-and-replace-result-current`) and visibly different highlight colour in both theme screenshots |
| Search navigation still works with the editor zoom setting applied | **PASS** | Zoom +0.1 twice (CSS `zoom: 1.2` on `.tiptap`); Enter still steps the counter correctly (11→12/20) and the editor still scrolls to the match (scrollTop → 1243 px) |
| No CSP violation in the console | **PASS** | Same zero-violation console capture as above (search ran during the watched session) |

### Pre-existing plugin areas that need real layout and coordinates

| Check | Result | Evidence |
| --- | --- | --- |
| Image lightbox (zoom controls, positioning) | **PASS** | Image loads (naturalWidth > 0); hover overlay (`.image-edit-overlay.visible`) appears on `mousemove` over the image; expand button opens `#lightbox-overlay` with correct `src` and caption; zoom-in twice → 150 % with `transform: scale(1.5)` on the image; close works |
| Table context menu (positioning at cursor) | **PASS** | Real right-click into a header cell opens `.table-context-menu` **exactly at the click coordinates** (menu rect = click point), all 10 items present; "Add Row Below" executes (3 → 4 rows) and the menu dismisses on action |
| Heading level badges (positioned overlays) | **PASS** | Screenshot of the running editor shows H1/H2/H3 badges rendered next to the corresponding headings |

### Items that used to need a human, and no longer do

Three items were previously recorded here as NOT PERFORMED, on the grounds
that a jsdom harness cannot see them. Two of those three turned out to be
measurable without a layout engine after all, and the third only needed the
right VS Code build downloaded. Each is now a committed check with a command
behind it, so the next person re-runs them instead of re-deferring them.

| Check | Status | How it is verified now |
| --- | --- | --- |
| Table with explicit column widths parses correctly (issue #67) | **PASS — automated** | `harness/table-colwidth-seam.ts`, golden `harness/golden/seams/table-colwidth.txt`, run by `npm run roundtrip`. HTML goes in, cell `colwidth` attributes come out of `editor.getJSON()`. Both branches of the upstream `parseColwidth` are covered: `<colgroup><col width="…">` (the shape pasted HTML tables carry, which is the 3.29 fix) and `colwidth="…"` on the cell (the shape Tiptap emits after a resize). Measured on this tree: widths `[150]`/`[320]` survive both shapes, a partially sized `<colgroup>` leaves the unsized column `null`, a `colspan=2` cell keeps `[150,320]`, and a plain table reports `null` everywhere. The same golden records the serialized markdown for each case, which is what makes the string seam's blindness explicit rather than assumed |
| Placeholder does not flicker while typing in a large document (issue #67) | **PASS — automated, within a stated limit** | `harness/placeholder-seam.ts`, golden `harness/golden/seams/placeholder.txt`, run by `npm run roundtrip`. Flicker is temporal, but its mechanism is not invisible: a flickering placeholder is one whose DOM is written more often than its state changes. A MutationObserver counts exactly that per keystroke. Measured on this tree, typing 12 characters into a 300-paragraph document: **0** DOM writes in any paragraph other than the one being typed into, and the placeholder markers (`data-placeholder`, `is-empty`) change exactly **once** — when the empty paragraph stops being empty — and never toggle back. The stated limit: this proves the DOM is not being rewritten, not that a human eye sees no flash; a flicker caused purely by CSS or compositing would not appear in these counts |
| Extension loads and works on the VS Code version declared in `engines` (`^1.85.0`) | **PASS — runtime-verified on 1.85.0** | `npm run verify:vscode-floor` (see `harness/vscode-floor/`) downloads the exact version named by `engines.vscode`, launches it as an Extension Development Host, runs in-host checks through `--extensionTestsPath`, and inspects the live webview over the DevTools protocol. Run on VS Code **1.85.0** (darwin-arm64) against this tree: 14/14 checks passed, twice in a row — extension resolves and activates, both commands register, `vscode.openWith` opens the document in `tuiMarkdown.editor`, the document stays unmodified across a 25 s hold, the webview mounts (`.tiptap`), the content renders (heading, bold, 3 table rows, 2 task items, 2 code blocks, 1 alert), the **lazily injected mermaid artifact loads and renders** with no stuck placeholder and no error, toolbar and metadata panel are present, and zero CSP violations appear in the console. This replaces the previous type-level-only evidence (`@types/vscode` pinned to `~1.85.0` plus a green lint) |

The two seams add no new dependency and run inside the existing
`npm run roundtrip`. The floor check needs a display and downloads ~120 MB of
VS Code on first use (cached in `~/.cache/tui-markdown-vscode-floor/`), so it
stays a separate command rather than part of the default harness run, and it
is deliberately not in `ci.yml`: a Linux runner needs `xvfb-run` plus the
Electron libraries, which has not been verified from here. Adding that job is
a follow-up for whoever can watch the first CI run.

## Findings

Pre-existing defects and trade-offs recorded for independent follow-up.

1. **The file search threshold has been ineffective since fuzzysort's previous
   major.** The v1/v2-era negative value evaluates to `NaN` under the current
   scale, every comparison against it is false, and filtering was silently
   disabled (found during issue #70 work; corrected to `0`, behaviour
   unchanged). The lesson: an option whose effect is "nothing matches the
   guard" fails silent — assert observable behaviour, not option presence.
2. **The js-yaml default-export removal was invisible to the type checker
   while breaking the bundler.** The package dropped its default export;
   synthetic default imports are implicitly enabled by `esModuleInterop`, so
   `tsc --noEmit` stayed green while `esbuild` produced a bundle that would
   crash at require time. In a repo whose strongest signal had been a green
   lint, that case proves lint alone is not sufficient evidence — part of the
   argument for the roundtrip harness and for always running
   `npm run build` on dependency changes.
3. **NEW (harness seams): frontmatter does not round-trip byte for byte in
   three forms, and this predates the sweep** (present in the js-yaml 4.1.1
   golden, unchanged by 5.3.0). Implicit frontmatter loses the blank line
   before its `---` separator; `---` immediately followed by `---` loses
   both delimiters entirely; `---`, blank line, `---` also loses both
   delimiters. Net effect: opening a document with empty frontmatter and
   saving it silently deletes that block. Recorded in the frontmatter seam
   golden as a byte-for-byte failure. This is a real pre-existing defect
   worth its own issue; deliberately not fixed in the sweep
   (`reconstructContent` in `src/utils/frontmatter-parser.ts` is the spot).
4. **NEW (mermaid lazy-load): the page nonce is now exposed on
   `window.__tuiMermaidBootstrap` / `window.__tuiCspNonce`.** The CSP string
   itself is unchanged (still `default-src 'none'; script-src 'nonce-…'`),
   but the bridge needs the nonce at runtime to inject the loader script,
   and browsers otherwise hide the nonce attribute from the DOM. This gives
   up the "nonce hiding" protection: an XSS inside the webview could reuse
   the exposed nonce to execute further scripts. Worth recording alongside
   the existing mermaid `securityLevel: "loose"` trade-off
   (see `docs/internals/mermaid-system.md`) when weighing webview hardening.
5. **NEW (bundle anatomy): mermaid's dist grew 66.2 MB → 84.0 MB between
   11.12.2 and 11.17.2** (new diagram types: treemap, radar, packet, venn),
   which is what pushed the eager webview bundle up 84 % before the
   lazy-load change reclaimed it. Selective diagram registration (instead of
   importing the full `mermaid` entry) would shrink the 8.46 MB artifact and
   remains future work.

## Running the harness for the next dependency upgrade

The harness exists so the next dependency change is one command away from
attributable evidence. Full guide: `harness/README.md`.

```bash
npm run roundtrip            # run corpus + seams, diff against goldens
npm run roundtrip:update     # re-capture goldens (deliberate use only)
npm run lint                 # type check — necessary, NOT sufficient
npm run build                # bundle — catches what tsc cannot (see finding 2)
npm run verify:vscode-floor  # run the extension on the engines.vscode floor
```

- Goldens live in `harness/golden/`, mirroring the corpus (synthetic
  fixtures + every top-level `*.md` and `docs/internals/*.md`, including
  this file).
- A diff is not automatically a failure: classify every diff as
  **intended fix**, **accepted change**, or **regression**, and record the
  classification in the commit that caused it (examples in
  `harness/README.md`).
- Know the limit: the harness runs on jsdom, which has no layout engine.
  Anything genuinely positional (lightbox placement, context menus at click
  coordinates, positioned badges, scroll offsets) is invisible to it and
  needs the manual checklist treatment above. "Temporal" is a weaker excuse
  than it looks: the placeholder seam shows that a rendering behaviour can
  often be counted (DOM writes per keystroke) even when it cannot be
  watched. Before deferring an item to a human, ask what the behaviour
  writes, and whether that is countable.

## Packaging note (this ticket)

`.vscodeignore` previously shipped `harness/**` and `out/harness/**` in the
.vsix — 33 fixtures, all goldens, and the harness README. Both trees (and
`esbuild.harness.config.js`) are now excluded; verified via `npx vsce ls`
that no harness file remains while `out/webview/mermaid-loader.js` (the lazy
mermaid artifact the extension needs at runtime) is still included.

Follow-up (same ticket): production builds set `sourcemap: !isProduction` and
emit no maps, but a stale `npm run build:dev` output was not cleaned and
`vsce ls` showed seven `.map` files totalling 43,858,474 B (the mermaid
artifact's map alone is 29.9 MB). `out/**/*.map` is now excluded the same
way; the listing ships zero maps, zero harness files, and still ships
`mermaid-loader.js`.

Second follow-up, found while re-checking the publish path: `.vscodeignore`
excluded `.agent/**` but not `.agents/**`, and the repository has both, so
`.agents/skills/create-readme/SKILL.md` was being packaged into the .vsix.
The pattern is now `.agents/**` as well; `vsce ls` is down to 13 files, all
of them things a user needs.
