# Deferred Work

Findings surfaced incidentally by review but not caused by the triggering story. Pick up later.

## Mermaid copy as PNG — nice-to-have cải thiện

1. **Screen reader feedback cho trạng thái "copied"** — `.mermaid-copy-btn` và `#lightbox-copy` chỉ đổi icon visual khi copy thành công. Nên thêm `aria-live="polite"` region hoặc đổi `aria-label` tạm thành "Copied" trong 1.5s để screen reader thông báo. Surfaced by blind-hunter review spec-mermaid-copy-image.
2. **Refactor duplicate copy flow** — mermaid-plugin.ts và image-lightbox-plugin.ts cùng implement pattern `svgToPngBlob → copyPngBlobToClipboard → flashCopied → reportCopyError`. Có thể gom thành helper `copySvgAsPng(button, getSvgMarkup)` trong svg-to-png.ts. Surfaced by blind-hunter review spec-mermaid-copy-image.

## Deferred from: code review (2026-04-22) — Fix mermaid layout + Export DOCX/PDF

1. **Windows font path thiếu trong PDF export** — `findSystemFont` trong `src/utils/export-pdf.ts` không có `C:\Windows\Fonts`. Trên Windows, user chọn font custom nhưng PDF vẫn fallback Roboto silent. Defer cho đến khi có user Windows báo lỗi.
2. **Variable font không có Italic variant** — `italicVarFont` null dẫn đến `italicPath = varPath`, italic hiển thị như normal. Case hiếm (user có variable font không có italic), defer.
3. **ELK layout áp cho non-flowchart diagram** — `mermaid.initialize({ layout: "elk" })` global, áp cho cả sequence/class/ER. ELK có thể fallback nội bộ nhưng không rollback `elkAvailable` khi render runtime fail.
4. **`copyFonts()` crash nếu node_modules chưa cài** — Build bị crash với error khó hiểu cho contributor mới. Thêm try/catch.

### Resolved in PR #50

Items below were originally deferred but resolved by the export rewrite:

- ~~PDF inline image bị bỏ~~ — resolved: puppeteer-core renders HTML natively.
- ~~Nested list mất trong PDF~~ — resolved: remark-rehype handles nested lists.
- ~~Table cell escape `\|` và `<br>` multiline sai~~ — resolved: remark-gfm parses correctly.
- ~~Heading `#######` (7 dấu `#`) parse sai~~ — resolved: remark-parse handles.
- ~~Code block không đóng nuốt phần còn lại~~ — resolved: remark-parse handles.
- ~~`parseInline` không hỗ trợ escape `\*`, `\[`~~ — resolved: remark-parse handles.
- ~~Link URL chứa `)` bị cắt~~ — resolved: remark-parse handles.
- ~~Pipeline MDAST thống nhất cho DOCX + PDF~~ — resolved: `markdown-ast.ts` shared pipeline.
- ~~Đánh giá migrate PDF sang puppeteer-core~~ — resolved: Stage 4 complete.
- ~~Migrate `@m2d/md2docx@0.0.1` sang `mdast2docx@1.6.1`~~ — resolved: Stage 2 complete.

## Deferred from: code review of plan-export-rewrite-overview (2026-04-22, pass 2)

1. **Chromium process orphan nếu `launch` throw sau fork** — `src/utils/export-pdf.ts:581-604`. Nếu `puppeteer.launch` succeed tạo process Chrome nhưng throw trước khi return, `finally` không close vì `browser` chưa được gán. Puppeteer thường tự cleanup qua SIGCHLD, nhưng không guaranteed. Hyper-edge, defer cho đến khi có report zombie process thực tế.
2. **Document > 500KB có thể OOM Chromium khi render HTML** — `src/utils/export-pdf.ts:590-599`. `page.setContent` với HTML cực dài + nhiều inline base64 image có thể OOM. Đã có MAX_FILE_SIZE warning tại bước open (500KB, warning only không block). Fix đầy đủ cần: (a) streaming HTML, (b) chunk export theo trang. Defer tới khi có user bug report.
3. **`mermaidImages` postMessage không chunk, IPC size unlimited** — `src/webview/main.ts:1411-1431`. 50 mermaid × 2MB PNG base64 → payload 100MB qua `vscode.postMessage`. Có thể crash webview hoặc extension host. Fix: chunk hoặc stream via `vscode.workspace.fs.writeFile` tạm rồi đọc lại. Edge case hiếm, defer.
4. **Save dialog chọn file đang mở bởi Word/Acrobat (Windows `EBUSY`)** — `src/utils/export-docx.ts:415`, `src/utils/export-pdf.ts:600`. VS Code error `EBUSY` đã khá rõ nhưng không hint user đóng app đang lock file. Defer tới khi có feedback.

## Mermaid plugin — pre-existing issues

1. **Stale lightbox snapshot on doc edit** — If user edits mermaid code while fullscreen lightbox is open, the lightbox keeps showing the snapshot captured at click time. Nice-to-have: close lightbox on `docChanged` when the underlying mermaid block changes, or re-render from the current block.
2. **Theme switch while lightbox open** — Same root cause as #1: SVG in lightbox is a static `outerHTML` snapshot. When user switches theme while lightbox is open, preview in editor re-renders but lightbox does not. Acceptable: Esc + reopen.
3. **`data-mermaid-src` not cleared on error** — `updateMermaidTheme` iterates `.mermaid-preview` and re-renders, but if an errored block's code is invalid, re-render fails silently. Root cause: per-preview render state not tracked. Not caused by this story.
4. **Debounce timer not cancelled on widget destroy** — `pendingTimers` in `MermaidDiagram` view is only cleared in plugin `destroy()`, not when individual widgets are recreated by decoration rebuild. Timers still fire into detached elements (harmless, but leaks handles). Pre-existing.
5. **Duplicate SVG element IDs across cached previews** — `renderCache` stores rendered SVG string keyed by code. When the same diagram appears twice in a doc, both previews have SVG nodes with identical auto-generated IDs (mermaid's internal refs). `document.getElementById` can return the wrong one. Adding the lightbox copy increases duplication. Fix: strip/rewrite IDs before writing host innerHTML.
