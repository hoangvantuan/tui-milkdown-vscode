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

## Bidirectional Sync

1. Document opens → Parse content → Show metadata panel (or "Add Metadata" button)
2. User edits metadata textarea → Validates YAML → Updates document (triggers `edit` message)
3. External document change → Reparse → Refresh metadata display
4. Empty metadata → Remove frontmatter delimiters from document

## Dependencies

`js-yaml@^4.1.1`, `@types/js-yaml` (dev)
