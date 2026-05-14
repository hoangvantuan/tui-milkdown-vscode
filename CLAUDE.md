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

* Webview persists theme, font, zoom, TOC state in `vscode.setState()` (use spread pattern: `{ ...getState(), key: value }`)

* Large files (>500KB) show warning dialog

* CSP uses nonce for script execution

## File Structure

```
src/
├── extension.ts              # Entry point, registers MarkdownEditorProvider
├── markdownEditorProvider.ts # CustomTextEditorProvider + HTML/CSS template
├── constants.ts              # Shared constants (MAX_FILE_SIZE)
├── utils/
│   ├── getNonce.ts           # CSP nonce generator
│   ├── clean-image-path.ts   # Shared image path cleaning utility (removes titles, angle brackets)
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
    ├── file-mention-plugin.ts # @-mention file autocomplete via @tiptap/suggestion (popup, fuzzy filter, link insert)
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

* Font size (8-32px), heading sizes H1-H6 (12-72px)

* `highlightCurrentLine` (boolean, default: true) - Enable cursor line highlight

* `imageSaveFolder` (string, default: `images`) - Folder to save pasted images (relative to document)

* `autoRenameImages` (boolean, default: true) - Automatically rename image files when you change the image <path> in Markdown (only when folder stays the same)

* `autoDeleteImages` (boolean, default: true) - Automatically delete image files when removed from Markdown (moves to Trash, warns if used elsewhere)

* `autoHideToolbar` (boolean, default: false) - Auto-hide toolbar when typing (show on hover)

## Tiptap Integration

Uses `@tiptap/core` with `@tiptap/markdown` (Beta, MarkedJS-based parser) for markdown roundtrip.

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via prosemirror-search), FileMention (@-mention file autocomplete via @tiptap/suggestion).

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

**Typography & spacing strategy:**
* Content max-width: 100% with fluid padding `clamp(24px, 5vw, 80px)`
* Body line-height: 1.625 (26px/16px) for optimal readability
* Heading scale: Perfect Fourth ratio (1.333) — H1:32, H2:24, H3:20, H4:16, H5:14, H6:13
* Heading margins: generous top (48-16px) for section grouping, tight bottom (16-6px) to pull toward content
* Modern CSS: `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, `font-feature-settings: "liga"`, `font-optical-sizing: auto`
* Tables can overflow content width with horizontal scroll
* `prefers-reduced-motion` disables all transitions/animations

**Micro-interactions:**
* Toolbar buttons: 0.15s ease-out transitions
* Code blocks: hover border, focus ring on edit
* Images: 6px border-radius, hover shadow, accent outline on selection (`ProseMirror-selectednode`)
* Links: underline slide-in via `background-size` transition
* Table rows: hover highlight, zebra striping
* Blockquotes: border thickens on hover (3px→4px)
* Heading badges: opacity increases on hover (0.5→0.8)
* Line highlight: subtle 0.04/0.05 opacity (light/dark)

**Content updates:** `editor.commands.setContent()` - no destroy/recreate needed. Cursor position preserved via save/restore around setContent.

**Empty paragraph roundtrip:** `BlankLineHandler` extension parses MarkedJS `space` tokens into empty paragraph nodes (count = newlines - 2). Custom `Document.extend({ renderMarkdown })` serializes empty paragraphs as single `\n` (instead of `\n\n`), producing correct blank line count in markdown output.

**Task list CSS gotcha:** Task list selectors MUST use direct child combinator (`ul[data-type="taskList"] > li`) — descendant combinator leaks `display: flex` to nested regular list items, breaking vertical layout.

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

* Buttons grouped by category with separators: Text formatting | Heading | Lists | Blocks | Table & Link | Source & Appearance

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

* `readClipboardImage`: Webview → Extension (request native clipboard read as fallback)

* `clipboardImage`: Extension → Webview (base64 PNG from system clipboard)

**Clipboard Image Fallback** (triple strategy in `src/webview/main.ts`):

1. ProseMirror `handlePaste` (editorProps) — standard `clipboardData.items`/`files`
2. `navigator.clipboard.read()` — async Clipboard API (may need permission)
3. Extension-side native read — `osascript` (macOS), PowerShell (Windows), `xclip` (Linux)

## Lightbox (Image & Mermaid)

**Plugin** (`src/webview/image-lightbox-plugin.ts`):

* Shared fullscreen overlay for both images and mermaid diagrams
* Dark backdrop, zoom (0.5x–4x), pan by dragging when `scale > 1`
* Zoom via buttons (+/−), mouse wheel, or keyboard (`+`/`-` step, `0` reset, `Esc` close)
* Touch: 2-finger drag pans image (when zoomed in); `touch-action: none` on overlay disables browser default pinch-to-zoom
* Caption from image alt text or explicit string
* Close via Escape, click outside image/controls, or close button (overlay-level click handler checks target)
* Internal state `currentTarget: HTMLElement` switches between `#lightbox-image` and `#lightbox-svg` wrapper; `applyTransform()` writes to whichever is active
* Exported API:
  * `openLightbox(src, alt)` — image path → `<img>`
  * `openMermaidLightbox(svgMarkup, caption)` — SVG outer HTML → `#lightbox-svg` wrapper
  * `initLightbox()` called once in `init()`
* Mousedown listener attached to `.lightbox-content` so both targets share drag-pan logic
* Mermaid SVG is rendered with `securityLevel: "loose"` (required for ELK + `foreignObject` HTML labels). `innerHTML` assignment into the lightbox trusts this input. See the "Mermaid Diagrams" section below for the security trade-off note.
* Mermaid expand button is injected in `mermaid-plugin.ts` widget decoration (top-left of `.mermaid-preview`, hidden on `.mermaid-error` or while editing); click reads `svgEl.outerHTML` from `.mermaid-svg-host` and calls `openMermaidLightbox`

## Content Zoom

**Feature** (in `src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* Zoom range: 50%–200% in 10% steps, applied as CSS `zoom` property on `.tiptap` element only
* Toolbar, TOC sidebar, metadata panel, Source editor stay at native size (zoom is content-only)
* Constants: `ZOOM_MIN = 0.5`, `ZOOM_MAX = 2.0`, `ZOOM_STEP = 0.1`, `ZOOM_DEFAULT = 1.0`
* `clampZoom(value)`: Rounds to 2 decimals (prevents floating-point drift), clamps to min/max
* `applyZoom(value)`: Sets `style.zoom` on `.tiptap`, updates display button text and disabled states
* `setZoom(value, persist?)`: Clamp → apply → optionally persist to `vscode.setState()` + notify extension

**Keyboard shortcuts**: `Cmd/Ctrl + =` zoom in, `Cmd/Ctrl + -` zoom out, `Cmd/Ctrl + 0` reset

**Persistence** (dual path, same pattern as font selector):

1. `vscode.setState({ zoomLevel })` — survives tab switches (webview state)
2. `context.globalState.update("markdownEditorZoom", zoom)` — survives restarts (extension state)
3. On init: restore from webview state first (immediate), then extension sends `savedZoom` message
4. At zoom 100%: `globalState` key is removed (`undefined`) to keep clean state

**Message types**: `zoomChange` (webview → extension), `savedZoom` (extension → webview)

**Coordinate safety**: CSS `zoom` in Chromium is transparent to JS coordinate APIs (`getBoundingClientRect`, `clientX/Y`, `elementFromPoint` all operate in viewport coordinate space). Plugins using `posAtCoords`, table context menu, image edit — all verified safe because dropdown/overlay elements are appended to `#editor-container` (parent of `.tiptap`, not zoomed).

## Appearance Popover

**UI** (in `src/markdownEditorProvider.ts` HTML + CSS):

* Gear icon button (`#btn-appearance`) with `aria-haspopup="true"` toggles `#appearance-popover`
* Popover contains three rows: Zoom controls, Theme select, Font selector (grid layout: 60px label + 1fr control)
* Positioned `absolute`, `top: calc(100% + 8px)`, `right: 0`, `z-index: 1000`
* Background uses VS Code native `--vscode-editorWidget-*` variables (not toolbar glass styling) for theme-aware contrast
* Input surfaces inside popover override with `rgba(127, 127, 127, 0.15)` neutral tint (works for both light & dark)
* `max-width: calc(100vw - 16px)` prevents overflow on narrow viewports

**Interaction** (in `src/webview/main.ts`):

* Toggle: click `#btn-appearance` → open/close with `is-active` class
* Close: click outside (document click listener), Escape key (returns focus to gear button)
* `stopPropagation` on popover clicks prevents close-on-click-inside
* Font selector Escape handler includes `stopPropagation()` to prevent closing popover when only closing dropdown

**View Source button**: Moved to standalone `toolbar-btn` with `</>` SVG icon (replaces old `.view-source-btn` text button)

## Toolbar Auto-hide

**Feature** (in `src/webview/main.ts`):

* `setupToolbarAutoHide(autoHide: boolean)` — controlled by `tuiMarkdown.autoHideToolbar` setting
* Typing in `.tiptap` triggers 3s hide timeout
* `#toolbar-hover-zone` (top 8px) reveals toolbar on mouseenter
* Toolbar mouseenter/focus also reveals
* CSS: `.toolbar-hidden` class with opacity/transform transition

## Reading Progress & Word Count

**Reading Progress** (in `src/webview/main.ts`):

* `setupReadingProgress()` — listens to `#editor-container` scroll event (passive)
* `#reading-progress` fixed bar at top, width tracks scroll percentage
* CSS gradient using `--accent-rgb`

**Word Count** (in `src/webview/main.ts`):

* `updateWordCount(editor)` — debounced 500ms, triggered on `tr.docChanged`
* `#word-count` element displays word count via `textContent.split(/\s+/).length`

## Page Break

**Styling** (in `src/markdownEditorProvider.ts`):

* `---` renders as a visual page break separator instead of a thin horizontal rule

* Dashed line (`border-top: 1.5px dashed`) using `--crepe-color-outline` for theme adaptation

* `::after` label `✦ PAGE BREAK ✦` — monospace, uppercase, letter-spacing `0.18em`

* Label background matches editor background (`--vscode-editor-background`) to "cut" the dashed line

* Hover: accent color (`--accent-rgb`) + subtle letter-spacing expansion (`0.18em` → `0.22em`)

* Dark theme override: label uses `rgba(255, 255, 255, 0.35)` for visibility

* Toolbar button: "Page Break" label with split-arrows icon

* Markdown syntax unchanged: `---` (parsed/serialized by `@tiptap/markdown` default HorizontalRule)

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

## Heading Collapse

**Plugin** (`src/webview/heading-collapse-plugin.ts`):

* ProseMirror plugin for visual-only heading collapse/expand toggles

* Decoration-based: no schema changes, no markdown impact

* **Toggle arrow**: `Decoration.widget` at `pos + 1` with `side: -2` (renders before badge)

* **Content hiding**: `Decoration.node` with `collapsed-content` class on section nodes below collapsed heading

* **Stable heading keys**: `"H{level}:{text}:{occurrence}"` to survive position shifts; changes when heading text edited

* **Section detection**: Collapses all nodes until next heading at same or higher level, or end of document

* **State tracking**: `Map<string, boolean>` in plugin state for collapsed heading keys

* **Click handler**: `handleDOMEvents.click` on toggle arrow to dispatch transaction with collapse meta

**State Persistence** (in `src/webview/main.ts`):

* Saved in `vscode.setState()` under `collapsedHeadings: string[]`

* Restored after editor init via `setCollapsedHeadings()` helper

* Updated on transaction via `onTransaction` hook when collapse meta present

**CSS** (in `src/markdownEditorProvider.ts`):

* Toggle arrow overlaps heading-level-badge at same position (`left: -15px; top: 3px`), hidden by default (`opacity: 0`)

* **Hover swap**: On heading hover, badge fades out (`opacity: 0`) and arrow fades in (`opacity: 0.6`) — click to toggle collapse

* **Collapsed state**: Arrow always visible, badge always hidden (via `.heading-collapsed-indicator` parent class)

* Arrow colors: light `rgba(0, 0, 0, 0.5)`, dark `rgba(255, 255, 255, 0.5)`, `z-index: 2` above badge

* Collapsed content: `display: none !important` to hide section nodes

* Collapsed heading indicator: dashed border (1px, 0.15 opacity)

* `prefers-reduced-motion`: disables transitions

**Coexistence**:

* **Heading level badge**: Both at `pos + 1`, same absolute position; CSS hover-swap mechanism — arrow has `z-index: 2` above badge

* **TOC sidebar**: Independent heading extraction; TOC continues to track all headings (including hidden ones for state persistence)

* **Line highlight**: Won't highlight nodes with `display: none`

* **Markdown output**: `editor.getMarkdown()` unaffected — decorations are visual-only

## TOC Sidebar

**Module** (`src/webview/toc-sidebar.ts`):

* Standalone module: extract headings, build nested tree, render DOM, active tracking

* `extractHeadings(doc)`: Traverses `doc.descendants()` for heading nodes (same pattern as heading-level-plugin)

* `buildTocTree(flat)`: Stack-based nesting algorithm converting flat heading list to tree

* `updateTocFromEditor(editor, docChanged)`: Debounced rebuild (200ms) on doc changes, immediate active heading update on selection

**Layout** (in `src/markdownEditorProvider.ts`):

* `#main-layout` flexbox wrapper: sidebar (220px fixed) + editor container (flex: 1)

* Sidebar hidden by default (`.hidden` class), toggle via toolbar button

* Responsive: 180px width on viewports < 600px

**Integration** (in `src/webview/main.ts`):

* `setupTocHandlers()`: Registers toolbar toggle button

* `initTocSidebar()`: Called after editor init, restores visibility state AFTER content populated

* State persisted in `vscode.setState()`: `tocVisible`

* Hooked into `onTransaction` (not `onSelectionUpdate` — onTransaction covers both)

**Key patterns:**

* DOM scroll: `view.nodeDOM(pos)` + `requestAnimationFrame` with 60px top offset for precise heading positioning

* XSS safe: Uses `textContent` (not `innerHTML`) for heading text

* `vscode.setState()` must use spread pattern: `{ ...getState(), key: value }` to preserve other state (theme, TOC)

## Search (Cmd+F)

**Plugin** (`src/webview/search-plugin.ts`):

* Tiptap Extension wrapping `prosemirror-search` package
* `search()` ProseMirror plugin provides decoration-based match highlighting
* `SearchQuery({ search, caseSensitive })` configures the search
* `setSearchState(tr, query)` sets query via transaction meta
* `findNext(state, dispatch)` / `findPrev(state, dispatch)` — standard ProseMirror commands
* `getMatchHighlights(state)` returns DecorationSet; `.find()` gives match count
* `Mod-f` intercepted via `addKeyboardShortcuts()`, dispatches `CustomEvent("toggle-search-bar")`

**Search Bar UI** (in `src/markdownEditorProvider.ts` HTML + CSS):

* Positioned between `#toolbar` and `#metadata-panel` in DOM
* Glassmorphic style matching toolbar (`backdrop-filter: blur(12px)`, CSS variables)
* Slide-down animation: `max-height: 0` → `40px` with `0.15s ease-out` transition
* `.hidden` class controls visibility (same pattern as TOC sidebar)
* Input debounced at 150ms, "no-results" red border on 0 matches

**Keyboard shortcuts**: `Mod-f` toggle, `Enter` next, `Shift+Enter` prev, `Escape` close

**CSS classes**: `.ProseMirror-search-match` (all matches, `rgba(--accent-rgb, 0.2)`), `.ProseMirror-active-search-match` (active, `0.45`). Dark theme uses higher opacity (`0.25`/`0.5`).

**Dependencies**: `prosemirror-search@^1.1.0`

## Font Selector

**Module** (`src/webview/font-selector.ts`):

* Searchable combobox component: text input + dropdown with all system fonts
* `sanitizeFontName()`: Strips `";\{}` characters to prevent CSS injection
* Search ranking: prefix matches first, then contains matches, max 80 displayed
* Each dropdown item previewed in its own font face
* Keyboard: Arrow keys navigate, Enter selects, Escape closes
* API: `setFonts()`, `setSelected()`, `getSelected()`, `destroy()`

**System Font Enumeration** (`src/markdownEditorProvider.ts`):

* macOS: `NSFontManager` via JXA (`osascript -l JavaScript`)
* Windows: PowerShell `InstalledFontCollection` with UTF-8 encoding
* Linux: `fc-list : family`
* Cached as `static cachedFonts` — enumerated once per VSCode session

**Data Flow**:

1. Webview `ready` → Extension sends `savedFont` (from `globalState`) + async `systemFonts`
2. User selects font → Webview overrides `--crepe-font-default` CSS var on `.tiptap` element
3. Webview persists via `vscode.setState({ fontFamily })` + sends `fontChange` message
4. Extension saves to `context.globalState` key `"markdownEditorFont"`
5. "Default" option removes CSS override, restoring theme's built-in font

**Key details**:

* Only overrides `--crepe-font-default` — never touches `--crepe-font-code`
* Font override survives theme changes (inline style > CSS class)
* `try/catch` around async `postMessage` to handle webview disposed during font enum

## File Mention (@)

**Plugin** (`src/webview/file-mention-plugin.ts`):

* Tiptap Extension using `@tiptap/suggestion` addon
* `char: "@"` trigger opens popup with workspace file list
* `allow()` blocks trigger inside `codeBlock` and after word characters (prevents email `user@domain`)
* Fuzzy filter: prefix match priority > contains, case-insensitive, max 20 results
* Insert: `[escapedName](<path>)` — angle brackets handle spaces, `]` escaped in filename
* Popup appended to `#editor-container` (not `.tiptap`) — avoids CSS zoom issues

**Cache strategy:**

* `onStart`: dispatch `file-mention-search` CustomEvent → main.ts forwards as `fileSearch` postMessage → extension calls `findFiles("**/*", excludePattern, 1000)` → returns `fileSearchResults`
* main.ts calls `setFileMentionFiles(files)` to populate module-level cache
* Subsequent typing filters locally from cache (no round-trip)
* Cache cleared on `onExit` (popup close), refetched on next open

**Extension side** (`src/markdownEditorProvider.ts`):

* Case `"fileSearch"`: calls `vscode.workspace.findFiles()` with exclude `{**/node_modules/**,**/.git/**,**/.vscode/**,**/out/**,**/dist/**,**/.DS_Store}`, max 1000 results
* Returns `{ type: "fileSearchResults", files: [{name, path}] }`

**Message types**: `fileSearch` (webview → extension), `fileSearchResults` (extension → webview)

**CSS**: `.file-mention-popup`, `.file-mention-item`, `.file-mention-icon`, `.file-mention-name`, `.file-mention-path`, `.file-mention-empty`. Glassmorphic style matching toolbar.

**Dependencies**: `@tiptap/suggestion@^3.19.0`

## Link Click Navigation

**Behavior** (in `src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* **Ctrl+Click** (`Cmd+Click` on macOS) triggers link navigation; regular click places cursor normally

* **Anchor links** (`#heading-slug`): `scrollToHeading()` traverses `doc.descendants()`, generates GitHub-style slug (lowercase, special chars removed, spaces→hyphens), scrolls matching heading into view via `scrollIntoView({ behavior: "smooth" })`

* **Relative file links** (`./file.md`, `../docs/readme.md`): Webview sends `openLink` message → Extension resolves path against `document.uri.fsPath` → `vscode.workspace.openTextDocument()` + `showTextDocument()`

* **External URLs** (`https://...`): Extension calls `vscode.env.openExternal()`

* **Cursor style**: `body.ctrl-held` class toggled via keydown/keyup listeners; CSS shows pointer cursor + underline on `.tiptap a`

**Message type**: `openLink` (webview → extension, payload: `{ href: string }`)

## Code Block Enhancement

**Plugin** (`src/webview/code-block-plugin.ts`):

* Tiptap Extension using ProseMirror `Decoration.widget` at `pos + 1` (inside codeBlock, before content)

* **Language badge**: Displays normalized language name with chevron; click opens dropdown selector (19 languages)

* **Copy button**: Clipboard icon, appears on code block hover (`opacity: 0` → `0.6`); checkmark feedback on copy (1.5s)

* **Language aliases**: Maps common abbreviations (`js`→`javascript`, `ts`→`typescript`, `py`→`python`, etc.)

* **Mermaid skip**: Ignores `language === "mermaid"` blocks (handled by mermaid-plugin)

* **Selective rebuild**: Only rebuilds decorations on `tr.docChanged` (not selection changes)

**CSS classes**: `.code-block-header`, `.code-lang-badge`, `.code-lang-dropdown`, `.code-lang-item`, `.code-copy-btn`

## Glassmorphic Toolbar

**Styling** (in `src/markdownEditorProvider.ts`):

* `backdrop-filter: blur(12px)` with `@supports` fallback to solid background

* Theme-aware via CSS custom properties: `--toolbar-bg-rgb`, `--border-rgb`, `--toolbar-fg`

* All 12 themes expose body-level variables for toolbar and UI elements outside `.tiptap`

* Icons: Stroke-based Lucide SVGs (`fill: none; stroke: currentColor; stroke-width: 2`)

* Select dropdowns: Custom `appearance: none` with SVG chevron arrow

* Active button: Accent-colored background (`rgba(--accent-rgb, 0.15)`)

* Press interaction: `transform: scale(0.93)` on `:active` with bounce easing

## Mermaid Diagrams

**Plugin** (`src/webview/mermaid-plugin.ts`):

* Tiptap Extension wrapping a ProseMirror plugin with widget decorations

* Renders SVG previews after `mermaid` code blocks using `mermaid` library (v11)

* **View/Edit mode**: View mode (default) hides code block, shows SVG only; double-click preview enters edit mode (code + preview stacked); cursor leave returns to view mode

* **Selective re-render**: `rebuildNodeDecosOnly()` preserves widget DOM elements when only selection changes (no flicker)

* **Render caching**: `renderCache` Map avoids re-rendering identical diagrams

* **Theme sync**: `updateMermaidTheme(isDark)` + `clearMermaidCache()` called on theme change

* **Debounced rendering**: 500ms debounce per code block position to avoid excessive renders during typing

* **Error handling**: Parse errors shown inline with `mermaid-error` class, stale temp elements cleaned up

* **Fullscreen expand**: Widget decoration contains `.mermaid-svg-host` (SVG target for `innerHTML`) + `.mermaid-expand-btn` sibling (top-left, hover fade-in, hidden on error/editing). Click reads `svgEl.outerHTML` and calls `openMermaidLightbox()`

**CSS classes**: `.mermaid-code-block`, `.mermaid-editing`, `.mermaid-preview`, `.mermaid-svg-host`, `.mermaid-error`, `.mermaid-expand-btn`, `.mermaid-copy-btn`

**Dependencies**: `mermaid@^11.12.2`

**Security note — `securityLevel: "loose"`**: Mermaid is initialized with `securityLevel: "loose"` in both `ensureMermaidInit()` and `updateMermaidTheme()` (decision D1 in `_bmad-output/implementation-artifacts/plan-export-rewrite-overview.md`). "loose" is required so ELK can render `foreignObject` HTML inside labels — "strict" strips HTML and the layout looks flat. Trade-off: a mermaid label can contain inline HTML such as `<img onerror=...>`, which is passed through to the rendered SVG. That SVG is then written to the DOM via `innerHTML` in both the preview host and the lightbox wrapper. **Implication**: treat third-party mermaid source (pasted from untrusted markdown) as potentially executable. The PDF exporter disables JavaScript in the Chromium page so this does not escalate there; the webview itself relies on VS Code's webview sandbox. Do NOT relax the sandbox or enable `--allow-scripts` for mermaid rendering.

## Mermaid Copy as PNG

**Module** (`src/webview/svg-to-png.ts`):
* `svgToPngBlob(svgString, scale = 2)`: DOMParser → ensure `width`/`height` (fallback to `viewBox`) → Blob SVG → `URL.createObjectURL` → `<Image>` → `canvas.drawImage` at `native * scale` → `canvas.toBlob('image/png')`. Scales via canvas (not CSS) to ensure crisp PNG at all DPIs.
* `copyPngBlobToClipboard(blob)`: `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`. Throws if `ClipboardItem` or `clipboard.write` is unavailable.
* `reportCopyError(message)`: Dispatches `CustomEvent('mermaid-copy-error', { detail: { message } })` on `document`. Keeps the module decoupled from the vscode API handle.

**Preview button** (`src/webview/mermaid-plugin.ts`):
* `.mermaid-copy-btn` injected next to `.mermaid-expand-btn` in the widget decoration (same button creation loop). Click: queries `svg` in `.mermaid-svg-host` → `svgToPngBlob` → `copyPngBlobToClipboard` → `flashCopiedState()` (adds `.is-copied` for 1.5s, two `<svg>` icons copy/check toggled via CSS).
* Auto-hidden via CSS when `.mermaid-error`, `.mermaid-editing`, or `data-rendered="true"` is not set.

**Lightbox button** (`src/webview/image-lightbox-plugin.ts`):
* `#lightbox-copy` in `.lightbox-controls` (before the close button). Wired in `initLightbox`, visibility toggled via `setCopyButtonVisibility()`:
  * `openMermaidLightbox` → visible
  * `openLightbox` (image) and `closeLightbox` → hidden
* Click reads SVG from `#lightbox-svg.querySelector('svg')` → same flow as preview.

**Error forwarding** (`src/webview/main.ts`):
* Listener `document.addEventListener('mermaid-copy-error', ...)` forwards `detail.message` to the extension via `vscode.postMessage({ type: 'showWarning', message })`. Keeps `svg-to-png.ts` from needing an `acquireVsCodeApi()` reference.

**Gotchas**:
* Lightbox strips `width`/`height` attributes from SVG (for free zoom), but `svgToPngBlob` already normalizes via `resolveSvgSize()` (reads `viewBox` when attributes are missing) then sets them back before serializing.
* Clipboard requires secure context — VS Code webview qualifies. If an older runtime lacks `ClipboardItem`, the button throws an error, which is forwarded as a VS Code warning dialog.
* `XMLSerializer` + Blob SVG avoids inline `<script>` → CSP-safe, no CSP tweaking needed.

## GitHub-Style Alerts

**Extension** (`src/webview/alert-extension.ts`):

* Custom `AlertNode` Tiptap node for `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`

* **Integration**: Blockquote extension (from StarterKit) is extended in `main.ts` to override `parseMarkdown` — detects `[!TYPE]` prefix and creates `alert` node instead of `blockquote`

* **Serialization**: `renderMarkdown()` outputs `> [!TYPE]\n> content` format

* **DOM output**: `<div data-alert-type="note" class="alert alert-note">...</div>`

* **Helper functions**: `getFirstText()` walks token children, `stripAlertPrefix()` removes `[!TYPE]` from parsed tokens

**CSS**: Color-coded alert boxes with icons, dark theme support (in `markdownEditorProvider.ts`)

## Table Context Menu

**Extension** (`src/webview/table-context-menu.ts`):

* Right-click context menu for table operations using ProseMirror plugin

* **Actions**: Select Row/Column/Table, Add Row Above/Below, Add Column Before/After, Delete Row/Column/Table

* **Selection**: Uses `CellSelection`, `TableMap`, `cellAround` from `@tiptap/pm/tables`

* **Positioning**: Container-relative coordinates with overflow adjustment

* **Cleanup**: Closes on Escape key, click outside, or editor scroll

**CSS**: `.table-context-menu`, `.table-ctx-item`, `.table-ctx-divider` (in `markdownEditorProvider.ts`)

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

## Export (DOCX / PDF)

**Shared pipeline** (`src/utils/markdown-ast.ts`):

* Extension host parses the raw document (only the BOM stripped, frontmatter handled by `remark-frontmatter`) into a single MDAST once per export via `parseMarkdownToMdast()`.
* The provider pops the leading `yaml`/`toml` node so frontmatter is not rendered as content.
* Mermaid code blocks are swapped for `image` nodes via `replaceMermaidBlocks()`. Correlation key: `hashMermaidCode()` — djb2 with `\r\n|\r → \n` normalization + trim, so CRLF files match the LF-normalized code the webview has in `data-mermaid-src`.
* Both exporters consume the same MDAST — no regex replace drift between webview text and export text.
* Webview pre-renders mermaid to PNG via `svg-to-png.ts` (DOMParser + native `canvas.toBlob`), sends `{ code, base64 }[]` in the `export` message. `svg-to-png.ts` falls back to 800×600 with `console.warn` when the SVG has no width/height/viewBox.

**Provider hook** (`src/markdownEditorProvider.ts` case `"export"`):

* Enforces a single-in-flight export per webview via the `exportInProgress` flag. A second click while busy gets rejected with "Export in progress, please wait for the current export to finish." + `exportDone {success: false, reason: "busy"}` back to the webview.
* On success or error, extension sends `exportDone` so the webview can re-enable its button without relying on a 3 s timeout. The webview also keeps a 60 s safety timer in case the message is lost.
* After building the MDAST, provider warns "Document is empty, nothing to export." when `mdast.children` is empty (or was only frontmatter).

**DOCX** (`src/utils/export-docx.ts`):

* `mdast2docx` core + `@m2d/html`, `@m2d/image`, `@m2d/table`, `@m2d/list` plugins.
* Node-side `imageResolver` handles data URLs, `http(s)` fetch, and relative file paths against the document directory. Failure modes are non-fatal — the resolver returns a 1×1 transparent PNG placeholder so one broken image does not kill a 50-image export. Warnings log to the console.
* Remote fetch uses `AbortController` with a 30 s timeout and rejects when `content-length` OR the downloaded `arrayBuffer` exceeds 10 MB.
* SVG images (not the mermaid data-URL kind) cannot be embedded in DOCX — resolver returns the placeholder + warns instead of throwing.
* `decodeURIComponent` is wrapped in `safeDecodeURIComponent` to survive filenames with literal `%` (e.g. `50%_off.png`).
* `fontFamily` option is applied via `docxProps.styles.default.document.run.font` so DOCX inherits the editor's active font.

**PDF** (`src/utils/export-pdf.ts`):

* MDAST → HAST via `remark-rehype` (`allowDangerousHtml: true`) + `rehype-highlight` (`detect: false, ignoreMissing: true`).
* Before stringify, `inlineRelativeImages(hast, baseDir)` walks the tree, reads any `<img>` with a relative/local path from disk, and rewrites `src` to a `data:` URL. Without this, Chromium's `about:blank` page would 404 all relative image references.
* `rehype-stringify` then produces HTML, which is passed through `stripDangerousHtmlTags()` to remove `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, and `<meta http-equiv>` tags. This is a narrow defence-in-depth strip, not a full sanitizer — it pairs with JS-disabled Chromium.
* HTML is wrapped in a GitHub-like document template (`buildHtmlDocument`). Font family user chose is passed through `cssFontFamilyToken()` — NOT `escapeHtml`. CSS `<style>` text does not decode HTML entities, so a whitelist strip (`[A-Za-z0-9 _-]`) is used to keep the `font-family` declaration valid.
* Chromium launch: `puppeteer.launch({ args: puppeteerLaunchArgs() })`. `puppeteerLaunchArgs()` returns `["--no-sandbox", "--disable-setuid-sandbox"]` ONLY on Linux-as-root — macOS/Windows/Linux-as-user keep Chromium's default sandbox.
* `page.setJavaScriptEnabled(false)` before `setContent`. `waitUntil: "networkidle0"` so inlined images finish decoding before `page.pdf()` prints.
* Launch errors are wrapped: "Failed to launch Chromium at `<path>`: <original>. Check execute permission or configure tuiMarkdown.chromiumPath."
* Extension does NOT ship a Chromium binary. `chromium-discovery.ts` looks up an installed Chrome/Edge/Chromium/Brave via (in order): `tuiMarkdown.chromiumPath` setting → `PUPPETEER_EXECUTABLE_PATH` env → OS-specific well-known paths. First hit is cached for the session.
* Path validation uses `fs.accessSync(path, X_OK)` on top of `isFile()`. Leading/trailing quotes in the setting value are stripped so `"C:\...\chrome.exe"` works.
* The provider listens for `tuiMarkdown.chromiumPath` changes via `onDidChangeConfiguration` and calls `clearChromiumCache()` — no reload needed. (`clearChromiumCache` is re-exported from `export-pdf.js` so the provider can reach it without a separate bundle entry for `chromium-discovery`.)
* Bundling: `puppeteer-core` is bundled INTO `out/export-pdf.js` via esbuild tree-shake (~2.5MB minified) — NOT external. `.vscodeignore` excludes `node_modules/**`, so external wouldn't ship.

**Gotchas**:

* **VS Code Electron is not a Chromium puppeteer can drive.** `process.execPath` in the extension host points at an Electron helper — launching puppeteer against it fails. This is why the discovery module explicitly does not try `process.execPath`.
* **Chromium is required on the user's machine.** PDF export surfaces an "Open Settings" error dialog when no binary is found. Fallback was intentionally NOT implemented to keep the bundle small and the pipeline WYSIWYG.
* **Do NOT add `--disable-web-security` or re-enable JS** on the puppeteer page. `--no-sandbox` is also gated to Linux root only — do not widen.
* **Do NOT drop `stripDangerousHtmlTags` or `inlineRelativeImages`.** They are the reason user markdown with `<iframe src="file:///...">` or `![](./img.png)` behaves safely and correctly.
* `findChromiumExecutable()` result is cached per session — clear with `clearChromiumCache()` if a test needs to re-probe. The provider auto-clears on `tuiMarkdown.chromiumPath` changes.
* Mermaid rendering is done client-side (webview) and shipped to the extension as base64 data URLs, so the exporters don't need mermaid / graphviz installed on the host.
* Hash stability: webview's `data-mermaid-src` holds ProseMirror's `node.textContent` (already LF-normalized), extension hashes remark-parse's `node.value` — both go through `hashMermaidCode` which re-normalizes line endings, so CRLF files and indented fences still match.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tui-milkdown-vscode** (606 symbols, 1351 relationships, 50 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/tui-milkdown-vscode/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/tui-milkdown-vscode/context` | Codebase overview, check index freshness |
| `gitnexus://repo/tui-milkdown-vscode/clusters` | All functional areas |
| `gitnexus://repo/tui-milkdown-vscode/processes` | All execution flows |
| `gitnexus://repo/tui-milkdown-vscode/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
