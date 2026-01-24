# Changelog

All notable changes to "Milkdown Markdown WYSIWYG" extension.

## \[1.3.0] - 2026-01-24

### Added

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

