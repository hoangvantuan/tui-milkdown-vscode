<div align="center">
  <img src="media/icon.png" width="96" alt="TUI Markdown Editor">

  # TUI Markdown Editor

  *A beautiful WYSIWYG Markdown editor for VS Code, powered by Tiptap*

  [![VS Code](https://img.shields.io/badge/VS_Code-%3E%3D1.85.0-007ACC?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)
  [![Version](https://img.shields.io/badge/version-2.11.0-blue?style=flat-square)](CHANGELOG.md)
  [![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

  [Features](#features) · [Usage](#usage) · [Configuration](#configuration) · [Themes](#themes) · [Export](#export)

</div>

![Preview](media/preview.png)

## Features

### Rich Text Editing

Full WYSIWYG markdown editing with Tiptap + `@tiptap/markdown` (GFM support via MarkedJS). Format text using the glassmorphic toolbar or keyboard shortcuts. Toggle between WYSIWYG and source view with `Ctrl/Cmd+Shift+M` or editor title bar icons.

### Code & Diagrams

- **Syntax Highlighting** — 19 languages via lowlight, with language badge dropdown and copy button
- **Mermaid Diagrams** — Live SVG preview with view/edit toggle, theme sync, fullscreen lightbox (zoom/pan), and copy-as-PNG (2x retina)
- **GitHub Alerts** — `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` render as styled alert boxes

### Tables

Resizable tables with multi-line cell content. Right-click context menu for row/column operations. Drag-select cells with visual highlight overlay.

### Images

- Paste from clipboard or drag-and-drop (auto-saved to configurable folder)
- Double-click to edit URL/path
- Auto-rename files when path changes in markdown
- Auto-delete files when removed from markdown (moves to Trash)
- Fullscreen lightbox with zoom controls (0.5x–4x)

### Navigation & Search

- **Search** (`Cmd/Ctrl+F`) — Find with match highlighting, next/prev navigation, match counter
- **Link Navigation** — `Cmd+Click` / `Ctrl+Click` to follow links, scroll to headings, open files, or launch URLs
- **Table of Contents** — Sidebar with click-to-scroll, active heading tracking, collapse/expand

### Writing Experience

- **Content Zoom** — 50%–200% via Appearance popover or `Ctrl/Cmd +/-/0`
- **Font Selector** — Browse all system fonts with live preview
- **Cursor Line Highlight** — Visual highlight of current block
- **Heading Collapse** — Toggle arrows on headings to collapse/expand sections
- **Metadata Panel** — Collapsible YAML frontmatter editor with validation
- **Reading Progress Bar** — Fixed top bar tracking scroll position
- **Word Count** — Subtle indicator in bottom-right corner
- **File Mention (@)** — Type `@` to autocomplete workspace filenames, inserts markdown link
- **Wiki Link ([[...]])** — Obsidian-style `[[filename]]` with autocomplete, inline node, Ctrl/Cmd+Click to open
- **Implicit Frontmatter** — YAML metadata at file start without opening `---` delimiter, auto-detected
- **Toolbar Auto-hide** — Opt-in, reveals on hover

## Usage

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/)
2. Open any `.md` or `.markdown` file
3. Editor opens automatically in WYSIWYG mode
4. Use toolbar to format text and insert elements
5. Changes save automatically to source file

## Export

### Export to DOCX

One-click export to Word `.docx` via `mdast2docx`. Preserves headings, lists, tables, code blocks, and images (mermaid diagrams rendered as PNG). Respects the active editor font.

### Export to PDF

WYSIWYG export via headless Chromium (`puppeteer-core`). Requires Chrome, Edge, Chromium, or Brave installed locally (not bundled). Auto-detects common install paths.

> [!TIP]
> If auto-detection fails, set `tuiMarkdown.chromiumPath` in VS Code settings to the absolute path of your browser executable.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tuiMarkdown.fontSize` | `16` | Editor font size (8–32px) |
| `tuiMarkdown.highlightCurrentLine` | `true` | Enable cursor line highlight |
| `tuiMarkdown.imageSaveFolder` | `images` | Folder for pasted images (relative to document) |
| `tuiMarkdown.autoRenameImages` | `true` | Auto-rename image files when path changes |
| `tuiMarkdown.autoDeleteImages` | `true` | Auto-delete images removed from markdown (Trash) |
| `tuiMarkdown.autoHideToolbar` | `false` | Auto-hide toolbar when typing |
| `tuiMarkdown.chromiumPath` | `""` | Chrome/Chromium path for PDF export |
| `tuiMarkdown.exportPageSize` | `A4` | Page size for PDF/DOCX export (`A4` or `Letter`) |
| `tuiMarkdown.headingSizes.h1`–`h6` | `32`–`16` | Heading font sizes (12–72px) |

## Themes

12 built-in themes with curated typography and color palettes:

| Theme | Style | Character |
|-------|-------|-----------|
| Frame | Light | Clean, modern default |
| Frame Dark | Dark | Blue-tinted, sharp |
| Nord | Light | Soft Arctic palette |
| Nord Dark | Dark | Official Nord colors |
| Crepe | Light | Warm serif reading |
| Crepe Dark | Dark | Warm serif, inverted |
| Catppuccin Latte | Light | Pastel warmth |
| Catppuccin Frappé | Dark | Subdued, muted |
| Catppuccin Macchiato | Dark | Medium contrast |
| Catppuccin Mocha | Dark | Rich, deep |
| Paper | Light | Serif, book-like |
| Midnight | Dark | Deep navy (#0d1117) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Editor engine | [Tiptap 3](https://tiptap.dev) + `@tiptap/markdown` |
| Markdown parser | MarkedJS (GFM) via `@tiptap/markdown` |
| Syntax highlighting | [lowlight](https://github.com/wooorm/lowlight) (highlight.js) |
| Diagrams | [Mermaid 11](https://mermaid.js.org) + ELK layout |
| DOCX export | [mdast2docx](https://github.com/nicolo-ribaudo/mdast2docx) + @m2d plugins |
| PDF export | [puppeteer-core](https://pptr.dev) + remark/rehype pipeline |
| Build | esbuild |

## Requirements

- VS Code 1.85.0 or higher
- For PDF export: Chrome, Edge, Chromium, or Brave installed on the system
