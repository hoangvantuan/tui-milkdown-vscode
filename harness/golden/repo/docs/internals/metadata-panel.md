# Metadata Panel

Frontmatter YAML editing panel.

## Frontmatter Handling

(`src/webview/frontmatter.ts`):

- Parses and validates YAML frontmatter using `js-yaml` library
- Returns validation errors with line numbers
- Reconstructs Markdown with frontmatter delimiters (`---`)
- Handles edge cases: empty frontmatter, missing delimiters, invalid YAML

## Panel UI

(integrated in `src/markdownEditorProvider.ts` HTML):

- Collapsible `<details>` element styled with VSCode theme variables
- Textarea for YAML editing with syntax error display (red border + error message)
- Tab key inserts 2 spaces (YAML standard indentation)
- "Add Metadata" button when no frontmatter exists
- Panel integrates seamlessly below toolbar, above editor

## Implicit Frontmatter Format

Some Markdown files omit the opening `---` delimiter. Implicit frontmatter is YAML key-value pairs at the very start of the file, terminated by a lone `---` line.

**Example:**

```
title: My Page
date: 2024-01-01
---

# Content here
```

**Detection heuristic** (in `src/utils/frontmatter-parser.ts`):

1. Parse candidate block (lines before first `---`) as YAML
2. Result must be a plain object (not array, not scalar)
3. Must have ≥2 keys
4. Must contain ≥1 known key

**Known keys:** `title`, `date`, `tags`, `author`, `description`, `draft`, `layout`, `slug`, `category`, `categories`, `permalink`, `weight`, `summary`, `image`, `cover`, `published`, `updated`, `created`, `aliases`, `keywords`, `series`, `toc`

**Format preservation:** file opened as implicit saves as implicit (no opening `---` added). File opened as standard (with opening `---`) saves as standard.

**Lossless replay (`rawBlock`):** beside `frontmatter` (the raw YAML between/above the delimiters), `ParseResult` carries `rawBlock`: the exact document prefix up to the first body character — the block with its delimiters plus whatever blank-line gap followed it (none, one, or several; the gap lives here rather than in `body` because a body re-serialized by the editor loses its leading newlines). `reconstructContent(frontmatter, body, format, rawBlock?)` replays those bytes verbatim (`rawBlock + body` with the body's leading newlines stripped as editor noise) while the block still embeds the current `frontmatter` — this check discards a stale block after a metadata-panel edit, which then falls back to the canonical `---\n{yaml}\n---\n\n` template (a deliberate re-derivation, not a round-trip). This is what keeps `---\n---`, blank-line-only blocks, the implicit separator's surrounding blank lines, the original block-to-body gap, and trailing whitespace on delimiter lines (`---` ) byte-for-byte stable across open/save. The distinction between "no frontmatter" (`frontmatter: null`, `format: "none"`) and "empty standard frontmatter" (`frontmatter: ""`, `format: "standard"`) lives in these fields.

**Shared utility:** `src/utils/frontmatter-parser.ts` exports `parseContent(content)` and `reconstructContent(frontmatter, body, format, rawBlock?)` used by both extension and webview; `src/webview/frontmatter.ts` re-exports them and adds `validateYaml`.

## Bidirectional Sync

1. Document opens → Parse content → Show metadata panel (or "Add Metadata" button)
2. User edits metadata textarea → Validates YAML → Updates document (triggers `edit` message)
3. External document change → Reparse → Refresh metadata display
4. Empty metadata → Remove frontmatter delimiters from document

## Dependencies

`js-yaml@^4.1.1`, `@types/js-yaml` (dev)