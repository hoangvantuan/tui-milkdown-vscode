# Autocomplete Plugins

File mention (@) and wiki link ([[...]]) autocomplete.

## Shared Search Module

**File** (`src/webview/file-search-utils.ts`):

Shared module used by both file-mention and wiki-link plugins.

* **Fuzzy search**: `fuzzysort` (5KB, 0-dep) matches on both `name` and `path` fields. Threshold -1000, returns top `maxResults * 3` then re-sorts with proximity bonus.
* **Proximity scoring**: Files in same folder as current document get +50 bonus, parent folder +25. When no query, files sort by proximity then alphabetically.
* **Highlight**: `highlightMatches()` wraps matched character indexes in `<mark>` tags (with HTML escaping).
* **File icons**: `getFileIcon()` returns SVG icons for 10 file type groups:

| Group | Extensions |
|-------|-----------|
| Markdown | `.md`, `.mdx` |
| Code | `.ts`, `.tsx`, `.js`, `.jsx` |
| JSON/Data format | `.json`, `.yaml`, `.yml`, `.toml` |
| CSS | `.css`, `.scss`, `.less` |
| HTML | `.html`, `.htm`, `.vue`, `.svelte` |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico` |
| Config | `.env`, `.gitignore`, `.editorconfig`, `.prettierrc`, `.eslintrc` |
| Data | `.csv`, `.xlsx`, `.sql` |
| PDF/Doc | `.pdf`, `.docx` |
| Default | All other extensions |

* **Types**: `FileItem` (name + path), `FileSearchOptions`, `FileSearchResult` (file + score + nameIndexes + pathIndexes)

## File Mention (@)

**Plugin** (`src/webview/file-mention-plugin.ts`):

* Tiptap Extension using `@tiptap/suggestion` addon
* `char: "@"` trigger opens popup with workspace file list
* `allow()` blocks trigger inside `codeBlock` and after word characters (prevents email `user@domain`)
* Fuzzy search via shared `searchFiles()` with proximity scoring
* File type icons from shared `getFileIcon()`
* Matched characters highlighted with `<mark>` tags via `highlightMatches()`
* Insert: `[escapedName](<path>)` — angle brackets handle spaces, `]` escaped in filename
* Popup appended to `#editor-container` (not `.tiptap`) — avoids CSS zoom issues

**Cache strategy:**

* `onStart`: dispatch `file-mention-search` CustomEvent -> main.ts forwards as `fileSearch` postMessage -> extension calls `findFiles("**/*", excludePattern, 5000)` -> returns `fileSearchResults` with `currentDocFolder`
* main.ts calls `setFileMentionFiles(files, currentDocFolder)` to populate module-level cache
* Subsequent typing filters locally from cache using `searchFiles()` (no round-trip)
* Cache cleared on `onExit` (popup close), refetched on next open

**Extension side** (`src/markdownEditorProvider.ts`):

* Case `"fileSearch"`: reads `files.exclude` from VSCode settings, merges with defaults (`**/node_modules/**`, `**/.git/**`), calls `findFiles("**/*", excludePattern, 5000)`
* Computes `currentDocFolder` from current document path
* Returns `{ type: "fileSearchResults", files: [{name, path}], currentDocFolder }`

**Message types**: `fileSearch` (webview -> extension), `fileSearchResults` (extension -> webview)

**CSS**: `.file-mention-popup`, `.file-mention-item`, `.file-mention-icon`, `.file-mention-name`, `.file-mention-path`, `.file-mention-empty`, `.file-mention-popup mark`. Glassmorphic style matching toolbar.

**Dependencies**: `@tiptap/suggestion@^3.19.0`, `fuzzysort@^3.1.0`

## Wiki Link ([[...]])

**Plugin** (`src/webview/wiki-link-plugin.ts`):

* WikiLink inline node + WikiLinkSuggestion extension using `@tiptap/suggestion`
* Trigger: `[[` (custom `findSuggestionMatch`)
* `markdownTokenizer` registers MarkedJS inline tokenizer for `[[filename]]` and `[[filename|alias]]` syntax
* `markdownTokenName: "wikiLink"` + `parseMarkdown`/`renderMarkdown` hooks for roundtrip
* Fuzzy search via shared `searchFiles()` matching on name AND path (was name-only before)
* File type icons from shared `getFileIcon()`
* Matched characters highlighted, `.md` extension stripped from display name
* Popup: `.wiki-link-popup`, glassmorphic style, filters `.md` files, max 20 results
* Insert: creates `wikiLink` node with `filename` + optional `alias` attributes

**Cache strategy:** Same as File Mention.

* `onStart`: dispatch `wiki-link-search` CustomEvent -> main.ts forwards `wikiLinkSearch` -> extension calls `findFiles("**/*.md", excludePattern, 5000)` -> returns `wikiLinkSearchResults` with `currentDocFolder`
* main.ts calls `setWikiLinkFiles(files, currentDocFolder)` to populate cache
* Typing filters locally from cache using `searchFiles()`
* `onExit`: clear cache

**Click Navigation** (in `src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* Ctrl/Cmd+Click on `.wiki-link` sends `openWikiLink` message with filename
* Extension resolves: if filename contains `/` -> exact relative path + `.md`; otherwise `**/{filename}.md`
* 1 result -> open; multiple -> QuickPick; 0 -> warning

**Export:** `stripWikiLinks()` in `markdown-ast.ts` replaces `[[f]]` with "f", `[[f|a]]` with "a" in MDAST text nodes.

**Message types**: `wikiLinkSearch` (webview -> extension), `wikiLinkSearchResults` (extension -> webview), `openWikiLink` (webview -> extension)
