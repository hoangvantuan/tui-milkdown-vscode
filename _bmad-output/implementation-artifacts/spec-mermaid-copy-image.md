---
title: 'Copy sơ đồ Mermaid ra clipboard dưới dạng PNG'
type: 'feature'
created: '2026-04-22'
status: 'done'
baseline_commit: 'f1d461bcc727b61704854223385cf53e4753302b'
context:
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Không có cách copy sơ đồ Mermaid ra clipboard để dán vào Slack/Word/Figma. User phải screenshot thủ công, mất nét trên retina.

**Approach:** Thêm nút "copy" ở 2 chỗ: góc trên mermaid preview (cạnh nút expand) và trong lightbox toolbar. Click render SVG sang PNG 2x native qua canvas, ghi clipboard bằng `navigator.clipboard.write` + `ClipboardItem("image/png")`. Feedback: icon đổi checkmark 1.5s.

## Boundaries & Constraints

**Always:**
- PNG scale cố định 2x SVG native.
- Snapshot SVG hiện có trong DOM, không re-render từ code.
- Ẩn nút copy khi preview `.mermaid-error` hoặc `.mermaid-editing`.
- Trong lightbox, nút copy chỉ hiển thị khi target là mermaid (ẩn khi `<img>`).
- CSP-safe: canvas + `URL.createObjectURL` blob SVG. Không `eval`, không inject script.

**Ask First:**
- Nếu `navigator.clipboard.write` / `ClipboardItem` không có trong webview runtime → HALT, xin chỉ đạo.

**Never:** Copy SVG text markup. UI chọn format. Đụng image lightbox. Dọn deferred issue ngoài scope.

## I/O & Edge-Case Matrix

| Scenario | Trạng thái | Kết quả | Xử lý lỗi |
|----------|-----------|---------|-----------|
| Copy từ preview | SVG render OK trong `.mermaid-svg-host` | PNG 2x vào clipboard, icon ✓ 1.5s | N/A |
| Copy từ lightbox | Mode mermaid | Giống preview, icon ✓ trên nút lightbox | N/A |
| Mermaid lỗi/đang edit | class `.mermaid-error` hoặc `.mermaid-editing` | Nút copy ẩn | N/A |
| Lightbox image mode | `currentTarget` là `<img>` | Nút copy ẩn | N/A |
| Clipboard reject | Promise fail | Icon khôi phục ngay, gửi `showWarning` tới extension | Không throw |
| SVG 0px / chưa render | width/height = 0 | Bỏ qua, `showWarning` | Không tạo blob |

</frozen-after-approval>

## Code Map

- `src/webview/svg-to-png.ts` -- MỚI: `svgToPngBlob(svg, scale)` + `copyPngBlobToClipboard(blob)`; canvas + Image + Blob URL.
- `src/webview/mermaid-plugin.ts` -- Widget (~line 336-356): append `.mermaid-copy-btn` sau `.mermaid-svg-host`.
- `src/webview/image-lightbox-plugin.ts` -- Thêm `#lightbox-copy` trong `.lightbox-controls`, toggle visibility theo `currentTarget`.
- `src/markdownEditorProvider.ts` -- HTML `<button id="lightbox-copy">` trong `.lightbox-controls`. CSS `.mermaid-copy-btn` (clone expand-btn, `left: 44px`), icon + state `.is-copied`.
- `CHANGELOG.md`, `README.md`, `CLAUDE.md` -- Cập nhật sau khi implement.

## Tasks & Acceptance

**Execution:**
- [x] `src/webview/svg-to-png.ts` -- 2 export: `svgToPngBlob(svgString, scale): Promise<Blob>` đọc viewBox/width/height, vẽ canvas scale×native rồi `toBlob('image/png')`; `copyPngBlobToClipboard(blob): Promise<void>` dùng `ClipboardItem`. Thêm `reportCopyError()` dispatch CustomEvent để forward lên extension.
- [x] `src/webview/mermaid-plugin.ts` -- Append `.mermaid-copy-btn` trong widget decoration. Click: query `svg` trong host → helper → swap icon 1.5s. Lỗi → `reportCopyError`.
- [x] `src/webview/image-lightbox-plugin.ts` -- Ref `#lightbox-copy` trong `initLightbox`; helper `setCopyButtonVisibility` toggle trong `openLightbox` (hide), `openMermaidLightbox` (show), `closeLightbox` (hide). Click: lấy SVG từ `svgWrapper` → helper → swap icon. Lỗi → `reportCopyError`.
- [x] `src/markdownEditorProvider.ts` -- Thêm HTML `<button id="lightbox-copy" class="lightbox-btn lightbox-copy-btn hidden" title="Copy as PNG">` trước nút close. CSS `.mermaid-copy-btn` + `#lightbox-copy` + icon copy/check stroke Lucide + state `.is-copied`.
- [x] `src/webview/main.ts` -- Listener `mermaid-copy-error` → forward `vscode.postMessage({ type: 'showWarning', message })`.
- [x] `package.json` -- Bump `2.8.3` → `2.8.4`.

**Acceptance Criteria:**
- Given mermaid render OK, when click copy trên preview, then clipboard có PNG paste được vào app khác và icon ✓ 1.5s.
- Given lightbox mở mermaid, when click copy toolbar, then clipboard có PNG giống preview, icon ✓ 1.5s.
- Given lightbox mở image thường, when nhìn toolbar, then nút copy ẩn.
- Given mermaid parse lỗi, when nhìn preview, then nút copy ẩn.
- Given clipboard API reject, when click copy, then icon khôi phục và VS Code hiện warning dialog.
- Given paste PNG vào viewer, when xem kích thước, then width = `2 × svgNativeWidth`.

## Spec Change Log

### 2026-04-22 — review loop 1 patches

- **Finding (Blind + Edge hunter)**: Stale timer/button reference khi widget bị rebuild mid-copy, promise hang nếu `canvas.toBlob` hoặc `<img>` load không settle, race khi user spam click copy, stale SVG snapshot khi lightbox copy chạm race với doc re-render.
- **Amendment**:
  - `svg-to-png.ts`: `LOAD_IMAGE_TIMEOUT_MS` / `TO_BLOB_TIMEOUT_MS` = 5s, bọc `loadImage` và `canvas.toBlob` trong timeout reject.
  - `mermaid-plugin.ts`: `copyBtn.disabled` gate, snapshot `svgEl.outerHTML` tại click-time, `button.isConnected` guard trong `flashCopiedState` + trước khi remove class.
  - `image-lightbox-plugin.ts`: đổi signature sang `HTMLButtonElement`, disable gate, snapshot `svgMarkup` tại click, `isConnected` guard cả khi add `.is-copied` lẫn khi remove qua timer.
- **Known-bad avoided**: copy hang vô thời hạn với SVG lớn hoặc có external reference; stale PNG khi user sửa doc trong lúc clipboard đang ghi; double promise gây `clipboard.write` chồng nhau.
- **KEEP**: pattern `CustomEvent('mermaid-copy-error')` → `vscode.postMessage({ showWarning })` trong `main.ts` (decouple plugin khỏi vscode handle); 2 `<svg>` icon toggle qua CSS class `.is-copied`.
- **Deferred**: aria-live cho screen reader feedback, refactor duplicate copy flow giữa 2 plugin. Ghi vào `deferred-work.md`.

### 2026-04-22 — hotfix: blob URL → data URL (bỏ CSP workaround)

- **Finding round 1 (user test)**: `Loading the image 'blob:vscode-webview://...' violates CSP directive: img-src 'self' https: data:`.
- **Finding round 2 (user test)**: Sau khi thêm `blob:` vào `img-src`, error đổi thành `Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported`.
- **Root cause**: `blob:` URL trong vscode-webview sandbox cross origin với document canvas → canvas tainted khi drawImage → `toBlob` bị chặn. Cộng với mermaid dùng `<foreignObject>` cho label HTML, Chromium sandbox chính sách nghiêm hơn.
- **Amendment**: `svg-to-png.ts` bỏ hẳn `Blob` + `URL.createObjectURL` + `revokeObjectURL`. Dùng `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}` → same-origin với document, không tainted canvas. `markdownEditorProvider.ts` rollback `blob:` khỏi `img-src` CSP (dọn orphan do round 1 thêm).
- **Known-bad avoided**: Canvas export fail im lặng với SVG mermaid có foreignObject; over-granting `blob:` trong CSP mà không dùng.
- **KEEP**: Pattern XMLSerializer + `<img>` rasterize + `canvas.toBlob` vẫn là cốt lõi — chỉ URL scheme thay đổi. Timeout guards vẫn giữ nguyên.

## Design Notes

**SVG → PNG (CSP-safe):** Blob SVG → `URL.createObjectURL` → `Image.onload` → `canvas.drawImage` với kích thước `native * scale` → `canvas.toBlob('image/png')`. Scale qua canvas (không qua CSS) để ảnh nét mọi dpi viewer.

**Clipboard:** `navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`.

**Icon swap:** 2 `<svg>` trong button, class `.is-copied` toggle visibility (pattern copy từ `code-block-plugin` đã có).

## Verification

**Commands:**
- `npm run lint` -- expected: TS pass.
- `npm run build:dev` -- expected: bundle OK.
- `npx gitnexus analyze` -- expected: index refresh sau thêm file mới.

**Manual checks:**
- Mở `.md` có block mermaid, hover preview → thấy 2 nút (copy + expand). Click copy → ✓ 1.5s. Paste Preview.app → ảnh nét, kích thước = 2× viewbox.
- Click expand → lightbox → thấy nút copy toolbar → click → paste → giống ảnh trên.
- Click ảnh thường (png/jpg) → lightbox → nút copy ẩn.
- Mermaid invalid → preview error → nút copy biến mất.
- Test theme light + dark + Catppuccin Mocha, icon đúng màu CSS var.
