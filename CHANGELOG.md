# Changelog

All notable changes to "TUI Markdown Editor" extension.

## [2.13.0] - 2026-05-25

### Added

- **Design Token System**: 3-tier CSS custom property architecture (primitive → semantic → component) with backwards-compatible adapter for legacy themes
- **Soft Modular Theme**: Flagship light + dark theme using primitive token references
- **Glass Popover**: Shared `backdrop-filter: blur(16px) saturate(180%)` class for file mention, wiki link, code block dropdowns

### Improved

- **All 12 Themes**: Critical fixes (missing highlights, inverted surfaces, outline contrast), per-theme polish (inline code, accent roles), 8 new tokens per theme
- **Component Styling**: Toolbar, editor surface, headings, blockquotes, code blocks, images, tables, alerts, TOC sidebar, metadata panel, search bar, line highlight all upgraded to semantic tokens
- **Dark Mode**: 18+ hardcoded `body.dark-theme` CSS overrides eliminated via semantic token auto-adaptation

## [2.12.0] - 2026-05-21

### Improved

- **File Search**: Fuzzy matching cho @ mention và [[ wiki link (fuzzysort)
- **File Search**: Proximity scoring ưu tiên file gần document đang mở
- **File Search**: File type icons (10 nhóm) trong popup
- **File Search**: Wiki link giờ filter cả path, không chỉ filename
- **File Search**: Dùng VSCode `files.exclude` setting thay vì exclude cố định
- **File Search**: Nâng giới hạn từ 1000 lên 5000 files
- **File Search**: Highlight matched characters trong popup

## [2.11.0] - 2026-05-21

### Added

- **Implicit Frontmatter**: Support frontmatter without opening `---` delimiter. YAML key-value pairs at file start terminated by `---` are now detected and parsed into the metadata panel. Detection uses heuristic (valid YAML object, 2+ keys, at least 1 known metadata key). File format preserved on save: implicit stays implicit, standard stays standard.
- **Editor Title Bar Toggle**: Toggle icons on VSCode editor title bar to switch between WYSIWYG and source view. `$(code)` icon when in WYSIWYG, `$(eye)` icon when in text editor. Works for `.md` and `.markdown` files.

### Changed

- **Shared frontmatter parser**: Extracted parse/reconstruct logic from `src/webview/frontmatter.ts` into `src/utils/frontmatter-parser.ts`, shared by both webview and extension bundles. Export pipeline (DOCX/PDF) now strips frontmatter via shared parser before MDAST processing.

## [2.10.0] - 2026-05-21

### Added

- **Wiki Link (`[[...]]`)**: Obsidian-style wiki links with `[[` trigger popup, `.md` file autocomplete, inline node rendering with file icon, Ctrl/Cmd+Click to open file, markdown roundtrip via custom MarkedJS tokenizer, DOCX/PDF export support (strips to plain text)

## [2.9.0] - 2026-05-14

### Added

- **File Mention (@)**: Type `@` in the editor to open an autocomplete popup listing workspace files. Select a file to insert a markdown link `[filename](path)` at cursor. Fuzzy search with prefix priority, keyboard navigation (Arrow keys, Enter, Escape), glassmorphic popup matching toolbar style. Blocked inside code blocks and email addresses.

## [2.8.9] - 2026-05-05

### Fixed

- **Search scroll to match (#52)**: Clicking "Search Down/Up" buttons or pressing Enter in search bar now scrolls the matched keyword to the center of the viewport. Previously, matches were found and highlighted but the page didn't scroll because ProseMirror's `scrollToSelection` bails when DOM focus is outside the editor.

## [2.8.8] - 2026-05-05

### Fixed

- **Lightbox touch gestures**: Two-finger drag now pans the image (when zoomed in) instead of triggering browser's default pinch-to-zoom. Disabled native touch gestures on lightbox overlay via `touch-action: none`.
- **Lightbox tap-outside-to-close**: Tapping anywhere outside the image/SVG and controls now closes the lightbox. Works for both mouse click and touch tap.

## [2.8.6] - 2026-04-22

### Added

- **Export to DOCX**: Export documents to Word `.docx` via `mdast2docx` + plugins (`@m2d/html`, `@m2d/image`, `@m2d/table`, `@m2d/list`). Preserves headings, lists, tables, code blocks, and images. DOCX font inherits the editor's currently selected font.
- **Export to PDF**: Export documents to WYSIWYG PDF using headless Chromium (`puppeteer-core`). Requires Chrome/Edge/Chromium/Brave installed on the system; no binary bundled with the extension. Auto-detects common paths, falls back to `tuiMarkdown.chromiumPath` or env `PUPPETEER_EXECUTABLE_PATH`.
- **Setting `tuiMarkdown.chromiumPath**`: Allows manually specifying the Chrome/Edge/Chromium/Brave path for PDF export when auto-detection does not find the correct binary.

### Changed

- **PDF export rewritten with puppeteer-core**: Removed `pdfmake` + custom 339-line markdown parser + bundled Roboto font. New pipeline: MDAST → HTML (`remark-rehype` + `rehype-highlight` + `rehype-stringify`) → Chromium `page.pdf()`, delivering WYSIWYG quality matching the preview (syntax-highlighted code, GitHub tables, alerts, mermaid base64). Requires Chrome/Edge/Chromium/Brave installed on the user's machine, auto-detected via `tuiMarkdown.chromiumPath` → `PUPPETEER_EXECUTABLE_PATH` → well-known system paths. Bundle `out/export-pdf.js` tree-shakes puppeteer-core to ~2.5MB, total VSIX ~5.4MB.
- **Removed MDAST→markdown bridge for PDF**: Call sites now pass MDAST directly to both `exportToPdf` and `exportToDocx`, eliminating serialize/parse drift risk. `mdastToMarkdown` function + `remark-stringify` dependency removed.
- **Mermaid `securityLevel` changed to `"loose"**`: Required for ELK + `foreignObject` to render HTML inside labels. Trade-off: generated SVG may contain raw HTML from markdown; treat mermaid from untrusted sources as potentially executable. PDF export disables JavaScript in Chromium to prevent escalation.

### Fixed

- **PDF render relative image**: Local images (`./img.png`) are now inlined as base64 before entering Chromium instead of loading from `about:blank` (which silently 404s). New pipeline walks HAST, reads files, encodes data URLs.
- **Safe frontmatter handling**: Removed manual regex stripping, using `remark-frontmatter` in the MDAST pipeline for proper frontmatter parsing. BOM ``﻿ is still stripped before parsing.
- **Mermaid hash CRLF/LF mismatch**: `hashMermaidCode` normalizes line endings `\r\n|\r` → `\n` before trimming, ensuring CRLF files do not miss mermaid export.
- **DOCX remote fetch timeout**: `AbortController` 30s + `content-length` / `arrayBuffer.byteLength` check capped at 10MB. Failed fetches (timeout, HTTP error, oversized) → placeholder 1x1 PNG instead of aborting the entire export.
- **DOCX missing local image**: `fs.readFile` failure no longer crashes the entire export; replaced with placeholder + log warning. SVG images also fall back to placeholder instead of throwing.
- **DOCX filename with literal `%**`: `decodeURIComponent("50%_off.png")` throwing `URIError` no longer crashes export; wrapped with try/catch, falls back to raw path.
- **Export button race duplicate**: Extension tracks `exportInProgress` flag; a second request while exporting is rejected with dialog "Export in progress, please wait". Webview re-enables button via `exportDone` message instead of relying on a fixed 3s timeout.
- **Empty document warning**: Exporting an empty file or one with only frontmatter shows warning "Document is empty, nothing to export" instead of silently generating an empty file.
- **PDF font-family CSS context**: User-selected font is now sanitized via whitelist `[A-Za-z0-9 _-]` instead of `escapeHtml` (CSS `<style>` does not decode HTML entities; previously fonts with `"` made the declaration invalid).
- **PDF Chromium sandbox conditional**: `--no-sandbox` only passed on Linux + root; macOS/Windows/Linux users keep default Chromium isolation.
- **PDF strip dangerous HTML**: Removes `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<meta http-equiv>` before feeding to Chromium (supplements `setJavaScriptEnabled(false)`).
- **PDF `waitUntil: "networkidle0"**`: Changed from `"load"` to `"networkidle0"` to wait for all images to load before `page.pdf()` runs.
- **PDF `rehype-highlight` `detect: false**`: Only syntax-highlights code blocks with a language specified. Reduces CPU on large documents.
- **Open Folder after export**: Uses `vscode.commands.executeCommand("revealFileInOS", ...)` instead of `openExternal(folder)` to reveal the correct file in Finder/Explorer cross-platform.
- **More robust Chromium discovery**: Checks `fs.constants.X_OK` in addition to `isFile()` to filter non-executable paths; strips extra quotes around `chromiumPath` if user pastes `"C:\...\chrome.exe"` verbatim.
- **Chromium cache invalidation on setting change**: `onDidChangeConfiguration` listens for `tuiMarkdown.chromiumPath` → calls `clearChromiumCache()`, no window reload needed.
- **Friendly Puppeteer launch error message**: Wraps launch error as "Failed to launch Chromium at `<path>`: . Check execute permission or configure tuiMarkdown.chromiumPath."
- **SVG zero-dimension fallback**: `svgToPngBlob` uses 800×600 fallback + console.warn when SVG has no width/height/viewBox, instead of throwing silently.
- **Git Graph diff blocked ([#48](https://github.com/hoangvantuan/tui-milkdown-vscode/issues/48))**: Added `git-graph` scheme to `configurationDefaults.workbench.editorAssociations` so TUI Markdown does not block opening markdown files when viewing diffs from Git Graph plugin. Previously only `git` and `gitlens` were excluded.

## [2.8.5] - 2026-04-22

### Added

- **Copy Mermaid as PNG**: "Copy" button appears on mermaid preview hover (next to expand button) and in the lightbox toolbar. Click renders SVG to PNG bitmap (2x scale for retina) and writes to clipboard via `navigator.clipboard.write` + `ClipboardItem("image/png")`. Can be pasted directly into Slack, Word, Figma, Notion, Preview.app. Checkmark feedback for 1.5s on success, VS Code warning dialog on error. Button auto-hides on `.mermaid-error`, editing mode, and regular image lightbox mode.

## [2.8.4] - 2026-04-18

### Fixed

- **Remove extraneous files from package**: Updated `.vscodeignore` to exclude dev files (`.agent`, `.github`, `.mcp.json`, `_bmad`, `AGENTS.md`, `.gitnexus`, `skills-lock.json`, `.DS_Store`) from the extension package. Reduces package size and removes unnecessary content.

## [2.8.3] - 2026-04-18

### Added

- **Content Zoom**: Zoom editor content 50%–200% (10% step) via Appearance popover or Ctrl/Cmd +/-/0 shortcuts. Only zooms `.tiptap` element — toolbar, TOC, metadata panel stay at native size. Zoom level persisted globally via `context.globalState`.
- **Appearance Popover**: Consolidated zoom, theme, and font controls into a single popover behind a gear icon on the right side of the toolbar. Prevents toolbar wrapping on narrow viewports (split-view).
- **View Source Icon**: View Source button changed from text button to `</>` SVG icon using unified `toolbar-btn` class.

### Fixed

- **Popover Dark Theme Contrast**: Input surfaces inside popover now use VS Code native `--vscode-editorWidget-*` variables instead of toolbar glass styling, fixing unreadable controls on dark themes.
- **Font Selector Escape Propagation**: Added `stopPropagation()` to font dropdown Escape handler, preventing parent popover from closing simultaneously.
- **Popover Viewport Overflow**: Added `max-width: calc(100vw - 16px)` to prevent popover from overflowing on narrow panels.

## [2.8.2] - 2026-04-13

### Fixed

- **Mermaid SVG Clipping**: Allow `foreignObject` labels in mermaid diagrams to render beyond the bounding box (apply `overflow: visible` to SVG and all child elements inside `.mermaid-svg-host`), fixing labels being clipped at diagram edges.

## [2.8.1] - 2026-04-13

### Added

- **Mermaid Diagram Fullscreen Lightbox**: Expand button on mermaid preview hover opens the diagram in a fullscreen viewer with zoom (buttons, mouse wheel, `+`/`-`/`0` keys, `Esc` to close) and pan by dragging when zoomed in. Reuses the image lightbox infrastructure.

## [2.8.0] - 2026-04-02

### Added

- **Paper Theme**: Warm white, serif font, book-like reading experience (light)
- **Midnight Theme**: Deep navy (#0d1117) for comfortable night writing (dark)
- **Image Lightbox**: Fullscreen overlay with zoom controls (0.5x–4x via buttons, scroll, keyboard), expand button on image hover, caption from alt text
- **Toolbar Auto-hide**: Opt-in setting `tuiMarkdown.autoHideToolbar` — hides toolbar after 3s of inactivity, reveals on hover or keyboard focus
- **Reading Progress Bar**: Fixed top bar tracking scroll position in editor
- **Word Count**: Subtle indicator in bottom-right corner, updates on content change
- **Paper Texture & Visual Depth**: CSS-only noise grain overlay + vignette radial gradient on editor background
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

## [2.7.1] - 2026-04-01

### Fixed

- **Font Selector Persistence**: Font selection no longer resets when switching between files — saved font now correctly persists to webview state on restore

## [2.7.0] - 2026-04-01

### Added

- **Font Selector**: Searchable font picker on toolbar — browse and search all system fonts with live preview, persisted across sessions (does not affect code font)

## [2.6.3] - 2026-03-31

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

## [2.6.2] - 2026-03-28

### Fixed

- **Image Path Regex**: Support nested parentheses in image paths (e.g., `path(1).png`) and angle-bracket syntax (`<path>`) in `extractImagePaths()`
- **Code Block Protection**: Skip fenced code blocks when updating image references across workspace — prevents accidental code modification
- **Path Traversal Hardening**: Decode URL-encoded characters (`%2e%2e`) before path traversal check in `hasPathTraversal()`
- **Case-Sensitive Image Delete**: Remove `toLowerCase()` from filename comparison in `detectImageDeletes()` — fixes false positives on case-sensitive file systems (Linux)
- **Search Count Stale**: Update search match count when content changes externally (e.g., another editor modifies the file)
- **Heading Collapse Persistence**: Migrate collapsed heading state when heading text is edited — headings no longer unexpectedly uncollapse on text changes

## [2.6.1] - 2026-03-28

### Improved

- **Keystroke Performance**: Deferred markdown serialization into debounce callback — reduces per-keystroke cost by ~50% (serialize once per 300ms instead of every keypress)
- **Heading Collapse Plugin**: Merged double doc traversal into single pass — halves node visits per keystroke
- **Mermaid Plugin**: Skip full document scan when no mermaid blocks exist; added LRU cache eviction (max 30 entries) to prevent unbounded memory growth
- **Image Map Caching**: Cached reverse image map to avoid rebuilding on every save cycle; replaced JSON.stringify echo check with lightweight version counter

### Fixed

- **Link Navigation Security**: Added workspace boundary check to prevent opening files outside workspace via path traversal (e.g., `../../../../etc/passwd`)
- **Image Edit Race Condition**: Verify image node identity (`src` attribute) before applying async rename update — prevents updating wrong node if document changed during rename
- **TOC Stale Position**: Validate heading node type before scroll to prevent navigating to wrong node during debounce window
- **Table Context Menu**: Added bounds clamping to prevent off-screen positioning; added document-level click-outside listener so clicking toolbar/TOC closes menu
- **Pending Link Edit Cleanup**: Added 60s timeout to prevent memory leak if extension never responds

## [2.6.0] - 2026-03-27

### Added

- **Search (Cmd+F)**: Find text in editor with `Cmd+F`/`Ctrl+F` — highlights all matches, navigate with Enter/Shift+Enter, match counter, glassmorphic search bar with slide-down animation. Powered by `prosemirror-search`.
- **Link Click Navigation**: `Ctrl+Click` (`Cmd+Click` on macOS) on links — anchor links (`#heading`) scroll to heading, relative file links open in VSCode, external URLs open in browser. Pointer cursor shown when modifier key held.

## [2.5.1] - 2026-03-27

### Fixed

- **Font Rendering**: Removed `-webkit-font-smoothing: antialiased` — text now renders thicker and more legible using default subpixel antialiasing

## [2.5.0] - 2026-03-20

### Changed

- **TOC Toggle Button**: Moved from toolbar right side to inline flex item in main layout — sits between sidebar and editor, no longer overlaps content

## [2.4.0] - 2026-03-19

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
- `**tocDepthFilter` state**: No longer persisted in `vscode.setState()`

## [2.3.1] - 2026-03-19

### Fixed

- **Task List Nested Layout**: Fixed `display: flex` leaking to nested list items inside task lists, causing paragraphs and code blocks to render side-by-side instead of vertically stacked. Changed CSS selectors from descendant to direct child combinator (`ul[data-type="taskList"] > li`)

## [2.3.0] - 2026-03-19

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

## [2.0.9] - 2026-03-19

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

- **Nord Dark Inline Code WCAG**: `#bf616a` (3.05:1) → `#d08770` Aurora orange (~4.8:1) — now passes WCAG AA
- **Frame Light Colors**: Softer text (#1a1b1e), blue links (#2563eb), lighter borders (#d0d5dd), warmer inline-code (#c4432b)
- **Frame Dark Colors**: Blue-tinted background (#1a1b1e), blue accent links (#6b9fff), cooler surface (#141518), softer inline-code (#f97583)

## [2.0.8] - 2026-03-05

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

## [2.0.7] - 2026-02-12

### Improved

- **Mermaid Diagram Selective Reload**: Switching between edit/view mode no longer re-renders all diagrams — only the changed diagram re-renders. Preserves widget DOM elements on selection changes for a smoother, flicker-free experience

## [2.0.6] - 2026-02-12

### Added

- **Table Right-Click Context Menu**: Right-click on any table cell to access Select Row/Column/Table, Add Row Above/Below, Add Column Before/After, and Delete Row/Column/Table actions
- **Cell Selection Highlight**: Drag-selecting across table cells now shows a visual highlight overlay (blue tint), supporting both light and dark themes

## [2.0.5] - 2026-02-12

### Fixed

- **Inline Code Exit in Table Cells**: Added `CodeExitHandler` extension so pressing ArrowRight at the end of an inline code span exits the code mark, allowing users to continue typing normal text (previously stuck in code formatting inside table cells)

## [2.0.4] - 2026-02-12

### Added

- **Mermaid Diagram Rendering**: Code blocks with `mermaid` language are now rendered as live SVG diagrams with automatic theme syncing (light/dark), error display, and caching
- **GitHub-Style Alerts**: Blockquotes starting with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` render as color-coded alert boxes with icons and dark theme support
- **Tab Indentation in Code Blocks**: Enabled tab key for indentation inside code blocks (2-space tab size)

## [2.0.3] - 2026-02-12

### Changed

- **Theme Font Configuration**: Updated fonts across all themes for improved markdown readability
  - Frame / Frame Dark: Noto Sans → Inter, Space Mono → JetBrains Mono
  - Crepe / Crepe Dark: Open Sans → Source Serif 4 (serif for warm reading experience)
  - Catppuccin (Latte, Frappé, Macchiato, Mocha): Noto Sans → Inter, Space Mono → Cascadia Code
  - Nord / Nord Dark: unchanged (already Inter + JetBrains Mono)
  - Updated default fallback font from Noto Sans to Inter
- **Blockquote Styling**: Added `overflow: hidden` to prevent line-highlight from bleeding outside blockquote boundaries
- **Line Highlight Cursor**: Extended highlight area with padding offsets (`-4px` all sides) and `border-radius: 3px` for a more comfortable, less cramped appearance

## [2.0.2] - 2026-02-12

### Changed

- **Table Cell Padding**: Made table content more compact by adjusting cell padding and adding specific spacing for elements within table cells
- **Heading Margins**: Adjusted heading top margins and introduced bottom margins for h1-h6 elements for improved readability

## [2.0.0] - 2026-02-07

### Added

- **Formatting Toolbar**: Full markdown toolbar with grouped buttons for text formatting (Bold, Italic, Strikethrough, Inline Code, Highlight), heading select (Paragraph/H1-H6), lists (Bullet, Ordered, Task), block elements (Blockquote, Code Block, Horizontal Rule), table insert, and link insert
- **Table Context Actions**: Add column before/after, add row below, delete column/row/table - buttons appear only when cursor is inside a table
- **Toolbar Active States**: Buttons highlight to reflect current formatting at cursor position
- 10MB image size limit on paste/drop with warning dialog
- showWarning message type for webview-to-extension warnings
- Custom table markdown serializer (`table-markdown-serializer.ts`) - preserves multi-line cell content with `<br>` tags via `renderMarkdown` hook
- Table cell content parser (`table-cell-content-parser.ts`) - post-parse transformer converts `<br>` → paragraphs, ``  → hardBreak, and list patterns (`- item`, `N. item`, `[x] item`) → proper list nodes
- Path traversal security check for `imageSaveFolder` configuration
- Race condition guard (`renameInProgress`) for image rename operations
- Image edit overlay MutationObserver now filters for image-related changes only, with debounce
- Tiptap Markdown reference documentation (`docs/tiptap-markdown-reference.md`) - API spec, extension patterns, tokenizer guides

### Changed

- **Blank line roundtrip**: Empty paragraphs now roundtrip via MarkedJS `space` token parsing (`BlankLineHandler`) and custom `Document` serializer, replacing the `<br>` hack + `convertBrOnlyParagraphsToEmpty` post-parse step
- **Editor Engine Migration: Milkdown Crepe -> Tiptap**
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
- Line highlight plugin: corrected node type `list_item` -> `listItem` (Tiptap camelCase convention)
- Image regex: improved HTML `<img>` matching (`<img\s[^>]*?src=` prevents false positives)

### Removed

- Removed `@milkdown/crepe` and `sharp` dependencies
- Removed `paste-link-plugin.ts` (replaced by built-in Link extension)
- Removed `convertBrOnlyParagraphsToEmpty` post-parse step (replaced by `BlankLineHandler` extension)
- Removed Milkdown-specific hardbreak rendering CSS hack
- Removed CodeMirror-related CSS (`.cm-editor`, `.cm-content`)
- Removed unused CSS variables from theme files (~15 per theme)
- Removed unused code: `hasFrontmatter()`, `showLoading()`, `currentTheme` variable

## [1.5.5] - 2026-02-06

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

## [1.5.2] - 2026-01-27

### Fixed

- **Editor Initialization Loop**
  - Fixed editor recreating 15+ times on document load (echo loop prevention)
  - Track content + imageMap keys together to detect echo from edits
  - Debounce `updateWebview()` calls (50ms) to prevent rapid updates
  - Guard `editorViewCtx` access to avoid "Context not found" errors
  - Cancel pending debounced edits when destroying editor

## [1.5.1] - 2026-01-25

### Added

- **Heading Level Indicator**
  - Displays H1-H6 badges next to headings for quick level identification
  - Subtle styling with muted colors
  - Supports all 10 themes (light and dark)

## [1.5.0] - 2026-01-24

### Added

- **Auto-link Paste URL**
  - When text is selected and you paste a URL, automatically converts to markdown link `[selected text](url)`
  - Supports http/https URLs only
  - Replaces existing link URL if selection is already a link
  - Intelligently skips paste events with files (images handled by image upload)
- **Image Upload & Paste Support**
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

## [1.4.0] - 2026-01-24

### Added

- Catppuccin theme palette with 4 variants
  - Catppuccin Latte (light)
  - Catppuccin Frappé (dark, subdued)
  - Catppuccin Macchiato (dark, medium contrast)
  - Catppuccin Mocha (dark, original)

## [1.3.1] - 2026-01-24

### Added

- Table auto-width CSS for proportional column sizing
  - Columns size automatically based on content
  - Table spans full editor width
  - Cell text wraps naturally for responsive display

## [1.3.0] - 2026-01-24

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

## [1.2.1] - 2026-01-24

### Fixed

- Fixed heading margin-top values for better visual spacing (h1:24px, h2:20px, h3:16px, h4:12px, h5:8px, h6:8px)

## [1.2.0] - 2026-01-24

### Changed

- Optimized build configuration with production/development modes

## [1.1.0] - 2026-01-23

### Added

- Configurable font sizes for each heading level (h1-h6, range 12-72px)

### Fixed

- Disable WYSIWYG editor in git diff view, use default text diff instead

## [1.0.1] - 2026-01-23

### Changed

- Add editor padding (10px top/bottom, 40px left/right)
- Improve line-height from 20px to 24px for better readability
- Add `*.vsix` to .gitignore

## [1.0.0] - 2026-01-23

### Added

- Initial release
- WYSIWYG markdown editing with Milkdown Crepe
- Theme selection (Nord, GitHub, Tokyo Night, etc.)
- View source toggle
- Large file warning (>500KB)
- Configurable font size (8-32px)
- Support for .md and .markdown files
