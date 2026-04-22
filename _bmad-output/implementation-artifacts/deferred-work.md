# Deferred Work

Findings surfaced incidentally by review but not caused by the triggering story. Pick up later.

## Mermaid copy as PNG — nice-to-have cải thiện

1. **Screen reader feedback cho trạng thái "copied"** — `.mermaid-copy-btn` và `#lightbox-copy` chỉ đổi icon visual khi copy thành công. Nên thêm `aria-live="polite"` region hoặc đổi `aria-label` tạm thành "Copied" trong 1.5s để screen reader thông báo. Surfaced by blind-hunter review spec-mermaid-copy-image.
2. **Refactor duplicate copy flow** — mermaid-plugin.ts và image-lightbox-plugin.ts cùng implement pattern `svgToPngBlob → copyPngBlobToClipboard → flashCopied → reportCopyError`. Có thể gom thành helper `copySvgAsPng(button, getSvgMarkup)` trong svg-to-png.ts. Surfaced by blind-hunter review spec-mermaid-copy-image.

## Deferred from: code review (2026-04-22) — Fix mermaid layout + Export DOCX/PDF

1. **Windows font path thiếu trong PDF export** — `findSystemFont` trong `src/utils/export-pdf.ts` không có `C:\Windows\Fonts`. Trên Windows, user chọn font custom nhưng PDF vẫn fallback Roboto silent. Defer cho đến khi có user Windows báo lỗi.
2. **Variable font không có Italic variant** — `italicVarFont` null dẫn đến `italicPath = varPath`, italic hiển thị như normal. Case hiếm (user có variable font không có italic), defer.
3. **PDF inline image bị bỏ** — `imgMatch` trong `markdownToPdfContent` chỉ match image standalone đầu dòng (`^!\[`). Inline image giữa paragraph bị bỏ qua. Sẽ tự fix khi migrate parser sang AST (xem action `Migrate PDF parser to remark-parse`).
4. **Nested list mất trong PDF** — Parser hiện tại không track indent depth. List lồng thành list phẳng. Tự fix khi migrate AST.
5. **Table cell escape `\|` và `<br>` multiline sai** — `parseRow` split raw theo `|`. Cell có `\|` bị split sai, cell có `<br>` in literal. Tự fix khi migrate AST.
6. **Heading `#######` (7 dấu `#`) parse sai** — Regex `#{1,6}` match 6 đầu, còn lại vào text. Hiếm.
7. **Code block không đóng nuốt phần còn lại** — `while (!lines[i].startsWith("\`\`\`"))` chạy đến EOF. Hiếm, nhưng nên clamp.
8. **`parseInline` không hỗ trợ escape `\*`, `\[`** — Text `\*not bold\*` thành italic sai. Tự fix khi migrate AST.
9. **Link URL chứa `)` bị cắt** — Regex `\(([^)]+)\)` dừng ở `)` đầu tiên. Case `[text](https://en.wikipedia.org/wiki/Foo_(disambiguation))` mất đuôi. Tự fix khi migrate AST.
10. **ELK layout áp cho non-flowchart diagram** — `mermaid.initialize({ layout: "elk" })` global, áp cho cả sequence/class/ER. ELK có thể fallback nội bộ nhưng không rollback `elkAvailable` khi render runtime fail.
11. **`copyFonts()` crash nếu node_modules chưa cài** — Build bị crash với error khó hiểu cho contributor mới. Thêm try/catch.
12. **Pipeline MDAST thống nhất cho DOCX + PDF** — Webview nên gửi MDAST + image map thay vì markdown text + regex replace. Giải quyết CRLF mismatch, duplicate mermaid, base64 regex O(N*M). Effort ~1 ngày, defer để tránh scope creep.
13. **Đánh giá migrate PDF sang puppeteer-core dùng VS Code Electron** — WYSIWYG thực sự với CSS theme, bỏ parser hoàn toàn. PoC riêng, defer dài hạn.
14. **Migrate `@m2d/md2docx@0.0.1` sang `mdast2docx@1.6.1` trực tiếp hoặc `docx@9.6.1`** — Phần wrapper của `@m2d/md2docx` chỉ ~12KB code và version 0.0.1 là alpha. Sau khi áp patch ghim version, đánh giá migrate.

## Mermaid plugin — pre-existing issues

1. **Stale lightbox snapshot on doc edit** — If user edits mermaid code while fullscreen lightbox is open, the lightbox keeps showing the snapshot captured at click time. Nice-to-have: close lightbox on `docChanged` when the underlying mermaid block changes, or re-render from the current block.
2. **Theme switch while lightbox open** — Same root cause as #1: SVG in lightbox is a static `outerHTML` snapshot. When user switches theme while lightbox is open, preview in editor re-renders but lightbox does not. Acceptable: Esc + reopen.
3. **`data-mermaid-src` not cleared on error** — `updateMermaidTheme` iterates `.mermaid-preview` and re-renders, but if an errored block's code is invalid, re-render fails silently. Root cause: per-preview render state not tracked. Not caused by this story.
4. **Debounce timer not cancelled on widget destroy** — `pendingTimers` in `MermaidDiagram` view is only cleared in plugin `destroy()`, not when individual widgets are recreated by decoration rebuild. Timers still fire into detached elements (harmless, but leaks handles). Pre-existing.
5. **Duplicate SVG element IDs across cached previews** — `renderCache` stores rendered SVG string keyed by code. When the same diagram appears twice in a doc, both previews have SVG nodes with identical auto-generated IDs (mermaid's internal refs). `document.getElementById` can return the wrong one. Adding the lightbox copy increases duplication. Fix: strip/rewrite IDs before writing host innerHTML.
