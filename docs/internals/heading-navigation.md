# Heading & Navigation

Heading level badges, collapse/expand, TOC sidebar, link click navigation.

## Heading Level Indicator

**Plugin** (`src/webview/heading-level-plugin.ts`):

* ProseMirror plugin using Decoration.widget API
* Displays "H1", "H2", etc. badges inline before heading text
* Widget inserted at `pos + 1` (inside heading node, before text content)
* Subtle styling: 11px font, 0.5 opacity, muted colors

**CSS** (in `src/markdownEditorProvider.ts`):

* `display: inline-block` with `margin-right: 8px`
* Light themes: `rgba(0, 0, 0, 0.6)` (default)
* Dark themes: `rgba(255, 255, 255, 0.5)` via `body.dark-theme` selector

## Heading Collapse

**Plugin** (`src/webview/heading-collapse-plugin.ts`):

* ProseMirror plugin for visual-only heading collapse/expand toggles
* Decoration-based: no schema changes, no markdown impact
* **Toggle arrow**: `Decoration.widget` at `pos + 1` with `side: -2` (renders before badge)
* **Content hiding**: `Decoration.node` with `collapsed-content` class on section nodes below collapsed heading
* **Stable heading keys**: `"H{level}:{text}:{occurrence}"` to survive position shifts; changes when heading text edited
* **Section detection**: Collapses all nodes until next heading at same or higher level, or end of document
* **State tracking**: `Map<string, boolean>` in plugin state for collapsed heading keys
* **Click handler**: `handleDOMEvents.click` on toggle arrow to dispatch transaction with collapse meta

**State Persistence** (in `src/webview/main.ts`):

* Saved in `vscode.setState()` under `collapsedHeadings: string[]`
* Restored after editor init via `setCollapsedHeadings()` helper
* Updated on transaction via `onTransaction` hook when collapse meta present

**CSS** (in `src/markdownEditorProvider.ts`):

* Toggle arrow overlaps heading-level-badge at same position (`left: -15px; top: 3px`), hidden by default (`opacity: 0`)
* **Hover swap**: On heading hover, badge fades out (`opacity: 0`) and arrow fades in (`opacity: 0.6`) — click to toggle collapse
* **Collapsed state**: Arrow always visible, badge always hidden (via `.heading-collapsed-indicator` parent class)
* Arrow colors: light `rgba(0, 0, 0, 0.5)`, dark `rgba(255, 255, 255, 0.5)`, `z-index: 2` above badge
* Collapsed content: `display: none !important` to hide section nodes
* Collapsed heading indicator: dashed border (1px, 0.15 opacity)
* `prefers-reduced-motion`: disables transitions

**Coexistence**:

* **Heading level badge**: Both at `pos + 1`, same absolute position; CSS hover-swap mechanism — arrow has `z-index: 2` above badge
* **TOC sidebar**: Independent heading extraction; TOC continues to track all headings (including hidden ones for state persistence)
* **Line highlight**: Won't highlight nodes with `display: none`
* **Markdown output**: `editor.getMarkdown()` unaffected — decorations are visual-only

## TOC Sidebar

**Module** (`src/webview/toc-sidebar.ts`):

* Standalone module: extract headings, build nested tree, render DOM, active tracking
* `extractHeadings(doc)`: Traverses `doc.descendants()` for heading nodes (same pattern as heading-level-plugin)
* `buildTocTree(flat)`: Stack-based nesting algorithm converting flat heading list to tree
* `updateTocFromEditor(editor, docChanged)`: Debounced rebuild (200ms) on doc changes, immediate active heading update on selection

**Layout** (in `src/markdownEditorProvider.ts`):

* `#main-layout` flexbox wrapper: sidebar (220px fixed) + editor container (flex: 1)
* Sidebar hidden by default (`.hidden` class), toggle via toolbar button
* Responsive: 180px width on viewports < 600px

**Integration** (in `src/webview/main.ts`):

* `setupTocHandlers()`: Registers toolbar toggle button
* `initTocSidebar()`: Called after editor init, restores visibility state AFTER content populated
* State persisted in `vscode.setState()`: `tocVisible`
* Hooked into `onTransaction` (not `onSelectionUpdate` — onTransaction covers both)

**Key patterns:**

* DOM scroll: `view.nodeDOM(pos)` + `requestAnimationFrame` with 60px top offset for precise heading positioning
* XSS safe: Uses `textContent` (not `innerHTML`) for heading text
* `vscode.setState()` must use spread pattern: `{ ...getState(), key: value }` to preserve other state (theme, TOC)

## Link Click Navigation

**Behavior** (in `src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* **Ctrl+Click** (`Cmd+Click` on macOS) triggers link navigation; regular click places cursor normally
* **Anchor links** (`#heading-slug`): `scrollToHeading()` traverses `doc.descendants()`, generates GitHub-style slug (lowercase, special chars removed, spaces→hyphens), scrolls matching heading into view via `scrollIntoView({ behavior: "smooth" })`
* **Relative file links** (`./file.md`, `../docs/readme.md`): Webview sends `openLink` message → Extension resolves path against `document.uri.fsPath` → `vscode.workspace.openTextDocument()` + `showTextDocument()`
* **External URLs** (`https://...`): Extension calls `vscode.env.openExternal()`
* **Cursor style**: `body.ctrl-held` class toggled via keydown/keyup listeners; CSS shows pointer cursor + underline on `.tiptap a`

**Message type**: `openLink` (webview → extension, payload: `{ href: string }`)
