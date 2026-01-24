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
- Extension bundle: `src/extension.ts` → `out/extension.js` (CJS, Node platform)
- Webview bundle: `src/webview/main.ts` → `out/webview/main.js` (IIFE, browser platform)

**Build configuration**:
- Production mode (default): minified bundles, no sourcemaps, tree-shaking enabled
- Development mode (`--dev` flag): sourcemaps enabled, unminified, tree-shaking enabled
- Watch mode (`--watch` flag): rebuilds on file changes, sourcemaps enabled

**Extension ↔ Webview communication flow:**
1. Extension registers `CustomTextEditorProvider` for `.md` files
2. When document opens, provider creates webview with HTML template containing editor container
3. Webview sends `ready` → Extension sends `theme`, `config`, `update` (content)
4. User edits → Webview debounces (300ms) → sends `edit` message → Extension applies `WorkspaceEdit`
5. External document changes → Extension sends `update` → Webview recreates Crepe instance

**Key implementation details:**
- `pendingEdit` flag prevents edit loops between extension and webview
- Webview persists theme selection in `vscode.setState()`
- Large files (>500KB) show warning dialog
- CSP uses nonce for script execution

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
    └── line-highlight-plugin.ts # ProseMirror plugin for cursor line highlight
```

## Configuration Settings

Extension provides these settings via `tuiMarkdown.*` namespace:
- Font size (8-32px), heading sizes H1-H6 (12-72px)
- `highlightCurrentLine` (boolean, default: true) - Enable cursor line highlight

## Milkdown Crepe Integration

Uses `@milkdown/crepe` package. Theme variables are manually applied via CSS custom properties in `THEME_VARIABLES` map. Editor recreates on content updates (no incremental update API).

## Metadata Panel

**Frontmatter Handling** (`src/webview/frontmatter.ts`):
- Parses and validates YAML frontmatter using `js-yaml` library
- Returns validation errors with line numbers
- Reconstructs markdown with frontmatter delimiters (`---`)
- Handles edge cases: empty frontmatter, missing delimiters, invalid YAML

**Panel UI** (integrated in `src/markdownEditorProvider.ts` HTML):
- Collapsible `<details>` element styled with VSCode theme variables
- Textarea for YAML editing with syntax error display (red border + error message)
- Tab key inserts 2 spaces (YAML standard indentation)
- "Add Metadata" button when no frontmatter exists
- Panel integrates seamlessly below toolbar, above editor

**Bidirectional Sync**:
1. Document opens → Parse content → Show metadata panel (or "Add Metadata" button)
2. User edits metadata textarea → Validates YAML → Updates document (triggers `edit` message)
3. External document change → Reparse → Refresh metadata display
4. Empty metadata → Remove frontmatter delimiters from document

**Dependencies**: `js-yaml@^4.1.1`, `@types/js-yaml` (dev)

## Line Highlight

**Plugin** (`src/webview/line-highlight-plugin.ts`):
- ProseMirror plugin using Decoration API
- Highlights immediate block containing cursor (paragraph, heading, list item)
- Skips code blocks (they have built-in line highlighting from CodeMirror)
- Injected via `prosePluginsCtx` before Crepe instance creation

**CSS** (in `src/markdownEditorProvider.ts`):
- Uses `::before` pseudo-element with `z-index: -1` stacking
- Light themes: `rgba(0, 0, 0, 0.08)` background
- Dark themes (`theme-frame-dark`, `theme-nord-dark`): `rgba(255, 255, 255, 0.08)`
