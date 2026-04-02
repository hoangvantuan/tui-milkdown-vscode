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

* Webview persists theme selection and TOC state in `vscode.setState()` (use spread pattern: `{ ...getState(), key: value }`)

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
│   └── image-rename-handler.ts # Image rename/delete detection, execution, workspace reference updates
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
    ├── table-markdown-serializer.ts # Custom GFM table serializer (multi-line cells)
    ├── table-cell-content-parser.ts # Post-parse transformer for table cell lists/breaks
    ├── table-context-menu.ts # Right-click context menu for table operations
    ├── search-plugin.ts      # Cmd+F search via prosemirror-search (highlight, next/prev, match count)
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

**Extensions:** StarterKit (includes Link with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via prosemirror-search).

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
* Images: 6px border-radius, hover shadow
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

* `readClipboardImage`: Webview → Extension (request native clipboard read as fallback)

* `clipboardImage`: Extension → Webview (base64 PNG from system clipboard)

**Clipboard Image Fallback** (triple strategy in `src/webview/main.ts`):

1. ProseMirror `handlePaste` (editorProps) — standard `clipboardData.items`/`files`
2. `navigator.clipboard.read()` — async Clipboard API (may need permission)
3. Extension-side native read — `osascript` (macOS), PowerShell (Windows), `xclip` (Linux)

## Image Lightbox

**Plugin** (`src/webview/image-lightbox-plugin.ts`):

* Fullscreen overlay with dark backdrop, zoom controls (0.5x–4x)
* Expand button added to image hover overlay (alongside edit button) in `image-edit-plugin.ts`
* Zoom via buttons (+/−), mouse wheel, or keyboard (+/−/0 for reset)
* Caption from image alt text
* Close via Escape, backdrop click, or close button
* `openLightbox(src, alt)` / `closeLightbox()` exported API
* `initLightbox()` called once in `init()`

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

**CSS classes**: `.mermaid-code-block`, `.mermaid-editing`, `.mermaid-preview`, `.mermaid-error`

**Dependencies**: `mermaid@^11.12.2`

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

