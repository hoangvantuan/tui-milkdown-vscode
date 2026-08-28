# Dependency-Verification Harness

A golden-baseline harness that verifies markdown fidelity and the two
non-editor seams (frontmatter parsing, file search ranking) across dependency
changes. It exists so a maintainer can run one command before and after any
dependency bump and attribute a fidelity regression to one specific version
change instead of a vague suspicion. Introduced for the upgrade sweep in
issue #64 (harness tickets: #65, #66), and intended to outlive it.

## How to run

```bash
npm run roundtrip          # check: run the corpus, diff against goldens
npm run roundtrip:update   # re-capture goldens (do this only deliberately)
```

The check exits non-zero on any diff, missing golden, or error, so it can
gate a commit or CI job. The runner rebuilds itself from current source each
time (`esbuild.harness.config.js` → `out/harness/roundtrip.js`, a transient
build artifact), so it always measures the tree you are on.

## What the harness observes

One seam: the public string-in / string-out boundary. Each corpus document
goes through exactly the load/save path the webview uses:

1. `parseContent()` splits frontmatter from the body
   (`src/utils/frontmatter-parser.ts`).
2. The body is handed to a Tiptap editor built with the markdown-relevant
   extension set from `initEditor()` in `src/webview/main.ts`, via
   `new Editor({ content, contentType: 'markdown' })`, followed by the same
   post-parse `transformTableCellsAfterParse()` call the webview makes.
3. The document is serialized back with `editor.getMarkdown()` and frontmatter
   is reattached with `reconstructContent()`.

Assertions never touch editor internals, node structures, decoration sets or
plugin state. Those are exactly the things a dependency upgrade is expected to
rearrange; a test that breaks while the markdown stays identical is a false
alarm and would be deleted rather than trusted. The only thing compared is
the serialized string against `harness/golden/`.

## The corpus

Two sources, combined:

- `fixtures/synthetic/` — one feature per file: headings, multi-line table
  cells, tables containing lists, nested task lists, alert blocks, mermaid
  diagrams, code blocks with language annotations, frontmatter in its
  supported forms (standard, implicit, empty, comment-only), wiki links,
  file mentions, images with awkward paths, and page breaks.
- Real repository documents — every top-level `*.md` and every
  `docs/internals/*.md`, enumerated at run time. Long-form documents catch
  cross-feature interactions that single-feature fixtures cannot. A new repo
  document appears as a `MISSING` golden until you capture it.

Goldens live in `harness/golden/` mirroring the corpus layout. The committed
baseline was captured on the pre-upgrade dependency tree, before any version
in the sweep moved. Add a fixture by dropping a `.md` file into
`fixtures/synthetic/` and running `roundtrip:update`.

**Defect fixtures record broken output on purpose.** The four fixtures
`list-continuation-underindented.md`, `heading-after-list.md`,
`table-cell-code-span-pipe.md` and `table-column-widths.md` exist to pin the
four markdown defects that the Tiptap upgrade in issue #67 must fix. Their
goldens were captured on Tiptap 3.26.0 and are expected to contain the
broken output (lost continuation characters, an absorbed heading, a split
table column, dropped column widths). Do not "repair" those goldens. When
#67 moves the version, these fixtures should diff, and each diff is
classified there as an intended fix.

## Reading a diff after a dependency change

A diff is not automatically a failure; some diffs are the point of an
upgrade. Classify every diff, in the commit message of the bump that caused
it, as exactly one of:

- **Intended fix** — the upgrade repairs known-broken behaviour (the golden
  was recording a bug).
- **Accepted change** — behaviour differs, review concluded it is tolerable
  or desirable; say why.
- **Regression** — fidelity got worse; revert or compensate before landing.

If goldens must move, regenerate them in the same commit as the bump, so each
commit stays self-consistent and revertible.

## Classification record: Tiptap 3.26.0 → 3.30.1 (issue #67)

Recorded when the fourteen directly-used `@tiptap/*` packages moved to
3.30.1. Baseline before the bump: 33 fixtures + 2 seams = 35 passed. After
the bump: 4 diffs, all in the markdown seam; both non-editor seams stayed at
zero diffs. Each diff is classified below.

| Fixture | Diff | Classification | Evidence |
| --- | --- | --- | --- |
| `synthetic/table-cell-code-span-pipe.md` | Cell containing a backtick code span with a pipe split into two columns on 3.26.0 (golden shows the escaped backtick fragments as separate cells and the table widened to 3 columns); on 3.30.1 the pipe stays inside the code span and the row matches the source | **Intended fix** | Golden vs source diff shows the split; new output matches the source row byte for byte |
| `synthetic/heading-after-list.md` | Heading immediately after an ordered list gained blank lines around it | **Intended fix** | 3.26.0 golden emitted `# Top Level Heading...` flush against `2. another ordered item`, unlike the same pattern after bullet lists which already had blank lines; 3.30.1 emits blank lines on both sides, consistent with the other headings in the same document |
| `synthetic/list-continuation-underindented.md` | Continuation line under the two-digit `10.` marker serializes with 1 leading space instead of 2 | **Accepted change** | Upstream changed how it indents continuation paragraphs of ordered-list items. Semantics are unchanged: both `2 spaces` and `1 space` re-parse as a lazy continuation of the same paragraph, and no text is lost. Measured convergence: round 1 → `1 space`, round 2 → `0 spaces`, round 3 identical (fixed point). The other continuation lines in this fixture are byte-identical to the 3.26.0 golden. Note: neither version preserves the original 4-space indent; the upgrade changes the normalization step, not fidelity |
| `repo/AGENTS.md` | One blank line added at end of file after the final table | **Intended fix** | Source `AGENTS.md` ends with table row + blank line (`\|\n\n`); the 3.26.0 golden swallowed that blank line (`\|\n`), while 3.30.1 preserves it, matching the source. Pre-existing normalizations unrelated to this bump (HTML-entity escaping of `&`, one swallowed mid-file blank line) were already recorded in the old golden and did not change |
| `synthetic/table-column-widths.md` | No diff: byte-identical output before and after the bump | **Not evidenced by this harness** | GFM table markdown has no syntax for column widths. The 3.29+ upstream fix parses `<colgroup>/<col width>` from HTML into the editor's DOM/attributes, but that is a rendering concern: both the custom serializer and the upstream one emit plain GFM tables with no width information, so the serialized markdown string cannot change whether widths were parsed or dropped. The string-in/string-out seam is structurally blind to this fix. Issue #67's column-width acceptance box is therefore NOT evidenced here and is deferred to the manual verification checklist in issue #73, as is the placeholder-flicker box (flicker is a rendering/perf behaviour, equally invisible to a jsdom harness with no layout) |

Why the `@tiptap/*` specifiers moved from caret ranges (`^3.26.0`) to exact
pins (`3.30.1`): this repository has no CI and no automated tests beyond
this harness, and the `@tiptap/*` family is the one dependency group that
governs markdown fidelity. Pinning it exactly means a plain `npm install`
can never silently drift onto a newer patch the goldens were never run
against. This is a deliberate decision, not an accident; relax it only
together with a harness run that re-baselines the goldens.

Custom table serializer check (issue #67 acceptance): the
`MarkdownRendererHelpers` type in `@tiptap/core` 3.30.1
(`node_modules/@tiptap/core/dist/index.d.ts`) is byte-identical to the
3.26.0 declaration (24/24 lines, `renderChildren` / `renderChild` /
`wrapInBlock` / `indent`), and `@tiptap/markdown` 3.30.1 still resolves the
hook via `getExtensionField(extension, "renderMarkdown")` and calls it with
`(node, helpers, context)`. The `Table.extend({ renderMarkdown })` wiring in
`src/webview/main.ts` therefore needs no adaptation, and the custom
serializer is retained deliberately (see issue #64: the upstream serializer
flattens lists inside table cells).

## Classification record: js-yaml 4.1.1 → 5.3.0 (issue #69)

Recorded when js-yaml moved to 5.3.0 (exact-pinned, same rationale as the
`@tiptap/*` family above), `@types/js-yaml` was removed from devDependencies
(the package now bundles its own type declarations), both consumers
(`src/utils/frontmatter-parser.ts`, `src/webview/frontmatter.ts`) switched
to namespace imports (`import * as yaml from "js-yaml"` — the package no
longer provides a default export, and that failure is invisible to `tsc`
under `esModuleInterop` and surfaces only at bundle time, hence the
mandatory `npm run build`), and a guard was added that treats frontmatter
consisting only of comment lines and blank lines as valid empty frontmatter
without invoking the loader (js-yaml 5's default YAML 1.2 core schema throws
on an empty document where 4.x returned a null value). The guard works by
stripping comment and blank lines (`isBlankOrCommentOnly`), never by matching
library error text. Baseline before the bump: 33 fixtures + 2 seams = 35
passed. After the bump + guard: 1 seam diff, classified below; all 33
markdown fixtures byte-identical, `npm run lint` and `npm run build` green.

| Fixture | Diff | Classification | Evidence |
| --- | --- | --- | --- |
| `seams/frontmatter.txt` (invalid-yaml case only) | Error position moved: parse error string `(3:1)` → `(2:16)`, `validateYaml` reportedLine `2` → `1` | **Accepted change** | js-yaml 5 anchors the "unexpected end of the stream within a flow collection" error at the end-of-input position of the offending line (line 2, `tags: [unclosed`) instead of advancing to the following line. The mark still identifies the offending line for genuinely malformed YAML: spot-checked further malformed inputs (bad mapping entry, duplicated mapping key) all report the line carrying the mistake. Every other seam line is unchanged: comment-only and blank-line-only still report `isValid=true` (via the guard, confirmed to flip to `false` without it), and all byte-for-byte verdicts match the old golden |

Pre-existing finding carried to issue #73: three byte-for-byte failures in
the frontmatter seam (implicit, empty-delimiters, blank-line-only
reconstructs) predate this bump — they are present in the js-yaml 4.1.1
golden and unchanged here. "Untouched frontmatter round-trips byte for
byte" is already false today for the implicit and empty frontmatter forms:
`reconstructContent` drops the blank line before an implicit separator and
drops empty delimiters entirely. Fixing `reconstructContent` is out of
scope for #69.

## Classification record: fuzzysort 3.1.0 → 4.0.2 (issue #70)

Recorded when fuzzysort moved to 4.0.2 (exact-pinned, same rationale as the
`@tiptap/*` family: this package governs the file-search golden). Two source
changes rode along in `src/webview/file-search-utils.ts`:

- **Threshold corrected from `-1000` to `0`.** fuzzysort 4 defines
  `threshold` as a minimum score on a 0..1 scale ("defaults to .5; 0 = any
  match", per the package's own `index.d.ts` and README), replacing the
  v1/v2-era scale where higher-is-better scores made negative thresholds
  meaningful and `-Infinity` the no-filter default. The old `-1000` has no
  defined meaning on the new scale; `0` is the documented value that admits
  every match, i.e. exactly today's behaviour with filtering off. The
  option now means what it says: measured on the seam fixture list, query
  `d` returns 5 results under the v4 default (`.5`) and 9 under `0`, so the
  knob demonstrably filters when not neutralised.
- **The manual diacritic-normalisation second pass is deleted.** fuzzysort
  4 automatically remaps common lookalike characters (the changelog line
  "Automatically remaps common lookalike characters", plus the new
  `fuzzysort.remap()` API), which is a superset of what the removed
  `normalizeText` + second `go()` pass did. One ranking path remains, so
  the class of results that used to be discovered only by the second pass
  and therefore rendered without match indices can no longer occur.

**Diacritic ordering: the premise in issues #64/#70 did not hold.** Both
issues state that today the accented filename ranks first and that
fuzzysort 4 will reverse this. The pre-upgrade golden (captured on
fuzzysort 3.1.0) already shows the opposite, and the post-bump run is
byte-identical:

| Measurement (query `café`, currentDocFolder=docs) | fuzzysort 3.1.0 (golden) | fuzzysort 4.0.2 (this bump) |
| --- | --- | --- |
| 1st result | `docs/cafe.md` nameIndexes=[0,1,2,3] pathIndexes=[5,6,7,8] | identical |
| 2nd result | `docs/café.md` nameIndexes=[0,1,2,3] pathIndexes=[5,6,7,8] | identical |
| Scores | (not recorded in golden) | tie at 0.9552 |

The unaccented file already ranked first before the bump, both majors
return match indices for both files, and v4 scores them equally. The
"accepted reversal" therefore never materialised on this fixture; nothing
was compensated and nothing needed to be. This finding carries forward to
the declined-upgrade record in issue #73.

**Breadth and proximity: unchanged where the seam measures them.** Empty
query: 12 of 12 files, indices null on all (no query, nothing to
highlight, expected). Query `ma` + currentDocFolder=docs: 2 of 12, both
with name and path indices. Query `readme` + currentDocFolder=tests:
`tests/README.md` above `README.md`; without the folder the order flips.
Ad-hoc probes beyond the seam's cases found breadth only growing, never
shrinking: `road map` and `MY PHOTO` (space vs hyphen) previously returned
nothing (the old normalisation pass only ran when the query carried
diacritics or hyphens itself, and the primary pass could not match a space
against a hyphen) and now match `plans/road-map.md` / `assets/my-photo.png`;
`cafe` now also returns `docs/café.md`, highlighted.

**Harness outcome: zero diffs, no golden re-captured.** 33 fixtures + 2
seams = 35 passed, 0 failed before and after; the file-search seam output
is byte-identical, so `harness/golden/seams/file-search.txt` still
represents the 3.1.0 baseline and also the 4.0.2 present. `npm run lint`
and `npm run build` green.

Pre-existing staleness carried forward (not touched here, docs edits are
out of scope for #70): `docs/internals/autocomplete-plugins.md` still
says "Threshold -1000" and lists `fuzzysort@^3.1.0` in its dependency
line.

## Classification record: remaining in-range bumps (issue #71)

Recorded when the last six packages moved to the latest version within
their existing semver ranges (caret floors raised, lockfile pins the
resolution):

| Package | Before | After | Constraint honoured |
| --- | --- | --- | --- |
| `mermaid` | 11.12.2 | 11.17.2 | within `^11` |
| `@mermaid-js/layout-elk` | 0.2.1 | 0.2.3 | within `^0.2` |
| `prosemirror-search` | 1.1.0 | removed | dropped as a direct dependency by #72 (search now runs on `@tiptap/extension-find-and-replace` 3.30.1, added there) |
| `puppeteer-core` | 24.42.0 | 24.43.1 | **major 24 held**: 25.x requires Node ≥ 22.12, the declared VS Code floor `^1.85.0` runs an extension host on Node 18 |
| `@types/node` | 25.6.0 | 25.9.5 | **major 25 held** (26.x exists, out of range) |
| `@types/vscode` | 1.108.1 | 1.134.0 | within `^1.85` (type-level only; no code changes, so no API above the 1.85 floor is called) |

**Harness outcome: zero diffs, no golden re-captured.** 33 fixtures + 2
seams = 35 passed, 0 failed before and after the bump; `npm run lint` and
`npm run build` green. Mermaid markdown roundtrip (the synthetic mermaid
fixture) is byte-identical: the codeBlock passes through the Tiptap
markdown layer, which this bump does not touch. The typed API surface the
plugins use (`mermaid.initialize` / `mermaid.render` /
`mermaid.registerLayoutLoaders(elkLayouts)` from layout-elk 0.2.3) still
typechecks under the new declarations; actual SVG rendering needs a real
DOM and is deferred to the #73 manual checklist.

**Production bundle sizes** (minified, before → after):

| Bundle | Before | After | Delta |
| --- | --- | --- | --- |
| `out/extension.js` | 176,434 B | 176,434 B | 0 |
| `out/webview/main.js` | 5,023,289 B | 9,246,656 B | **+4,223,367 B (+84%)** |
| `out/markdown-ast.js` | 154,219 B | 154,219 B | 0 |
| `out/export-docx.js` | 464,029 B | 464,029 B | 0 |
| `out/export-pdf.js` | 2,583,511 B | 2,595,481 B | +11,970 B |

The webview growth is mermaid itself, not a bundling regression: the
package's unpacked dist grew from 66,174,471 B / 793 files (11.12.2) to
83,995,446 B / 1,183 files (11.17.2), adding new diagram types (verified
dist chunks: `treemap`, `radar`, `packet`, `vennDiagram`, plus new deps
`@upsetjs/venn.js`, `fastdom`, `es-toolkit` replacing `lodash-es`). The
plugin imports the full `mermaid` entry, so every registered diagram is
bundled. Slimming that (selective diagram registration) is future work,
not part of #71.

**Export verification (PDF/DOCX "output unchanged" boxes).** Method: the
real lazy bundles `out/export-docx.js` and `out/export-pdf.js` were run
under plain Node against a fixed sample document (headings, emphasis,
inline code, link, nested/task lists, blockquote, table, two fenced code
blocks; no images, no mermaid substitution), with a shimmed `vscode`
module providing the dialogs/progress/FS surface; same document and same
installed Chrome before and after the bump.

- **PDF**: zip-level byte comparison is impossible by construction
  (creation timestamps, object ids, font subset tags), so page count and
  the extracted text layer were compared with pypdf: 2 pages before and
  after, text layer identical on both pages (616 + 94 chars).
- **DOCX**: the extracted zip trees were compared part by part.
  16 of 18 parts byte-identical (styles, numbering, settings, fontTable,
  comments, footnotes, endnotes, `[Content_Types].xml`, …);
  `docProps/core.xml` excluded (carries creation/modification timestamps).
  `word/document.xml` and `word/_rels/document.xml.rels` differ **only**
  in the hyperlink relationship id the `docx` library randomizes per run
  (`rId5qcwfwzvd3jwejdbzl9y3` vs `rIdbdf4spt3ltqemh5085dzd`, same 12,617
  and 1,243 byte lengths). Control: two exports on the *same* post-bump
  tree differ from each other the same way; after normalizing that one
  id, before vs after is byte-identical. The DOCX dependency chain
  (`mdast2docx`, `@m2d/*`, `docx`, `image-size`) did not move in this
  bump; the diff is per-run nondeterminism, not a version effect.

**Deferred to the #73 manual checklist** (not verifiable here): mermaid
diagram rendering in the running extension, and the extension loading on
the VS Code version declared in `engines`.

## Follow-up to #71: mermaid lazy-loading + @types/vscode floor pin

Two coordinator-approved changes landed on top of #71 (one commit,
Refs #71).

**Mermaid is now a separate, on-demand artifact.** The webview bundle is
IIFE, so a dynamic `import()` cannot split a chunk (and an initial
mis-build without `bundle: true` on the new entry confirmed how silently
that fails: the "artifact" was 1,570 B of bare `require()` stubs). The
working design: `src/webview/mermaid-loader.ts` is its own esbuild entry
(IIFE, `out/webview/mermaid-loader.js`) that imports mermaid +
`@mermaid-js/layout-elk` eagerly and registers them on
`window.__tuiMermaidBundle`. `src/webview/mermaid-bridge.ts` (in
main.js) injects that file as a `<script nonce=…>` on first render. The
nonce and artifact URI come from a nonce-bearing inline bootstrap script
the provider emits before main.js (`window.__tuiMermaidBootstrap`);
browsers hide the nonce attribute from the DOM, so the page cannot
recover it otherwise. **The CSP is byte-for-byte unchanged** (still
`default-src 'none'; script-src 'nonce-…'; …`): a nonce-bearing script
element may load the artifact without any relaxation. Loading is
idempotent and race-safe: one in-flight promise shared by all callers,
one `<script>` element, one ELK registration, one `mermaid.initialize`;
failed loads clear the in-flight promise so the next render retries.
Theme changes before first load are a no-op (nothing rendered to
re-theme; first render initializes with the current body theme class).
During the first load the user sees the existing `Rendering…`
placeholder — the code block stays hidden in view mode, so there is no
flash of raw code.

| Bundle (production) | #71 (eager) | Follow-up (lazy) | Delta |
| --- | --- | --- | --- |
| `out/webview/main.js` | 9,246,656 B | **783,157 B** | **−8,463,499 B (−91.5%)** |
| `out/webview/mermaid-loader.js` (new) | — | 8,457,219 B | loaded only when a diagram renders |

`main.js` is now also 84% below the pre-sweep 5,023,289 B baseline;
documents without diagrams never fetch the 8.46 MB artifact at all.
Verified `cytoscape`/mermaid runtime symbols absent from main.js
(the only remaining "dagre" hit is the plugin's own fallback warning
string). jsdom smoke test of the real artifact: executes, registers
`__tuiMermaidBundle`, ELK registration OK, `initialize` OK;
`mermaid.render` rejects with `getBBox is not a function`, the known
jsdom no-layout limit. **Deferred to #73 manual checklist**: actual
diagram rendering, view/edit toggle, copy-as-PNG, lightbox, and CSP
enforcement of the nonce-bearing injection in the real webview.

**@types/vscode pinned back to the declared floor.** `~1.85.0`
(installed 1.85.0; #71 had raised it to ^1.134.0 while `engines.vscode`
stays `^1.85.0`, letting tsc bless APIs the minimum runtime lacks).
`npm run lint` is GREEN on the 1.85.0 type surface: no production code
calls an API newer than the floor, so no call sites to report.
`@types/node` stays at 25.9.5.

**Verification (after final edit):** `npm run lint` clean;
`npm run build` and `npm run build:dev` both complete; harness 33
fixtures + 2 seams = 35 passed / 0 failed (zero diffs, no golden
re-captured — the harness editor never loaded the mermaid preview
plugin, so the lazy-loading change is invisible to it by design).

## The other two seams

Besides the markdown corpus, the same single command runs two pure,
no-DOM seams against their own goldens (`harness/golden/seams/`):

- **Frontmatter seam** (`frontmatter-seam.ts`) exercises
  `parseContent` / `reconstructContent` from
  `src/utils/frontmatter-parser.ts` and the webview's `validateYaml` from
  `src/webview/frontmatter.ts`, through their existing exported signatures.
  It records each supported frontmatter form (standard, implicit, empty
  delimiters, comment-only, blank-line-only, none), whether comment-only and
  blank-line-only blocks validate, the reported line of a YAML error, and
  whether untouched frontmatter reconstructs byte for byte. Where it does
  not (implicit form, empty delimiters), the reconstructed output is
  recorded next to the input so the diff shows exactly what changed.

- **File search seam** (`filesearch-seam.ts`) exercises `searchFiles` from
  `src/webview/file-search-utils.ts` with a fixed twelve-file fixture list.
  It records candidate breadth, proximity ordering with and without a
  `currentDocFolder`, and whether every result carries match indices.

  The **diacritic ordering block is a recorded measurement, not a pass/fail
  assertion**: it shows how a diacritic-bearing query ranks accented versus
  unaccented filenames today. The upcoming search library major is expected
  to change that ordering; the change was accepted in advance, and this
  measurement exists so the decision can be revisited against data rather
  than recollection.

Both seam reports are plain deterministic text: whatever the current
dependency tree produces is what lands in the golden.

## Stated limitation: no layout, no coordinates, no measurement

The harness runs on Node with **jsdom** supplying the DOM. jsdom has no
layout engine: there is no box model, no fonts, no rendering. Anything that
depends on `getBoundingClientRect`, `posAtCoords`, scroll positions, CSS
computed layout, canvas, or actual painting is **invisible to this harness
and is not verified by it**. In particular, these areas require manual
verification in the running extension:

- image lightbox (zoom controls, positioning),
- table context menu (positioning at cursor),
- heading level badges and collapse toggles (positioned overlays),
- mermaid SVG preview rendering and its fullscreen viewer,
- search highlight scrolling and theme legibility.

The harness is adequate for schema and string logic, which is what the
markdown roundtrip seam exercises, and inadequate for anything positional.
The limit is stated here rather than papered over.

## Maintenance notes

- `harness/editor.ts` mirrors the markdown-relevant parts of
  `initEditor()` in `src/webview/main.ts`, including duplicated definitions
  of `EscapeToken`, `BlankLineHandler` and the `Blockquote` / `Document` /
  `Paragraph` extends (main.ts cannot be imported from Node: it calls
  `acquireVsCodeApi()` at module scope). If you edit those in main.ts, update
  the mirrors in the same change, or the harness stops representing the real
  editor.
- UI-only extensions (Placeholder, line highlight, heading badges, collapse,
  code block toolbar, table context menu, search, file mention and wiki link
  autocomplete popups, mermaid preview) are deliberately not loaded: they
  have no effect on markdown parsing or serialization.
- The webview's image path rewriting (`transformForDisplay` /
  `transformForSave`) is identity when the image map is empty, so the
  harness exercises markdown fidelity without the webview-URI layer.
- jsdom requires a recent Node (≥ 20 recommended). The harness is a
  development tool and is never shipped in the extension bundle.
