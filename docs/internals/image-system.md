# Image System

Image display, upload, editing, lightbox, clipboard fallback.

## Local Image Display

(`src/markdownEditorProvider.ts`):

* `extractImagePaths()`: Extracts image paths from Markdown (both `![](path)` and `<img src="">`)
* `resolveImagePath()`: Resolves relative/absolute paths against document location
* `buildImageMap()`: Creates mapping from original paths to webview URIs
* `localResourceRoots` includes document folder and workspace for image access

## Image Upload

(`src/webview/main.ts`):

* Paste from clipboard: Intercepts paste events with image data
* Tiptap handlePaste/handleDrop: Intercepts paste/drop events for image uploads
* Converts images to base64, sends to extension for saving
* Extension saves to configured folder (`tuiMarkdown.imageSaveFolder`)
* Returns saved path, updates Markdown with relative path

**Message Flow**:

1. Webview detects image (paste or upload) → converts to base64
2. Sends `saveImage` message with base64 data and filename
3. Extension saves to disk, returns `imageSaved` with relative path
4. Webview updates Markdown content with new image path

**Path Transformation**:

* On load: Local paths → webview URIs (for display)
* On save: Webview URIs → original paths (preserve markdown)

## Auto Rename Images

(`src/markdownEditorProvider.ts`):

* When user edits image path in Markdown (same folder, different filename)
* On save: Extension detects path change and prompts user via QuickPick dialog
* If confirmed: Renames image file on disk, updates all `.md` files in workspace with new path
* Controlled by `tuiMarkdown.autoRenameImages` setting (boolean, default: true)
* Only triggers when image folder remains the same

## Auto Delete Images

(`src/markdownEditorProvider.ts` + `src/utils/image-rename-handler.ts`):

* When user removes image from markdown (path no longer exists in document)
* On save: Extension detects removed images and prompts user via QuickPick dialog
* Shows warning icon if image is used in other `.md` files in workspace
* If confirmed: Moves image file to Trash (can be recovered)
* Controlled by `tuiMarkdown.autoDeleteImages` setting (boolean, default: true)

## Image URL Editing

(`src/webview/image-edit-plugin.ts`):

* Double-click on image opens VSCode input box to edit URL/path
* DOM event listener (capture phase) intercepts before Tiptap components
* Finds ProseMirror node via `posAtDOM()` and position search
* Uses async message flow: webview → extension (showInputBox) → webview
* Reverse lookup from imageMap to display original path instead of webview URI
* Updates node via ProseMirror transaction after user confirms

## Open Image in New Tab (issue #62)

(`src/webview/image-edit-plugin.ts` + `src/markdownEditorProvider.ts`):

The hover overlay has a third button (external-link icon), shown only when the
image is local (`isLocalImageSrc`: src starts with `vscode-webview://` or contains
`vscode-resource.vscode-cdn.net`). Base64 and remote `http(s)` images hide it.

Flow:

1. Webview reverse-looks up `originalPath` from `currentImageMap` (webview URI → relative path).
2. Sends `postMessage({ type: "openImageInTab", path })`.
3. Extension `openLocalFileInEditor(path, document)`: resolves against the document
   folder, security-checks it stays within the workspace, then `vscode.open(uri)`
   (respects the default editor association, so the Excalidraw plugin opens `.svg`).

Helper `openLocalFileInEditor` is shared with the `openLink` handler.

## Context-Aware Path Transforms

(`src/webview/main.ts` + `src/markdownEditorProvider.ts`):

* Path replacements only apply within markdown image/link syntax contexts (`![alt](url)` and `[text](url)`)
* Workspace reference updates skip content inside code blocks (fenced and inline) to prevent accidental code modification
* Image path utility (`clean-image-path.ts`): Removes markdown link titles and angle brackets from paths before saving

## Image Size Limit

* 10MB maximum image size limit on paste/drop operations
* Oversized images trigger `showWarning` message to display user-facing dialog in extension

## Message Types

* `saveImage`: Webview → Extension (base64 image data, filename, upload type)
* `imageSaved`: Extension → Webview (relative file path after save)
* `showWarning`: Webview → Extension (message title and warning text for VSCode dialog)
* `readClipboardImage`: Webview → Extension (request native clipboard read as fallback)
* `clipboardImage`: Extension → Webview (base64 PNG from system clipboard)
* `openImageInTab`: Webview → Extension (relative path of a local image to open in a new editor tab)

## Clipboard Image Fallback

Triple strategy in `src/webview/main.ts`:

1. ProseMirror `handlePaste` (editorProps) — standard `clipboardData.items`/`files`
2. `navigator.clipboard.read()` — async Clipboard API (may need permission)
3. Extension-side native read — `osascript` (macOS), PowerShell (Windows), `xclip` (Linux)

## Lightbox (Image & Mermaid)

**Plugin** (`src/webview/image-lightbox-plugin.ts`):

* Shared fullscreen overlay for both images and mermaid diagrams
* Dark backdrop, zoom (0.5x–4x), pan by dragging when `scale > 1`
* Zoom via buttons (+/−), mouse wheel, or keyboard (`+`/`-` step, `0` reset, `Esc` close)
* Touch: 2-finger drag pans image (when zoomed in); `touch-action: none` on overlay disables browser default pinch-to-zoom
* Caption from image alt text or explicit string
* Close via Escape, click outside image/controls, or close button (overlay-level click handler checks target)
* Internal state `currentTarget: HTMLElement` switches between `#lightbox-image` and `#lightbox-svg` wrapper; `applyTransform()` writes to whichever is active
* Exported API:
  * `openLightbox(src, alt)` — image path → `<img>`
  * `openMermaidLightbox(svgMarkup, caption)` — SVG outer HTML → `#lightbox-svg` wrapper
  * `initLightbox()` called once in `init()`
* Mousedown listener attached to `.lightbox-content` so both targets share drag-pan logic
* Mermaid SVG is rendered with `securityLevel: "loose"` (required for ELK + `foreignObject` HTML labels). `innerHTML` assignment into the lightbox trusts this input. See `mermaid-system.md` for the security trade-off note.
* Mermaid expand button is injected in `mermaid-plugin.ts` widget decoration (top-left of `.mermaid-preview`, hidden on `.mermaid-error` or while editing); click reads `svgEl.outerHTML` from `.mermaid-svg-host` and calls `openMermaidLightbox`
