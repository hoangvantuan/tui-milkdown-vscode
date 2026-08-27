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
