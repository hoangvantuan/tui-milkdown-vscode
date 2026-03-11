# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

* Extension bundle: `src/extension.ts` → `out/extension.js` (CJS, Node platform)

* Webview bundle: `src/webview/main.ts` → `out/webview/main.js` (IIFE, browser platform)

**Build configuration**:

* Production mode (default): minified bundles, no sourcemaps, tree-shaking enabled

* Development mode (`--dev` flag): sourcemaps enabled, unminified, tree-shaking enabled

* Watch mode (`--watch` flag): rebuilds on file changes, sourcemaps enabled

**Extension ↔ Webview communication flow:**

1. Extension registers `CustomTextEditorProvider` for `.md` files
2. When document opens, provider creates webview with HTML template containing editor container
3. Webview sends `ready` → Extension sends `theme`, `config`, `update` (content)
4. User edits → Webview debounces (300ms) → sends `edit` message → Extension applies `WorkspaceEdit`
5. External document changes → Extension sends `update` → Webview calls `editor.commands.setContent()` (no destroy/recreate)

**Key implementation details:**

* `pendingEdit` flag prevents edit loops between extension and webview

* Webview persists theme selection in `vscode.setState()`

* Large files (>500KB) show warning dialog

* CSP uses nonce for script execution

## File Structure

```
src/
├── extension.ts              # Entry point, registers MarkdownEditorProvider
├── markdownEditorProvider.ts # CustomTextEditorProvider + HTML/CSS template
├── constants.ts              # Shared constants (MAX_FILE_SIZE)
├── utils/getNonce.ts         # CSP nonce generator
├── utils/clean-image-path.ts  # Shared image path cleaning utility (removes titles, angle brackets)
└── webview/
    ├── main.ts               # Browser-side Tiptap editor
    ├── frontmatter.ts        # YAML parsing & validation utilities
    ├── line-highlight-plugin.ts # ProseMirror plugin for cursor line highlight
    ├── heading-level-plugin.ts # ProseMirror plugin for H1-H6 level badges
    ├── image-edit-plugin.ts  # Double-click image URL editing
    ├── table-markdown-serializer.ts # Custom GFM table serializer (multi-line cells)
    ├── table-cell-content-parser.ts # Post-parse transformer for table cell lists/breaks
    ├── document-style-detector.ts # Detects dominant markdown formatting style (bullets, emphasis, fences, HR)
    ├── marker-preserving-extensions.ts # 8 Tiptap extensions preserving original syntax markers
    ├── markdown-diff-patch.ts # LCS diff engine for line-level markdown format preservation
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
        └── catppuccin-mocha.css   # Catppuccin Mocha (dark)
```

## Configuration Settings

Extension provides these settings via `tuiMarkdown.*` namespace:

* Font size (8-32px), heading sizes H1-H6 (12-72px)

* `highlightCurrentLine` (boolean, default: true) - Enable cursor line highlight

* `imageSaveFolder` (string, default: `images`) - Folder to save pasted images (relative to document)

* `autoRenameImages` (boolean, default: true) - Automatically rename image files when you change the image <path> in Markdown (only when folder stays the same)

* `autoDeleteImages` (boolean, default: true) - Automatically delete image files when removed from Markdown (moves to Trash, warns if used elsewhere)

## Tiptap Integration

Uses `@tiptap/core` with `@tiptap/markdown` (Beta, MarkedJS-based parser) for markdown roundtrip.

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation).

**Markdown API:**

* Parse: `new Editor({ content, contentType: 'markdown' })` or `editor.commands.setContent(md, { contentType: 'markdown' })`
* Serialize: `editor.getMarkdown()` returns markdown string
* Manager: `editor.markdown.parse()`, `editor.markdown.serialize()`, `editor.markdown.instance` (MarkedJS)
* Custom extension hooks: `renderMarkdown(node, helpers)` and `parseMarkdown(token, helpers)` on any extension

**Theme system:** CSS variables loaded from `src/webview/themes/`, scoped by body class (e.g., `.theme-frame .tiptap`). Dark theme overrides use `body.dark-theme` selector (set by `applyTheme()`).

**Theme font strategy:**
* Default font (`--crepe-font-default`): All themes use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif` — picks the OS's native reading font (SF Pro on macOS, Segoe UI on Windows). No external font download needed.
* Crepe themes use `ui-serif, "Source Serif 4", ..., Georgia, serif` — `ui-serif` resolves to New York on macOS, excellent for long-form reading.
* Code font (`--crepe-font-code`): All themes prioritize `"Cascadia Code"` (bundled with VS Code, always available), then per-theme fallbacks (`"JetBrains Mono"` for Frame/Nord, `"Fira Code"` for Crepe/Catppuccin).
* Nord Dark uses the official Nord palette (Polar Night / Snow Storm / Frost / Aurora) — visually distinct from Frame Dark.

**Content updates:** `editor.commands.setContent()` - no destroy/recreate needed. Cursor position preserved via save/restore around setContent.

**Empty paragraph roundtrip:** `BlankLineHandler` extension parses MarkedJS `space` tokens into empty paragraph nodes (count = newlines - 2). Custom `Document.extend({ renderMarkdown })` serializes empty paragraphs as single `\n` (instead of `\n\n`), producing correct blank line count in markdown output.

**Node naming:** Tiptap uses camelCase: `listItem`, `codeBlock`, `taskList`, `taskItem`, `tableCell`, `tableHeader`.

## Metadata Panel

**Frontmatter Handling** (`src/webview/frontmatter.ts`):

* Parses and validates YAML frontmatter using `js-yaml` library

* Returns validation errors with line numbers

* Reconstructs Markdown with frontmatter delimiters (`---`)

* Handles edge cases: empty frontmatter, missing delimiters, invalid YAML

**Panel UI** (integrated in `src/markdownEditorProvider.ts` HTML):

* Collapsible `<details>` element styled with VSCode theme variables

* Textarea for YAML editing with syntax error display (red border + error message)

* Tab key inserts 2 spaces (YAML standard indentation)

* "Add Metadata" button when no frontmatter exists

* Panel integrates seamlessly below toolbar, above editor

**Bidirectional Sync**:

1. Document opens → Parse content → Show metadata panel (or "Add Metadata" button)
2. User edits metadata textarea → Validates YAML → Updates document (triggers `edit` message)
3. External document change → Reparse → Refresh metadata display
4. Empty metadata → Remove frontmatter delimiters from document

**Dependencies**: `js-yaml@^4.1.1`, `@types/js-yaml` (dev)

## Toolbar

**Layout** (in `src/markdownEditorProvider.ts` HTML + CSS):

* Sticky toolbar at top with formatting buttons, heading select, theme select, and View Source

* Buttons grouped by category with separators: Text formatting | Heading | Lists | Blocks | Table & Link | Theme & Source

* Table context buttons (add/delete column/row, delete table) appear only when cursor is inside a table

* Active state highlighting: buttons show `is-active` class based on current selection

**Commands** (in `src/webview/main.ts`):

* `TOOLBAR_COMMANDS` record maps `data-command` attributes to Tiptap chain commands

* `updateToolbarActiveState()` called on `onSelectionUpdate` and `onTransaction` to sync button states

* Heading select dropdown switches between Paragraph and H1-H6

* Table context visibility: walks `$from.node(d)` ancestors to detect if cursor is inside a table

**Link editing**: Uses async message flow (webview → extension `showInputBox` → webview) since VSCode webview sandbox blocks `prompt()`

## Line Highlight

**Plugin** (`src/webview/line-highlight-plugin.ts`):

* ProseMirror plugin using Decoration API

* Highlights immediate block containing cursor (paragraph, heading, list item)

* Skips code blocks (node type `codeBlock` - Tiptap camelCase convention)

* Registered via `editor.registerPlugin()` after Tiptap instance creation

**CSS** (in `src/markdownEditorProvider.ts`):

* Uses `::after` pseudo-element with `z-index: -1` stacking

* Light themes: `rgba(0, 0, 0, 0.08)` background (default)

* Dark themes: `rgba(255, 255, 255, 0.08)` via `body.dark-theme` selector

## Table Styling

**CSS** (in `src/markdownEditorProvider.ts`):

* `table-layout: auto` - Columns size proportionally to content

* `width: 100%` - Table spans full editor width

* `white-space: normal`, `word-wrap: break-word`, `overflow-wrap: break-word` - Cell text wraps naturally for responsive display

## Image Handling

**Local Image Display** (`src/markdownEditorProvider.ts`):

* `extractImagePaths()`: Extracts image <paths> from Markdown (both `![](path)` and `<img src="">`)

* `resolveImagePath()`: Resolves relative/absolute <paths> against document location

* `buildImageMap()`: Creates mapping from original <paths> to webview URIs

* `localResourceRoots` includes document folder and workspace for image access

**Image Upload** (`src/webview/main.ts`):

* Paste from clipboard: Intercepts paste events with image data

* Tiptap handlePaste/handleDrop: Intercepts paste/drop events for image uploads

* Converts images to base64, sends to extension for saving

* Extension saves to configured folder (`tuiMarkdown.imageSaveFolder`)

* Returns saved <path>, updates Markdown with relative <path>

**Message Flow**:

1. Webview detects image (paste or upload) → converts to base64
2. Sends `saveImage` message with base64 data and filename
3. Extension saves to disk, returns `imageSaved` with relative <path>
4. Webview updates Markdown content with new image <path>

**Path Transformation**:

* On load: Local <paths> → webview URIs (for display)

* On save: Webview URIs → original <paths> (preserve markdown)

**Auto Rename Images** (`src/markdownEditorProvider.ts`):

* When user edits image <path> in Markdown (same folder, different filename)

* On save: Extension detects <path> change and prompts user via QuickPick dialog

* If confirmed: Renames image file on disk, updates all `.md` files in workspace with new <path>

* Controlled by `tuiMarkdown.autoRenameImages` setting (boolean, default: true)

* Only triggers when image folder remains the same

**Auto Delete Images** (`src/markdownEditorProvider.ts` + `src/utils/image-rename-handler.ts`):

* When user removes image from markdown (<path> no longer exists in document)

* On save: Extension detects removed images and prompts user via QuickPick dialog

* Shows warning icon if image is used in other `.md` files in workspace

* If confirmed: Moves image file to Trash (can be recovered)

* Controlled by `tuiMarkdown.autoDeleteImages` setting (boolean, default: true)

**Image URL Editing** (`src/webview/image-edit-plugin.ts`):

* Double-click on image opens VSCode input box to edit URL/<path>

* DOM event listener (capture phase) intercepts before Tiptap components

* Finds ProseMirror node via `posAtDOM()` and position search

* Uses async message flow: webview → extension (showInputBox) → webview

* Reverse lookup from imageMap to display original <path> instead of webview URI

* Updates node via ProseMirror transaction after user confirms


**Context-Aware Path Transforms** (`src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* Path replacements only apply within markdown image/link syntax contexts (`![alt](url)` and `[text](url)`)

* Workspace reference updates skip content inside code blocks (fenced and inline) to prevent accidental code modification

* Image path utility (`clean-image-path.ts`): Removes markdown link titles and angle brackets from paths before saving

**Image Size Limit**:

* 10MB maximum image size limit on paste/drop operations

* Oversized images trigger `showWarning` message to display user-facing dialog in extension

**Message Types**:

* `saveImage`: Webview → Extension (base64 image data, filename, upload type)

* `imageSaved`: Extension → Webview (relative file path after save)

* `showWarning`: Webview → Extension (message title and warning text for VSCode dialog)

## Heading Level Indicator

**Plugin** (`src/webview/heading-level-plugin.ts`):

* ProseMirror plugin using Decoration.widget API

* Displays "H1", "H2", etc. badges inline before heading text

* Widget inserted at `pos + 1` (inside heading node, before text content)

* Subtle styling: 11px font, 0.5 opacity, muted colors

**CSS** (in `src/markdownEditorProvider.ts`):

* `display: inline-block` with `margin-right: 8px`

* Light themes: `rgba(0, 0, 0, 0.6)` (default)

* Dark themes: `rgba(255, 255, 255, 0.5)` via `body.dark-theme` selector

## Table Serializer

**Custom Serializer** (`src/webview/table-markdown-serializer.ts`):

* Extends `@tiptap/extension-table` via `Table.extend({ renderMarkdown(node, helpers) })` hook (pattern from `@tiptap/markdown` extension spec)

* `helpers` is `MarkdownRendererHelpers` providing `renderChildren()`, `indent()`, `wrapInBlock()`

* Preserves multi-line cell content using `<br>` tags in GFM table format

* Handles bullet lists, ordered lists, task lists within table cells

* Column widths auto-padded for aligned markdown output

**Table Cell Content Parser** (`src/webview/table-cell-content-parser.ts`):

* Post-parse transformer called after `setContent`/`initEditor`

* Converts `<br>` (hardBreak from GFM) → paragraph boundaries

* Converts `\n` (literal) → hardBreak nodes within paragraph (soft break)

* Detects list patterns (`- item`, `N. item`, `[x] item`) → proper list nodes

* Groups consecutive same-type segments into single list block

## Markdown Fidelity Engine

A 3-layer system preserving original markdown formatting during Tiptap editor roundtrip. Ensures user's stylistic choices (bullet chars, emphasis markers, fence styles, HR patterns) persist through edit cycles.

**Layer 1 - Marker Preserving Extensions** (`src/webview/marker-preserving-extensions.ts`):

* 8 Tiptap extension overrides: BulletList, OrderedList, Heading, HorizontalRule, CodeBlock, Italic, Bold, Table

* Captures original syntax markers from MarkedJS tokens during `parseMarkdown()`

* Reproduces original markers during `renderMarkdown()` serialization

* Examples: `-` vs `*` for bullets, `_` vs `*` for emphasis, `` ``` `` vs `~~~` for fences

**Layer 2 - Document Style Detector** (`src/webview/document-style-detector.ts`):

* Analyzes original markdown to detect dominant formatting style

* Extracts: preferred bullet char (`-`, `*`, `+`), emphasis char (`_`, `*`), fence char (`` ` ``, `~`), HR style (`---`, `***`, `___`, `***`)

* Provides fallback style for new nodes added during editing (lists, blockquotes, code blocks without detected patterns)

* Called on `initEditor()` to scan document before editing begins

**Layer 3 - LCS Diff & Patch** (`src/webview/markdown-diff-patch.ts`):

* Line-level Longest Common Subsequence (LCS) diff comparing serialized output with original markdown

* Unchanged lines keep original verbatim (preserves spacing, style, comments)

* Only replaces lines containing actual content changes

* 2000-line performance cap to prevent slowdown on large files

* Handles edge cases: removed lines, added lines, reordered content

**Integration** (`src/webview/main.ts`):

* On `initEditor()`: Call `detectDocumentStyle()` to populate style cache

* On `editor.getMarkdown()`: Apply marker preservation via extension overrides, then run LCS diff/patch

* Result: User's formatting choices preserved even after multiple edit/save cycles

**Data Flow**:

1. Original markdown loaded → Detect dominant style (Layer 2) → Parse via marker-preserving extensions (Layer 1)
2. User edits → Editor serializes to markdown with preserved markers
3. Send to extension → Apply LCS diff/patch (Layer 3) → Only changed lines modified, rest preserved verbatim
4. Saved to disk → Next load repeats the cycle with new detection baseline

## Development Guidelines

**Tiptap-First Approach:**

* Always prefer Tiptap's built-in extensions and APIs over custom implementations

* Check existing Tiptap extensions before creating custom ProseMirror plugins

* Use theme CSS variables (`--crepe-color-*`) for consistent styling

**Reference Documentation:**

* Tiptap docs: <https://tiptap.dev/docs>

* @tiptap/markdown: <https://tiptap.dev/docs/editor/markdown>

* Local reference: `docs/tiptap-markdown-reference.md` (API spec, extension patterns, tokenizer guides)

**Performance & Bundle Optimization:**

* Prefer named imports (e.g., `import { Image } from '@tiptap/extension-image'`)

* Avoid importing entire packages when only specific features are needed

* Lazy-load plugins and features when possible

* Minimize custom CSS; leverage theme CSS variables

* Profile bundle size impact before adding new dependencies

## Documentation Update Guidelines

After every development cycle (new feature, bug fix, refactor), update these files:

| File           | When to Update       | What to Include                                         |
| -------------- | -------------------- | ------------------------------------------------------- |
| `CHANGELOG.md` | Every change         | New features, bug fixes, breaking changes, improvements |
| `README.md`    | New features only    | User-facing feature descriptions (keep concise)         |
| `CLAUDE.md`    | Architecture/lessons | New components, patterns, gotchas, lessons learned      |

**CHANGELOG.md** - Version history for users:

* Add entry under current version (or create new version section)

* Group by: Added, Changed, Fixed, Removed

* Include brief description of what changed

**README.md** - User documentation:

* Only update for new user-facing features

* Keep feature list concise (one line per feature)

* Update configuration table if new settings added

**CLAUDE.md** - Developer knowledge base:

* Document new file/component in File Structure section

* Add dedicated section for complex features (architecture, message flow)

* Record lessons learned, gotchas, edge cases discovered during development

* Keep as reference for future development and AI assistants

