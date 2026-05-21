# Editor Core

Toolbar, appearance, zoom, search, line highlight, reading progress, page break.

## Toolbar

**Layout** (in `src/markdownEditorProvider.ts` HTML + CSS):

* Sticky toolbar at top with formatting buttons, heading select, theme select, and View Source
* VSCode editor title bar: `$(code)` icon (WYSIWYG → Source) and `$(eye)` icon (Source → WYSIWYG) via `tuiMarkdown.viewSource` / `tuiMarkdown.viewRichText` commands
* Buttons grouped by category with separators: Text formatting | Heading | Lists | Blocks | Table & Link | Source & Appearance
* Table context buttons (add/delete column/row, delete table) appear only when cursor is inside a table
* Active state highlighting: buttons show `is-active` class based on current selection

**Commands** (in `src/webview/main.ts`):

* `TOOLBAR_COMMANDS` record maps `data-command` attributes to Tiptap chain commands
* `updateToolbarActiveState()` called on `onSelectionUpdate` and `onTransaction` to sync button states
* Heading select dropdown switches between Paragraph and H1-H6
* Table context visibility: walks `$from.node(d)` ancestors to detect if cursor is inside a table

**Link editing**: Uses async message flow (webview → extension `showInputBox` → webview) since VSCode webview sandbox blocks `prompt()`

## Glassmorphic Toolbar

**Styling** (in `src/markdownEditorProvider.ts`):

* `backdrop-filter: blur(12px)` with `@supports` fallback to solid background
* Theme-aware via CSS custom properties: `--toolbar-bg-rgb`, `--border-rgb`, `--toolbar-fg`
* All 12 themes expose body-level variables for toolbar and UI elements outside `.tiptap`
* Icons: Stroke-based Lucide SVGs (`fill: none; stroke: currentColor; stroke-width: 2`)
* Select dropdowns: Custom `appearance: none` with SVG chevron arrow
* Active button: Accent-colored background (`rgba(--accent-rgb, 0.15)`)
* Press interaction: `transform: scale(0.93)` on `:active` with bounce easing

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
