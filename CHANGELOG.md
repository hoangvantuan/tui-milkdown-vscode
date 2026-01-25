# Changelog

All notable changes to "Milkdown Markdown WYSIWYG" extension.

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
  * Upload images via Crepe's file picker button
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

* Bidirectional sync between metadata panel and Milkdown editor

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
