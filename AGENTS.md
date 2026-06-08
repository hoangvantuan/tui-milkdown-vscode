This file is a **map**, not an encyclopedia. It tells you where things are and how they connect. Implementation details live in `docs/internals/`.

## Project Overview

VSCode extension providing WYSIWYG Markdown editing using Tiptap editor with @tiptap/markdown. Opens `.md` files in a custom editor with theme selection and view source functionality.

## Commands

```bash
npm run build      # Production build (minified, no sourcemaps)
npm run build:dev  # Development build (with sourcemaps, unminified)
npm run watch      # Watch mode for development
npm run lint       # TypeScript type checking (tsc --noEmit)
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
│   ├── markdown-ast.ts       # Shared MDAST pipeline (parse + mermaid image substitution)
│   ├── export-docx.ts        # MDAST → DOCX via mdast2docx (lazy-loaded bundle)
│   ├── export-pdf.ts         # MDAST → HTML → Chromium page.pdf (lazy-loaded bundle)
│   └── chromium-discovery.ts # Locate Chrome/Edge/Chromium/Brave executable for PDF export
└── webview/
    ├── main.ts               # Browser-side Tiptap editor
    ├── index.html            # HTML template for webview (loaded by markdownEditorProvider)
    ├── frontmatter.ts        # YAML parsing & validation utilities
    ├── alert-extension.ts    # GitHub-style alert blocks ([!NOTE], [!TIP], etc.)
    ├── mermaid-plugin.ts     # Mermaid diagram rendering (SVG preview, view/edit mode, caching)
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
    ├── search-plugin.ts      # Cmd+F search via prosemirror-search (highlight, next/prev, match count)
    ├── file-search-utils.ts  # Shared: fuzzy search (fuzzysort), proximity scoring, file type icons, highlight helpers
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

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via prosemirror-search), FileMention (@-mention file autocomplete via @tiptap/suggestion), WikiLink (wiki links), WikiLinkSuggestion ([[...]] autocomplete via @tiptap/suggestion).

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

## Feature Docs

Implementation details for each feature area:

| Doc                       | Covers                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor-core.md`          | Toolbar, glassmorphic styling, appearance popover, auto-hide, zoom, line highlight, reading progress, word count, page break, search (Cmd+F) |
| `image-system.md`         | Image display, upload, auto rename/delete, URL editing, clipboard fallback, lightbox                                                         |
| `table-system.md`         | Table styling, context menu, GFM serializer, cell content parser                                                                             |
| `mermaid-system.md`       | Mermaid rendering, copy as PNG, `securityLevel: "loose"` trade-off                                                                           |
| `heading-navigation.md`   | Heading level badges, collapse/expand, TOC sidebar, link click navigation                                                                    |
| `autocomplete-plugins.md` | File mention (@), wiki link ([[...]]), cache strategy, click navigation                                                                      |
| `export-system.md`        | DOCX/PDF export, MDAST pipeline, Chromium discovery, security notes                                                                          |
| `metadata-panel.md`       | Frontmatter YAML panel, bidirectional sync                                                                                                   |
| `theming.md`              | Theme system, font strategy, typography, micro-interactions, font selector                                                                   |
| `alerts-codeblock.md`     | GitHub-style alerts, code block language badge + copy                                                                                        |


## Development Guidelines

**Tiptap-First Approach:**

- Always prefer Tiptap's built-in extensions and APIs over custom implementations
- Check existing Tiptap extensions before creating custom ProseMirror plugins
- Use theme CSS variables (`--crepe-color-*`) for consistent styling

**Reference Documentation:**

- Tiptap docs: [https://tiptap.dev/docs](https://tiptap.dev/docs)
- @tiptap/markdown: [https://tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown)
- Local reference: `docs/tiptap-markdown-reference.md` (API spec, extension patterns, tokenizer guides)

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
| `docs/internals/*.md` | Feature changes   | Implementation details, message flows, CSS classes, gotchas                     |
| `CLAUDE.md`           | Map changes only  | New files in File Structure, new entries in Feature Docs table, new conventions |


**What goes where:**

- **CLAUDE.md**: "Cái gì ở đâu" — file structure, extension list, settings, conventions, pointers
- **docs/internals/**: "Cái này hoạt động thế nào" — message flows, DOM structure, CSS classes, persistence strategies, gotchas


# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tui-milkdown-vscode** (2033 symbols, 3073 relationships, 132 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run** `gitnexus_detect_changes()` **before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                             | Use for                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/tui-milkdown-vscode/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/tui-milkdown-vscode/clusters`       | All functional areas                     |
| `gitnexus://repo/tui-milkdown-vscode/processes`      | All execution flows                      |
| `gitnexus://repo/tui-milkdown-vscode/process/{name}` | Step-by-step execution trace             |


## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

