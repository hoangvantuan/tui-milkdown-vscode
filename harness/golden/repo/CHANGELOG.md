# Changelog

All notable changes to "TUI Markdown Editor" extension.

## \[Unreleased\]

## \[3.0.2\] - 2026-09-21

Wave 10 (#149) turned the architecture review of 2026-09-21 into code. All seven tickets are merged, each closed against the coordinator's own measurements rather than the worker's report: seven `agy` workers on seven worktrees, in three waves, with the ticket that fixes a bug landing before the refactor that moves the code it fixed. #150 is the eighth, opened during the wave and closed after it: the one bridge the parallel branches had to leave standing, plus the three checks that had no teeth until it was removed.

One user-visible fix, #142. Everything else is internal: `src/webview/main.ts` went from 2,442 lines to 1,925, and what left it went into modules that own their own state (`extension-factory.ts`, `image-path-translation.ts`, `content-sync.ts`) rather than into a second copy of it. Each new boundary came with the check that makes it measurable.

### Fixed

- **Renaming an image by double-click wrote a webview address into the file (#142, #129)**: `sample.md` referenced `media/icon.png` twice, once as `<img width>` and once as `![]()`; after a rename the file held one `https://file+.vscode-resource...` URL and one new relative path, so the document pointed at a resource that exists only inside the webview and at a file that no longer existed. Two modules held the image map and neither invalidated the other's cache: the plugin rewrote the map without bumping `imageMapVersion`, so `transformForSave` reused the stale reverse map, and only the clicked node was updated while the host had rewritten every reference. Rename completion is now one call in `main.ts` that bumps the version, updates every node carrying the old address (matched through `sameResource`, so percent-encoding does not matter) and re-anchors `contentBaseline`, so no redundant `edit` follows. The floor probe added for this went from `newRelative=1 webviewUrls=1` to `newRelative=2 webviewUrls=0`, and `harness/image-path-seam.ts` pins seven cases; a fix that updates only the first node turns one of them red.

### Changed

- **Extension factory (#143, #145)**: the markdown-relevant Tiptap extensions (StarterKit flags, the alert Blockquote, the Document serializer, the fence-length CodeBlockLowlight, the Table serializer, EscapeToken, BlankLineHandler, CustomUnderline, the tab-expanding marked lexer, the idempotent `MarkdownManager.prototype` patch) are built ONCE by `buildMarkdownExtensions()` in `src/webview/extension-factory.ts`. `harness/editor.ts` and `initEditor()` both call it, so the roundtrip harness measures the rules that ship instead of a hand-kept mirror; the wave 8 ownership markers in `main.ts` are gone with the mirror. Behaviour is unchanged: 60/60 roundtrip with no golden touched, and the webview bundle dropped 2,223 B to 1,024,243 B.
- **Image ledger (#144)**: the per-document baseline of image paths that rename and delete detection compare against lives in `src/host/imageLedger.ts`, one instance per `docKey`, shared by two panels on the same file. The provider, `applyEdit`, `handleDocumentSave` and the rename handler call `setBaseline`, `detectRenames`, `applyRenames`, `detectDeletes` and `updateEntry` instead of threading the outer `Map<string, Map<string, string>>` plus `docKey` around; the "never hold the inner map" trap in AGENTS.md is now unrepresentable. The #126 rule (re-baseline FIRST, synchronously, before the delete prompt's `await`) is inside the ledger and has a unit test that goes red when the order is swapped.
- **Image path translation (#147)**: the webview's image map, its version counter, the cached reverse lookup and every path transformation live in `src/webview/image-path-translation.ts`. `main.ts` and the image edit plugin are callers holding no map state, so the two-owners-one-cache shape that caused #142 cannot recur: replacing or mutating the map bumps the version and drops the cache in one call. Reverse lookup matches on a canonical key rather than scanning the map with `sameResource` per miss. The module is Node-safe, so `harness/image-path-seam.ts` imports it instead of `main.ts`, and the `typeof acquireVsCodeApi` guards #142 had to add to `main.ts` are gone; the harness bundle is back to 2,780,163 B from 3,043,044 B.
- **Content sync (#148)**: the nine `let`s that tracked what the host holds against what the webview has promised (`currentBody`, `currentFrontmatter`, `currentFormat`, `currentRawBlock`, `contentBaseline`, `lastSentState`, `isUpdatingFromExtension`, `debounceTimer`, `blobRetryCount`) and the functions around them are `ContentSync` in `src/webview/content-sync.ts`, with `postMessage` injected: production passes the webview API, the harness passes a recorder. `{ type: "edit" }` now leaves the webview from exactly one line. `harness/content-sync-seam.ts` pins the five cases that used to exist only in comments, including the #111 pair: a character typed and undone inside one debounce window posts nothing, and a document ending in an alert posts nothing at load.
- **One latch for host-driven updates (#150)**: `main.ts` kept a module-scope `isUpdatingFromExtension` beside the private one inside `ContentSync`, a bridge left standing when #147 and #148 merged; `isUpdating()` returned true if either was set, so which of the two a new caller happened to raise decided whether a transaction was suppressed. That is the #142 shape, two places holding one truth. The flag is now a single private field and `guardExtensionUpdate(fn)` is the only way to raise it: there is no setter, so it cannot be set and left, nor cleared early. Both webview callers that rewrite image nodes on the host's behalf, and the `update` handler, go through it. Two gaps the wave 10 close recorded are closed with the checks that would have caught them: `harness/content-sync-seam.ts` now reads the latch inside the call, immediately after it returns and one microtask later, which is the only way to see it at all (the baseline gate in `postEdit` hides a broken latch from any count of posts), and it counts serializations at the first timer's deadline, which is the only way to see that the debounce coalesces. A third goes red on the host side when `withPendingEdit` releases `pendingEdit` synchronously instead of on a microtask.
- **EditorSession flags are behaviour, not fields (#146)**: `pendingEdit`, `inFlightEdit` and `exportInProgress` are private; the message handler table calls `withPendingEdit(fn)`, `withExportLock(fn)` and `applyEdit()` instead of assigning them, and the provider reads `isApplyingEdit`. The #104 teardown order (await the in-flight edit, then set disposed) is unchanged and now has a unit test that goes red when it is reversed. The rename path still runs under `withPendingEdit` without calling `updateWebview()`, as before.

## \[3.0.1\] - 2026-09-20

### Changed

- **`autoDeleteImages` is covered end to end in a live host**: the floor check went from one branch to four, 50 checks to 53. `Keep`, `Delete Anyway`, the unreferenced image that must not queue behind the question, and the reference put back under an open prompt are each asserted against a real extension host, because a notification with buttons and a document changing mid-await exist nowhere else. `docs/manual-checks.md` C4 is down to the three things a machine genuinely cannot answer: whether the file reaches the Trash on a human's desktop, whether it comes back, and whether the prompt reads well.

### Fixed

- **Deleting an image another document still used trashed it with no warning (#126)**: `a.md` and `b.md` both rendered `images/shared.png`; removing it from `a.md` and saving sent the file to the Trash, leaving `b.md` with a broken image and nothing said. `AGENTS.md` had claimed the warning existed, but `ImageDelete.usedInFiles` shipped declared `// Will be populated by caller` with no caller. `src/host/imageUsage.ts` is that caller. An image nothing else references still goes without confirmation; a shared one raises a prompt naming the other documents, and `Keep` — or dismissing the notification, or any host that never answers one — leaves the file alone. Matching is by resolved absolute path, so `notes/c.md` writing `../images/shared.png` counts where a string compare would have missed it. The scan runs only on a save that actually removed an image. Two things follow from the prompt having no deadline: images nothing else references are trashed before it, so the common case keeps its old timing, and the answer is re-validated against a fresh read of the document, so putting the image back while the prompt is open beats a stale Yes. The floor check that used to MEASURE this now asserts it, and waits for the prompt rather than for a clock.
- **The Trash half of `autoDeleteImages` is attributed rather than shrugged at**: the floor check reported `foundIn~/.Trash=no` and could not say whose fault it was. A new probe makes the same `vscode.workspace.fs.delete(..., { useTrash: true })` call on a file the extension has never heard of and gets the same reading, so the missing Trash is VS Code's behaviour as the floor launches it, not this extension's call. Measured outside VS Code for completeness: `NSFileManager.trashItem` does reach `~/.Trash` from both `/private/tmp` and `os.tmpdir()`, so the operating system is not the reason. Where the file lands on a human's desktop stays a hand check, now with a reason instead of a shrug.

## \[3.0.0\] - 2026-09-20

Release 3.0 (#85) extends what the editor RENDERS without extending what it writes to disk. Every heavy renderer is a lazy artifact, the way mermaid has been since 2.15, and the webview startup bundle now has a build gate rather than a convention. Four `agy` workers ran in parallel on four worktrees; every issue below was closed against the coordinator's own measurements, not the worker's report.

### Fixed

- **Formulas were corrupted on the first save (#131)**: `$\frac{a}{b}$` came back as `$\\frac{a}{b}$`, and `$$\int_0^1 x^2 dx$$` as `$$\\int\_0^1 x^2 dx$$`. The parent issue described math as "passing through but showing as source"; the first half was false, and this was data loss shipping in 2.17. The cause is `INLINE_SYNTAX_REGEX` in `markdown-text-escape.ts`, whose group 3 escapes `\` and `_` with nothing exempting a formula. The fix is not another rule there, which is the #99/#101 trap: math is now a node holding its LaTeX as an ATTRIBUTE, and an attribute is never escaped. `harness/fixtures/synthetic/math-passthrough.md` is red on 2.17 and green here.
- **A `<details>` block sprang shut the moment it was opened (#132)**: the browser's own `<summary>` toggle flips the `open` attribute without a transaction, ProseMirror saw a foreign DOM mutation and redrew the node, and the disclosure closed again. A NodeView now ignores that one mutation. It deliberately does not answer with a transaction instead: `renderMarkdown` writes the attribute out as `<details open>`, so a reader's click would otherwise be written into the author's file.
- **A link wrapped around `<kbd>`, `<sub>` or `<sup>` was destroyed on save (#132)**: `[<kbd>Ctrl</kbd> docs](url)` became `<kbd>[Ctrl](url)</kbd> [docs](url)`. Those tags are marks now rather than raw-HTML atoms, and a mark can hold a link where an atom cannot. `docs/upstream/tiptap-markdown-mark-around-atom.md` still stands for atoms; this sidesteps it. `MarkdownLink.parseMarkdown` also had to batch its child tokens, because one token at a time never lets `parseInline` see an opening tag, its text and its closing tag together.

### Added

- **Math rendered with KaTeX, loaded on demand (#131)**: `$...$` and `$$...$$` render as formulas. The delimiter rules follow GitHub's, so `It costs $5 and $10.` stays prose. KaTeX is 267,806 B plus 1.1 MB of fonts and never enters the startup bundle; the stylesheet and `fonts/` are copied to `out/webview/katex/` because `katex.min.css` references its fonts by relative URL.
- **Footnotes (#131)**: numbered references, a definitions section, and a hover preview of the definition body. What is written to disk is unchanged: footnotes already round-tripped byte for byte in 2.17, and `footnotes-passthrough.md` still does.
- **The HTML whitelist renders (#132)**: `<details>`/`<summary>` collapse in the editor as they do on GitHub, and `<kbd>`, `<sub>`, `<sup>` render as themselves. `harness/golden/synthetic/raw-html.md` is byte-identical to its 2.17 version, which is the evidence that rendering changed and saving did not.
- **Drag handle for block reordering (#133)**: hover a block, drag it. `@tiptap/extension-drag-handle` costs 127,420 B eagerly, most of it yjs and y-prosemirror reached through `@tiptap/extension-collaboration`, which this editor does not use, so it loads on the first hover instead. Nothing relocates the handle: upstream appends it to `#editor`, which is already inside `#editor-container` and already outside the element carrying the CSS `zoom`, and the floor check measures it following the block under the pointer at both 100% and 120%.
- **Emoji picker on `:` (#133)**: fuzzy filtered, inserting the unicode character. The dataset is a 528,529 B lazy artifact. The extension's own schema node is deliberately NOT used: it declares a `renderMarkdown` that would rewrite a unicode character the user already saved into a `:shortcode:`, and 3.0's rule is that rendering never changes what is on disk.
- **Backlinks panel (#134)**: every workspace document that references the current one through a `[[wiki link]]` or an `@` mention, one click away. It opens on the RIGHT of the editor, the mirror of the Contents sidebar on the left.
- **Focus mode (#134)**: hides the toolbar, the TOC and the progress bar, and keeps the active line centred.
- **Code block line numbers and a wrap toggle (#134)**: per block, in the existing header. Both are view state, so the fenced block on disk is unchanged, which `harness/codeblock-seam.ts` pins.

### Changed

- **The webview startup bundle is gated at 1,100,000 B**: `assertWebviewBudget()` fails the production build past it rather than warning, and prints the number on every build. 2.15 recorded 933,347 B after the mermaid split, 2.17 shipped 983,969 B, and 3.0 lands at 1,026,075 B with five new renderers, because only the small markdown-side code is eager.
- **Lazy artifacts are a shared mechanism now**: `src/webview/artifact-bridge.ts` carries mermaid's load semantics (one in-flight load per artifact, a spent `<script>` never waited on twice, a network failure retryable, an artifact that runs without registering its global latched) for the three new ones. `mermaid-bridge.ts` deliberately keeps its own copy, because it carries the #112 scheduling history.
- **The floor check covers the new artifacts**: 36 checks to 50, and the six criteria these issues closed with as "verify by hand" are checked by the harness instead. One of the fifty is the window itself: Chromium runs no animation frames for a covered window, so a run with something on top produces a dozen reds that all look like product defects, and the check that says so comes first. KaTeX waits on the same budget as mermaid and the wait ends only when both are ready, so a fast mermaid cannot report a false red for a formula still loading.

## \[2.17.0\] - 2026-09-20

Release 2.17 (#84) is the editing surface built on the 2.16 foundations: the shared suggestion popup (#90) became the slash command, the typed message protocol (#87) and the handler table (#88) carried the new messages, and the raw HTML node (#96) turned out to need correcting rather than building on. Four `agy` workers ran in parallel on four worktrees; every issue below was closed against the coordinator's own measurements, not the worker's report.

### Added

- **Slash command menu (#114)**: type `/` at the start of an empty paragraph for a fuzzy-filtered list of 17 block insertions: headings 1 to 3, bullet, numbered and task lists, table, code block, Mermaid diagram, the five GitHub alerts, image, quote and horizontal rule. `src/webview/slash-command-plugin.ts` is the third consumer of `SuggestionPopup`, after `@` mentions and `[[` wiki links, which is what that extraction existed for. The popup attaches to `#editor-container`, not `.tiptap`, because CSS `zoom` on `.tiptap` is transparent to the JS coordinate APIs. One correction to the plan: #84 listed a "page break" entry, and there is no `pageBreak` node in this codebase, only `horizontalRule`, so the entry ships as Horizontal rule and serializes to `---` rather than inventing a node. Pinned by `harness/slash-seam.ts`; all 17 entries change if the insert command is broken.
- **Find and Replace (#115)**: the search bar gained a replace row, replace-all, and a case-sensitive toggle. `@tiptap/extension-find-and-replace` already implemented every one of these at the library level; only the UI and the command wiring were missing. The two load-bearing options in `search-plugin.ts` are untouched: `searchDebounceMs: 0`, which is what lets `performSearch` read `storage.findAndReplace` synchronously after `setSearchTerm`, and `injectCSS: false`, which keeps the extension from overriding the theme's decoration styles. Pinned by `harness/replace-seam.ts`; breaking replace moves 16 of its lines, and breaking only the case toggle still moves one, so the toggle is pinned in its own right.
- **Bubble menu on text selection (#116)**: Bold, Italic, Code, Link and Highlight appear where the selection is. Adds `@tiptap/extension-bubble-menu@3.30.1` and, through it, `@floating-ui/dom`; `out/webview/main.js` grows about 19KB. The menu attaches to `#editor-container` for the zoom reason above.
- **Inline link editor (#117)**: editing a link is a popover at the caret instead of a VS Code input box at the top of the window. `requestLinkEdit` and `linkEditResponse` are gone from `src/shared/messages.ts` and from the handler table; because that table is a mapped type over the union, removing half of a message kind is a compile error rather than a silent no-op. The toolbar's Link button now reflects `isActive('link')`. `requestImageUrlEdit` deliberately stays on the input box. Pinned by `harness/link-edit-seam.ts`, 14 of 51 lines on a broken `applyLinkEdit`.
- **Table column alignment, and a table menu that works from the keyboard (#118)**: the context menu bound its items to `mousedown`, so Enter on a focused item did nothing; items are on `click` now, with roving focus across Tab, arrows, Home, End and Escape. The outside-click close deliberately stays on `mousedown`, because `mousedown` fires on the element actually pressed and so does not close falsely on a native `<select>` dropdown. Three entries set a column to left, center or right. Alignment *preservation* was already shipped in 2.16 and the serializer was not touched. Pinned by `harness/table-align-seam.ts`, 16 of 63 lines.
- **The lightbox takes focus and gives it back (#119)**: `grep -c focus src/webview/image-lightbox-plugin.ts` returned 0 before this release. The overlay is now a dialog with a focus trap, and closing it, including by Escape, returns focus to the image that opened it.
- **Image resize by drag (#120)**, and this one required correcting the premise of #84. The parent issue assumed the 2.16 raw HTML node made `<img width>` a safe target. Measured, it is the opposite: an `<img>` carrying `width` was routed to `rawHtmlInline`, and `RawHtmlBlock.renderHTML` renders `<pre><code>` with an "HTML" badge, so resizing an image by that route would have replaced the picture the user was looking at with a block of escaped source. `MarkdownImage` now owns `width` and `height` as node attributes and serializes `<img src alt width>` when either is set; `hasUnmodeledImageAttributes` keeps only `align`. Raw HTML still makes such a tag survivable; what changed is that it is now also editable. Pinned by `harness/img-width-seam.ts` and the new `harness/fixtures/synthetic/image-resize.md`.
- **A command to choose the default editor for `.md` in this workspace (#122)**, which is what #48 asked for. `contributes.customEditors` registers this editor with `priority: "default"`, so markdown already opened here everywhere and the useful direction was always the opposite one. The command is a QuickPick with three outcomes, each reversible from the same entry and each labelled by its result: TUI Markdown, the built-in text editor, or a reset that removes the workspace association. It has not been demonstrated to fix Git Graph's diff view specifically, which is a separate path in VS Code; #48 should be checked by hand before this ships.
- **A wiki link to a file that does not exist offers to create it (#123)**, next to the current document. #84 described the old behaviour as doing nothing; it showed a warning toast, and that toast is what this replaces.
- **Reading time next to the word count** (one of the last two bullets of #84). The other, a copy-anchor button on hover over a heading, is in Removed below. `headingSlug()` stays in `heading-level-plugin.ts`, where the button put it: `scrollToHeading` in `main.ts` is now its only caller, and having the rule in one place is still the point.

### Removed

- **The copy-anchor button on headings, withdrawn before release.** Built in this cycle from the last bullet of #84 and taken out in the same one, at the user's request after seeing it: a `#` sitting in front of every heading on hover, which shifted the heading text sideways. Not a defect, a judgement about the reading surface. Gone from `heading-level-plugin.ts`, `editor.css` and the floor check. `headingSlug()` stays because `scrollToHeading` uses it.
- **Cursor and scroll position per file (#121), withdrawn before release.** It was built in this cycle and taken out in the same one, at the user's request, after the hand-test pass. Two defects were found and fixed first and neither was what the report was actually about: the replay was scheduled from `requestAnimationFrame` alone, which never runs in a window being restored at startup, and it was a single shot against an editor that might not exist yet. The real complaint, "the cursor is gone", turned out to be that nothing in this webview had EVER focused the editor, so a document opened with no caret at all and the restore had nothing visible to show for itself. That part stays fixed: the editor is now created with `autofocus: 'start'`. The feature is gone: `src/host/editorPosition.ts`, its two message kinds, `workspaceState` on the handler context, and its unit tests. Positions already written to `workspaceState` are simply never read again.

### Fixed

- **The published `.vsix` no longer carries dev-only files, one of which held a tester's own notes.** `vsce` reads `.vscodeignore` and stops reading `.gitignore` the moment that file exists, so `.manual-checks.env`, which is gitignored precisely because it records free-text answers and absolute paths from whoever ran the hand checks, was packaged into the extension. `scripts/manual-checks.sh` (22 KB of wizard) went with it, and `CONTEXT.md`, the agent-facing glossary, has been shipping since 2.16 because the ignore list named `docs/**` and CONTEXT.md is at the root. The package is 18 files before and 15 after. Found by running `vsce package` and reading the file list before tagging; no automated check covers what a release contains, and `npm run package` is the whole of that check.
- **The editor failed to mount for any document containing a standalone markdown image.** Introduced by the `inline: true` change below and caught the first time the floor check opened a document with an image in it, before release. `@tiptap/extension-paragraph`'s `parseMarkdown` unconditionally returns the lone image itself for a paragraph that holds nothing else, dropping the paragraph. For a block-level image that is right. For an inline one it builds `doc > image`, which the schema does not allow, and Tiptap throws `Called contentMatchAt on a node with invalid content` during construction: no editor, no error in the UI, a blank panel for any file with a `![](...)` on its own line. `MarkdownParagraph` in `src/webview/markdown-destination.ts` overrides that one case in both the webview and the harness editor. The strongest thing to say about it is what the checks said: with the defect present `npm run roundtrip` reported 52 passed 0 failed, because it measures a string through an editor it constructs the same wrong way, and `npm run verify:vscode-floor` reported 6 failures. Two false fixes were measured and discarded on the way: reading the flag from `this.editor`, which is `undefined` during the initial parse, and returning `null` for the fallback, which falls through to the manager's own wrapper so the override appears to work while doing nothing. Reported upstream in `docs/upstream/tiptap-paragraph-image.md`.
- **DOCX export was dead on VS Code 1.85, the version `engines.vscode` promises.** `ReferenceError: crypto is not defined`: Web Crypto only became a global in Node 19 and 1.85 runs its extension host on Node 18, so something under mdast2docx threw while building the document and every export there ended in "Export failed" with no file. PDF was unaffected. `export-docx.ts` now assigns `globalThis.crypto` from `node:crypto` when it is missing, a no-op on any newer host. Found by driving the two export criteria from #88, which had never been run because they "need a save dialog": the host now stubs that dialog and the follow-up notification, the runner clicks the real button, and the host checks the magic number of what landed. DOCX 32 KB, PDF 116 KB, both with the document's headings, table, code block and images in them.
- **The image lightbox trapped no focus in a window that was not visible.** Second occurrence of #112's mechanism. `focusOverlay()` was scheduled only from `requestAnimationFrame`, and Chromium does not run those for a covered window, so the overlay opened as a dialog while focus stayed on the document behind it and Tab walked underneath it. Same fix: whichever of the frame and a 50 ms timer arrives first. Measured with the window covered in both directions, `visibility=hidden` in each: rAF only gives `focusInside=false (DIV.tiptap)`, with the timer `focusInside=true (BUTTON.lightbox-btn)`. The check had existed and passed for two days, because it only fails when the window happens to be covered; it now reports `visibility=` so that can never again read as a broken focus trap.
- **The hover cache no longer walks ProseMirror's own separator images (#125).** A document with two images rendered four `img` elements in a real webview, which read as a duplicated node. Measured, the second one per image is prosemirror-view's `img.ProseMirror-separator`, which it inserts next to a leaf node in a browser but not under jsdom, where it emits `br.ProseMirror-trailingBreak` instead. That is upstream behaviour and no harness seam can see it. One consequence was real and is fixed: `image-edit-plugin.ts` walked them in its hover cache. They are zero-size so hover never matched one, but every walk paid for them. The floor check now asserts one real element per image and one NodeView per real element, and reports the class of every `img` so the next reader does not have to re-derive this.
- **A link wrapped around a raw-HTML image was lost on save (#124)**, found by measuring the blast radius of #120 rather than reported by a user. `[<img src="a.png" width="200">](https://x)` roundtripped to `<img src="a.png" width="200">`: the destination was not moved or mangled, it was gone. The cause is that such an image took the `rawHtmlInline` path, where a self-closing tag encloses no text for a link mark to attach to; the paired-tag cases (`<kbd>`, `<sub>`) keep the link but migrate it inside the tag. #120 fixes the image case by routing it back through `MarkdownImage.renderMarkdown`, whose link-wrapping branch already existed. The paired-tag cases are still wrong and are closed as `wontfix`, with the mechanism measured rather than guessed: `@tiptap/markdown`'s serializer closes every active mark BEFORE a non-text node and reopens it after, so a mark can never wrap an atom, and `<kbd>` is two atoms with the marked text between them. Marking the atoms as well makes it worse, producing a stray unclosed `[`. Three workarounds were considered and all three trade losslessness or the user's own syntax for it, so nothing ships and the current output stays lossless; `docs/upstream/tiptap-markdown-mark-around-atom.md` has the measurements, and anyone who wants it fixed here anyway should open a new issue naming which trade-off they accept.

### Changed

- **`MarkdownImage` is configured `inline: true`**, in `src/webview/main.ts` and `harness/editor.ts` together. A link mark cannot be applied to a block-level image node without violating ProseMirror's paragraph content schema, which #117 needed. One golden moved: the slash command's image entry records `node=paragraph md="![]()"` where it recorded `node=image md="![]()\n"`. Classified as an accepted change, because an image is inline in CommonMark and a standalone image is a paragraph containing one. The evidence that it is safe is not that line but the 40 markdown fixtures that did not move.
- **The floor check drives every 2.17 surface and grew from 20 checks to 36.** The wave closed ten issues whose behaviour exists only against a live ProseMirror view, and it closed them on hand-test criteria nobody ran, which is a debt rather than evidence. `docs/manual-checks.md` is the single source of truth for what is left; the count is deliberately not repeated anywhere else. `driveSurfaces` in `harness/vscode-floor/run.mjs` now types `/` and reads the slash menu, opens find-and-replace and replaces a word, selects text and reads the bubble menu, drags an image handle and reads back the written width, opens and Escapes the lightbox, hovers a heading for its anchor button, and reads the reading time; `extension-tests.ts` adds the editor-association check. A later pass closed five more hand-test criteria the same way: the bubble menu at a non-100% zoom (`dx=0 dy=44` at 1.2), the `@` and `[[` popups, image delete on save, and both exports. Three probes in that pass were wrong before they were right, all in the same way: they measured the harness rather than the feature. The zoom probe compared against a selection 834px above the viewport; the lightbox probe read focus once at a fixed delay when the focus is scheduled by whichever of a frame and a timer wins; and the table menu's Enter is still only REPORTED, not asserted, because ProseMirror will not take the selection while its view has no focus, and asserting it would fail a working feature. Teeth were measured in two batches, exactly 3 and exactly 4 red against the corresponding code removed. Three probes accused working code before they were correct, and those corrections are the useful part: an image NodeView writes `style.width` rather than a `width` attribute, a hover overlay needs a `mousemove` carrying coordinates inside the target rect, and `defaultPrevented` on a `contextmenu` proves nothing because the VS Code webview cancels that event itself. A third pass took the last two: the theme sweep (#86) and the diff editor (#48). Neither needed a human after all, and the interesting part is that the written sheet had said both did. #86's claim, that moving 2,356 lines of CSS out of the provider changed no declaration, is a byte comparison: 2309 declarations before, 2309 after, 0 differing once indentation is ignored, which is a stronger statement than any pair of screenshots. "No theme hides its text" is a WCAG contrast computation over the CSS custom properties: all 12 themes pass AA for body text, 7.06 at the lowest (catppuccin-latte) and 17.22 at the highest (frame). It found one real inconsistency: `--crepe-color-highlight` is undefined in `crepe`, `frame` and `nord`, which fall back to the `#fff3b0` literal at the single use site, so changing that default silently changes three themes. For #48, `vscode.diff` opens a diff the same way a git extension does, and the new check reads back the winner under two states of `workbench.editorAssociations`: a diff stays a diff even when the user has pointed `.md` at this editor. Teeth: swapping `vscode.diff` for `vscode.open` turns it red with `tuiMarkdown.editor`. One trap worth recording, since two versions of the probe reported "no tabs" while the diff tab was open: VS Code 1.85 leaves `tab.input` undefined for a diff tab, so the tab label is the evidence. Theme screenshots exist as an opt-in convenience (`TUI_FLOOR_SHOTS=<dir>`) and are REPORTED, never asserted: `Page.captureScreenshot` waits for a surface frame and a covered window produces none, measured at 12/12 once and 1/12 four times on identical code. What stays hand-only is now smaller and sharper: Git Graph's own diff view, and whether the menus look good, which is taste and has no number.
- **#122 is now shown to change which editor opens `.md`, not merely to write the setting.** The unit tests proved the command writes the right JSON, which is a weaker claim than the one #48 makes. The floor check opens the sample the ordinary way, with no viewType, under three states of `workbench.editorAssociations` and reads back the winner. Teeth: flipping `contributes.customEditors` to `priority: "option"` turns it red on exactly the first state.
- **The harness registers its seams and discovers its unit tests up front.** Five seam files (`slash`, `replace`, `link-edit`, `table-align`, `img-width`) were committed as skeletons with their registration lines before the wave's worktrees were cut, so four parallel workers could each own one seam without all four editing `harness/roundtrip.ts`. `esbuild.harness.config.js` now reads `test/*.test.ts` from disk instead of listing entry points, which removes the same collision for unit tests and matches the `out/test/**/*.test.js` glob `npm test` already ran.

## \[2.16.0\] - 2026-09-16

### Changed

- **The floor check times the lazy mermaid artifact separately, and says why it failed (#112)**: `harness/vscode-floor/run.mjs` ran one deadline for two conditions, so the diagram paid for the editor mount out of its own budget, and the mount is the part contention actually slows down. The mermaid budget now starts at the mount. The number is unchanged at 40s and that is the finding: #112 reported three concurrent runs exhausting it, and the mechanism it names, CPU contention, does not reproduce. Time from mount to a rendered diagram measured 1507ms for one run, 1506ms for three concurrent, 1510ms for six, and 1523ms with all twelve cores saturated and load average at 24. Contention moves the mount (1.5s to 5.6s) and leaves the diagram flat, so the budget has roughly 25x headroom and raising it would have been a guess dressed as a fix; the table is on the issue and in the file header instead. The failure detail now distinguishes `stuckPlaceholders>0 errors=0`, which means STILL LOADING when the budget ran out, from a diagram that rendered nothing or rendered an error. For two waves those read the same. Both elapsed times are reported on success too. Teeth: cutting the mermaid budget to 1ms turns exactly one check red, with `rendered=0 errors=0 stuckPlaceholders=1; STILL LOADING after 1514ms`, which is the signature the issue reported. Two corrections found while measuring: `mermaidRendered` counted `svg` elements inside the preview, so a sample holding one diagram reported `rendered=4`, and the elapsed time for a failing probe was read after the drive phase and the 60s exit race, inflating it about twofold. The header also records a shared resource #110 did not cover: every run builds into the repo's own `out/` and VS Code loads the extension from the repo path, so concurrent runs overwrite each other's bundles; that surfaces as `errors=1`, not this bug, so it is recorded rather than fixed here.
- **`resolveCustomTextEditor` split into handlers and a session object (#88)**: the method ran 1,136 lines and held the whole per-document contract in closure variables, so there was nothing to construct and nothing to test. The bodies of its eighteen `onDidReceiveMessage` cases are now free functions under `src/host/`, `switch (msg.type)` is a table keyed by `WebviewToHostMessage["type"]`, and the nine pieces of per-document state live in an `EditorSession` class. The method is 91 lines and the provider went from 1,737 to 460. Behaviour is unchanged: the order of the sends on `ready`, which cases are awaited and which launch async work and return, the #104 teardown order (`setImmediate`, await the in-flight edit, then mark disposed), and all four layers of the edit-loop guard are preserved. What it buys: adding a message kind and forgetting its handler is now a `tsc` error instead of a message that silently does nothing. Verified by the floor check, which was extended for this refactor in the same wave and reports 19/19 against the rewritten provider.
- **One typed message protocol between the extension host and the webview (#87)**: the two sides exchanged 18 and 15 stringly-typed message kinds and each cast incoming objects to an ad hoc inline shape, so a typo on either side failed silently at runtime. `src/shared/messages.ts` declares `WebviewToHostMessage` and `HostToWebviewMessage` with one member per kind and its payload typed; both `postMessage` wrappers and both `switch` statements are narrowed through them, and the webview's out-of-band `exportDone` handling folds into the `switch`. Renaming a `type` literal on one side alone is now a `tsc` error. The file is type-only, so the webview bundle is unchanged by it. No behaviour change; this is the prerequisite for splitting the host's message handling (#88).
- **The editor stylesheet moved out of the provider (#86)**: `src/markdownEditorProvider.ts` was 4,006 lines, of which 2,356 were a single `<style>` block containing no interpolation, so CSS could not be linted or formatted and the provider's own logic was buried. The block moved verbatim into `src/webview/editor.css`, imported from `main.ts` ahead of `themes/index.css` so the cascade order is preserved, and served through the `<link>` the CSP already allows. Not one declaration changed. The provider went from 4,006 lines to 1,737 on `develop` at the end of the wave, 1,648 of which is the move itself and the rest #87 landing in the same file.
- **List keyboard behaviour: Tab on a first item, Tab in table cells, sub-list type, typed markers (#107)**: `sinkListItem` returns `false` for an item with no previous sibling, and no handler claimed the key, so Tab on the first item of any list did nothing and moved focus out of the editor. `Table`'s `Tab: goToNextCell` also ran before `ListItem`'s `sinkListItem`, so Tab inside a list in a table cell always jumped cells. `ListKeymapExtension` registers after both and: nests a first item under the preceding list when there is one, otherwise swallows the key so focus stays; tries list sinking in a table cell first and falls through to `goToNextCell`; converts an inner list created by the keypress from an ordered parent into a bullet list while leaving a pre-existing ordered sub-list alone; and absorbs a hand-typed `2.`  at the start of an item already inside an ordered list. These act only on keypresses, never on a file read from disk. Serializing a cell also stopped dropping nested sub-lists, which the table-cell case now produces. Pinned by `harness/list-keys-seam.ts`; five of its eight cases change if the extension is removed and the other three are regression guards over upstream behaviour.
- **`Ctrl/Cmd+Shift+M` works from both views (#108)**: the shortcut only reached the source view because the webview handled the keydown itself; from the source view there was no way back except the title bar icon. `contributes.keybindings` now binds `tuiMarkdown.viewSource` under `activeCustomEditorId == 'tuiMarkdown.editor'` and `tuiMarkdown.viewRichText` under `editorLangId == 'markdown' && !activeCustomEditorId`. The in-webview handler stays, for when VS Code does not forward the chord.
- **One `SuggestionPopup` behind the `@` mention and `[[` wiki link popups (#90)**: `file-mention-plugin.ts` and `wiki-link-plugin.ts` each carried their own copy of the popup: DOM creation, caret positioning, selection state, `ArrowUp`/`ArrowDown`/`Enter`/`Escape` handling and scroll-into-view, 314 lines of `diff` between them. `src/webview/suggestion-popup.ts` now owns all of it and the two plugins pass a render function; the plugins lose 126 and 110 lines. Behaviour, class names and appearance are unchanged, and the file search and file mention seams show no golden diff. The 2.17 slash command is the third consumer this exists for.
- **Retired `docs/internals/` and `docs/superpowers/`; the source is now the reference.** Everything those documents said that could not be read from the code (why PDF export keeps JavaScript off and what the tag strip protects, the mermaid `securityLevel: "loose"` and nonce-exposure trade-offs, why the table serializer is custom, why the file search threshold is `0`, the puppeteer-core major hold) moved into comments at the code site. Files that had no header comment (`extension.ts`, `main.ts`, `image-lightbox-plugin.ts`, `wiki-link-plugin.ts`, `table-markdown-serializer.ts`) got one. `AGENTS.md` lost its Feature Docs table and points at module headers instead. The historical design specs are in git history.
- The roundtrip harness corpus no longer enumerates `docs/internals/*.md`; its goldens were removed and the `AGENTS.md` / `CHANGELOG.md` goldens re-captured for this change (intended, documentation only).

### Added

- **A unit test runner, and the first tests for the code that rewrites the user's files (#89)**: the repository had no `npm test`. The roundtrip harness measures markdown fidelity and its seams cover a handful of webview functions, so nothing on the extension-host side was exercised by any automated check, including `image-rename-handler.ts`, which renames and deletes files on disk and rewrites references across the workspace. `npm test` now builds `test/` with esbuild the way the harness is built and runs Node's built-in `node:test`, with no new dependency, and CI runs it after the roundtrip step. `test/vscode-stub.ts` is a programmable stand-in for the `vscode` module: the existing esbuild stub is a static string and cannot be steered per test, so the new one drives real files under a temp directory and records `showWarningMessage` calls. First tests cover `frontmatter-parser` in its five forms and `image-rename-handler` for rename detection, the folder-change rejection, path traversal, delete detection and reference rewriting including the `](<path with spaces>)` form. `.vscodeignore` excludes `test/**` and `out/test/**`, which it did not do for the new directory. One acceptance criterion of the issue was dropped rather than faked: `image-rename-handler.ts` never reads `autoRenameImages`, that check lives in the caller at `markdownEditorProvider.ts:472`, and a test simulating the caller would assert nothing about the module under test. It is recorded in `docs/reports/w5-unittests.md` instead.

### Fixed

- **A diagram in a window that is not on screen now renders (#112)**: `mermaid-plugin.ts` scheduled the initial render from inside a `requestAnimationFrame` callback, and Chromium does not run those for a window it considers not visible. A webview that was hidden while the document loaded therefore never scheduled a render at all: the placeholder sat at `Rendering...` with no error to show for it, and stayed there until something made the window visible again. It was reported as a harness flake, and as a budget that was too short, because it only showed up when concurrent floor-check runs stacked VS Code windows on top of each other. It is neither: measurements at one, three and six concurrent runs, and at three runs with all twelve cores saturated, all rendered in about 1.5 seconds, while the failing runs sat at over 40 seconds having scheduled nothing. The render is now scheduled by whichever of the animation frame and a 50ms timer arrives first, so a visible window behaves exactly as before and a hidden one no longer waits forever. Teeth, with the window held minimized for the whole run: without the timer the check reports `scheduled=0 visibility=hidden` and fails; with it, `scheduled=1`, rendered 1511ms after mount. The floor check's failure detail now separates a render that was slow from one that was never scheduled, since only the first is about the budget.
- **Opening a document no longer leaves it modified (#111)**: a file could be opened, touched by nobody, and come back marked as changed. The cause was not in the guard the issue suspected. StarterKit's `trailingNode` keeps an empty paragraph at the end of the document so there is somewhere to click after a table or an alert, and it adds it from `appendTransaction`, which ProseMirror does not run while the editor is being constructed, only from the first transaction onwards. A document ending in a table or an alert therefore GREW that paragraph the moment anything dispatched, and the paragraph serializes to a trailing newline. Since the webview posts `editor.getMarkdown()` rather than the text it was handed, that arrived at the host as a user edit carrying every normalization the serializer applies. It looked nondeterministic because it depended on whether anything happened to dispatch during a given load. Two changes: the webview now remembers `contentBaseline`, the content string it last agreed with the host on, and does not post an `edit` equal to it; and one empty transaction settles `trailingNode` before that baseline is measured. The comparison is at the markdown layer deliberately, because Tiptap already suppresses `update` when the document is unchanged, so what gets through is a real change that serializes to the same text. The baseline is re-anchored on every real post, so typing a character and undoing it after the edit has gone still reaches the host. All five `postMessage({type:"edit"})` call sites now go through one `postEdit()`; they each repeated the `lastSentState` bookkeeping, so a new call site was one forgotten line away from an echo loop. Pinned by a new floor check, `a keystroke undone inside the debounce window leaves the document clean`, which types one character and Backspaces it inside a single 300ms window; removing either half of the fix turns it red on its own. The floor check goes from 19 to 20.
- **The floor check now drives the editor, not just reads it.** Added while preparing #88, which rewrites `resolveCustomTextEditor`. Every check the floor harness had was read-only, and the markdown roundtrip harness measures a string through an editor rather than a provider through VS Code, so the provider's per-document contract (`pendingEdit`, `inFlightEdit`, the debounce timer, the 18-case message switch) had no automated coverage at all. A second phase now types a sentinel into the live webview over the DevTools `Input` domain and clicks `#btn-source`, and the extension host asserts that the character reached the document, that it did not bounce back as a second update, and that view source opened the raw markdown in a text editor. The webview's `acquireVsCodeApi()` handle is a module-level const in `main.ts` and is deliberately left unpublished, so the phase drives the UI instead of posting host messages; that also covers the webview side of each path. The two processes rendezvous on marker files inside the per-run base, and the driving runs strictly after the two read-only checks that assert the document is clean. Measured teeth: stubbing out the `edit` case turns the typed-character check red, and stubbing out `viewSource` turns the view-source check red. The no-bounce check is an invariant check rather than a unit check, and did not go red when either the host `pendingEdit` guard or the webview `lastSentState` echo guard was removed on its own, because those guards are layered; it covers the loop only when every layer is gone. 15 checks become 19.
- **Two `npm run verify:vscode-floor` runs no longer corrupt each other (#110)**: `harness/vscode-floor/run.mjs` derived `ws`, `ud`, `ext` and `result.json` from one constant base, `/tmp/tuimd-floor`. Two concurrent runs therefore shared the workspace, so each one's `copyFileSync` rewrote the `sample.md` the other was asserting was unmodified, inside the exact 25-second hold the `document still unmodified after the hold` check measures; shared the user-data dir, where VS Code keeps its IPC socket and its single-instance lock, so the second launch could forward into the first and every DevTools check then inspected the wrong window; and, not noted on the issue, the second run's startup `rmSync(base)` deleted the first run's whole tree while it was running. Each run now takes an `fs.mkdtempSync` base, six characters that stay well inside the 103-character macOS socket-path cap. A second collision in the same file, also unlisted: the shared 120 MB download cache was written in place, so two cold runs interleaved one `curl` into one `vscode.zip` and unzipped into one `app/`, which also made `app/` exist while half-written; writes are now staged under a pid-private name and renamed into place, and rename is atomic, so `app/` appears only complete. A passing run deletes its base, a failing one keeps it as evidence, and a base abandoned by a failed or interrupted run is reaped on the next run once it is a day old, which the old unconditional wipe used to do implicitly. The residual `freePort` bind-then-close race is left and documented at the function: it fails loudly, unlike the shared user-data dir. Verified by two runs started together both reporting 15/15 from two distinct bases. `docs/agents/parallel-waves.md` recorded this symptom as CPU-load sensitivity across waves 3 and 4 and its ban on workers running the command is lifted.
- **A list continuation line indented with spaces stops drifting (#109)**: `harness/fixtures/synthetic/list-continuation-underindented.md` was not a fixed point on the second save. `@tiptap/extension-list`, `src/ordered-list/utils.ts`, computes `contentIndent = indentLevel + marker.length + 1` inside `OrderedList.markdownTokenizer.tokenize`, on the markdown parse path rather than only the paste path. `marker` excludes the separator, so `10.` yields 3 instead of 4: a four-space continuation was cut by three, kept one space on the first save, and lost that one on the second. A single-digit marker never showed it because `1.` yields 2, cuts exactly 2, and zero indentation no longer matches the continuation regex. `src/webview/ordered-list-extension.ts` overrides the tokenizer with the separator counted. The golden for that fixture changes and the change is the fix: the old golden was encoding the drift. Second-pass stability across the whole corpus goes from 1 failed to 0. Pinned additionally by `ordered-list-multi-digit-indent.md`; `docs/upstream/tiptap-extension-list-109.md` is what to re-read on a bump.
- **Edits typed in the last 300 ms before the tab closes are no longer lost, and an external change keeps the scroll position (#104)**: `debouncedPostEdit()` waited out its 300 ms after the final keystroke with nothing flushing on teardown, so typing and pressing Ctrl+W inside that window discarded the last words. The webview now flushes the pending `edit` on `visibilitychange` to `hidden` and on `pagehide`, skipping the blob retry wait; on the host, `onDidDispose` defers teardown by one tick so an edit arriving during it is still applied while the document is open. The 300 ms debounce is unchanged for ordinary typing, because a shorter one would multiply `WorkspaceEdit`s and pollute VS Code's undo stack. One window remains and is stated in the module header: a message posted from `pagehide` can still be lost if VS Code tears the webview down first. `updateEditorContent()` now saves and restores `#editor-container`'s scroll offset around `setContent`, after the selection is restored, so a git checkout while the editor is open no longer jumps the view.
- **A failed clipboard image read says so instead of doing nothing (#105)**: every failure branch of `readClipboardImage` was `catch { /* read failed */ }`, so on Linux without `xclip` or `wl-clipboard` a paste silently did nothing. The host now replies `{ type: "clipboardImage", error }` and shows `vscode.window.showWarningMessage` once per session per reason, with "Install xclip or wl-clipboard to paste images" on Linux. The issue asked for the webview to raise its "existing error toast" via `showError`; there is no toast. `showError` assigns `editorEl.innerHTML` and is the fatal-error screen used when the editor cannot be built, so calling it here would wipe the open document. The webview therefore only logs, and the host warning is the whole visible part. The correction is recorded on the issue.
- **Underline is written as `<ins>`, not `++text++` (#106)**: `StarterKit` ships `Underline`, so Ctrl/Cmd+U already worked, but it serialized to `++text++`, which is neither CommonMark nor GFM and which GitHub renders as literal plus signs. Markdown has no underline syntax, so the portable form is inline HTML, and the tag matters: GitHub's html-pipeline `SanitizationFilter` allowlist contains `ins` but not `u`, so `<u>` would be stripped to plain text there. `CustomUnderline` parses `ins`, `u` and `text-decoration: underline`, and writes `<ins>`; `raw-html.ts` recognizes `ins` so it is not kept verbatim. A legacy `++x++` and a pasted `<u>x</u>` are both Normalized to `<ins>x</ins>`, inside bold and inside a table cell too. An Underline button joins the text formatting group, reusing the existing button class with no new CSS. Pinned by `harness/fixtures/synthetic/underline.md`, which fails if `CustomUnderline` is removed.
- **Dead file, triplicated helper, stale metadata (#91)**: `src/webview/index.html` was referenced by nothing and is deleted. `escapeHtml` existed three times and the three were not equivalent, the `file-search-utils.ts` regex version not escaping `'`; one definition now lives in `file-search-utils.ts`, escapes `& < > " '`, and is used by `main.ts` and `mermaid-plugin.ts`. `.github/workflows/publish.yml` moves to Node 22, matching `ci.yml`, which is on 22 because jsdom 30 requires it. Loose-to-tight list normalization is produced by upstream's list serializer, not by anything in this repository, so the note explaining why it is an accepted Normalized behaviour sits in the `BlankLineHandler` header, the nearest code this repository owns, mirrored in `harness/editor.ts`.
- **Raw HTML in the source survives a save (#96)**: `<details>`, `<kbd>`, `<sub>`, `<div align>` and HTML comments were gone on the first save. The cause was not the `htmlAsLiteralText` fallback the issue named: for tags listed in `STANDARD_HTML_TAGS` the parser handed the token to ProseMirror's `DOMParser`, which unwrapped or dropped it because no node in the schema matched. `src/webview/raw-html.ts` adds `rawHtmlBlock` and `rawHtmlInline`, which store the source text and write it back verbatim; an opening and a closing inline tag are separate atoms so the text between them stays editable. Recognized tags are untouched (`<br>` is still a hard break, `<u>` still underline, a plain `<img src>` still an image node), except that an `<img>` carrying `width`, `height` or `align` is now kept as raw HTML instead of being downgraded to `![]()`. This repository's own README header is the visible case: the `repo/README.md` golden regains its `<div align="center">` and `<img width="96">` instead of the flattened `![...](...)`. Pinned by `harness/fixtures/synthetic/raw-html.md`.
- **DOCX export no longer crashes on any document containing raw HTML.** Found while fixing #96 and not covered by any issue. `parseMarkdownToMdast` parses the source string with remark, so `html` nodes were always in the MDAST regardless of what the editor did, and `@m2d/html` calls `document.createElement` unconditionally. In the Node extension host there is no `document`, so exporting a README with a `<div>` in it failed with `ReferenceError: document is not defined`. Measured on the pre-fix tree: with `htmlPlugin()` the export throws, without it the same document produces a valid 8629-byte file. The plugin is dropped and `mdast2docx` skips raw HTML instead. PDF export was never affected: it renders raw HTML through `remark-rehype` with `allowDangerousHtml`. `@m2d/html` is now unused in `package.json` and is deliberately left declared until the next dependency sweep.
- **A code block fenced with four backticks keeps its fence (#92)**: `@tiptap/extension-code-block` emitted three backticks regardless of content, so a block fenced with four because it contains a ````` line lost that protection on the first save, and the second save reparsed the wreckage into several empty code blocks plus a stray paragraph. This compounds: every open/save cycle made the file worse, which hit anyone documenting Markdown itself, this repository included. The fence length is now one more than the longest backtick run in the content, minimum three. Parsing already worked; only serialization changed. Pinned by `harness/fixtures/synthetic/code-fence-nested.md`; `docs/upstream/tiptap-extension-code-block-92.md` is what to re-read before dropping the override.
- **Consecutive blank lines stop eroding (#95)**: `BlankLineHandler` derived `emptyCount` from the newline count in the marked `space` token and was off by one for runs longer than one blank line, so three blank lines became two on the first save and one on the second. The result was not stable from the second pass, which is exactly what this repository's Normalized standard forbids, and it destroyed the vertical spacing writers add before headings and between README sections. Upstream `@tiptap/markdown` was also absorbing `space` tokens through `createImplicitEmptyParagraphsFromSpace` with a non-overlapping newline regex; the count is now read through `extractAbsorbedBlankLines`. One blank line behaves exactly as before, so no existing golden moved. Pinned by `harness/fixtures/synthetic/blank-lines-preserved.md`.
- **Four text-escaping defects fixed at one seam (#97, #99, #100, #101)**: these were not four bugs. All four came out of `MarkdownManager.escapeMarkdownSyntax`, a single `text.replace(/([\\`\*\_\[\]\~\])/g, "\\$1")`applied to every text node, and #99 and #101 wanted opposite things from the same rule for`\[`.` src/webview/markdown-text-escape.ts`installs one override and carries the four rules, rather than patching four call sites. A footnote reference`[^1]`and a definition line`[^1]:`are written back unescaped, while an unclosed`\[^abc`still escapes as before (#101). A task item under an ordered marker keeps`1. \[ \]`instead of becoming the literal text`1. \[ \]`, which is what GitHub renders as a checkbox (#99). An HTML entity that is not one of the four` @tiptap/core`knows is no longer wrapped into`&copy;`; the entity spelling is preserved byte for byte, which the issue listed as the stretch goal rather than the requirement (#97). A backslash before a construct that would open a block (`#`,` 1.`,` -`,` &gt;`, a fence, a thematic break) is kept, so` # not heading`no longer reopens as a real heading, while a`#`or`1.`in the middle of a line is still left alone (#100). The`nested-task-lists.md`golden changes at lines 14 and 16: it was recording the #99 defect, so #99's own criterion that the file show no golden diff contradicted the fix and was set aside deliberately. Pinned by four new fixtures and by`docs/upstream/tiptap-core-97.md`,` tiptap-extension-list-99.md`and`tiptap-markdown-100.md\`.
- **List indentation follows VS Code, and a tab-indented continuation stays with its item (#102)**: `Markdown.configure` was hardcoded to two spaces and `CodeBlockLowlight` to `tabSize: 2`, so a document indented with tabs or four spaces was rewritten whole on its first edit, a full-file diff in version control. Worse, `-\ta\n\tcontinuation` was saved as `-    a\n   continuation` and the second save detached the continuation into its own paragraph: Marked's list tokenizer uses `search(/[^ ]/)`, which does not count a tab, so the continuation was serialized three spaces deep where CommonMark needs five. A `CustomLexer` expands leading tabs to four-space stops before tokenizing, and the case is now stable from the first pass. Indentation is read from `editor.insertSpaces` and `editor.tabSize` resolved for `markdown` and passed to the webview in the `config` message, with `tuiMarkdown.listIndent` (`"editor"`, `2`, `4`, `"tab"`) to override it. With the default two spaces no existing golden moved. Pinned by `list-indent-tabs.md` and `list-indent-4-spaces.md`.
- **CRLF line endings preserved on save (#103)**: Documents with CRLF line endings were rewritten with LF on the first edit because `applyEdit` replaced the document with serialized markdown joined with `\n`. The save path now reads `document.eol` and normalizes the serialized content to that sequence before building the `WorkspaceEdit`. Documents with mixed line endings are normalized to `document.eol`, matching VS Code's own behavior. Pinned by `harness/crlf-seam.ts`; the seam needed the extension-host module to be importable without VS Code, so the roundtrip build gained a small `vscode` stub plugin, which is what lets any host-side pure function be pinned from now on.
- **A link wrapping an image survives a save (#98)**: `[![alt](src)](url)` was written back as `![alt](src)`. `@tiptap/extension-image` declares no `marks` on its node spec, so ProseMirror refused the `link` mark on an image and the parser dropped it silently. `MarkdownImage` now allows the mark, `MarkdownLink.parseMarkdown` attaches it to image leaf nodes as well as text nodes, and `MarkdownImage.renderMarkdown` writes the enclosing link back with the existing destination escaping. This repository's own README badge rows were losing their links on every save; the `repo/README.md` golden regains them. Pinned by `harness/fixtures/synthetic/image-in-link.md` (badge row, linked image with a title, destination with spaces). The upstream defect report is `docs/upstream/tiptap-linked-image.md`; it was deliberately not filed, and it is what to re-read before dropping any of the three overrides on a Tiptap bump.
- **Table column alignment survives a save (#94)**: `|:--|:-:|--:|` came back as `|---|---|---|` on the first save, so right-aligned number columns and centred status columns lost their alignment everywhere the file was rendered. `renderTableToMarkdown` wrote `'-'.repeat(w)` for every column and read no alignment at all. It now writes `:--`, `:-:`, `--:` or `---` per column from the cells' `align` attribute. Nothing had to be added to the editor side: `@tiptap/extension-table` 3.30.1 already parses the separator row into that attribute and already renders it back as `style="text-align: ..."`, so only the save path was losing it. A column with no alignment still serializes as `---`, byte-identical to before. Pinned by `harness/fixtures/synthetic/table-alignment.md`.
- **A literal `|` in a table cell is escaped on save (#93)**: the serializer wrote `x|y` for the cell text `x|y`, so the next save split the row and dropped the last cell's data. `renderInline` now escapes an unescaped pipe as `\|` everywhere in cell text, code spans included, which is what GFM requires inside a table. An already-escaped pipe is left alone. The `table-cell-code-span-pipe.md` golden changes as a result: its ``git log | head -20`` rows are written back escaped, which is how the editor already displays them and how GitHub will now render them. Pinned by `harness/fixtures/synthetic/table-cell-escaped-pipe.md`, byte-identical on a second roundtrip.

## \[2.15.2\] - 2026-09-13

### Fixed

- **Picking a file from the `@` mention popup no longer pushes the link onto a new line.** The insert went through `insertContent(markdown, { contentType: "markdown" })`, which parses `[name](<path>)` into a paragraph; Tiptap widens the replaced range for a block node only when the parent textblock is empty, so inserting into a paragraph that already had text split it and left the link alone on the next line. Typing `- **Bài toán số 1:** @` and choosing a file produced two lines instead of one. The mention is now inserted as an inline node (a text node with a link mark), the same shape the wiki link plugin uses, so it lands wherever the caret is. A mention on an otherwise empty line was never affected and still behaves the same.
- **Filenames containing `*`, `_` or `[` no longer produce a broken mention link.** The old markdown-string path escaped only `]`, so `a]b*c_d[e.md` was re-parsed as emphasis and the link came out mangled. Escaping now happens once, in `MarkdownLink.renderMarkdown` on save, which covers every markdown-significant character in the link text.

Both are pinned by a new harness seam, `harness/filemention-seam.ts`, which exercises the production `insertFileMention()` and observes the resulting markdown string (`npm run roundtrip`).

## \[2.15.1\] - 2026-09-12

### Fixed

- **Links and images whose path contains spaces no longer degrade into plain text after a save and reopen.** `@tiptap/extension-link` and `@tiptap/extension-image` serialized the raw path, so `Nguồn: [My clip 2026-09-09.mp4](<My clip 2026-09-09.mp4>)` was written to disk as `[My clip 2026-09-09.mp4](My clip 2026-09-09.mp4)`, which is not a CommonMark link. The file looked right until it was reopened, at which point the link had become literal text. Both extensions now wrap a destination in `<...>` when the bare form would not parse back (whitespace, unbalanced parentheses, empty). This affected @ mentions of files with spaces in the name and pasted images saved under such a name. Covered by the harness fixture `link-destination-spaces.md`.
- **Link titles and image alt text no longer break the same way.** Both are attributes interpolated raw by the same two extensions, so a title containing `"` closed the title early and an alt text containing `]` closed the alt early, in each case turning the link or image into plain text on the next open. Both are now escaped. Found by probing the surfaces adjacent to the destination fix, and pinned in the same fixture.
- An empty destination is left as `[text]()` instead of being rewritten to `[text](<>)`, so such links no longer churn on save.
- **Auto-rename of images now updates references written in the `](<path>)` form**, so renaming an image whose path contains spaces propagates to other documents in the workspace instead of silently skipping them.
- **`npm run verify:vscode-floor` now actually launches the floor build.** Run from inside VS Code (its integrated terminal, or an extension host) it inherited `ELECTRON_RUN_AS_NODE`, so the downloaded VS Code ran as plain Node, rejected every flag with `bad option: --extensionDevelopmentPath=...` and exited without a window. The run then reported "webview never mounted" instead of "the editor never started", which reads like an extension defect and is not one. The child environment is now built without the launching editor's `ELECTRON_*` and `VSCODE_*` variables (`VSCODE_IPC_HOOK` was equally damaging: it forwarded the launch into the already-running editor), a `floor VS Code build launched` check reports a non-launch as one honest failure, and the macOS executable is read from the bundle rather than assumed to be named `Electron`. The check goes from 3 checks with 2 failing to 15 checks all passing.

Documents already saved with a broken link are not repaired automatically: the link is plain text on disk and reopening them reads it as plain text. Re-inserting the link once is enough, and it then survives.

## \[2.15.0\] - 2026-08-28

Dependency upgrade sweep (#64), verified with the markdown roundtrip harness. Per-bump detail and how to run the harness: `harness/README.md` and `docs/internals/dependency-upgrade-sweep.md`.

### Changed

- **Dependency upgrade sweep (#64)**: 14 `@tiptap/*` packages 3.26.0 → 3.30.1 (pinned exactly), TypeScript 5.9.3 → 7.0.2, esbuild → 0.28.2, js-yaml 4 → 5.3.0, fuzzysort 3.1.0 → 4.0.2, mermaid 11.12.2 → 11.17.2, plus the remaining in-range bumps. Cmd+F search moved from `prosemirror-search` to `@tiptap/extension-find-and-replace` (one direct dependency fewer).
- **Markdown fixes (each evidenced by a harness golden)**:
  - A table cell containing a code span with a `|` no longer splits into two columns
  - A heading placed immediately after an ordered list keeps proper block structure (it is no longer absorbed into the list text)
  - A trailing blank line after a table at end of file survives a save
- **Frontmatter (js-yaml 5)**: empty or comment-only frontmatter stays valid; YAML error positions are more precise (they point at the line that actually carries the error)
- **File search**: every @ mention and [[wiki link]] suggestion now carries match highlighting (a single ranking path, after the manual diacritic-normalization pass was removed)
- **Search**: the match counter reads the authoritative index from plugin storage instead of inferring it from the cursor position
- **Mermaid lazy-load**: the webview startup bundle drops from 5,023,289 B to 933,347 B; mermaid (8,457,219 B) becomes a separate artifact, fetched only when a document contains a diagram
- **Performance**: type checking (`tsc --noEmit`) is faster, median \~0.94 s → \~0.27 s
- **Security**: js-yaml 4 → 5 removes exposure to two published parser denial-of-service defects

### Added

- **Automated verification for what previously needed a human**: the harness gained a table column-width seam and a placeholder rendering seam, and the repository gained `npm run verify:vscode-floor`, which downloads the VS Code version named by `engines.vscode`, runs the extension in it and inspects the live webview. The three items the sweep record listed as "not verified" are now checks anyone can re-run with one command.

### Fixed

- **Mermaid lazy-load hanging forever (#75)**: when the artifact finished loading but did not register `window.__tuiMermaidBundle` (a broken or truncated build), the next retry attached a fresh `load` listener to a `<script>` element that had already fired `load` (an element fires `load`/`error` exactly once), so the promise never settled and every diagram sat at "Rendering..." with no error. A settled element is now removed from the DOM and the "executed but did not register" failure is latched for the lifetime of the page: later calls reject immediately instead of re-downloading the same broken bytes (a webview reload picks up the fixed build); network failures still remove the element and stay genuinely retryable; and every load failure surfaces through the placeholder's existing `.mermaid-err-msg` instead of hanging. Concurrent callers still share exactly one load and one registration (evidenced by a five-scenario jsdom probe)
- **Packaging**: `.vscodeignore` excluded `.agent/**` but not `.agents/**`, so `.agents/skills/create-readme/SKILL.md` was shipping inside the .vsix; the extension package is now 13 files, all of them things a user needs
- **File search threshold**: the old `-1000` value (a fuzzysort v1/v2-era number) evaluates to `NaN` on the new scale, which had silently disabled filtering long ago; it is now `0` (today's behaviour unchanged, but the option finally states it honestly)
- **Frontmatter round-trip (#74)**: untouched frontmatter is now saved back byte for byte. Three forms used to be corrupted: `---` immediately followed by `---` (both delimiters lost), `---`, blank line, `---` (both delimiters lost), and the implicit form (the blank line before the separator lost). Cause: `parseContent()` discarded the original block, so `reconstructContent()` could not tell "no frontmatter" from "empty frontmatter". Parsing now also returns `rawBlock` (the raw text of the block, delimiters included, plus the whitespace between block and body) and reconstruction replays it verbatim while the frontmatter has not been edited through the metadata panel; that whitespace keeps its original shape (none, one, or several blank lines), and trailing spaces on a delimiter line (`---` ) survive too. Validity is unchanged for every form

## \[2.14.0\] - 2026-06-10

### Changed

- **Tiptap upgrade 3.19 → 3.26**: All 13 `@tiptap/*` packages moved to 3.26.0. Main improvements:
  - Fixed markdown roundtrip of overlapping bold/italic
  - Fixed HTML entity (`&lt;`, `&gt;`, `&amp;`) roundtrip
  - Fixed backslash-escape handling (`\*`, `\_`, `\\`) on parse and serialize
  - Fixed content inside angle-bracket tags being swallowed
  - Fixed marks of the same type with different attributes being merged
  - Fixed image drag creating a duplicate
  - Improved placeholder performance on large documents
  - Fixed a memory leak in Editor.destroy()

## \[2.13.0\] - 2026-06-08

### Added

- **Open Image in New Tab**: A new button on local image hover opens the file in a VSCode editor tab (using the default editor for that type, e.g. the Excalidraw plugin for `.svg`). Local images only; base64 images and http(s) URLs do not get the button. (#62)

## \[2.12.0\] - 2026-05-21

### Improved

- **File Search**: Fuzzy matching for @ mention and \[\[ wiki link (fuzzysort)
- **File Search**: Proximity scoring favours files near the open document
- **File Search**: File type icons (10 groups) in the popup
- **File Search**: Wiki links now filter on the path too, not just the filename
- **File Search**: Uses the VSCode `files.exclude` setting instead of a fixed exclude list
- **File Search**: Limit raised from 1000 to 5000 files
- **File Search**: Highlight matched characters trong popup

## \[2.11.0\] - 2026-05-21

### Added

- **Implicit Frontmatter**: Support frontmatter without opening `---` delimiter. YAML key-value pairs at file start terminated by `---` are now detected and parsed into the metadata panel. Detection uses heuristic (valid YAML object, 2+ keys, at least 1 known metadata key). File format preserved on save: implicit stays implicit, standard stays standard.
- **Editor Title Bar Toggle**: Toggle icons on VSCode editor title bar to switch between WYSIWYG and source view. `$(code)` icon when in WYSIWYG, `$(eye)` icon when in text editor. Works for `.md` and `.markdown` files.

### Changed

- **Shared frontmatter parser**: Extracted parse/reconstruct logic from `src/webview/frontmatter.ts` into `src/utils/frontmatter-parser.ts`, shared by both webview and extension bundles. Export pipeline (DOCX/PDF) now strips frontmatter via shared parser before MDAST processing.

## \[2.10.0\] - 2026-05-21

### Added

- **Wiki Link (`[[...]]`)**: Obsidian-style wiki links with `[[` trigger popup, `.md` file autocomplete, inline node rendering with file icon, Ctrl/Cmd+Click to open file, markdown roundtrip via custom MarkedJS tokenizer, DOCX/PDF export support (strips to plain text)

## \[2.9.0\] - 2026-05-14

### Added

- **File Mention (@)**: Type `@` in the editor to open an autocomplete popup listing workspace files. Select a file to insert a markdown link `[filename](path)` at cursor. Fuzzy search with prefix priority, keyboard navigation (Arrow keys, Enter, Escape), glassmorphic popup matching toolbar style. Blocked inside code blocks and email addresses.

## \[2.8.9\] - 2026-05-05

### Fixed

- **Search scroll to match (#52)**: Clicking "Search Down/Up" buttons or pressing Enter in search bar now scrolls the matched keyword to the center of the viewport. Previously, matches were found and highlighted but the page didn't scroll because ProseMirror's `scrollToSelection` bails when DOM focus is outside the editor.

## \[2.8.8\] - 2026-05-05

### Fixed

- **Lightbox touch gestures**: Two-finger drag now pans the image (when zoomed in) instead of triggering browser's default pinch-to-zoom. Disabled native touch gestures on lightbox overlay via `touch-action: none`.
- **Lightbox tap-outside-to-close**: Tapping anywhere outside the image/SVG and controls now closes the lightbox. Works for both mouse click and touch tap.

## \[2.8.6\] - 2026-04-22

### Added

- **Export to DOCX**: Export documents to Word `.docx` via `mdast2docx` + plugins (`@m2d/html`, `@m2d/image`, `@m2d/table`, `@m2d/list`). Preserves headings, lists, tables, code blocks, and images. DOCX font inherits the editor's currently selected font.
- **Export to PDF**: Export documents to WYSIWYG PDF using headless Chromium (`puppeteer-core`). Requires Chrome/Edge/Chromium/Brave installed on the system; no binary bundled with the extension. Auto-detects common paths, falls back to `tuiMarkdown.chromiumPath` or env `PUPPETEER_EXECUTABLE_PATH`.
- \*\*Setting `tuiMarkdown.chromiumPath**`: Allows manually specifying the Chrome/Edge/Chromium/Brave path for PDF export when auto-detection does not find the correct binary.

### Changed

- **PDF export rewritten with puppeteer-core**: Removed `pdfmake` + custom 339-line markdown parser + bundled Roboto font. New pipeline: MDAST → HTML (`remark-rehype` + `rehype-highlight` + `rehype-stringify`) → Chromium `page.pdf()`, delivering WYSIWYG quality matching the preview (syntax-highlighted code, GitHub tables, alerts, mermaid base64). Requires Chrome/Edge/Chromium/Brave installed on the user's machine, auto-detected via `tuiMarkdown.chromiumPath` → `PUPPETEER_EXECUTABLE_PATH` → well-known system paths. Bundle `out/export-pdf.js` tree-shakes puppeteer-core to \~2.5MB, total VSIX \~5.4MB.
- **Removed MDAST→markdown bridge for PDF**: Call sites now pass MDAST directly to both `exportToPdf` and `exportToDocx`, eliminating serialize/parse drift risk. `mdastToMarkdown` function + `remark-stringify` dependency removed.
- \*\*Mermaid `securityLevel` changed to `"loose"**`: Required for ELK + `foreignObject` to render HTML inside labels. Trade-off: generated SVG may contain raw HTML from markdown; treat mermaid from untrusted sources as potentially executable. PDF export disables JavaScript in Chromium to prevent escalation.

### Fixed

- **PDF render relative image**: Local images (`./img.png`) are now inlined as base64 before entering Chromium instead of loading from `about:blank` (which silently 404s). New pipeline walks HAST, reads files, encodes data URLs.
- **Safe frontmatter handling**: Removed manual regex stripping, using `remark-frontmatter` in the MDAST pipeline for proper frontmatter parsing. BOM \`\`﻿ is still stripped before parsing.
- **Mermaid hash CRLF/LF mismatch**: `hashMermaidCode` normalizes line endings `\r\n|\r` → `\n` before trimming, ensuring CRLF files do not miss mermaid export.
- **DOCX remote fetch timeout**: `AbortController` 30s + `content-length` / `arrayBuffer.byteLength` check capped at 10MB. Failed fetches (timeout, HTTP error, oversized) → placeholder 1x1 PNG instead of aborting the entire export.
- **DOCX missing local image**: `fs.readFile` failure no longer crashes the entire export; replaced with placeholder + log warning. SVG images also fall back to placeholder instead of throwing.
- \*\*DOCX filename with literal `%**`: `decodeURIComponent("50%_off.png")` throwing `URIError` no longer crashes export; wrapped with try/catch, falls back to raw path.
- **Export button race duplicate**: Extension tracks `exportInProgress` flag; a second request while exporting is rejected with dialog "Export in progress, please wait". Webview re-enables button via `exportDone` message instead of relying on a fixed 3s timeout.
- **Empty document warning**: Exporting an empty file or one with only frontmatter shows warning "Document is empty, nothing to export" instead of silently generating an empty file.
- **PDF font-family CSS context**: User-selected font is now sanitized via whitelist `[A-Za-z0-9 _-]` instead of `escapeHtml` (CSS `<style>` does not decode HTML entities; previously fonts with `"` made the declaration invalid).
- **PDF Chromium sandbox conditional**: `--no-sandbox` only passed on Linux + root; macOS/Windows/Linux users keep default Chromium isolation.
- **PDF strip dangerous HTML**: Removes `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<meta http-equiv>` before feeding to Chromium (supplements `setJavaScriptEnabled(false)`).
- \*\*PDF `waitUntil: "networkidle0"**`: Changed from `"load"` to `"networkidle0"` to wait for all images to load before `page.pdf()` runs.
- \*\*PDF `rehype-highlight` `detect: false**`: Only syntax-highlights code blocks with a language specified. Reduces CPU on large documents.
- **Open Folder after export**: Uses `vscode.commands.executeCommand("revealFileInOS", ...)` instead of `openExternal(folder)` to reveal the correct file in Finder/Explorer cross-platform.
- **More robust Chromium discovery**: Checks `fs.constants.X_OK` in addition to `isFile()` to filter non-executable paths; strips extra quotes around `chromiumPath` if user pastes `"C:\...\chrome.exe"` verbatim.
- **Chromium cache invalidation on setting change**: `onDidChangeConfiguration` listens for `tuiMarkdown.chromiumPath` → calls `clearChromiumCache()`, no window reload needed.
- **Friendly Puppeteer launch error message**: Wraps launch error as "Failed to launch Chromium at `<path>`: . Check execute permission or configure tuiMarkdown.chromiumPath."
- **SVG zero-dimension fallback**: `svgToPngBlob` uses 800×600 fallback + console.warn when SVG has no width/height/viewBox, instead of throwing silently.
- **Git Graph diff blocked ([#48](https://github.com/hoangvantuan/tui-milkdown-vscode/issues/48))**: Added `git-graph` scheme to `configurationDefaults.workbench.editorAssociations` so TUI Markdown does not block opening markdown files when viewing diffs from Git Graph plugin. Previously only `git` and `gitlens` were excluded.

## \[2.8.5\] - 2026-04-22

### Added

- **Copy Mermaid as PNG**: "Copy" button appears on mermaid preview hover (next to expand button) and in the lightbox toolbar. Click renders SVG to PNG bitmap (2x scale for retina) and writes to clipboard via `navigator.clipboard.write` + `ClipboardItem("image/png")`. Can be pasted directly into Slack, Word, Figma, Notion, Preview.app. Checkmark feedback for 1.5s on success, VS Code warning dialog on error. Button auto-hides on `.mermaid-error`, editing mode, and regular image lightbox mode.

## \[2.8.4\] - 2026-04-18

### Fixed

- **Remove extraneous files from package**: Updated `.vscodeignore` to exclude dev files (`.agent`, `.github`, `.mcp.json`, `_bmad`, `AGENTS.md`, `.gitnexus`, `skills-lock.json`, `.DS_Store`) from the extension package. Reduces package size and removes unnecessary content.

## \[2.8.3\] - 2026-04-18

### Added

- **Content Zoom**: Zoom editor content 50%–200% (10% step) via Appearance popover or Ctrl/Cmd +/-/0 shortcuts. Only zooms `.tiptap` element — toolbar, TOC, metadata panel stay at native size. Zoom level persisted globally via `context.globalState`.
- **Appearance Popover**: Consolidated zoom, theme, and font controls into a single popover behind a gear icon on the right side of the toolbar. Prevents toolbar wrapping on narrow viewports (split-view).
- **View Source Icon**: View Source button changed from text button to `</>` SVG icon using unified `toolbar-btn` class.

### Fixed

- **Popover Dark Theme Contrast**: Input surfaces inside popover now use VS Code native `--vscode-editorWidget-*` variables instead of toolbar glass styling, fixing unreadable controls on dark themes.
- **Font Selector Escape Propagation**: Added `stopPropagation()` to font dropdown Escape handler, preventing parent popover from closing simultaneously.
- **Popover Viewport Overflow**: Added `max-width: calc(100vw - 16px)` to prevent popover from overflowing on narrow panels.

## \[2.8.2\] - 2026-04-13

### Fixed

- **Mermaid SVG Clipping**: Allow `foreignObject` labels in mermaid diagrams to render beyond the bounding box (apply `overflow: visible` to SVG and all child elements inside `.mermaid-svg-host`), fixing labels being clipped at diagram edges.

## \[2.8.1\] - 2026-04-13

### Added

- **Mermaid Diagram Fullscreen Lightbox**: Expand button on mermaid preview hover opens the diagram in a fullscreen viewer with zoom (buttons, mouse wheel, `+`/`-`/`0` keys, `Esc` to close) and pan by dragging when zoomed in. Reuses the image lightbox infrastructure.

## \[2.8.0\] - 2026-04-02

### Added

- **Paper Theme**: Warm white, serif font, book-like reading experience (light)
- **Midnight Theme**: Deep navy (#0d1117) for comfortable night writing (dark)
- **Image Lightbox**: Fullscreen overlay with zoom controls (0.5x–4x via buttons, scroll, keyboard), expand button on image hover, caption from alt text
- **Toolbar Auto-hide**: Opt-in setting `tuiMarkdown.autoHideToolbar` — hides toolbar after 3s of inactivity, reveals on hover or keyboard focus
- **Reading Progress Bar**: Fixed top bar tracking scroll position in editor
- **Word Count**: Subtle indicator in bottom-right corner, updates on content change
- **Paper Texture &amp; Visual Depth**: CSS-only noise grain overlay + vignette radial gradient on editor background
- **Code Block Premium Styling**: Gradient accent bar at top, enhanced header with accent tint, font ligatures (`liga`, `calt`)
- **Premium Alert Blocks**: SVG icons replacing emoji, theme-aware colors, rounded borders with hover lift effect
- **Image Selection Indicator**: Accent-colored outline on selected images for clear visual feedback
- **Micro-interactions**: Task checkbox draw-in animation, H1/H2 gradient underline, enhanced blockquote hover, smooth table row highlight
- **Clipboard Image Fallback**: Triple-fallback strategy for image paste in VSCode webview (ProseMirror → Clipboard API → extension-side native read)
- **Accessibility**: `prefers-reduced-motion` support, high contrast mode, print stylesheet, visible focus indicators

### Changed

- Theme selection dropdown now includes Paper and Midnight (total: 12 themes)
- Link click navigation: platform-correct modifier key (Cmd on macOS, Ctrl on Windows/Linux)
- Image paste/drop logic extracted into reusable `processImagePaste()` / `getImageFromClipboard()` helpers
- All animations and transitions respect user motion preferences

## \[2.7.1\] - 2026-04-01

### Fixed

- **Font Selector Persistence**: Font selection no longer resets when switching between files — saved font now correctly persists to webview state on restore

## \[2.7.0\] - 2026-04-01

### Added

- **Font Selector**: Searchable font picker on toolbar — browse and search all system fonts with live preview, persisted across sessions (does not affect code font)

## \[2.6.3\] - 2026-03-31

### Added

- **Page Break Visual**: `---` horizontal rule now renders as a modern page break separator with dashed line, `✦ PAGE BREAK ✦` label, and accent color hover effect — clearly separates content into distinct sections
- **Page Break Toolbar**: Updated toolbar button icon and label from "Horizontal Rule" to "Page Break"
- **Floating Editor Canvas**: Editor now floats on a subtle gradient canvas background with layered shadow elevation — creates a refined "paper on desk" aesthetic inspired by premium writing apps
  - Per-theme `--canvas-bg` surface delta (4-5 lightness steps darker than editor background)
  - Ambient radial glow using theme accent color at 4% opacity
  - 4-layer progressive box-shadow (Josh Comeau technique) for natural elevation
  - Responsive padding on all 4 sides via `clamp(6px, 1.5vw, 24px)`
  - Editor max-width capped at 1280px with auto centering
  - All 10 themes supported with hand-tuned canvas colors
- **Responsive TOC Sidebar**: Sidebar width now scales with viewport — `clamp(180px, 15vw, 300px)` — wider on large screens, compact on small

## \[2.6.2\] - 2026-03-28

### Fixed

- **Image Path Regex**: Support nested parentheses in image paths (e.g., `path(1).png`) and angle-bracket syntax (`<path>`) in `extractImagePaths()`
- **Code Block Protection**: Skip fenced code blocks when updating image references across workspace — prevents accidental code modification
- **Path Traversal Hardening**: Decode URL-encoded characters (`%2e%2e`) before path traversal check in `hasPathTraversal()`
- **Case-Sensitive Image Delete**: Remove `toLowerCase()` from filename comparison in `detectImageDeletes()` — fixes false positives on case-sensitive file systems (Linux)
- **Search Count Stale**: Update search match count when content changes externally (e.g., another editor modifies the file)
- **Heading Collapse Persistence**: Migrate collapsed heading state when heading text is edited — headings no longer unexpectedly uncollapse on text changes

## \[2.6.1\] - 2026-03-28

### Improved

- **Keystroke Performance**: Deferred markdown serialization into debounce callback — reduces per-keystroke cost by \~50% (serialize once per 300ms instead of every keypress)
- **Heading Collapse Plugin**: Merged double doc traversal into single pass — halves node visits per keystroke
- **Mermaid Plugin**: Skip full document scan when no mermaid blocks exist; added LRU cache eviction (max 30 entries) to prevent unbounded memory growth
- **Image Map Caching**: Cached reverse image map to avoid rebuilding on every save cycle; replaced JSON.stringify echo check with lightweight version counter

### Fixed

- **Link Navigation Security**: Added workspace boundary check to prevent opening files outside workspace via path traversal (e.g., `../../../../etc/passwd`)
- **Image Edit Race Condition**: Verify image node identity (`src` attribute) before applying async rename update — prevents updating wrong node if document changed during rename
- **TOC Stale Position**: Validate heading node type before scroll to prevent navigating to wrong node during debounce window
- **Table Context Menu**: Added bounds clamping to prevent off-screen positioning; added document-level click-outside listener so clicking toolbar/TOC closes menu
- **Pending Link Edit Cleanup**: Added 60s timeout to prevent memory leak if extension never responds

## \[2.6.0\] - 2026-03-27

### Added

- **Search (Cmd+F)**: Find text in editor with `Cmd+F`/`Ctrl+F` — highlights all matches, navigate with Enter/Shift+Enter, match counter, glassmorphic search bar with slide-down animation. Powered by `prosemirror-search`.
- **Link Click Navigation**: `Ctrl+Click` (`Cmd+Click` on macOS) on links — anchor links (`#heading`) scroll to heading, relative file links open in VSCode, external URLs open in browser. Pointer cursor shown when modifier key held.

## \[2.5.1\] - 2026-03-27

### Fixed

- **Font Rendering**: Removed `-webkit-font-smoothing: antialiased` — text now renders thicker and more legible using default subpixel antialiasing

## \[2.5.0\] - 2026-03-20

### Changed

- **TOC Toggle Button**: Moved from toolbar right side to inline flex item in main layout — sits between sidebar and editor, no longer overlaps content

## \[2.4.0\] - 2026-03-19

### Added

- **Code Block Header**: Language badge with dropdown selector (19 languages) and one-click copy button with visual feedback; skips Mermaid blocks
- **Glassmorphic Toolbar**: Frosted-glass effect with `backdrop-filter: blur(12px)`, stroke-based Lucide icons replacing filled MDI icons, press-scale micro-interaction on buttons
- **Theme Accent Variables**: All 10 themes now expose `--accent-primary`, `--accent-rgb`, `--toolbar-bg-rgb`, `--border-rgb`, `--toolbar-fg` for consistent UI outside `.tiptap`
- **Link Hover Animation**: Underline slides in via `background-size` transition (replaces `border-bottom`)
- **Selection Highlight**: `::selection` uses theme accent color
- **Gradient HR**: Horizontal rule fades to transparent at edges
- **Custom Scrollbar**: Thin 6px scrollbar for editor, 4px for TOC sidebar
- **High Contrast Support**: `prefers-contrast: more` media query adds visible borders and underlines
- **Smooth Theme Transitions**: Background and text color animate on theme switch (0.3s ease)

### Changed

- **Toolbar Styling**: Custom `appearance: none` selects with SVG chevron, unified `border-radius: 6px`, reduced gap (4px → 2px)
- **Editor Padding**: Fixed padding replaced with fluid `clamp(24px, 5vw, 80px)`; bottom padding increased to `40vh` for comfortable writing
- **TOC Sidebar**: Removed H1-H6 depth filter buttons for cleaner UI; simplified API (`setupTocSidebar` no longer takes `depthFilter` param)
- **TOC Scroll**: Uses `view.nodeDOM()` with 60px top offset for precise heading positioning
- **TOC Active State**: Accent-colored highlight with inset left border (`box-shadow: inset 2px 0 0`)
- **Inline Code Background**: Uses `--border-rgb` variable for subtle theme-aware background
- **Table Header**: Subtle accent tint on `<th>` cells
- **Image Hover**: Enhanced shadow + micro-scale (1.003×), removed separate light/dark hover rules

### Removed

- **TOC Depth Filter**: `setTocDepthFilter()`, `getTocDepthFilter()` exports and related UI (H1-H6 toggle buttons)
- `**tocDepthFilter` state\*\*: No longer persisted in `vscode.setState()`

## \[2.3.1\] - 2026-03-19

### Fixed

- **Task List Nested Layout**: Fixed `display: flex` leaking to nested list items inside task lists, causing paragraphs and code blocks to render side-by-side instead of vertically stacked. Changed CSS selectors from descendant to direct child combinator (`ul[data-type="taskList"] > li`)

## \[2.3.0\] - 2026-03-19

### Added

- **Table of Contents Sidebar**: Toggleable TOC panel inside the editor with click-to-scroll navigation, active heading highlight, H1-H6 depth filter, collapse/expand sections, and state persistence
- **Heading Collapse/Expand**: Visual-only toggle arrows on H1-H6 headings to collapse/expand content sections until next same-or-higher-level heading; hover heading badge to reveal toggle arrow; state persisted across webview reloads

### Fixed

- TOC button moved to right side of toolbar for better visibility
- Sidebar visibility deferred until content populated (no empty box flash)
- Click-to-scroll now scrolls heading to top of viewport
- `setTheme()` no longer overwrites TOC state in `vscode.setState()`
- Debounced TOC rebuild (200ms) to avoid DOM rebuild on every keystroke
- Removed duplicate heading extraction on selection change and initial load
- Responsive sidebar width (180px) on narrow viewports

## \[2.0.9\] - 2026-03-19

### Changed

- **Typography Redesign**: Perfect Fourth heading scale (1.333 ratio), line-height 1.6, generous heading margins for clear section grouping
- **Responsive Content Width**: 760px default (65-70 chars/line), adaptive for narrow panels, tables can overflow with scroll
- **Editor Padding**: Increased to 32px/48px for document-like feel
- **Blockquote Style**: Clean border (primary color) + no background, subtle hover effect
- **Link Style**: Underline replaced with animated border-bottom on hover
- **Table Enhancement**: Larger cell padding (10px 14px), row hover highlight, zebra striping
- **Code Blocks**: Focus ring on edit, hover border, increased padding
- **HR Spacing**: 32px margin (was 16px) with 50% opacity for softer separation
- **Image Polish**: 6px border-radius, subtle shadow on hover

### Added

- **Modern CSS**: `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, ligatures (`font-feature-settings`), `font-optical-sizing`, `-webkit-font-smoothing: antialiased`
- **Micro-interactions**: Toolbar button transitions (0.15s), heading badge hover opacity, line highlight transition, task checkbox fade
- **Reduced Motion**: `prefers-reduced-motion` media query disables all animations

### Fixed

- **Nord Dark Inline Code WCAG**: `#bf616a` (3.05:1) → `#d08770` Aurora orange (\~4.8:1) — now passes WCAG AA
- **Frame Light Colors**: Softer text (#1a1b1e), blue links (#2563eb), lighter borders (#d0d5dd), warmer inline-code (#c4432b)
- **Frame Dark Colors**: Blue-tinted background (#1a1b1e), blue accent links (#6b9fff), cooler surface (#141518), softer inline-code (#f97583)

## \[2.0.8\] - 2026-03-05

### Changed

- **Theme Font Overhaul**: Replaced static `"Noto Sans"` with `system-ui` stack across all themes — delivers the OS's native reading font (San Francisco on macOS, Segoe UI on Windows) without requiring font installation
  - Frame / Frame Dark: `Noto Sans` → `system-ui` stack; code font: `Space Mono` → `Cascadia Code` (bundled with VS Code)
  - Nord / Nord Dark: `Noto Sans` → `system-ui` stack; code font: `Space Mono` → `Cascadia Code`
  - Catppuccin (Latte, Frappé, Macchiato, Mocha): `Noto Sans` → `system-ui` stack
  - Crepe / Crepe Dark: switched to `ui-serif` first (New York on macOS), then `Source Serif 4 → Georgia` as fallback; code font: `Space Mono` → `Cascadia Code`
- **Nord Dark — Real Nord Palette**: Replaced generic dark-gray colors with official Nord palette
  - Background `#1b1c1d` → `#2e3440` (Polar Night 1), surface → `#3b4252`, outline → `#4c566a`, primary → `#88c0d0` (Frost teal), inline-code → `#bf616a` (Aurora red)
  - Nord Dark now visually distinct from Frame Dark (previously near-identical)

### Fixed

- **Frame Light Outline Contrast**: `--crepe-color-outline` `#a8a8a8` → `#767676` (now passes WCAG AA 4.5:1 on white background)

## \[2.0.7\] - 2026-02-12

### Improved

- **Mermaid Diagram Selective Reload**: Switching between edit/view mode no longer re-renders all diagrams — only the changed diagram re-renders. Preserves widget DOM elements on selection changes for a smoother, flicker-free experience

## \[2.0.6\] - 2026-02-12

### Added

- **Table Right-Click Context Menu**: Right-click on any table cell to access Select Row/Column/Table, Add Row Above/Below, Add Column Before/After, and Delete Row/Column/Table actions
- **Cell Selection Highlight**: Drag-selecting across table cells now shows a visual highlight overlay (blue tint), supporting both light and dark themes

## \[2.0.5\] - 2026-02-12

### Fixed

- **Inline Code Exit in Table Cells**: Added `CodeExitHandler` extension so pressing ArrowRight at the end of an inline code span exits the code mark, allowing users to continue typing normal text (previously stuck in code formatting inside table cells)

## \[2.0.4\] - 2026-02-12

### Added

- **Mermaid Diagram Rendering**: Code blocks with `mermaid` language are now rendered as live SVG diagrams with automatic theme syncing (light/dark), error display, and caching
- **GitHub-Style Alerts**: Blockquotes starting with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` render as color-coded alert boxes with icons and dark theme support
- **Tab Indentation in Code Blocks**: Enabled tab key for indentation inside code blocks (2-space tab size)

## \[2.0.3\] - 2026-02-12

### Changed

- **Theme Font Configuration**: Updated fonts across all themes for improved markdown readability
  - Frame / Frame Dark: Noto Sans → Inter, Space Mono → JetBrains Mono
  - Crepe / Crepe Dark: Open Sans → Source Serif 4 (serif for warm reading experience)
  - Catppuccin (Latte, Frappé, Macchiato, Mocha): Noto Sans → Inter, Space Mono → Cascadia Code
  - Nord / Nord Dark: unchanged (already Inter + JetBrains Mono)
  - Updated default fallback font from Noto Sans to Inter
- **Blockquote Styling**: Added `overflow: hidden` to prevent line-highlight from bleeding outside blockquote boundaries
- **Line Highlight Cursor**: Extended highlight area with padding offsets (`-4px` all sides) and `border-radius: 3px` for a more comfortable, less cramped appearance

## \[2.0.2\] - 2026-02-12

### Changed

- **Table Cell Padding**: Made table content more compact by adjusting cell padding and adding specific spacing for elements within table cells
- **Heading Margins**: Adjusted heading top margins and introduced bottom margins for h1-h6 elements for improved readability

## \[2.0.0\] - 2026-02-07

### Added

- **Formatting Toolbar**: Full markdown toolbar with grouped buttons for text formatting (Bold, Italic, Strikethrough, Inline Code, Highlight), heading select (Paragraph/H1-H6), lists (Bullet, Ordered, Task), block elements (Blockquote, Code Block, Horizontal Rule), table insert, and link insert
- **Table Context Actions**: Add column before/after, add row below, delete column/row/table - buttons appear only when cursor is inside a table
- **Toolbar Active States**: Buttons highlight to reflect current formatting at cursor position
- 10MB image size limit on paste/drop with warning dialog
- showWarning message type for webview-to-extension warnings
- Custom table markdown serializer (`table-markdown-serializer.ts`) - preserves multi-line cell content with `<br>` tags via `renderMarkdown` hook
- Table cell content parser (`table-cell-content-parser.ts`) - post-parse transformer converts `<br>` → paragraphs, \`\`  → hardBreak, and list patterns (`- item`, `N. item`, `[x] item`) → proper list nodes
- Path traversal security check for `imageSaveFolder` configuration
- Race condition guard (`renameInProgress`) for image rename operations
- Image edit overlay MutationObserver now filters for image-related changes only, with debounce
- Tiptap Markdown reference documentation (`docs/tiptap-markdown-reference.md`) - API spec, extension patterns, tokenizer guides

### Changed

- **Blank line roundtrip**: Empty paragraphs now roundtrip via MarkedJS `space` token parsing (`BlankLineHandler`) and custom `Document` serializer, replacing the `<br>` hack + `convertBrOnlyParagraphsToEmpty` post-parse step
- **Editor Engine Migration: Milkdown Crepe -&gt; Tiptap**
  - Replaced Milkdown Crepe with Tiptap (`@tiptap/core` + `@tiptap/markdown`) for markdown roundtrip
  - Content updates use `editor.commands.setContent()` - no destroy/recreate, eliminates UI flash
  - Cursor position preserved across external document changes
  - Syntax highlighting for code blocks via lowlight (highlight.js), replacing CodeMirror
  - Image paste/drop via Tiptap's `editorProps.handlePaste`/`handleDrop`
  - Auto-link paste URL now handled by `@tiptap/extension-link` (`autolink: true, linkOnPaste: true`)
  - Task list (checkbox) support via `@tiptap/extension-list` (TaskList + TaskItem)
  - Table resizing support via `@tiptap/extension-table` with custom markdown serializer for multi-line cells
  - Placeholder text via `@tiptap/extension-placeholder`
  - Highlight (mark) support via `@tiptap/extension-highlight`
- **Extension Rename**
  - Renamed from "Milkdown Markdown WYSIWYG" to "TUI Markdown Editor"
  - Updated all CSS selectors from `.milkdown` to `.tiptap`
  - All 10 theme CSS files simplified - removed unused CSS variables
- **CSS Architecture**
  - Dark theme overrides consolidated using `body.dark-theme` selector (set by `applyTheme()`)
  - Base Tiptap styles (outline, fonts, colors, placeholder, blockquote, hr, links, tables) added inline
  - Task list checkbox styling with font-scale support
- DRY - extracted shared cleanImagePath utility
- Removed debug console.log statements from production code

### Fixed

- Echo loop after image save causing editor re-parse and cursor loss
- Image path transforms now context-aware (only within image/link syntax, not plain text)
- handleDrop inserts images at correct block boundary position
- SVG image paste generates correct .svg extension (not .svg+xml)
- Workspace reference updates now context-aware (won't replace paths in code blocks)
- Line highlight plugin: corrected node type `list_item` -&gt; `listItem` (Tiptap camelCase convention)
- Image regex: improved HTML `<img>` matching (`<img\s[^>]*?src=` prevents false positives)

### Removed

- Removed `@milkdown/crepe` and `sharp` dependencies
- Removed `paste-link-plugin.ts` (replaced by built-in Link extension)
- Removed `convertBrOnlyParagraphsToEmpty` post-parse step (replaced by `BlankLineHandler` extension)
- Removed Milkdown-specific hardbreak rendering CSS hack
- Removed CodeMirror-related CSS (`.cm-editor`, `.cm-content`)
- Removed unused CSS variables from theme files (\~15 per theme)
- Removed unused code: `hasFrontmatter()`, `showLoading()`, `currentTheme` variable

## \[1.5.5\] - 2026-02-06

### Fixed

- **Inline Hardbreak Rendering**
  - Single newlines (soft breaks) now display as visual line breaks instead of inline spaces
  - Added CSS to collapse inline hardbreak `<span>` elements into block-level breaks
- **Concurrent Editor Initialization**
  - Added `isEditorInitializing` guard to prevent overlapping editor init/recreate calls
  - Flush microtasks between destroy and create to avoid stale state
  - Skip `update` messages while editor is still initializing
- **CSP Font Source**
  - Added `data:` to `font-src` CSP directive to support data URI fonts

## \[1.5.2\] - 2026-01-27

### Fixed

- **Editor Initialization Loop**
  - Fixed editor recreating 15+ times on document load (echo loop prevention)
  - Track content + imageMap keys together to detect echo from edits
  - Debounce `updateWebview()` calls (50ms) to prevent rapid updates
  - Guard `editorViewCtx` access to avoid "Context not found" errors
  - Cancel pending debounced edits when destroying editor

## \[1.5.1\] - 2026-01-25

### Added

- **Heading Level Indicator**
  - Displays H1-H6 badges next to headings for quick level identification
  - Subtle styling with muted colors
  - Supports all 10 themes (light and dark)

## \[1.5.0\] - 2026-01-24

### Added

- **Auto-link Paste URL**
  - When text is selected and you paste a URL, automatically converts to markdown link `[selected text](url)`
  - Supports http/https URLs only
  - Replaces existing link URL if selection is already a link
  - Intelligently skips paste events with files (images handled by image upload)
- **Image Upload &amp; Paste Support**
  - Paste images from clipboard directly into the editor
  - Drop images or pick via drag-and-drop
  - Images saved automatically to configurable folder
  - Configurable via `tuiMarkdown.imageSaveFolder` setting (default: `images`)
  - Use `.` for same folder as document
- **Local Image Display**
  - Renders local images from document folder and workspace
  - Supports both relative and absolute paths
  - Automatic path resolution for webview display
- **Image URL Editing**
  - Hover on image to show edit icon (pencil button)
  - Double-click on image to edit URL/path via VSCode input box
  - Shows original path instead of webview URI
- **Auto Rename Images**
  - Automatically rename image files when you change the path in Markdown
  - Only triggers when image folder remains the same
  - Updates all references in workspace `.md` files
  - Configurable via `tuiMarkdown.autoRenameImages` setting (default: true)
- **Auto Delete Images**
  - Automatically delete image files when removed from markdown
  - Moves files to Trash (recoverable)
  - Shows warning if image is used in other `.md` files
  - Configurable via `tuiMarkdown.autoDeleteImages` setting (default: true)

### Fixed

- Fixed cursor position loss when deleting images (editor no longer recreates on imageMap changes from user edits)

### Changed

- Image edit icon now shows when hovering anywhere on image block (not just the image itself)
- Extended `localResourceRoots` to include document folder and workspace for image loading

## \[1.4.0\] - 2026-01-24

### Added

- Catppuccin theme palette with 4 variants
  - Catppuccin Latte (light)
  - Catppuccin Frappé (dark, subdued)
  - Catppuccin Macchiato (dark, medium contrast)
  - Catppuccin Mocha (dark, original)

## \[1.3.1\] - 2026-01-24

### Added

- Table auto-width CSS for proportional column sizing
  - Columns size automatically based on content
  - Table spans full editor width
  - Cell text wraps naturally for responsive display

## \[1.3.0\] - 2026-01-24

### Added

- Cursor line highlight with theme support
  - Highlights current block/paragraph containing cursor
  - Individual list item highlighting (not entire list)
  - Skips code blocks (they have built-in highlighting)
  - Configurable via `tuiMarkdown.highlightCurrentLine` setting
- Responsive max-width layout (1200px) for editor content on large screens
  - Improves readability on 4K/ultrawide monitors
  - Full-width on screens ≤1200px (split view compatible)
- Collapsible metadata panel for editing YAML frontmatter
- YAML validation with line number error display
- "Add Metadata" button when document has no frontmatter
- Bidirectional sync between metadata panel and editor
- Tab key support in metadata textarea (inserts 2 spaces for YAML indentation)
- `js-yaml` dependency for frontmatter parsing and validation

## \[1.2.1\] - 2026-01-24

### Fixed

- Fixed heading margin-top values for better visual spacing (h1:24px, h2:20px, h3:16px, h4:12px, h5:8px, h6:8px)

## \[1.2.0\] - 2026-01-24

### Changed

- Optimized build configuration with production/development modes

## \[1.1.0\] - 2026-01-23

### Added

- Configurable font sizes for each heading level (h1-h6, range 12-72px)

### Fixed

- Disable WYSIWYG editor in git diff view, use default text diff instead

## \[1.0.1\] - 2026-01-23

### Changed

- Add editor padding (10px top/bottom, 40px left/right)
- Improve line-height from 20px to 24px for better readability
- Add `*.vsix` to .gitignore

## \[1.0.0\] - 2026-01-23

### Added

- Initial release
- WYSIWYG markdown editing with Milkdown Crepe
- Theme selection (Nord, GitHub, Tokyo Night, etc.)
- View source toggle
- Large file warning (&gt;500KB)
- Configurable font size (8-32px)
- Support for .md and .markdown files