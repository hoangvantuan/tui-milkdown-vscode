# Project Changelog

All notable changes to TUI Markdown Editor are documented here. Format follows [Keep a Changelog](https://keepachangelog.com).

## [2.8.0] - 2026-04-02

### Added

- **Paper Texture & Visual Depth**
  - SVG noise texture overlay on editor background (subtle grain effect)
  - Vignette radial gradient for visual depth at edges
  - Reading progress bar (fixed top, tracks scroll position)
  - Per-theme selection colors (enhanced from global `::selection`)

- **Code Block Premium Styling**
  - Gradient accent bar at top of code blocks (fades left-to-right)
  - Enhanced header background with subtle accent tint
  - Font ligatures enabled (`liga`, `calt`) for code readability
  - Smooth hover effect (gradient intensify + shadow)

- **Image Lightbox**
  - Fullscreen lightbox overlay with zoom controls
  - Expand button (🔍) on image hover, alongside edit button
  - Zoom range 0.5x-4x via buttons, mouse wheel, or keyboard (+/-)
  - Caption displays image alt text
  - Escape key, backdrop click, or close button to dismiss
  - All existing image interactions preserved (Ctrl+Click, double-click, single click)

- **Toolbar Auto-hide (Opt-in)**
  - Auto-hide toolbar after 3s of inactivity when typing
  - Reveal on hover (top 8px zone), keyboard focus, or ESC
  - New VSCode setting: `tuiMarkdown.autoHideToolbar` (boolean, default: false)
  - Search bar synced with toolbar visibility
  - Touch devices: toolbar always visible

- **Micro-interactions**
  - Task list checkbox: draw-in animation + strikethrough sweep
  - Blockquote: enhanced left border with hover effect
  - H1/H2 headings: subtle gradient underline
  - Link hover: improved underline animation with accent color
  - Table rows: smooth hover highlight + zebra striping
  - **Premium Alert Blocks:**
    - SVG icons (circle, lightbulb, triangle, shield, octagon) instead of emoji
    - Theme-aware colors per alert type (NOTE/TIP/IMPORTANT/WARNING/CAUTION)
    - Rounded left border + full border (1px)
    - Hover effect: border accent intensifies + subtle lift shadow
    - Icon + label inline on title row with separator line

- **Theme Improvements**
  - New **Paper theme** (light): Warm white, serif font, book-like feel
  - New **Midnight theme** (dark): Deep navy (#0d1117), comfortable for night writing
  - Smooth theme transitions (0.3s) across all CSS properties
  - Total themes: 12 (8 classic + 2 new)

- **Accessibility & Polish**
  - Comprehensive `prefers-reduced-motion: reduce` support (all animations disabled)
  - High contrast mode (`prefers-contrast: more`) with opaque backgrounds, stronger borders
  - Print stylesheet (@media print): clean document layout, no UI elements, proper page breaks
  - Visible focus indicators on all interactive elements (outline 2px, 2px offset)
  - Word count indicator: subtle bottom-right corner, visible on editor hover

### Changed

- Theme selection dropdown now includes Paper and Midnight options
- All animations and transitions respect user motion preferences
- Print preview produces clean, document-ready output

### Technical Details

- v2.7.1 → v2.8.0 (minor version bump)
- 7 independent implementation phases, shipped sequentially
- Zero breaking changes
- CSP-safe: all textures/icons use SVG data URIs
- Performance: GPU-accelerated SVG filters, CSS-only animations, no layout shifts

### Files Added

- `src/webview/themes/paper.css` — Paper theme definitions
- `src/webview/themes/midnight.css` — Midnight theme definitions
- `src/webview/image-lightbox-plugin.ts` — Lightbox DOM and event management

### Files Modified

- `src/markdownEditorProvider.ts` — CSS for textures, vignette, progress bar, lightbox, alerts, toolbar auto-hide, focus indicators, print stylesheet
- `src/webview/themes/index.css` — Added Paper/Midnight imports
- `src/webview/image-edit-plugin.ts` — Added expand button to image overlay
- `src/webview/main.ts` — Lightbox init, word count logic, toolbar auto-hide setup, dark theme detection (Midnight)
- `package.json` — Added `tuiMarkdown.autoHideToolbar` setting

## [2.7.1] - 2026-03-28

### Added

- Font selector persist across file switches
- Searchable font dropdown with system font enumeration
- Floating editor canvas with responsive layout

### Fixed

- Font selection state preserved in webview when switching markdown files

## [2.7.0] - 2026-03-25

### Added

- Floating editor canvas with responsive layout
- Enhanced shadows and visual depth
- Modern page break visual for horizontal rules (`---`)

## [2.6.0] - 2026-03-20

### Added

- Searchable font selector in toolbar
- System font enumeration (macOS, Windows, Linux)
- Font override for `--crepe-font-default` CSS variable

## [2.5.0] and Earlier

See git history for detailed changes in previous versions.
