# Table System

Table styling, context menu, GFM serializer, cell content parser.

## Table Styling

**CSS** (in `src/markdownEditorProvider.ts`):

* `table-layout: auto` - Columns size proportionally to content
* `width: 100%` - Table spans full editor width
* `white-space: normal`, `word-wrap: break-word`, `overflow-wrap: break-word` - Cell text wraps naturally for responsive display

## Table Context Menu

**Extension** (`src/webview/table-context-menu.ts`):

* Right-click context menu for table operations using ProseMirror plugin
* **Actions**: Select Row/Column/Table, Add Row Above/Below, Add Column Before/After, Delete Row/Column/Table
* **Selection**: Uses `CellSelection`, `TableMap`, `cellAround` from `@tiptap/pm/tables`
* **Positioning**: Container-relative coordinates with overflow adjustment
* **Cleanup**: Closes on Escape key, click outside, or editor scroll

**CSS**: `.table-context-menu`, `.table-ctx-item`, `.table-ctx-divider` (in `markdownEditorProvider.ts`)

## Table Serializer

**Custom Serializer** (`src/webview/table-markdown-serializer.ts`):

* Extends `@tiptap/extension-table` via `Table.extend({ renderMarkdown(node, helpers) })` hook (pattern from `@tiptap/markdown` extension spec)
* `helpers` is `MarkdownRendererHelpers` providing `renderChildren()`, `indent()`, `wrapInBlock()`
* Preserves multi-line cell content using `<br>` tags in GFM table format
* Handles bullet lists, ordered lists, task lists within table cells
* Column widths auto-padded for aligned markdown output

## Table Cell Content Parser

(`src/webview/table-cell-content-parser.ts`):

* Post-parse transformer called after `setContent`/`initEditor`
* Converts `<br>` (hardBreak from GFM) → paragraph boundaries
* Converts `\n` (literal) → hardBreak nodes within paragraph (soft break)
* Detects list patterns (`- item`, `N. item`, `[x] item`) → proper list nodes
* Groups consecutive same-type segments into single list block
