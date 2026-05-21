# Mermaid System

Mermaid diagram rendering, copy as PNG, security considerations.

## Mermaid Diagrams

**Plugin** (`src/webview/mermaid-plugin.ts`):

* Tiptap Extension wrapping a ProseMirror plugin with widget decorations
* Renders SVG previews after `mermaid` code blocks using `mermaid` library (v11)
* **View/Edit mode**: View mode (default) hides code block, shows SVG only; double-click preview enters edit mode (code + preview stacked); cursor leave returns to view mode
* **Selective re-render**: `rebuildNodeDecosOnly()` preserves widget DOM elements when only selection changes (no flicker)
* **Render caching**: `renderCache` Map avoids re-rendering identical diagrams
* **Theme sync**: `updateMermaidTheme(isDark)` + `clearMermaidCache()` called on theme change
* **Debounced rendering**: 500ms debounce per code block position to avoid excessive renders during typing
* **Error handling**: Parse errors shown inline with `mermaid-error` class, stale temp elements cleaned up
* **Fullscreen expand**: Widget decoration contains `.mermaid-svg-host` (SVG target for `innerHTML`) + `.mermaid-expand-btn` sibling (top-left, hover fade-in, hidden on error/editing). Click reads `svgEl.outerHTML` and calls `openMermaidLightbox()`

**CSS classes**: `.mermaid-code-block`, `.mermaid-editing`, `.mermaid-preview`, `.mermaid-svg-host`, `.mermaid-error`, `.mermaid-expand-btn`, `.mermaid-copy-btn`

**Dependencies**: `mermaid@^11.12.2`

## Security: `securityLevel: "loose"`

Mermaid is initialized with `securityLevel: "loose"` in both `ensureMermaidInit()` and `updateMermaidTheme()`. "loose" is required so ELK can render `foreignObject` HTML inside labels. "strict" strips HTML and the layout looks flat.

**Trade-off**: a mermaid label can contain inline HTML such as `<img onerror=...>`, which is passed through to the rendered SVG. That SVG is then written to the DOM via `innerHTML` in both the preview host and the lightbox wrapper.

**Implication**: treat third-party mermaid source (pasted from untrusted markdown) as potentially executable. The PDF exporter disables JavaScript in the Chromium page so this does not escalate there; the webview itself relies on VS Code's webview sandbox. Do NOT relax the sandbox or enable `--allow-scripts` for mermaid rendering.

## Mermaid Copy as PNG

**Module** (`src/webview/svg-to-png.ts`):

* `svgToPngBlob(svgString, scale = 2)`: DOMParser → ensure `width`/`height` (fallback to `viewBox`) → Blob SVG → `URL.createObjectURL` → `<Image>` → `canvas.drawImage` at `native * scale` → `canvas.toBlob('image/png')`. Scales via canvas (not CSS) to ensure crisp PNG at all DPIs.
* `copyPngBlobToClipboard(blob)`: `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`. Throws if `ClipboardItem` or `clipboard.write` is unavailable.
* `reportCopyError(message)`: Dispatches `CustomEvent('mermaid-copy-error', { detail: { message } })` on `document`. Keeps the module decoupled from the vscode API handle.

**Preview button** (`src/webview/mermaid-plugin.ts`):

* `.mermaid-copy-btn` injected next to `.mermaid-expand-btn` in the widget decoration (same button creation loop). Click: queries `svg` in `.mermaid-svg-host` → `svgToPngBlob` → `copyPngBlobToClipboard` → `flashCopiedState()` (adds `.is-copied` for 1.5s, two `<svg>` icons copy/check toggled via CSS).
* Auto-hidden via CSS when `.mermaid-error`, `.mermaid-editing`, or `data-rendered="true"` is not set.

**Lightbox button** (`src/webview/image-lightbox-plugin.ts`):

* `#lightbox-copy` in `.lightbox-controls` (before the close button). Wired in `initLightbox`, visibility toggled via `setCopyButtonVisibility()`:
  * `openMermaidLightbox` → visible
  * `openLightbox` (image) and `closeLightbox` → hidden
* Click reads SVG from `#lightbox-svg.querySelector('svg')` → same flow as preview.

**Error forwarding** (`src/webview/main.ts`):

* Listener `document.addEventListener('mermaid-copy-error', ...)` forwards `detail.message` to the extension via `vscode.postMessage({ type: 'showWarning', message })`. Keeps `svg-to-png.ts` from needing an `acquireVsCodeApi()` reference.

**Gotchas**:

* Lightbox strips `width`/`height` attributes from SVG (for free zoom), but `svgToPngBlob` already normalizes via `resolveSvgSize()` (reads `viewBox` when attributes are missing) then sets them back before serializing.
* Clipboard requires secure context — VS Code webview qualifies. If an older runtime lacks `ClipboardItem`, the button throws an error, which is forwarded as a VS Code warning dialog.
* `XMLSerializer` + Blob SVG avoids inline `<script>` → CSP-safe, no CSP tweaking needed.
