# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode extension providing WYSIWYG Markdown editing using Milkdown Crepe editor. Opens `.md` files in a custom editor with theme selection and view source functionality.

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
5. External document changes → Extension sends `update` → Webview recreates Crepe instance

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
└── webview/
    ├── main.ts               # Browser-side Milkdown Crepe editor
    ├── frontmatter.ts        # YAML parsing & validation utilities
    ├── line-highlight-plugin.ts # ProseMirror plugin for cursor line highlight
    ├── heading-level-plugin.ts # ProseMirror plugin for H1-H6 level badges
    ├── image-edit-plugin.ts  # Double-click image URL editing
    ├── paste-link-plugin.ts  # Auto-link pasted URLs when text is selected
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

* `autoRenameImages` (boolean, default: true) - Automatically rename image files when you change the image path in Markdown (only when folder stays the same)

* `autoDeleteImages` (boolean, default: true) - Automatically delete image files when removed from Markdown (moves to Trash, warns if used elsewhere)

## Milkdown Crepe Integration

Uses `@milkdown/crepe` package. Theme CSS variables loaded from `src/webview/themes/` directory, scoped by body class (e.g., `.theme-frame .milkdown`). Available themes: frame, frame-dark, nord, nord-dark, crepe, crepe-dark, catppuccin-latte, catppuccin-frappe, catppuccin-macchiato, catppuccin-mocha. Editor recreates on content updates (no incremental update API).

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

## Line Highlight

**Plugin** (`src/webview/line-highlight-plugin.ts`):

* ProseMirror plugin using Decoration API

* Highlights immediate block containing cursor (paragraph, heading, list item)

* Skips code blocks (they have built-in line highlighting from CodeMirror)

* Injected via `prosePluginsCtx` before Crepe instance creation

**CSS** (in `src/markdownEditorProvider.ts`):

* Uses `::before` pseudo-element with `z-index: -1` stacking

* Light themes (`theme-frame`, `theme-nord`, `theme-crepe`, `theme-catppuccin-latte`): `rgba(0, 0, 0, 0.08)` background

* Dark themes (`theme-frame-dark`, `theme-nord-dark`, `theme-crepe-dark`, `theme-catppuccin-frappe`, `theme-catppuccin-macchiato`, `theme-catppuccin-mocha`): `rgba(255, 255, 255, 0.08)`

## Table Styling

**CSS** (in `src/markdownEditorProvider.ts`):

* `table-layout: auto` - Columns size proportionally to content

* `width: 100%` - Table spans full editor width

* `white-space: normal`, `word-wrap: break-word`, `overflow-wrap: break-word` - Cell text wraps naturally for responsive display

## Image Handling

**Local Image Display** (`src/markdownEditorProvider.ts`):

* `extractImagePaths()`: Extracts image paths from Markdown (both `![](path)` and `<img src="">`)

* `resolveImagePath()`: Resolves relative/absolute paths against document location

* `buildImageMap()`: Creates mapping from original paths to webview URIs

* `localResourceRoots` includes document folder and workspace for image access

**Image Upload** (`src/webview/main.ts`):

* Paste from clipboard: Intercepts paste events with image data

* Crepe file picker: Uses `onUpload` callback for image uploads

* Converts images to base64, sends to extension for saving

* Extension saves to configured folder (`tuiMarkdown.imageSaveFolder`)

* Returns saved path, updates Markdown with relative path

**Message Flow**:

1. Webview detects image (paste or upload) → converts to base64
2. Sends `saveImage` message with base64 data and filename
3. Extension saves to disk, returns `imageSaved` with relative path
4. Webview updates Markdown content with new image path

**Path Transformation**:

* On load: Local paths → webview URIs (for display)

* On save: Webview URIs → original paths (preserve markdown)

**Auto Rename Images** (`src/markdownEditorProvider.ts`):

* When user edits image path in Markdown (same folder, different filename)

* On save: Extension detects path change and prompts user via QuickPick dialog

* If confirmed: Renames image file on disk, updates all `.md` files in workspace with new path

* Controlled by `tuiMarkdown.autoRenameImages` setting (boolean, default: true)

* Only triggers when image folder remains the same

**Auto Delete Images** (`src/markdownEditorProvider.ts` + `src/utils/image-rename-handler.ts`):

* When user removes image from markdown (path no longer exists in document)

* On save: Extension detects removed images and prompts user via QuickPick dialog

* Shows warning icon if image is used in other `.md` files in workspace

* If confirmed: Moves image file to Trash (can be recovered)

* Controlled by `tuiMarkdown.autoDeleteImages` setting (boolean, default: true)

**Image URL Editing** (`src/webview/image-edit-plugin.ts`):

* Double-click on image opens VSCode input box to edit URL/path

* DOM event listener (capture phase) intercepts before Milkdown components

* Finds ProseMirror node via `posAtDOM()` and position search

* Uses async message flow: webview → extension (showInputBox) → webview

* Reverse lookup from imageMap to display original path instead of webview URI

* Updates node via ProseMirror transaction after user confirms

## Heading Level Indicator

**Plugin** (`src/webview/heading-level-plugin.ts`):

* ProseMirror plugin using Decoration.widget API

* Displays "H1", "H2", etc. badges inline before heading text

* Widget inserted at `pos + 1` (inside heading node, before text content)

* Subtle styling: 11px font, 0.5 opacity, muted colors

**CSS** (in `src/markdownEditorProvider.ts`):

* `display: inline-block` with `margin-right: 8px`

* Light themes: `rgba(0, 0, 0, 0.6)`

* Dark themes: `rgba(255, 255, 255, 0.5)`

## Paste Link

**Auto-link Plugin** (`src/webview/paste-link-plugin.ts`):

* ProseMirror plugin intercepts paste events

* When text is selected and clipboard contains valid URL (http/https)

* Converts selected text to markdown link: `[selected text](pasted URL)`

* Skips if no selection or clipboard has files (images)

* Replaces existing link URL if selection is already a link

## Development Guidelines

**Milkdown-First Approach:**

* Always prefer Milkdown's built-in features, plugins, and APIs over custom implementations

* Check existing Milkdown plugins before creating custom ProseMirror plugins

* Use Milkdown's theming system and CSS variables instead of custom styling when possible

**Reference Documentation:**

* Milkdown docs: <https://github.com/Milkdown/website/tree/main/docs>

* Milkdown API: <https://github.com/Milkdown/milkdown/tree/main/docs/api>

**Performance & Bundle Optimization:**

* Prefer tree-shakeable imports (e.g., `import { specific } from '@milkdown/kit'`)

* Avoid importing entire packages when only specific features are needed

* Lazy-load plugins and features when possible

* Minimize custom CSS; leverage Milkdown's CSS variables

* Profile bundle size impact before adding new dependencies

## Documentation Update Guidelines

After every development cycle (new feature, bug fix, refactor), update these files:

| File | When to Update | What to Include |
|------|----------------|-----------------|
| `CHANGELOG.md` | Every change | New features, bug fixes, breaking changes, improvements |
| `README.md` | New features only | User-facing feature descriptions (keep concise) |
| `CLAUDE.md` | Architecture/lessons | New components, patterns, gotchas, lessons learned |

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

