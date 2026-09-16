# Worker Report: Issue #96 (Raw HTML Preservation)

## Summary of Implementation

- Implemented `RawHtmlBlock` and `RawHtmlInline` in `src/webview/raw-html.ts` following the core principle: the editor never invents or drops HTML, and only renders a tag natively when a dedicated extension owns it.
- `RawHtmlBlock` handles block-level HTML tokens (such as `<details>`, `<summary>`, `<div>`, and comments), displaying a muted monospace block with an HTML badge, serializing back verbatim.
- `RawHtmlInline` uses `markdownTokenizer` to tokenize inline HTML tags into distinct atom nodes for opening and closing tags, keeping enclosed text editable while serializing verbatim.
- Recognized tags (`<br>`, `<u>`, `<table>`, and plain `<img>`) remain handled natively by their dedicated extensions. An `<img>` carrying unmodeled attributes (`width`, `height`, `align`) is preserved as raw HTML.
- In `src/utils/export-docx.ts`, omitted `@m2d/html` which crashed in Node without DOM, allowing `mdast2docx` to gracefully skip raw HTML nodes without failing export.
- Registered nodes in `src/webview/main.ts` and mirrored in `harness/editor.ts`.
- Added CSS styles in `src/webview/themes/index.css`.

## Four Verification Commands

1. `npm run lint`: passed, 0 errors.
2. `npm run build`: passed, all bundles compiled successfully.
3. `npm run roundtrip`: passed, 35/35 checks (29 markdown fixtures + 6 seams: 35 passed, 0 failed, 0 missing, 0 errored).
4. `npm run verify:vscode-floor`: passed, 15/15 checks (15 passed, 0 failed on VS Code 1.85.0).

## Round Two Stability Check

- Command: `cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip; git checkout -- harness/fixtures/synthetic/`
- Failed fixtures before change: 1 (`synthetic/list-continuation-underindented.md`, pre-existing on develop).
- Failed fixtures after change: 1 (`synthetic/list-continuation-underindented.md`).
- Result: `synthetic/raw-html.md` is 100% byte-identical and stable on round two.

## Golden Baseline Changes

- `harness/golden/synthetic/raw-html.md`: new golden, byte-identical to fixture input.
- `harness/golden/repo/README.md`: intended fix (restores `<div align="center">`, `<img width="96">`, and `</div>` in header that were previously stripped).

## Proposed Text for CHANGELOG.md and AGENTS.md

### CHANGELOG.md

```markdown
### Fixed

- Preserve raw HTML blocks (<details>, <summary>, <div>, comments) and inline tags (<kbd>, <sub>, <a> with custom attributes, and <img> with width/height/align) verbatim on save (#96).
```

### AGENTS.md

- In File Structure:
  `├── webview/raw-html.ts # Raw HTML preservation nodes (rawHtmlBlock, rawHtmlInline)`
- In Tiptap Integration -> Extensions list:
  Add `RawHtmlBlock, RawHtmlInline (raw HTML preservation)`

## Findings Different from Issue Description

1. Token parsing mechanism: The issue description noted that `@tiptap/markdown` falls back to `htmlAsLiteralText` when no extension claims the tag. In reality, for standard HTML elements (such as `<div>`, `<details>`, `<kbd>`, `<summary>`), `isUnrecognizedHtml` returned false because the tag names are present in `STANDARD_HTML_TAGS`. They were passed to ProseMirror DOMParser, which stripped or unwrapped them because the schema had no matching node.
2. DOCX export crash: In `src/utils/export-docx.ts`, `@m2d/html` unconditionally invoked `document.createElement("div")`. In the Node extension host where `document` is not defined, exporting any document with raw HTML crashed with `ReferenceError: document is not defined`. Removing `@m2d/html` lets `mdast2docx` skip raw HTML safely without failing the export.
