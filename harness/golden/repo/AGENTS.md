This file is a **map**, not an encyclopedia. It tells you where things are and how they connect. The source is the reference: every module starts with a header comment stating its role, and the reason behind a non-obvious choice is a comment at the code site, not a separate document.

## Project Overview

VSCode extension providing WYSIWYG Markdown editing using Tiptap editor with @tiptap/markdown. Opens `.md` files in a custom editor with theme selection and view source functionality.

## Commands

```bash
npm run build      # Production build (minified, no sourcemaps)
npm run build:dev  # Development build (with sourcemaps, unminified)
npm run watch      # Watch mode for development
npm run lint       # TypeScript type checking (tsc --noEmit)
npm test           # Unit tests via node:test (extension-host pure functions, see test/)
                   # The glob is load-bearing: Node 22, the version CI runs, reads a bare
                   # `out/test/` as a module path and fails; only newer Node treats it as a directory
npm run roundtrip  # Markdown roundtrip harness: corpus vs golden baselines (see harness/README.md)
npm run roundtrip:update  # Re-capture golden baselines (deliberate use only)
npm run verify:vscode-floor  # Run the extension on the VS Code version in engines.vscode (see harness/vscode-floor/)
npm run package    # Package extension as .vsix
```

## Architecture

**Dual-bundle build** using esbuild (`esbuild.config.js`):

- Extension bundle: `src/extension.ts` → `out/extension.js` (CJS, Node platform)
- Webview bundle: `src/webview/main.ts` → `out/webview/main.js` (IIFE, browser platform)

**Extension ↔ Webview communication flow:**

1. Extension registers `CustomTextEditorProvider` for `.md` files
2. When document opens, provider creates webview with HTML template containing editor container
3. Webview sends `ready` → Extension sends `theme`, `config`, `update` (content)
4. User edits → Webview debounces (300ms) → sends `edit` message → Extension applies `WorkspaceEdit`
5. External document changes → Extension sends `update` → Webview calls `editor.commands.setContent()` (no destroy/recreate)

## File Structure

```
src/
├── extension.ts              # Entry point, registers MarkdownEditorProvider + viewSource/viewRichText commands
├── markdownEditorProvider.ts # CustomTextEditorProvider: HTML template + wiring; the per-document work is in src/host/
├── host/                     # Extension-host side of resolveCustomTextEditor (#88)
│   ├── session.ts            # EditorSession: per-document state behind behaviour methods (withPendingEdit, withExportLock, applyEdit, dispose); the flags are private (#146)
│   ├── messageHandlers.ts    # Handler table keyed by WebviewToHostMessage["type"] + dispatchMessage
│   ├── typedWebview.ts       # TypedWebview — here, not shared/messages.ts, which must stay free of `vscode`
│   ├── config.ts             # tuiMarkdown.* getters, buildConfigMessage, handleConfigurationChange
│   ├── imagePaths.ts         # extractImagePaths / resolveImagePath / buildImageMap / buildOriginalImageMap
│   ├── lineEndings.ts        # normalizeLineEndings (re-exported by the provider for harness/crlf-seam.ts)
│   ├── documentSave.ts       # onDidSaveTextDocument: image delete detection + map rebuild
│   ├── workspaceFiles.ts     # buildExcludePattern / getDocFolder for the @ and [[ pickers
│   ├── openLocalFile.ts      # openLocalFileInEditor, shared by openLink and openImageInTab
│   ├── savedPreferences.ts   # ready: replay the saved theme/font/zoom
│   ├── systemFonts.ts        # System font enumeration (module-level cache)
│   ├── saveImage.ts          # saveImage: filename + folder validation, write, reply
│   ├── readClipboardImage.ts # Native clipboard read (osascript / PowerShell / xclip)
│   ├── requestImageRename.ts # Rename on disk + rewrite this document + workspace references
│   ├── openWikiLink.ts       # [[name]] resolution and open; creates the file when nothing resolves (#123)
│   ├── backlinks.ts          # Workspace scan for [[wiki]] and @ references to the open document (#134)
│   ├── imageUsage.ts         # Workspace scan filling ImageDelete.usedInFiles, by resolved path (#126)
│   ├── imageLedger.ts        # ImageLedger: one per docKey, owns the image path baseline that rename and delete detection compare against (#144)
│   ├── defaultEditor.ts      # QuickPick writing workbench.editorAssociations for the workspace (#122)
│   └── exportDocument.ts     # export: busy lock, synchronous read, lazy require of the renderers
├── constants.ts              # Shared constants (MAX_FILE_SIZE)
├── shared/
│   └── messages.ts           # Type-only message protocol: WebviewToHostMessage / HostToWebviewMessage
├── utils/
│   ├── getNonce.ts           # CSP nonce generator
│   ├── clean-image-path.ts   # Shared image path cleaning utility (removes titles, angle brackets)
│   ├── frontmatter-parser.ts # Shared frontmatter parse/reconstruct (standard + implicit format)
│   ├── image-rename-handler.ts # Image rename/delete detection, execution, workspace reference updates
│   ├── markdown-destination.ts # Link/image destination escaping (wraps paths with spaces in <...>)
│   ├── markdown-ast.ts       # Shared MDAST pipeline (parse + mermaid image substitution)
│   ├── export-docx.ts        # MDAST → DOCX via mdast2docx (lazy-loaded bundle)
│   ├── export-pdf.ts         # MDAST → HTML → Chromium page.pdf (lazy-loaded bundle)
│   ├── vscode-resource.ts    # Detect webview resource URLs and recover the local file path
│   └── chromium-discovery.ts # Locate Chrome/Edge/Chromium/Brave executable for PDF export
└── webview/
    ├── main.ts               # Browser-side Tiptap editor
    ├── extension-factory.ts  # buildMarkdownExtensions(): the ONE definition of the markdown-relevant extensions, called by initEditor and by harness/editor.ts (#143, #145)
    ├── editor.css            # Editor stylesheet, loaded before the themes (moved out of the provider, #86)
    ├── css-modules.d.ts      # Ambient declaration so esbuild CSS imports type-check
    ├── markdown-destination.ts # Tiptap Link/Image with destination-safe markdown serialization
    ├── markdown-text-escape.ts # One override of MarkdownManager text escaping, carries the footnote, ordered-task, entity and block-marker rules (#97, #99, #100, #101)
    ├── raw-html.ts            # rawHtmlBlock / rawHtmlInline, keep unrecognized HTML verbatim (#96)
    ├── ordered-list-extension.ts # CustomOrderedList: tokenizer override counting the marker separator (#109)
    ├── list-keymap-extension.ts # Tab/Shift-Tab list behaviour and typed-marker absorption (#107)
    ├── frontmatter.ts        # YAML parsing & validation utilities
    ├── alert-extension.ts    # GitHub-style alert blocks ([!NOTE], [!TIP], etc.); an optional title after the marker is a raw-string attribute
    ├── mermaid-plugin.ts     # Mermaid diagram rendering (SVG preview, view/edit mode, caching)
    ├── mermaid-bridge.ts     # Lazy-loads the mermaid artifact with the page nonce (retry/latch semantics)
    ├── artifact-bridge.ts    # The same load semantics, reusable: loadArtifact("katex" | "dragHandle" | "emoji") (#85)
    ├── tiptap-globals.ts     # Publishes Tiptap + ProseMirror on window so a lazy artifact reuses the page's single instance (#85)
    ├── katex-loader.ts       # Separate esbuild entry → out/webview/katex-loader.js (KaTeX only; CSS and fonts are copied assets)
    ├── drag-handle-loader.ts # Separate esbuild entry → out/webview/drag-handle-loader.js (@tiptap/extension-drag-handle)
    ├── emoji-loader.ts       # Separate esbuild entry → out/webview/emoji-loader.js (the emojibase dataset ONLY, never the schema node)
    ├── math-extension.ts     # inlineMath / blockMath, LaTeX held as a node attribute, KaTeX rendered lazily (#131)
    ├── footnote-extension.ts # footnoteReference / footnoteDefinition + hover preview (#131)
    ├── html-marks.ts         # <kbd>, <sub>, <sup> as marks, so a link can wrap them (#132)
    ├── details-extension.ts  # <details>/<summary> rendered collapsible (#132); owns insertDetails, the one insert the toolbar button and the `/` entry both call
    ├── drag-handle-plugin.ts # Block reordering; loads its artifact on first hover. Relocates nothing: upstream's own parent is already correct (#133). Sits one zoom-scaled gutter left of the block, outside the collapse arrow's strip
    ├── emoji-plugin.ts       # Emoji picker on ':', fourth consumer of suggestion-popup.ts; inserts unicode, adds no schema node (#133)
    ├── focus-mode.ts         # Hides toolbar/TOC/progress and centres the active line, on the latched rAF+timer pair (#134)
    ├── backlinks-panel.ts    # Panel listing documents that link here; appended LAST in #main-layout, so it opens on the right (#134)
    ├── mermaid-loader.ts     # Separate esbuild entry → out/webview/mermaid-loader.js (mermaid + ELK)
    ├── line-highlight-plugin.ts # ProseMirror plugin for cursor line highlight
    ├── heading-slug.ts       # headingSlug(): the ONE GitHub-style anchor slug rule, used by scrollToHeading
    ├── heading-collapse-plugin.ts # ProseMirror plugin for heading collapse/expand toggles
    ├── code-block-plugin.ts  # Code block header: language badge dropdown + copy button
    ├── image-edit-plugin.ts  # Double-click image URL editing + expand button; holds no image map of its own since #147
    ├── image-path-translation.ts # Image path translation: owns the image map, its version, the reverse cache and the display/save transforms (#147)
    ├── content-sync.ts        # Content sync: the baseline, the debounce, the flush and the ONE place an `edit` leaves the webview (#148)
    ├── image-lightbox-plugin.ts # Fullscreen image viewer with zoom controls (0.5x-4x)
    ├── svg-to-png.ts         # SVG → PNG blob via canvas + clipboard.write (mermaid copy helper)
    ├── table-markdown-serializer.ts # Custom GFM table serializer (multi-line cells)
    ├── table-cell-content-parser.ts # Post-parse transformer for table cell lists/breaks
    ├── table-context-menu.ts # Right-click context menu for table operations
    ├── search-plugin.ts      # Cmd+F search and replace via @tiptap/extension-find-and-replace (highlight, next/prev, match count, replace/replaceAll, case toggle)
    ├── slash-command-plugin.ts # `/` block insertion menu via @tiptap/suggestion, third consumer of suggestion-popup.ts (#114)
    ├── bubble-menu.ts        # Selection bubble menu via @tiptap/extension-bubble-menu (#116)
    ├── link-popover.ts       # Inline link editor at the caret; replaced the requestLinkEdit round trip (#117)
    ├── file-search-utils.ts  # Shared: fuzzy search (fuzzysort), proximity scoring, file type icons, highlight helpers
    ├── suggestion-popup.ts   # Shared suggestion popup (DOM ownership, positioning, selection, key handling)
    ├── file-mention-plugin.ts # @-mention file autocomplete via @tiptap/suggestion (popup, fuzzy filter, link insert)
    ├── wiki-link-plugin.ts   # Wiki link [[...]] autocomplete via @tiptap/suggestion (popup, filter, node insert)
    ├── font-selector.ts      # Searchable font combobox (system font enumeration, live preview, CSS sanitization)
    ├── toc-sidebar.ts        # Table of Contents sidebar (extract, tree, render, active tracking)
    └── themes/               # Theme CSS files (scoped by body class)
        ├── index.css              # Imports all theme CSS
        ├── frame.css              # Frame light theme
        ├── frame-dark.css         # Frame dark theme
        ├── nord.css               # Nord light theme
        ├── nord-dark.css          # Nord dark theme
        ├── crepe.css              # Crepe light theme
        ├── crepe-dark.css         # Crepe dark theme
        ├── catppuccin-latte.css   # Catppuccin Latte (light)
        ├── catppuccin-frappe.css  # Catppuccin Frappé (dark)
        ├── catppuccin-macchiato.css # Catppuccin Macchiato (dark)
        ├── catppuccin-mocha.css   # Catppuccin Mocha (dark)
        ├── paper.css              # Paper (light, warm serif)
        ├── midnight.css           # Midnight (dark, deep navy)
        ├── notion.css             # Notion (light, flat, callout-style alerts)
        └── notion-dark.css        # Notion Dark (#191919)
harness/                            # Dependency-verification harness (see harness/README.md)
├── editor.ts                       # Editor factory; its extensions come from src/webview/extension-factory.ts, so it mirrors nothing (#143)
├── corpus.ts                       # Corpus enumeration (synthetic fixtures + repo docs)
├── diff.ts                         # Dependency-free unified line diff
├── roundtrip.ts                    # Runner: check (default) / --update modes
├── frontmatter-seam.ts             # Frontmatter parse/reconstruct + validateYaml seam
├── filesearch-seam.ts              # File search ranking seam (diacritic ordering = recorded measurement)
├── filemention-seam.ts             # @-mention insert seam (inline insert + escaping on save)
├── table-colwidth-seam.ts          # Table column widths: <colgroup>/<col width> and cell colwidth parsing
├── placeholder-seam.ts             # Placeholder DOM writes per keystroke (the flicker measurement)
├── crlf-seam.ts                    # Line-ending normalization on save (normalizeLineEndings, CRLF/LF/mixed)
├── list-keys-seam.ts               # Tab/Shift-Tab list keymap and typed markers (#107)
├── slash-seam.ts                   # What each slash menu entry inserts, as markdown (#114)
├── replace-seam.ts                 # Document text after replace / replaceAll, per case (#115)
├── link-edit-seam.ts               # The markdown an inline link edit writes back (#117)
├── table-align-seam.ts             # The separator row a set-alignment command produces (#118)
├── img-width-seam.ts               # How an image with width/height parses and serializes (#120, #124)
├── math-footnote-seam.ts           # Math and footnote nodes: attributes in, markdown out (#131)
├── html-render-seam.ts             # <details>/<kbd>/<sub>/<sup>: node or mark, and what they serialize to (#132)
├── emoji-insert-seam.ts            # What the emoji picker writes, and that unicode is never rewritten (#133)
├── codeblock-seam.ts               # Line numbers and wrap are view state, so the fenced block is unchanged (#134)
├── image-path-seam.ts              # What the file gets for an image the view displays: map change, plugin rename, two nodes on one image (#142, #147)
├── content-sync-seam.ts            # Which edits the view posts and which it does not; a skeleton until #148 lands
├── vscode-floor/                   # VS Code floor check: run.mjs (driver + surface probes) + extension-tests.ts (in-host checks)
├── fixtures/synthetic/*.md         # One feature per fixture
└── golden/                         # Committed baselines (corpus + seams), captured on the pre-upgrade dependency tree
```

## Configuration Settings

Extension provides these settings via `tuiMarkdown.*` namespace:

- Font size (8-32px), heading sizes H1-H6 (12-72px)
- `highlightCurrentLine` (boolean, default: true) - Enable cursor line highlight
- `imageSaveFolder` (string, default: `images`) - Folder to save pasted images (relative to document)
- `autoRenameImages` (boolean, default: true) - Automatically rename image files when you change the image path in Markdown (only when folder stays the same)
- `autoDeleteImages` (boolean, default: true) - Automatically delete image files when removed from Markdown (moves to Trash). An image no other document references goes without confirmation; one that another document still references raises a prompt and is kept unless the button is pressed (#126, `src/host/imageUsage.ts`). An image whose filename reappears in another folder is treated as a move and left alone
- `autoHideToolbar` (boolean, default: false) - Auto-hide toolbar when typing (show on hover)
- `listIndent` (`"editor"` | `2` | `4` | `"tab"`, default: `"editor"`) - List and code-block indentation. `"editor"` follows `editor.insertSpaces` / `editor.tabSize` resolved for `markdown`
- `chromiumPath` (string, default: empty) - Explicit Chrome/Edge/Chromium/Brave executable for PDF export; empty means auto-discovery (`chromium-discovery.ts`)
- `exportPageSize` (string, default: `A4`) - Page size for PDF export

The command **Choose Default Editor for Markdown in this Workspace**
(`tuiMarkdown.useAsDefaultEditor`, `src/host/defaultEditor.ts`) writes
`workbench.editorAssociations` at workspace scope. It is a command rather than a
`tuiMarkdown.*` setting because the setting it drives is VS Code's own.

## Tiptap Integration

Uses `@tiptap/core` with `@tiptap/markdown` (Beta, MarkedJS-based parser) for markdown roundtrip.

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F find and replace via @tiptap/extension-find-and-replace), SlashCommand (`/` block insertion menu), BubbleMenu (selection formatting), FileMention (@-mention file autocomplete via @tiptap/suggestion), WikiLink (wiki links), WikiLinkSuggestion ([[...]] autocomplete via @tiptap/suggestion), RawHtmlBlock + RawHtmlInline (verbatim raw HTML), CustomUnderline (replaces StarterKit's Underline; parses `ins`/`u`/`text-decoration`, serializes `<ins>`, #106), CustomOrderedList (replaces StarterKit's OrderedList; tokenizer override for continuation indent, #109), MarkdownParagraph (replaces StarterKit's Paragraph; keeps a lone inline image inside its paragraph), ListKeymapExtension (Tab/Shift-Tab list behaviour, registered after StarterKit and Table, #107).

**Markdown API:**

- Parse: `new Editor({ content, contentType: 'markdown' })` or `editor.commands.setContent(md, { contentType: 'markdown' })`
- Serialize: `editor.getMarkdown()` returns markdown string
- Manager: `editor.markdown.parse()`, `editor.markdown.serialize()`, `editor.markdown.instance` (MarkedJS)
- Custom extension hooks: `renderMarkdown(node, helpers)` and `parseMarkdown(token, helpers)` on any extension

**Node naming:** Tiptap uses camelCase: `listItem`, `codeBlock`, `taskList`, `taskItem`, `tableCell`, `tableHeader`.

## Conventions &amp; Gotchas

- `pendingEdit` is private to `EditorSession` (#146): the host writes the document inside `session.withPendingEdit(fn)`, which clears the flag on a microtask, and the document-change listener reads `session.isApplyingEdit`. It is one of several layers against the edit loop, not the only one
- Webview persists state in `vscode.setState()` — MUST use spread pattern: `{ ...getState(), key: value }`
- Large files (&gt;500KB) show warning dialog
- CSP uses nonce for script execution
- `BlankLineHandler` extension handles empty paragraph roundtrip (MarkedJS `space` tokens → empty paragraph nodes)
- Task list selectors MUST use direct child combinator (`ul[data-type="taskList"] > li`) — descendant combinator leaks `display: flex` to nested items
- **The editor's zoom is a `transform: scale()`, not CSS `zoom`, and that is what keeps every rect in the pointer's coordinates.** VS Code launches Electron with `--disable-blink-features=StandardizedBrowserZoom` (in its `out/main.js`, 1.138 included), so under CSS `zoom` the pre-standard semantics apply: at zoom 1.5 a `getBoundingClientRect()` inside `.tiptap` returns real/1.5, while `MouseEvent.clientX`, `elementFromPoint` and CDP `Input.dispatchMouseEvent` use real coordinates (measured in Chrome with the same flag: an `h1` drawn at x=80 reports 53.3, a click at x=110 reports `clientX=110`). Every overlay here measures a rect inside `.tiptap` and places itself outside, so until 3.3.0 the drag handle and the bubble menu stood off their targets at every zoom but 1.0, and their floor checks stayed green because they compared two numbers off by the same factor. `scaleEditor` in `main.ts` owns the zoom now. A transform moves no layout, so it pays for two things: the column width in layout px (`.tiptap.is-zoomed` in `editor.css`), and a bottom margin of height \* (zoom - 1) kept by a ResizeObserver so the scroll range ends at the text. It writes nothing at 1.0. Do not go back to `zoom`, and do not fix a misplaced overlay by dividing by the zoom: that brings the second coordinate space back. The floor checks that read at a zoom ask the page what is under the pointer rather than trusting a rect; write new ones the same way
- Popup elements (file mention, wiki link, context menus) append to `#editor-container`, not `.tiptap`, so the editor's scale does not apply to them a second time
- Tiptap 3.30's decorations hook was considered for the collapse/code-block plugins and not adopted: widget decorations render inside the scaled `.tiptap`, so the hand-managed ProseMirror plugins stay until the zoom interaction is tested by hand
- Text escaping on save goes through ONE place: `installMarkdownTextEscape()` overrides `MarkdownManager`'s escaping rather than patching each call site. Four issues (#97, #99, #100, #101) were one defect in `escapeMarkdownSyntax`, and #99 and #101 wanted opposite things from the same rule for `[`. Add a rule there, not a new override
- `harness/editor.ts` and `initEditor()` both build their markdown-relevant extensions from `buildMarkdownExtensions()` in `src/webview/extension-factory.ts` (#143, #145), so the harness measures the rules that ship; there is no mirror to keep in step. The factory is NOT the whole editor: UI plugins (Placeholder, menus, suggestions, LineHighlight) are added by each caller, and `harness/vscode-floor/sample.md` is still not a first-pass fixed point under `roundtripMarkdown`. The webview writes no edit for it, and since #111 that is a guarantee rather than a tendency: it posts an `edit` only when the serialized content differs from `contentBaseline`, the string it last agreed with the host on. Before #111 it merely usually held, and the same SHA produced both 18/19 and 19/19. A new markdown-relevant extension goes into the factory; adding it to one caller is the old bug in a new place
- The webview posts `editor.getMarkdown()`, never the text the host handed it, so EVERY `edit` carries the serializer's normalizations. Since #148 that path is `ContentSync.postEdit()` in `src/webview/content-sync.ts`, the ONE place an `edit` leaves the webview, and it gates on `contentBaseline`, the string it last agreed with the host on. A guard at the ProseMirror layer would not do: upstream already suppresses `update` when `prevState.doc.eq(state.doc)`, so what arrives is a real document change that serializes to the same text. Two traps if you touch this: StarterKit's `trailingNode` appends its paragraph from `appendTransaction`, which does not run during construction, so the document changes on its FIRST transaction and the baseline is measured after an empty transaction that settles it; and the baseline must be re-anchored on every real post, or typing then undoing leaves the host holding the typed version. `harness/content-sync-seam.ts` measures both. The suppression latch is ONE private field on `ContentSync` since #150, raised only by `guardExtensionUpdate(fn)`, which releases it on a microtask; there is no setter, and `main.ts` keeps no copy (it kept one until #150, a bridge left standing when #147 and #148 merged, and `isUpdating()` was true if either was set). The microtask is load-bearing on both sides of the protocol: transactions dispatched by a host update run after `fn` returns but before the checkpoint drains, and on the host `applyEdit` resolving does not mean the document-change listener has run. Neither release is visible in a count of posts, because the baseline gate absorbs the extra post, so the seam READS the flag at three moments (inside, after the call returns, after one microtask) and `test/editor-session.test.ts` case 6 does the same for `withPendingEdit`. The seam also counts serializations at the first timer's deadline, which is the only reading that goes red when the debounce stops coalescing
- `verify:vscode-floor` is safe to run concurrently, since #110 — safe from corruption, which is not the same as reliable. Concurrent runs used to fail `lazy mermaid artifact loads and renders`, and that was read as load twice over: first as the probe window being too short, then as genuine contention. It was neither (#112). Concurrent runs stack VS Code windows, a covered window gets no animation frame, and the initial mermaid render was scheduled inside `requestAnimationFrame`, so nothing was ever scheduled and no budget could have helped. The render now falls back to a 50 ms timer, and the failure detail reports `scheduled=` so the two are no longer confusable. Load is not the cause of that check either; it only decides which window ends up on top. It used to derive `ws`, `ud` and `ext` from one fixed base (`/tmp/tuimd-floor`), so two runs overwrote each other's `sample.md`, shared VS Code's user-data dir and IPC socket, and the second run's startup `rmSync` deleted the first run's tree. That, not machine load, is why `document still unmodified after the hold` failed spuriously during parallel agent waves. Each run now gets its own `mkdtemp` base and stages its writes into the shared download cache before renaming them into place
- Messages between the extension host and the webview go through the typed unions in `src/shared/messages.ts`. Add a kind there, not an inline `as { type?: string }` cast; a typo on one side is then a `tsc` error
- A new message kind in `src/shared/messages.ts` must have a handler in `src/host/messageHandlers.ts`. The table is a mapped type over the union, so a missing handler is a `tsc` error rather than a message that silently does nothing at runtime. `dispatchMessage` checks `hasOwnProperty` before calling: the old `switch` fell through on an unknown `type`, but an object-literal lookup would find `constructor` or `toString` on `Object.prototype` and call it
- The image path baseline is an `ImageLedger` (`src/host/imageLedger.ts`, #144), one per `docKey`, created by the provider and shared by every panel on that document. Before #144 it was `originalImagePaths`, an outer `Map<docKey, Map<relative, absolute>>` that had to be passed whole, because `handleDocumentSave` replaced the inner map on every save and anything holding the old one silently stopped detecting renames; no automated check caught it. The ledger keeps the map private, so that trap is unrepresentable. Two rules moved inside with it and are unit-tested: `setBaseline` is the FIRST thing a save does, synchronously, before the delete prompt's `await` (#126: the prompt can wait for a human indefinitely, and re-baselining afterwards would make the next save ask about the same image again), and `applyRenames` holds the rename lock so two overlapping batches cannot race on the map
- `normalizeLineEndings` lives in `src/host/lineEndings.ts` but the provider re-exports it, because `harness/crlf-seam.ts` imports it from `src/markdownEditorProvider.ts` and a worker may not edit the harness
- The editor stylesheet is `src/webview/editor.css`, imported by `main.ts` before `themes/index.css`. That import order is the cascade order, and the provider must stay free of `<style>` blocks
- DOCX export runs in the Node extension host, so any mdast2docx plugin that touches `document` crashes it. `@m2d/html` did, which is why raw HTML is skipped rather than rendered there; PDF export renders it through `remark-rehype` with `allowDangerousHtml`
- `MarkdownImage` is configured `inline: IMAGE_IS_INLINE` once, in `src/webview/extension-factory.ts`. A link mark cannot be applied to a block-level image node without violating ProseMirror's paragraph content schema, which the inline link editor needs. It moved exactly one golden, the slash seam's image entry, from `node=image` to `node=paragraph`; no markdown fixture moved, which is the evidence that it is safe
- That `inline: true` is only half of a pair. `@tiptap/extension-paragraph`'s `parseMarkdown` unconditionally returns the lone image itself for a paragraph holding nothing else, dropping the paragraph, which is correct for a block image and produces `doc > image` for an inline one: an invalid document that throws `Called contentMatchAt on a node with invalid content` and leaves the editor unmounted for ANY file containing a standalone `![](...)`. `MarkdownParagraph` in `markdown-destination.ts` overrides that one case and is registered in both editors alongside the image. Three traps if you touch it: the flag MUST be the module constant `IMAGE_IS_INLINE`, not `this.editor.options`, because `this.editor` is `undefined` during the initial parse and the rule would then never run where it matters; the fallback branch must call the captured `Paragraph.config.parseMarkdown`, because returning `null` falls through to the manager's own wrapper and the override then looks like it works while doing nothing; and a teeth test must be run against a real mount (`verify:vscode-floor`), since `npm run roundtrip` reported 52 passed 0 failed with the editor broken. Reported upstream in `docs/upstream/tiptap-paragraph-image.md`
- `hasUnmodeledImageAttributes` in `raw-html.ts` now matches `align` only. `width` and `height` are node attributes on `MarkdownImage`, so an `<img width>` is a real image you can resize, not a raw-HTML source badge. Before #120 it was the badge, and a link wrapped around such an image was silently dropped on save (#124): a self-closing tag encloses no text for the link mark to attach to. The paired-tag cases (`<kbd>`, `<sub>`) still migrate the link inside the tag. That is wrong, it is lossless, and it is a decided `wontfix`: the cause is upstream, in how `@tiptap/markdown` closes a mark before a non-text node and reopens it after, so a mark can never wrap an atom. Do not re-derive it; `docs/upstream/tiptap-markdown-mark-around-atom.md` holds the measurements and the three workarounds that were rejected
- The webview holds no image map outside `image-path-translation.ts` (#147). Replacing the map or mutating it goes through that module, which bumps the version and drops the reverse cache in the same call; nothing else may touch the counter. That is the whole fix for #142 made structural: before it, the plugin rewrote the map while the version counter lived in `main.ts`, so `transformForSave` served a stale reverse cache and wrote a `vscode-resource` URL into the user's file. Reverse lookup matches on a canonical key, so a percent-encoded spelling of the same address still resolves
- **Never write to DOM ProseMirror owns from outside a transaction, and a widget factory that mutates its ancestor is the worst version of it.** `code-block-plugin.ts` toggled `code-wrap` / `has-line-numbers` on the `<pre>` from a click handler and re-applied it from a `queueMicrotask` inside `createHeaderWidget`. The microtask runs AFTER `DOMObserver` is re-enabled, so every restore was a foreign mutation: observe, flush, re-render, rebuild the widget, write again. The editor spun until the tab was closed. Three readings pin it and none of them is a guess: the repeated record is `attributes on PRE attr=class`, the writer is the restore step (`classList.add(code-wrap)`, 60 times in 3 seconds), and `onTokenListValue=""` on EVERY write, which is why a `contains()` guard cannot help: each render hands out a fresh `<pre>`. View state belongs in the decoration set (`Decoration.node` for the classes, the widget's own DOM for the gutter) and a toggle asks for a redraw with `tr.setMeta(codeBlockKey, ...)`, a transaction that changes no content so `ContentSync` posts no `edit`
- **A widget at `pos + 1` is inside the node's contentDOM, not beside it.** The code block header therefore lives inside the `<code>`, so the `<pre>` is its ANCESTOR: `header.parentElement.querySelector("pre")` is `null` and `header.nextElementSibling` is a lowlight `<span>`. That one wrong assumption silently broke copy, the language picker and the line-number gutter at once, and it also HID the freeze above, because the gutter's `insertBefore` threw before the handler could persist its state. Use `closest`, and build anything the header shows inside the widget element
- **A `.click()` does not reproduce an input-path defect.** The freeze needs a real `Input.dispatchMouseEvent` press AND release; the release is where it starts, because that is where `click` is synthesized. The floor check `a code block header button click leaves the renderer responsive` presses both header buttons and reads liveness after each, with a press on an ordinary paragraph first so a hang cannot be blamed on the dispatch. Synthetic events are NOT reliable for asking WHICH element is at fault: they pass straight through anything with `pointer-events: none` (the heading level badge, since removed, read as broken and was not), and a reading taken with no settle contradicted one taken with one
- **Kill survivors with `pkill -9 -f "tui-markdown-vscode-floor"`.** The process command line is the download cache path, so a pattern matching the temp workspace (`tuimd-floor`) matches NOTHING and silently leaves every window running. Thirteen stacked VS Code windows produced one false `55/56`, one `53/57`, and a run that never launched at all
- **The floor's cached VS Code can be replaced under it, so its version is checked, not assumed.** On macOS the floor build shares the bundle id `com.microsoft.VSCode` with the user's own VS Code, and Squirrel's ShipIt log shows two installs into the cached tree with `--disable-updates` passed; it read 1.138.0 on a floor of 1.85.0, and three runs passed on it because `vscode version is the floor` recorded `true` whatever it read. `ensureVsCode` in `run.mjs` reads `product.json` and unpacks the archive again when the version is not the floor, and the check compares `vscode.version` with `TUI_FLOOR_EXPECT_VERSION`. What triggered the installs is not established
- **`helpers.renderChildren(node)` is a trap for a node that can be EMPTY.** A node with no children has no `content` key at all, so `renderChildren` falls through its `Array.isArray` check and renders the node it was handed, which renders its own children again: `RangeError: Maximum call stack size exceeded` on save. It shipped that way in 3.0.2 for `<summary></summary>`, reachable by hand in any file. Pass `node.content ?? []` for any node whose content is `inline*` or otherwise optional; `extension-factory.ts:373` already did. `harness/fixtures/synthetic/details-empty-summary.md` is the fixture
- **The Collapsible insert opens the block on the DOM, not in the document.** A fresh `details` is closed, the UA hides every child but the `<summary>`, and the caret would land where nobody can see it. Setting `attrs.open` instead fixes the view and writes  `open` into the user's file, which nothing can then take back out, because the NodeView deliberately never dispatches a transaction for the toggle. So `insertDetails` sets the attribute through `view.nodeDOM(pos)`, the same mutation `ignoreMutation` already swallows for a reader's click. The invariant has two halves and two checks: `harness/slash-seam.ts` pins the file half (`<details>`, never `<details open>`), and the floor probe `the Collapsible entry is reachable by the word 'more'` pins the view half, asserting `domOpen=true` against `documentSaysOpen=false` in a live view. Neither half alone can see the other
- The GitHub-style heading slug has ONE definition, `headingSlug()` in `heading-slug.ts`. `scrollToHeading` in `main.ts` is the only caller. Keep it single: two copies drift, and the symptom is a link that scrolls nowhere
- **The strip left of a heading belongs to the collapse arrow** (`left: -15px`). Upstream places the drag handle flush against every block, in that same strip, and its wrapper's `z-index: 10` beats the arrow's 2, so the handle covered the arrow and took its clicks: no heading could be collapsed with the mouse. `HANDLE_GUTTER_PX` in `drag-handle-plugin.ts` pushes the handle out through a floating-ui middleware, scaled by the zoom on `.tiptap` because the arrow is inside the zoom and the handle is not. Change the CSS offset and the constant together; the floor check `a heading's collapse arrow is clear of the drag handle and takes the click` presses the arrow for real, at 100% and again at 150%
- The floor check's drive phase (`driveSurfaces` in `harness/vscode-floor/run.mjs`) is the only automated coverage of the 2.17 editing surfaces, because they exist only against a live ProseMirror view. Three of its probes reported working code as broken before they were right, and each mistake is a rule: an image NodeView writes `style.width`, not a `width` attribute; a hover overlay needs a `mousemove` with coordinates inside the target's rect, not a `mouseover` on the element; and a `contextmenu` whose `defaultPrevented` is true proves nothing, because the VS Code webview cancels that event itself. A scripted selection range does not reach ProseMirror either, so a menu that reads the editor selection has to be driven through the editor. When a probe does place a DOM range, it must target content ProseMirror can map (a top-level paragraph, never `lastElementChild`) and wait before the next key: a range in the footnote definition was silently dropped, the caret stayed in the table cell an earlier probe left it in, and the slash probe went red on a CSS-only change to code block height, because the drag probes act by coordinates and decide which block ends the document
- A probe that MEASURES A POSITION must re-measure before every attempt, and must refuse a reading taken while the view moved. `hoverParagraphForHandle` in `run.mjs` is the shared helper for the two drag-handle probes and it exists because both of the alternatives failed: coordinates captured once and reused across a retry loop land on whatever block scrolled under them (ProseMirror pulls the caret back into view on its next transaction, and a mermaid preview is the usual thing that slides into place), and a reading taken after that scroll shows the handle beside the block that moved into its old row. It therefore re-reads the rect each attempt, accepts only a pointer genuinely over a `.tiptap > p`, and requires `containerScrollTop` to be unchanged since the move. The assertion itself is always the same one: the handle must line up with the block UNDER THE POINTER, never with the block the probe picked. Two more rules came from the release run, which went red twice on probes that had been green all day: a retry loop must wait for the THING IT ASSERTS, not merely for its precondition (waiting for the pointer to be on a paragraph accepted a handle that was one animation frame behind), and a probe that finds `visibility !== "visible"` must raise the window again itself, because the gate at the top of `driveSurfaces` measures once and something can take the front after it. The drag-reorder probe drops onto the FARTHEST block for a third reason of the same family: the drop lands at the target's bottom edge, so an adjacent target drops the block exactly where it already sits, and a correct no-op then reads as a broken drag
- **A covered window is not a product defect, and the harness now says so first.** Chromium runs no animation frames for a window it considers not visible, so a run with anything on top produces a dozen reds that all look like defects: a bubble menu `present=false`, a drag handle that never moved, a mermaid diagram stuck loading. The first check in `driveSurfaces` reads `document.visibilityState`, raises the window again through `raiseWindow(floorPid)` if it has lost the front, and reports what it found. It measures ONCE, which is why its name says "when the surfaces start" and why both drag-handle checks print their own `visibility`. A VS Code left running by an earlier failed run covers the new one just as well as PDF export's Chromium does, so killing survivors before a run is part of the routine, not a superstition
- **The floor check's two processes rendezvous on a HEARTBEAT, not a clock.** The host used to wait a flat `DRIVEN_TIMEOUT_MS` for `phase-driven`; wave 8 added seven probes, the drive crept past it, and the result was not a clear failure but a run that lost every check after the tipping point, killed VS Code under the runner and reported `phase-driven never appeared` with no hint why. `driveSurfaces` now touches `phase-progress` as it records each check, and any retry loop long enough to go quiet (`hoverParagraphForHandle`) beats per attempt, because a covered window throttles every evaluate. The host gives up only after `STALL_TIMEOUT_MS` of SILENCE. Add probes freely; do not reintroduce a fixed budget
- **A run that verifies nothing must never exit 0, and the harness once did exactly that.** A `DevToolsSession.send` promise was settled only by a reply carrying its id: no `onclose`, no timeout. When VS Code exited mid-drive every in-flight command hung, node emptied its event loop and exited 0 having printed nothing at all, so `npm run verify:vscode-floor` reported success on a run that checked nothing. Three things keep that shut, and all three are load-bearing: `onclose` rejects the pending map, `SEND_TIMEOUT_MS` names the command that went unanswered, and `main()` sets `process.exitCode = 1` on entry so an unresolved await cannot pass for a green
- **Never schedule work with `requestAnimationFrame` alone unless a user gesture is what scheduled it.** Chromium does not run animation frames for a window it considers not visible, and a VS Code webview is not visible whenever its window is covered, minimized or being restored at startup. Three separate features shipped broken this way: the initial mermaid render (#112), the lightbox focus trap (#128), and replaying a saved cursor and scroll position (#121, since withdrawn, but the mechanism is the point). Each was invisible until someone covered a window. The fix in all three is the same latched pair, `requestAnimationFrame(once)` plus `setTimeout(once, 50)`, whichever wins. The four remaining `rAF` call sites (`table-context-menu.ts`, `link-popover.ts`, `search-plugin.ts`, `toc-sidebar.ts`) are all reached from a click or a keypress, so the window is visible by construction; that is the line, not the API
- The editor is created with `autofocus: 'start'`. Without it nothing in this webview ever focused the editor, and a ProseMirror selection in an unfocused view draws NO CARET, so opening a document left no cursor anywhere. It dispatches a transaction at load, which is the shape of #111, so the three floor checks that assert the document is not dirty are what to run after touching it
- `npm test` globs `out/test/**/*.test.js`, so DELETING a test source leaves its compiled copy behind and the runner keeps passing it. `rm -rf out/test` after removing a test, or the count will not move and a test for deleted code will still be green
- Backticks are banned inside the `Runtime.evaluate` template literals in `run.mjs`. That has cost two syntax errors; use string concatenation
- Seam files are registered in `harness/roundtrip.ts` by the coordinator BEFORE a parallel wave's worktrees are cut, so each worker owns one seam file and none of them edits the shared list. A seam's `run` may return a promise and the runner awaits it (#150): the content sync seam reads a latch one microtask after the call that set it, and a microtask cannot be drained from synchronous code. Markdown fixtures are unaffected. `esbuild.harness.config.js` reads `test/*.test.ts` from disk for the same reason
- **A lazy Tiptap EXTENSION is not the mermaid pattern, and the difference is invisible until runtime.** Mermaid is a standalone library, so its artifact can be self-contained. KaTeX, the drag handle and the emoji dataset plug into a live editor, and an artifact carrying its own `prosemirror-state` gets its own PluginKey identities and its own `EditorState` class: `instanceof` checks inside ProseMirror then fail with nothing failing at compile time. `src/webview/tiptap-globals.ts` publishes the page's Tiptap and ProseMirror on `window`, and `tiptapGlobalsPlugin` in `esbuild.config.js` resolves the bare specifiers inside every artifact to them. A new artifact that imports `@tiptap/*` MUST go through `lazyArtifactConfig`, never a hand-rolled esbuild entry
- **`@tiptap/extension-emoji` is deliberately used for its DATA only.** It declares a schema node named `emoji` with its own `renderMarkdown`, a schema is fixed at `new Editor()`, and that renderer would rewrite a unicode character the user already saved into a `:shortcode:`. The picker inserts plain unicode text through `suggestion-popup.ts` and adds nothing to the schema. The seam `harness/emoji-insert-seam.ts` is what pins that: `😄` in, `😄` out
- **The webview startup bundle has a hard gate.** `assertWebviewBudget()` in `esbuild.config.js` FAILS the production build past 1,100,000 B (`build:dev` is unminified and exempt). The number is deliberate, not inherited: 2.15 recorded 933,347 B after the mermaid split, 2.17 shipped 983,969 B, and `tiptap-globals.ts` costs 16,839 B of the remainder. Measured marginal costs if the 3.0 renderers were eager: KaTeX 267,806 B plus 1.1 MB of fonts, `@tiptap/extension-drag-handle` 127,420 B (yjs and y-prosemirror, reached through `@tiptap/extension-collaboration`, which this editor does not use), `@tiptap/extension-emoji` 528,529 B (`emojibase-data` does not tree-shake). All three are artifacts
- Math holds its LaTeX as a node ATTRIBUTE, and that is the whole fix for #131, not a second rule in `installMarkdownTextEscape`. Before 3.0 the escape module's group 3 (`[\\`\*\_\[\]\~\]`) reached inside` $...$`, so` $\frac{a}{b}$`was saved as`$\\frac{a}{b}$`and`$$\int_0^1$$` as `$$\\int\_0^1$$`: data loss on the first save. An attribute is not text, so the escaper never sees it. Do NOT add a `$\` rule there; #99 and #101 are the standing example of two issues wanting opposite things from one rule
- `<kbd>`, `<sub>` and `<sup>` are MARKS, not atoms, and that is why `[<kbd>Ctrl</kbd> docs](url)` survives a save. `docs/upstream/tiptap-markdown-mark-around-atom.md` records that a mark can never wrap an atom, and it still holds; marks sidestep it rather than fix it. `MarkdownLink.parseMarkdown` also had to batch its child tokens, because feeding `parseInline` one token at a time never lets it see an opening tag, its text and its closing tag together
- **The Trash half of `autoDeleteImages` is the HOST's behaviour, and that is measured, not assumed.** `verify:vscode-floor` reports `trashedTo=nowhere found` for every image it deletes, and the check `vscode.workspace.fs.delete accepts useTrash in this host` gets the same reading from a bare API call on a file no extension code touched, so what is proven is about VS Code as the floor launches it, not about this extension's call. Whether it is specific to extension-test mode or to 1.85 as downloaded is NOT proven and was not tested. Outside VS Code, `NSFileManager.trashItem` does reach `~/.Trash` from both `/private/tmp` and `os.tmpdir()`, so the operating system is not the reason either. Do not re-derive this, and do not "fix" `executeImageDeletes`: it already passes `useTrash: true`, and where the file lands on a real desktop is the one line of `docs/manual-checks.md` C4 that a machine cannot close
- Security trade-offs are documented where they are made: mermaid `securityLevel: "loose"` and nonce exposure in `mermaid-plugin.ts` / `mermaid-bridge.ts`, PDF export invariants in `export-pdf.ts`

## Development Guidelines

**Dependency Upgrades:**

- Before and after ANY dependency change: run `npm run roundtrip` (see `harness/README.md`) and `npm run build` — a green `npm run lint` is NOT sufficient evidence (a default-import break once passed tsc while breaking the bundle)
- When a change can affect what the extension host or the webview does at runtime, also run `npm run verify:vscode-floor`: it downloads the VS Code version in `engines.vscode` and checks activation, the custom editor and the live webview there
- Classify every golden diff as intended fix / accepted change / regression, in the commit that caused it
- Per-bump diff classifications and declined-upgrade reasoning: `harness/README.md`, plus the dependency notes in the affected module headers (e.g. puppeteer-core in `export-pdf.ts`)

**Which check to add:**

- **Unit test (`npm test`)** for a pure extension-host function: `frontmatter-parser.ts`, `image-rename-handler.ts`, `chromium-discovery.ts`. `node:test`, no framework dependency; `test/vscode-stub.ts` stands in for the `vscode` module and drives real files under a temp directory. Reach for this when the behaviour is a return value or a file on disk
- **Roundtrip fixture (`npm run roundtrip`)** when the behaviour is visible as markdown in, markdown out. One feature per fixture, and the fixture must hold the RAW input, never the serialized output
- **Harness seam** when the behaviour is a webview function's observable result that is not a markdown string: search ranking, escaping rules, column widths. A seam is a golden of measurements
- **Floor check (`npm run verify:vscode-floor`)** when the behaviour only exists inside a live extension host or webview: message dispatch, the custom editor, CSP, lazy artifacts. It opens a real VS Code window, so it is a separate command
- A test that cannot go red is worse than no test. Before committing one, break the code it covers and confirm it fails

**Tiptap-First Approach:**

- Always prefer Tiptap's built-in extensions and APIs over custom implementations
- Check existing Tiptap extensions before creating custom ProseMirror plugins
- Use theme CSS variables (`--crepe-color-*`) for consistent styling

**Reference Documentation:**

- Tiptap docs: [https://tiptap.dev/docs](https://tiptap.dev/docs)
- @tiptap/markdown: [https://tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown)

**Performance &amp; Bundle Optimization:**

- Prefer named imports (e.g., `import { Image } from '@tiptap/extension-image'`)
- Avoid importing entire packages when only specific features are needed
- Lazy-load plugins and features when possible
- Minimize custom CSS; leverage theme CSS variables
- Profile bundle size impact before adding new dependencies

## Documentation Update Guidelines

After every development cycle (new feature, bug fix, refactor), update these files:

| File                  | When to Update    | What to Include                                                                   |
| --------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `CHANGELOG.md`        | Every change      | New features, bug fixes, breaking changes, improvements                           |
| `README.md`           | New features only | User-facing feature descriptions (keep concise)                                   |
| Module header comment | Feature changes   | Role of the file plus the non-obvious constraints; put the *why* next to the code |
| `AGENTS.md`           | Map changes only  | New files in File Structure, new conventions                                      |


**What goes where:**

- **AGENTS.md**: "Where things are" — file structure, extension list, settings, conventions, pointers
- **Source comments**: "How and why this works" — a header per module, and a comment at the site of each non-obvious decision. There is no separate internals documentation; if a fact cannot be verified from the code, it does not belong in a comment either