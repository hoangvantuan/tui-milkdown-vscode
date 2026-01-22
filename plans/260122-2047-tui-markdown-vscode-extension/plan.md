---
title: "TUI Markdown WYSIWYG VS Code Extension"
description: "VS Code extension using TUI Editor for WYSIWYG markdown editing with code-syntax-highlight plugin"
status: pending
priority: P2
effort: 8h
branch: feat/tui-markdown-extension
tags: [vscode, extension, markdown, wysiwyg, tui-editor, learning]
created: 2026-01-22
---

# TUI Markdown WYSIWYG VS Code Extension

## Overview

Build VS Code extension using CustomTextEditorProvider with TUI Editor for WYSIWYG markdown editing.

**Goals:**
- WYSIWYG markdown editing with TUI Editor
- Auto-enable for `.md` / `.markdown` files
- Code syntax highlighting plugin (Prism.js)
- Bidirectional sync (VS Code TextDocument <-> Webview)
- Light/Dark theme sync

## Architecture

```
VS Code Extension
├── CustomTextEditorProvider (registers for *.md)
│   ├── TextDocument (source of truth)
│   └── WebviewPanel
│       └── TUI Editor (WYSIWYG rendering)
└── Message Passing (postMessage)
    ├── Extension → Webview: content updates
    └── Webview → Extension: edit requests
```

## Tech Stack

- TypeScript + esbuild
- @toast-ui/editor@3.2.2 (vanilla, no framework)
- Code syntax highlight plugin only
- VS Code Extension API

## Phase Overview

| Phase | Name | Effort | Status |
|-------|------|--------|--------|
| 01 | [Project Setup](./phase-01-project-setup.md) | 1h | complete |
| 02 | [Basic Provider](./phase-02-basic-provider.md) | 1.5h | complete |
| 03 | [TUI Integration](./phase-03-tui-integration.md) | 2h | complete |
| 04 | [Sync Logic](./phase-04-sync-logic.md) | 1.5h | pending |
| 05 | [Plugins & Theme](./phase-05-plugins-theme.md) | 1.5h | pending |
| 06 | [Polish & Test](./phase-06-polish-test.md) | 0.5h | pending |

## Key Dependencies

**NPM Packages:**
- @toast-ui/editor
- @toast-ui/editor-plugin-code-syntax-highlight
- prismjs

**Dev Dependencies:**
- typescript, esbuild, @types/vscode

## Success Criteria

- [ ] Extension activates on `.md` file open
- [ ] WYSIWYG editor renders markdown correctly
- [ ] Edits in WYSIWYG save to file
- [ ] External file changes update webview
- [ ] Code syntax highlighting functional
- [ ] Theme syncs with VS Code
- [ ] No infinite loop issues

## Validation Summary

**Validated:** 2026-01-22
**Questions asked:** 6

### Confirmed Decisions

| Decision | User Choice | Impact |
|----------|-------------|--------|
| Editor Priority | `default` | Auto-open WYSIWYG for all .md files |
| Debounce Delay | 500ms | Less frequent saves, better performance |
| Plugins | Code-syntax-highlight only | Minimal bundle, chỉ cần syntax highlighting |
| Prism Languages | 15 languages | Balanced bundle size |
| Settings UI | Full configuration | Add contributes.configuration |
| Project Location | Current directory | `/Users/shun/Desktop/markdown/` |

### Action Items

- [x] Update package.json: Change `priority: "option"` → `priority: "default"`
- [ ] Update DEBOUNCE_MS: 300 → 500
- [x] Remove all plugins except code-syntax-highlight
- [ ] Add Phase 07: Settings Configuration với contributes.configuration
- [ ] Update effort estimate: 8h → 9h (thêm settings phase)

## References

- [Brainstorm Report](../reports/brainstorm-260122-2047-tui-markdown-vscode-extension.md)
- [VS Code API Research](./research/researcher-01-vscode-custom-editor-api.md)
- [TUI Integration Research](./research/researcher-02-tui-editor-integration.md)
