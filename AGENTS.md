This file is a **map**, not an encyclopedia. It tells you where things are and how they connect. The source is the reference: every module starts with a header comment stating its role, and the reason behind a non-obvious choice is a comment at the code site, not a separate document.

## Project Overview

VSCode extension providing WYSIWYG Markdown editing using Tiptap editor with @tiptap/markdown. Opens `.md` files in a custom editor with theme selection and view source functionality.

## Commands

```bash
npm run build      # Production build (minified, no sourcemaps)
npm run build:dev  # Development build (with sourcemaps, unminified)
npm run watch      # Watch mode for development
npm run lint       # TypeScript type checking (tsc --noEmit)
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
├── markdownEditorProvider.ts # CustomTextEditorProvider + HTML/CSS template
├── constants.ts              # Shared constants (MAX_FILE_SIZE)
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
    ├── index.html            # HTML template for webview (loaded by markdownEditorProvider)
    ├── markdown-destination.ts # Tiptap Link/Image with destination-safe markdown serialization
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

## Tiptap Integration

Uses `@tiptap/core` with `@tiptap/markdown` (Beta, MarkedJS-based parser) for markdown roundtrip.

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via @tiptap/extension-find-and-replace), FileMention (@-mention file autocomplete via @tiptap/suggestion), WikiLink (wiki links), WikiLinkSuggestion ([[...]] autocomplete via @tiptap/suggestion).

**Markdown API:**

- Parse: `new Editor({ content, contentType: 'markdown' })` or `editor.commands.setContent(md, { contentType: 'markdown' })`
- Serialize: `editor.getMarkdown()` returns markdown string
- Manager: `editor.markdown.parse()`, `editor.markdown.serialize()`, `editor.markdown.instance` (MarkedJS)
- Custom extension hooks: `renderMarkdown(node, helpers)` and `parseMarkdown(token, helpers)` on any extension

**Node naming:** Tiptap uses camelCase: `listItem`, `codeBlock`, `taskList`, `taskItem`, `tableCell`, `tableHeader`.

## Conventions & Gotchas

- `pendingEdit` flag prevents edit loops between extension and webview
- Webview persists state in `vscode.setState()` — MUST use spread pattern: `{ ...getState(), key: value }`
- Large files (>500KB) show warning dialog
- CSP uses nonce for script execution
- `BlankLineHandler` extension handles empty paragraph roundtrip (MarkedJS `space` tokens → empty paragraph nodes)
- Task list selectors MUST use direct child combinator (`ul[data-type="taskList"] > li`) — descendant combinator leaks `display: flex` to nested items
- CSS `zoom` on `.tiptap` is transparent to JS coordinate APIs — plugins using `posAtCoords`, context menus, overlays all safe because they attach to `#editor-container` (parent, not zoomed)
- Popup elements (file mention, wiki link, context menus) append to `#editor-container`, not `.tiptap`, to avoid CSS zoom issues
- Tiptap 3.30's decorations hook was considered for the badge/collapse/code-block plugins and not adopted: widget decorations render inside the zoomed `.tiptap`, so the hand-managed ProseMirror plugins stay until the zoom interaction is tested by hand
- Security trade-offs are documented where they are made: mermaid `securityLevel: "loose"` and nonce exposure in `mermaid-plugin.ts` / `mermaid-bridge.ts`, PDF export invariants in `export-pdf.ts`

## Development Guidelines

**Dependency Upgrades:**

- Before and after ANY dependency change: run `npm run roundtrip` (see `harness/README.md`) and `npm run build` — a green `npm run lint` is NOT sufficient evidence (a default-import break once passed tsc while breaking the bundle)
- When a change can affect what the extension host or the webview does at runtime, also run `npm run verify:vscode-floor`: it downloads the VS Code version in `engines.vscode` and checks activation, the custom editor and the live webview there
- Classify every golden diff as intended fix / accepted change / regression, in the commit that caused it
- Per-bump diff classifications and declined-upgrade reasoning: `harness/README.md`, plus the dependency notes in the affected module headers (e.g. puppeteer-core in `export-pdf.ts`)

**Tiptap-First Approach:**

- Always prefer Tiptap's built-in extensions and APIs over custom implementations
- Check existing Tiptap extensions before creating custom ProseMirror plugins
- Use theme CSS variables (`--crepe-color-*`) for consistent styling

**Reference Documentation:**

- Tiptap docs: [https://tiptap.dev/docs](https://tiptap.dev/docs)
- @tiptap/markdown: [https://tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown)

**Performance & Bundle Optimization:**

- Prefer named imports (e.g., `import { Image } from '@tiptap/extension-image'`)
- Avoid importing entire packages when only specific features are needed
- Lazy-load plugins and features when possible
- Minimize custom CSS; leverage theme CSS variables
- Profile bundle size impact before adding new dependencies

## Documentation Update Guidelines

After every development cycle (new feature, bug fix, refactor), update these files:

| File                  | When to Update    | What to Include                                                                 |
| --------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `CHANGELOG.md`        | Every change      | New features, bug fixes, breaking changes, improvements                         |
| `README.md`           | New features only | User-facing feature descriptions (keep concise)                                 |
| Module header comment | Feature changes   | Role of the file plus the non-obvious constraints; put the *why* next to the code |
| `AGENTS.md`           | Map changes only  | New files in File Structure, new conventions                                    |


**What goes where:**

- **AGENTS.md**: "Where things are" — file structure, extension list, settings, conventions, pointers
- **Source comments**: "How and why this works" — a header per module, and a comment at the site of each non-obvious decision. There is no separate internals documentation; if a fact cannot be verified from the code, it does not belong in a comment either