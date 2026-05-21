# Autocomplete Plugins

File mention (@) and wiki link ([[...]]) autocomplete.

## File Mention (@)

**Plugin** (`src/webview/file-mention-plugin.ts`):

* Tiptap Extension using `@tiptap/suggestion` addon
* `char: "@"` trigger opens popup with workspace file list
* `allow()` blocks trigger inside `codeBlock` and after word characters (prevents email `user@domain`)
* Fuzzy filter: prefix match priority > contains, case-insensitive, max 20 results
* Insert: `[escapedName](<path>)` — angle brackets handle spaces, `]` escaped in filename
* Popup appended to `#editor-container` (not `.tiptap`) — avoids CSS zoom issues

**Cache strategy:**

* `onStart`: dispatch `file-mention-search` CustomEvent → main.ts forwards as `fileSearch` postMessage → extension calls `findFiles("**/*", excludePattern, 1000)` → returns `fileSearchResults`
* main.ts calls `setFileMentionFiles(files)` to populate module-level cache
* Subsequent typing filters locally from cache (no round-trip)
* Cache cleared on `onExit` (popup close), refetched on next open

**Extension side** (`src/markdownEditorProvider.ts`):

* Case `"fileSearch"`: calls `vscode.workspace.findFiles()` with exclude `{**/node_modules/**,**/.git/**,**/.vscode/**,**/out/**,**/dist/**,**/.DS_Store}`, max 1000 results
* Returns `{ type: "fileSearchResults", files: [{name, path}] }`

**Message types**: `fileSearch` (webview → extension), `fileSearchResults` (extension → webview)

**CSS**: `.file-mention-popup`, `.file-mention-item`, `.file-mention-icon`, `.file-mention-name`, `.file-mention-path`, `.file-mention-empty`. Glassmorphic style matching toolbar.

**Dependencies**: `@tiptap/suggestion@^3.19.0`

## Wiki Link ([[...]])

**Plugin** (`src/webview/wiki-link-plugin.ts`):

* WikiLink inline node + WikiLinkSuggestion extension using `@tiptap/suggestion`
* Trigger: `[[` (custom `findSuggestionMatch`)
* `markdownTokenizer` registers MarkedJS inline tokenizer for `[[filename]]` and `[[filename|alias]]` syntax
* `markdownTokenName: "wikiLink"` + `parseMarkdown`/`renderMarkdown` hooks for roundtrip
* Popup: `.wiki-link-popup`, glassmorphic style, filters `.md` files, max 20 results
* Insert: creates `wikiLink` node with `filename` + optional `alias` attributes

**Cache strategy:** Same as File Mention.

* `onStart`: dispatch `wiki-link-search` CustomEvent -> main.ts forwards `wikiLinkSearch` -> extension calls `findFiles("**/*.md")` -> returns `wikiLinkSearchResults`
* main.ts calls `setWikiLinkFiles(files)` to populate cache
* Typing filters locally from cache
* `onExit`: clear cache

**Click Navigation** (in `src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* Ctrl/Cmd+Click on `.wiki-link` sends `openWikiLink` message with filename
* Extension resolves: if filename contains `/` -> exact relative path + `.md`; otherwise `**/{filename}.md`
* 1 result -> open; multiple -> QuickPick; 0 -> warning

**Export:** `stripWikiLinks()` in `markdown-ast.ts` replaces `[[f]]` with "f", `[[f|a]]` with "a" in MDAST text nodes.

**Message types**: `wikiLinkSearch` (webview -> extension), `wikiLinkSearchResults` (extension -> webview), `openWikiLink` (webview -> extension)
