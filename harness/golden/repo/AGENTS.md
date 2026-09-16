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
│   ├── session.ts            # EditorSession: the 9 per-document state fields + updateWebview/sendTheme/sendConfig/applyEdit/dispose
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
│   ├── openWikiLink.ts       # [[name]] resolution and open
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
    ├── editor.css            # Editor stylesheet, loaded before the themes (moved out of the provider, #86)
    ├── css-modules.d.ts      # Ambient declaration so esbuild CSS imports type-check
    ├── markdown-destination.ts # Tiptap Link/Image with destination-safe markdown serialization
    ├── markdown-text-escape.ts # One override of MarkdownManager text escaping, carries the footnote, ordered-task, entity and block-marker rules (#97, #99, #100, #101)
    ├── raw-html.ts            # rawHtmlBlock / rawHtmlInline, keep unrecognized HTML verbatim (#96)
    ├── ordered-list-extension.ts # CustomOrderedList: tokenizer override counting the marker separator (#109)
    ├── list-keymap-extension.ts # Tab/Shift-Tab list behaviour and typed-marker absorption (#107)
    ├── frontmatter.ts        # YAML parsing & validation utilities
    ├── alert-extension.ts    # GitHub-style alert blocks ([!NOTE], [!TIP], etc.)
    ├── mermaid-plugin.ts     # Mermaid diagram rendering (SVG preview, view/edit mode, caching)
    ├── mermaid-bridge.ts     # Lazy-loads the mermaid artifact with the page nonce (retry/latch semantics)
    ├── mermaid-loader.ts     # Separate esbuild entry → out/webview/mermaid-loader.js (mermaid + ELK)
    ├── line-highlight-plugin.ts # ProseMirror plugin for cursor line highlight
    ├── heading-level-plugin.ts # ProseMirror plugin for H1-H6 level badges
    ├── heading-collapse-plugin.ts # ProseMirror plugin for heading collapse/expand toggles
    ├── code-block-plugin.ts  # Code block header: language badge dropdown + copy button
    ├── image-edit-plugin.ts  # Double-click image URL editing + expand button
    ├── image-lightbox-plugin.ts # Fullscreen image viewer with zoom controls (0.5x-4x)
    ├── svg-to-png.ts         # SVG → PNG blob via canvas + clipboard.write (mermaid copy helper)
    ├── table-markdown-serializer.ts # Custom GFM table serializer (multi-line cells)
    ├── table-cell-content-parser.ts # Post-parse transformer for table cell lists/breaks
    ├── table-context-menu.ts # Right-click context menu for table operations
    ├── search-plugin.ts      # Cmd+F search via @tiptap/extension-find-and-replace (highlight, next/prev, match count)
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
        └── midnight.css           # Midnight (dark, deep navy)
harness/                            # Dependency-verification harness (see harness/README.md)
├── editor.ts                       # Editor factory mirroring initEditor's markdown-relevant extensions
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
├── vscode-floor/                   # VS Code floor check: run.mjs (driver) + extension-tests.ts (in-host checks)
├── fixtures/synthetic/*.md         # One feature per fixture
└── golden/                         # Committed baselines (corpus + seams), captured on the pre-upgrade dependency tree
```

## Configuration Settings

Extension provides these settings via `tuiMarkdown.*` namespace:

- Font size (8-32px), heading sizes H1-H6 (12-72px)
- `highlightCurrentLine` (boolean, default: true) - Enable cursor line highlight
- `imageSaveFolder` (string, default: `images`) - Folder to save pasted images (relative to document)
- `autoRenameImages` (boolean, default: true) - Automatically rename image files when you change the image path in Markdown (only when folder stays the same)
- `autoDeleteImages` (boolean, default: true) - Automatically delete image files when removed from Markdown (moves to Trash, warns if used elsewhere)
- `autoHideToolbar` (boolean, default: false) - Auto-hide toolbar when typing (show on hover)
- `listIndent` (`"editor"` | `2` | `4` | `"tab"`, default: `"editor"`) - List and code-block indentation. `"editor"` follows `editor.insertSpaces` / `editor.tabSize` resolved for `markdown`
- `chromiumPath` (string, default: empty) - Explicit Chrome/Edge/Chromium/Brave executable for PDF export; empty means auto-discovery (`chromium-discovery.ts`)
- `exportPageSize` (string, default: `A4`) - Page size for PDF export

## Tiptap Integration

Uses `@tiptap/core` with `@tiptap/markdown` (Beta, MarkedJS-based parser) for markdown roundtrip.

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via @tiptap/extension-find-and-replace), FileMention (@-mention file autocomplete via @tiptap/suggestion), WikiLink (wiki links), WikiLinkSuggestion ([[...]] autocomplete via @tiptap/suggestion), RawHtmlBlock + RawHtmlInline (verbatim raw HTML), CustomUnderline (replaces StarterKit's Underline; parses `ins`/`u`/`text-decoration`, serializes `<ins>`, #106), CustomOrderedList (replaces StarterKit's OrderedList; tokenizer override for continuation indent, #109), ListKeymapExtension (Tab/Shift-Tab list behaviour, registered after StarterKit and Table, #107).

**Markdown API:**

- Parse: `new Editor({ content, contentType: 'markdown' })` or `editor.commands.setContent(md, { contentType: 'markdown' })`
- Serialize: `editor.getMarkdown()` returns markdown string
- Manager: `editor.markdown.parse()`, `editor.markdown.serialize()`, `editor.markdown.instance` (MarkedJS)
- Custom extension hooks: `renderMarkdown(node, helpers)` and `parseMarkdown(token, helpers)` on any extension

**Node naming:** Tiptap uses camelCase: `listItem`, `codeBlock`, `taskList`, `taskItem`, `tableCell`, `tableHeader`.

## Conventions &amp; Gotchas

- `pendingEdit` flag prevents edit loops between extension and webview
- Webview persists state in `vscode.setState()` — MUST use spread pattern: `{ ...getState(), key: value }`
- Large files (&gt;500KB) show warning dialog
- CSP uses nonce for script execution
- `BlankLineHandler` extension handles empty paragraph roundtrip (MarkedJS `space` tokens → empty paragraph nodes)
- Task list selectors MUST use direct child combinator (`ul[data-type="taskList"] > li`) — descendant combinator leaks `display: flex` to nested items
- CSS `zoom` on `.tiptap` is transparent to JS coordinate APIs — plugins using `posAtCoords`, context menus, overlays all safe because they attach to `#editor-container` (parent, not zoomed)
- Popup elements (file mention, wiki link, context menus) append to `#editor-container`, not `.tiptap`, to avoid CSS zoom issues
- Tiptap 3.30's decorations hook was considered for the badge/collapse/code-block plugins and not adopted: widget decorations render inside the zoomed `.tiptap`, so the hand-managed ProseMirror plugins stay until the zoom interaction is tested by hand
- Text escaping on save goes through ONE place: `installMarkdownTextEscape()` overrides `MarkdownManager`'s escaping rather than patching each call site. Four issues (#97, #99, #100, #101) were one defect in `escapeMarkdownSyntax`, and #99 and #101 wanted opposite things from the same rule for `[`. Add a rule there, not a new override
- `harness/editor.ts` mirrors the markdown-relevant extensions of `initEditor()`; a change to one without the other makes the harness measure something that does not ship. It is NOT a full mirror, and the two can disagree: `harness/vscode-floor/sample.md` is not a first-pass fixed point under `roundtripMarkdown` yet the webview writes no edit for it, which is why the floor check passes
- `verify:vscode-floor` is safe to run concurrently, since #110. It used to derive `ws`, `ud` and `ext` from one fixed base (`/tmp/tuimd-floor`), so two runs overwrote each other's `sample.md`, shared VS Code's user-data dir and IPC socket, and the second run's startup `rmSync` deleted the first run's tree. That, not machine load, is why `document still unmodified after the hold` failed spuriously during parallel agent waves. Each run now gets its own `mkdtemp` base and stages its writes into the shared download cache before renaming them into place
- Messages between the extension host and the webview go through the typed unions in `src/shared/messages.ts`. Add a kind there, not an inline `as { type?: string }` cast; a typo on one side is then a `tsc` error
- A new message kind in `src/shared/messages.ts` must have a handler in `src/host/messageHandlers.ts`. The table is a mapped type over the union, so a missing handler is a `tsc` error rather than a message that silently does nothing at runtime. `dispatchMessage` checks `hasOwnProperty` before calling: the old `switch` fell through on an unknown `type`, but an object-literal lookup would find `constructor` or `toString` on `Object.prototype` and call it
- `originalImagePaths` is always passed as the whole outer map plus a `docKey`, never as the inner map. `handleDocumentSave` REPLACES the inner map after every save, so anything holding a reference to the old one silently stops detecting renames. No automated check catches this
- `normalizeLineEndings` lives in `src/host/lineEndings.ts` but the provider re-exports it, because `harness/crlf-seam.ts` imports it from `src/markdownEditorProvider.ts` and a worker may not edit the harness
- The editor stylesheet is `src/webview/editor.css`, imported by `main.ts` before `themes/index.css`. That import order is the cascade order, and the provider must stay free of `<style>` blocks
- DOCX export runs in the Node extension host, so any mdast2docx plugin that touches `document` crashes it. `@m2d/html` did, which is why raw HTML is skipped rather than rendered there; PDF export renders it through `remark-rehype` with `allowDangerousHtml`
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