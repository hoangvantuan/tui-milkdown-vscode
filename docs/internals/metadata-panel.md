# Metadata Panel

Frontmatter YAML editing panel.

## Frontmatter Handling

(`src/webview/frontmatter.ts`):

* Parses and validates YAML frontmatter using `js-yaml` library
* Returns validation errors with line numbers
* Reconstructs Markdown with frontmatter delimiters (`---`)
* Handles edge cases: empty frontmatter, missing delimiters, invalid YAML

## Panel UI

(integrated in `src/markdownEditorProvider.ts` HTML):

* Collapsible `<details>` element styled with VSCode theme variables
* Textarea for YAML editing with syntax error display (red border + error message)
* Tab key inserts 2 spaces (YAML standard indentation)
* "Add Metadata" button when no frontmatter exists
* Panel integrates seamlessly below toolbar, above editor

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

**Shared utility:** `src/utils/frontmatter-parser.ts` exports `parseFrontmatter(content)` and `reconstructMarkdown(data, body, format)` used by both extension and webview.

## Bidirectional Sync

1. Document opens → Parse content → Show metadata panel (or "Add Metadata" button)
2. User edits metadata textarea → Validates YAML → Updates document (triggers `edit` message)
3. External document change → Reparse → Refresh metadata display
4. Empty metadata → Remove frontmatter delimiters from document

## Dependencies

`js-yaml@^4.1.1`, `@types/js-yaml` (dev)
