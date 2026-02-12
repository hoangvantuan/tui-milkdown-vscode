# Changelog

All notable changes to "TUI Markdown Editor" extension.

## \[2.0.7] - 2026-02-12

### Improved

* **Mermaid Diagram Selective Reload**: Switching between edit/view mode no longer re-renders all diagrams — only the changed diagram re-renders. Preserves widget DOM elements on selection changes for a smoother, flicker-free experience

## \[2.0.6] - 2026-02-12

### Added

* **Table Right-Click Context Menu**: Right-click on any table cell to access Select Row/Column/Table, Add Row Above/Below, Add Column Before/After, and Delete Row/Column/Table actions

* **Cell Selection Highlight**: Drag-selecting across table cells now shows a visual highlight overlay (blue tint), supporting both light and dark themes

## \[2.0.5] - 2026-02-12

### Fixed

* **Inline Code Exit in Table Cells**: Added `CodeExitHandler` extension so pressing ArrowRight at the end of an inline code span exits the code mark, allowing users to continue typing normal text (previously stuck in code formatting inside table cells)

## \[2.0.4] - 2026-02-12

### Added

* **Mermaid Diagram Rendering**: Code blocks with `mermaid` language are now rendered as live SVG diagrams with automatic theme syncing (light/dark), error display, and caching

* **GitHub-Style Alerts**: Blockquotes starting with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` render as color-coded alert boxes with icons and dark theme support

* **Tab Indentation in Code Blocks**: Enabled tab key for indentation inside code blocks (2-space tab size)

## \[2.0.3] - 2026-02-12

### Changed

* **Theme Font Configuration**: Updated fonts across all themes for improved markdown readability

  * Frame / Frame Dark: Noto Sans → Inter, Space Mono → JetBrains Mono

  * Crepe / Crepe Dark: Open Sans → Source Serif 4 (serif for warm reading experience)

  * Catppuccin (Latte, Frappé, Macchiato, Mocha): Noto Sans → Inter, Space Mono → Cascadia Code

  * Nord / Nord Dark: unchanged (already Inter + JetBrains Mono)

  * Updated default fallback font from Noto Sans to Inter

* **Blockquote Styling**: Added `overflow: hidden` to prevent line-highlight from bleeding outside blockquote boundaries

* **Line Highlight Cursor**: Extended highlight area with padding offsets (`-4px` all sides) and `border-radius: 3px` for a more comfortable, less cramped appearance

## \[2.0.2] - 2026-02-12

### Changed

* **Table Cell Padding**: Made table content more compact by adjusting cell padding and adding specific spacing for elements within table cells

* **Heading Margins**: Adjusted heading top margins and introduced bottom margins for h1-h6 elements for improved readability

## \[2.0.0] - 2026-02-07

### Added

* **Formatting Toolbar**: Full markdown toolbar with grouped buttons for text formatting (Bold, Italic, Strikethrough, Inline Code, Highlight), heading select (Paragraph/H1-H6), lists (Bullet, Ordered, Task), block elements (Blockquote, Code Block, Horizontal Rule), table insert, and link insert

* **Table Context Actions**: Add column before/after, add row below, delete column/row/table - buttons appear only when cursor is inside a table

* **Toolbar Active States**: Buttons highlight to reflect current formatting at cursor position

* 10MB image size limit on paste/drop with warning dialog

* showWarning message type for webview-to-extension warnings

* Custom table markdown serializer (`table-markdown-serializer.ts`) - preserves multi-line cell content with `<br>` tags via `renderMarkdown` hook

* Table cell content parser (`table-cell-content-parser.ts`) - post-parse transformer converts `<br>` → paragraphs, `
` → hardBreak, and list patterns (`- item`, `N. item`, `[x] item`) → proper list nodes

* Path traversal security check for `imageSaveFolder` configuration

* Race condition guard (`renameInProgress`) for image rename operations

* Image edit overlay MutationObserver now filters for image-related changes only, with debounce

* Tiptap Markdown reference documentation (`docs/tiptap-markdown-reference.md`) - API spec, extension patterns, tokenizer guides

### Changed

* **Blank line roundtrip**: Empty paragraphs now roundtrip via MarkedJS `space` token parsing (`BlankLineHandler`) and custom `Document` serializer, replacing the `<br>` hack + `convertBrOnlyParagraphsToEmpty` post-parse step

* **Editor Engine Migration: Milkdown Crepe -> Tiptap**

  * Replaced Milkdown Crepe with Tiptap (`@tiptap/core` + `@tiptap/markdown`) for markdown roundtrip

  * Content updates use `editor.commands.setContent()` - no destroy/recreate, eliminates UI flash

  * Cursor position preserved across external document changes

  * Syntax highlighting for code blocks via lowlight (highlight.js), replacing CodeMirror

  * Image paste/drop via Tiptap's `editorProps.handlePaste`/`handleDrop`

  * Auto-link paste URL now handled by `@tiptap/extension-link` (`autolink: true, linkOnPaste: true`)

  * Task list (checkbox) support via `@tiptap/extension-list` (TaskList + TaskItem)

  * Table resizing support via `@tiptap/extension-table` with custom markdown serializer for multi-line cells

  * Placeholder text via `@tiptap/extension-placeholder`

  * Highlight (mark) support via `@tiptap/extension-highlight`

* **Extension Rename**

  * Renamed from "Milkdown Markdown WYSIWYG" to "TUI Markdown Editor"

  * Updated all CSS selectors from `.milkdown` to `.tiptap`

  * All 10 theme CSS files simplified - removed unused CSS variables

* **CSS Architecture**

  * Dark theme overrides consolidated using `body.dark-theme` selector (set by `applyTheme()`)

  * Base Tiptap styles (outline, fonts, colors, placeholder, blockquote, hr, links, tables) added inline

  * Task list checkbox styling with font-scale support

* DRY - extracted shared cleanImagePath utility

* Removed debug console.log statements from production code

### Fixed
* Echo loop after image save causing editor re-parse and cursor loss

* Image path transforms now context-aware (only within image/link syntax, not plain text)

* handleDrop inserts images at correct block boundary position

* SVG image paste generates correct .svg extension (not .svg+xml)

* Workspace reference updates now context-aware (won't replace paths in code blocks)


* Line highlight plugin: corrected node type `list_item` -> `listItem` (Tiptap camelCase convention)

* Image regex: improved HTML `<img>` matching (`<img\s[^>]*?src=` prevents false positives)

### Removed

* Removed `@milkdown/crepe` and `sharp` dependencies

* Removed `paste-link-plugin.ts` (replaced by built-in Link extension)

* Removed `convertBrOnlyParagraphsToEmpty` post-parse step (replaced by `BlankLineHandler` extension)

* Removed Milkdown-specific hardbreak rendering CSS hack

* Removed CodeMirror-related CSS (`.cm-editor`, `.cm-content`)

* Removed unused CSS variables from theme files (\~15 per theme)

* Removed unused code: `hasFrontmatter()`, `showLoading()`, `currentTheme` variable

## \[1.5.5] - 2026-02-06

### Fixed

* **Inline Hardbreak Rendering**

  * Single newlines (soft breaks) now display as visual line breaks instead of inline spaces

  * Added CSS to collapse inline hardbreak `<span>` elements into block-level breaks

* **Concurrent Editor Initialization**

  * Added `isEditorInitializing` guard to prevent overlapping editor init/recreate calls

  * Flush microtasks between destroy and create to avoid stale state

  * Skip `update` messages while editor is still initializing

* **CSP Font Source**

  * Added `data:` to `font-src` CSP directive to support data URI fonts

## \[1.5.2] - 2026-01-27

### Fixed

* **Editor Initialization Loop**

  * Fixed editor recreating 15+ times on document load (echo loop prevention)

  * Track content + imageMap keys together to detect echo from edits

  * Debounce `updateWebview()` calls (50ms) to prevent rapid updates

  * Guard `editorViewCtx` access to avoid "Context not found" errors

  * Cancel pending debounced edits when destroying editor

## \[1.5.1] - 2026-01-25

### Added

* **Heading Level Indicator**

  * Displays H1-H6 badges next to headings for quick level identification

  * Subtle styling with muted colors

  * Supports all 10 themes (light and dark)

## \[1.5.0] - 2026-01-24

### Added

* **Auto-link Paste URL**

  * When text is selected and you paste a URL, automatically converts to markdown link `[selected text](url)`

  * Supports http/https URLs only

  * Replaces existing link URL if selection is already a link

  * Intelligently skips paste events with files (images handled by image upload)

* **Image Upload & Paste Support**

  * Paste images from clipboard directly into the editor

  * Drop images or pick via drag-and-drop

  * Images saved automatically to configurable folder

  * Configurable via `tuiMarkdown.imageSaveFolder` setting (default: `images`)

  * Use `.` for same folder as document

* **Local Image Display**

  * Renders local images from document folder and workspace

  * Supports both relative and absolute paths

  * Automatic path resolution for webview display

* **Image URL Editing**

  * Hover on image to show edit icon (pencil button)

  * Double-click on image to edit URL/path via VSCode input box

  * Shows original path instead of webview URI

* **Auto Rename Images**

  * Automatically rename image files when you change the path in Markdown

  * Only triggers when image folder remains the same

  * Updates all references in workspace `.md` files

  * Configurable via `tuiMarkdown.autoRenameImages` setting (default: true)

* **Auto Delete Images**

  * Automatically delete image files when removed from markdown

  * Moves files to Trash (recoverable)

  * Shows warning if image is used in other `.md` files

  * Configurable via `tuiMarkdown.autoDeleteImages` setting (default: true)

### Fixed

* Fixed cursor position loss when deleting images (editor no longer recreates on imageMap changes from user edits)

### Changed

* Image edit icon now shows when hovering anywhere on image block (not just the image itself)

* Extended `localResourceRoots` to include document folder and workspace for image loading

## \[1.4.0] - 2026-01-24

### Added

* Catppuccin theme palette with 4 variants

  * Catppuccin Latte (light)

  * Catppuccin Frappé (dark, subdued)

  * Catppuccin Macchiato (dark, medium contrast)

  * Catppuccin Mocha (dark, original)

## \[1.3.1] - 2026-01-24

### Added

* Table auto-width CSS for proportional column sizing

  * Columns size automatically based on content

  * Table spans full editor width

  * Cell text wraps naturally for responsive display

## \[1.3.0] - 2026-01-24

### Added

* Cursor line highlight with theme support

  * Highlights current block/paragraph containing cursor

  * Individual list item highlighting (not entire list)

  * Skips code blocks (they have built-in highlighting)

  * Configurable via `tuiMarkdown.highlightCurrentLine` setting

* Responsive max-width layout (1200px) for editor content on large screens

  * Improves readability on 4K/ultrawide monitors

  * Full-width on screens ≤1200px (split view compatible)

* Collapsible metadata panel for editing YAML frontmatter

* YAML validation with line number error display

* "Add Metadata" button when document has no frontmatter

* Bidirectional sync between metadata panel and editor

* Tab key support in metadata textarea (inserts 2 spaces for YAML indentation)

* `js-yaml` dependency for frontmatter parsing and validation

## \[1.2.1] - 2026-01-24

### Fixed

* Fixed heading margin-top values for better visual spacing (h1:24px, h2:20px, h3:16px, h4:12px, h5:8px, h6:8px)

## \[1.2.0] - 2026-01-24

### Changed

* Optimized build configuration with production/development modes

## \[1.1.0] - 2026-01-23

### Added

* Configurable font sizes for each heading level (h1-h6, range 12-72px)

### Fixed

* Disable WYSIWYG editor in git diff view, use default text diff instead

## \[1.0.1] - 2026-01-23

### Changed

* Add editor padding (10px top/bottom, 40px left/right)

* Improve line-height from 20px to 24px for better readability

* Add `*.vsix` to .gitignore

## \[1.0.0] - 2026-01-23

### Added

* Initial release

* WYSIWYG markdown editing with Milkdown Crepe

* Theme selection (Nord, GitHub, Tokyo Night, etc.)

* View source toggle

* Large file warning (>500KB)

* Configurable font size (8-32px)

* Support for .md and .markdown files

