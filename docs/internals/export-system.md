# Export System

DOCX and PDF export via shared MDAST pipeline.

## Shared Pipeline

(`src/utils/markdown-ast.ts`):

* Extension host parses the raw document (only the BOM stripped, frontmatter handled by `remark-frontmatter`) into a single MDAST once per export via `parseMarkdownToMdast()`.
* The provider pops the leading `yaml`/`toml` node so frontmatter is not rendered as content.
* Mermaid code blocks are swapped for `image` nodes via `replaceMermaidBlocks()`. Correlation key: `hashMermaidCode()` — djb2 with `\r\n|\r → \n` normalization + trim, so CRLF files match the LF-normalized code the webview has in `data-mermaid-src`.
* Both exporters consume the same MDAST — no regex replace drift between webview text and export text.
* Webview pre-renders mermaid to PNG via `svg-to-png.ts` (DOMParser + native `canvas.toBlob`), sends `{ code, base64 }[]` in the `export` message. `svg-to-png.ts` falls back to 800x600 with `console.warn` when the SVG has no width/height/viewBox.

## Provider Hook

(`src/markdownEditorProvider.ts` case `"export"`):

* Enforces a single-in-flight export per webview via the `exportInProgress` flag. A second click while busy gets rejected with "Export in progress, please wait for the current export to finish." + `exportDone {success: false, reason: "busy"}` back to the webview.
* On success or error, extension sends `exportDone` so the webview can re-enable its button without relying on a 3 s timeout. The webview also keeps a 60 s safety timer in case the message is lost.
* After building the MDAST, provider warns "Document is empty, nothing to export." when `mdast.children` is empty (or was only frontmatter).

## DOCX Export

(`src/utils/export-docx.ts`):

* `mdast2docx` core + `@m2d/html`, `@m2d/image`, `@m2d/table`, `@m2d/list` plugins.
* Node-side `imageResolver` handles data URLs, `http(s)` fetch, and relative file paths against the document directory. Failure modes are non-fatal — the resolver returns a 1x1 transparent PNG placeholder so one broken image does not kill a 50-image export. Warnings log to the console.
* Remote fetch uses `AbortController` with a 30 s timeout and rejects when `content-length` OR the downloaded `arrayBuffer` exceeds 10 MB.
* SVG images (not the mermaid data-URL kind) cannot be embedded in DOCX — resolver returns the placeholder + warns instead of throwing.
* `decodeURIComponent` is wrapped in `safeDecodeURIComponent` to survive filenames with literal `%` (e.g. `50%_off.png`).
* `fontFamily` option is applied via `docxProps.styles.default.document.run.font` so DOCX inherits the editor's active font.

## PDF Export

(`src/utils/export-pdf.ts`):

* MDAST → HAST via `remark-rehype` (`allowDangerousHtml: true`) + `rehype-highlight` (`detect: false, ignoreMissing: true`).
* Before stringify, `inlineRelativeImages(hast, baseDir)` walks the tree, reads any `<img>` with a relative/local path from disk, and rewrites `src` to a `data:` URL. Without this, Chromium's `about:blank` page would 404 all relative image references.
* `rehype-stringify` then produces HTML, which is passed through `stripDangerousHtmlTags()` to remove `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, and `<meta http-equiv>` tags. This is a narrow defence-in-depth strip, not a full sanitizer — it pairs with JS-disabled Chromium.
* HTML is wrapped in a GitHub-like document template (`buildHtmlDocument`). Font family user chose is passed through `cssFontFamilyToken()` — NOT `escapeHtml`. CSS `<style>` text does not decode HTML entities, so a whitelist strip (`[A-Za-z0-9 _-]`) is used to keep the `font-family` declaration valid.
* Chromium launch: `puppeteer.launch({ args: puppeteerLaunchArgs() })`. `puppeteerLaunchArgs()` returns `["--no-sandbox", "--disable-setuid-sandbox"]` ONLY on Linux-as-root — macOS/Windows/Linux-as-user keep Chromium's default sandbox.
* `page.setJavaScriptEnabled(false)` before `setContent`. `waitUntil: "networkidle0"` so inlined images finish decoding before `page.pdf()` prints.
* Launch errors are wrapped: "Failed to launch Chromium at `<path>`: <original>. Check execute permission or configure tuiMarkdown.chromiumPath."

## Chromium Discovery

(`src/utils/chromium-discovery.ts`):

* Extension does NOT ship a Chromium binary. Looks up an installed Chrome/Edge/Chromium/Brave via (in order): `tuiMarkdown.chromiumPath` setting → `PUPPETEER_EXECUTABLE_PATH` env → OS-specific well-known paths. First hit is cached for the session.
* Path validation uses `fs.accessSync(path, X_OK)` on top of `isFile()`. Leading/trailing quotes in the setting value are stripped so `"C:\...\chrome.exe"` works.
* The provider listens for `tuiMarkdown.chromiumPath` changes via `onDidChangeConfiguration` and calls `clearChromiumCache()` — no reload needed. (`clearChromiumCache` is re-exported from `export-pdf.js` so the provider can reach it without a separate bundle entry for `chromium-discovery`.)
* Bundling: `puppeteer-core` is bundled INTO `out/export-pdf.js` via esbuild tree-shake (~2.5MB minified) — NOT external. `.vscodeignore` excludes `node_modules/**`, so external wouldn't ship.

## Gotchas

* **VS Code Electron is not a Chromium puppeteer can drive.** `process.execPath` in the extension host points at an Electron helper — launching puppeteer against it fails. This is why the discovery module explicitly does not try `process.execPath`.
* **Chromium is required on the user's machine.** PDF export surfaces an "Open Settings" error dialog when no binary is found. Fallback was intentionally NOT implemented to keep the bundle small and the pipeline WYSIWYG.
* **Do NOT add `--disable-web-security` or re-enable JS** on the puppeteer page. `--no-sandbox` is also gated to Linux root only — do not widen.
* **Do NOT drop `stripDangerousHtmlTags` or `inlineRelativeImages`.** They are the reason user markdown with `<iframe src="file:///...">` or `![](./img.png)` behaves safely and correctly.
* `findChromiumExecutable()` result is cached per session — clear with `clearChromiumCache()` if a test needs to re-probe. The provider auto-clears on `tuiMarkdown.chromiumPath` changes.
* Mermaid rendering is done client-side (webview) and shipped to the extension as base64 data URLs, so the exporters don't need mermaid / graphviz installed on the host.
* Hash stability: webview's `data-mermaid-src` holds ProseMirror's `node.textContent` (already LF-normalized), extension hashes remark-parse's `node.value` — both go through `hashMermaidCode` which re-normalizes line endings, so CRLF files and indented fences still match.
