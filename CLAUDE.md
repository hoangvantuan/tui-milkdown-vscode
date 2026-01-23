# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode extension providing WYSIWYG Markdown editing using Milkdown Crepe editor. Opens `.md` files in a custom editor with theme selection and view source functionality.

## Commands

```bash
npm run build     # Build extension and webview bundles
npm run watch     # Watch mode for development
npm run lint      # TypeScript type checking (tsc --noEmit)
npm run package   # Package extension as .vsix
```

## Architecture

**Dual-bundle build** using esbuild (`esbuild.config.js`):
- Extension bundle: `src/extension.ts` → `out/extension.js` (CJS, Node platform)
- Webview bundle: `src/webview/main.ts` → `out/webview/main.js` (IIFE, browser platform)

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
├── markdownEditorProvider.ts # CustomTextEditorProvider implementation
├── utils/getNonce.ts         # CSP nonce generator
└── webview/main.ts           # Browser-side Milkdown Crepe editor
```

## Milkdown Crepe Integration

Uses `@milkdown/crepe` package. Theme variables are manually applied via CSS custom properties in `THEME_VARIABLES` map. Editor recreates on content updates (no incremental update API).
