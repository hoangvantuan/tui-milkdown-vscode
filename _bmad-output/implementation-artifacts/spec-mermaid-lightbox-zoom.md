---
title: 'Mermaid diagram fullscreen lightbox với zoom và pan'
type: 'feature'
created: '2026-04-13'
status: 'done'
baseline_commit: '86dd60315a2e1d8138786ab9f1a1163ac415733c'
context:
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi sơ đồ Mermaid lớn, preview bị giới hạn trong chiều rộng của editor và không thể zoom — user phải scroll ngang hoặc sửa code để xem chi tiết. Không có cách nào phóng to để đọc nhãn/nhánh nhỏ.

**Approach:** Thêm nút "expand" trên mỗi mermaid preview. Click sẽ mở SVG trong fullscreen lightbox (tái dùng hạ tầng `image-lightbox-plugin`). Lightbox hỗ trợ zoom (buttons + wheel + phím +/−/0) và pan bằng chuột khi đã zoom, Esc để đóng.

## Boundaries & Constraints

**Always:**
- Tái dùng `#lightbox-overlay` hiện có thay vì tạo overlay riêng. Generalize state zoom/pan của `image-lightbox-plugin.ts` để áp dụng cho cả `<img>` lẫn SVG wrapper.
- Giữ nguyên chữ ký và hành vi public `openLightbox(src, alt)` — image lightbox hiện tại không được regression.
- Nút expand chỉ hiện khi mermaid đã render thành công (không có class `mermaid-error`) và không ở chế độ editing (`.mermaid-editing + .mermaid-preview`).
- Pan chỉ kích hoạt khi `scale > 1` (giống image-lightbox).
- Zoom range: `MIN_SCALE = 0.5`, `MAX_SCALE = 4`, `SCALE_STEP = 0.25` (đồng bộ image-lightbox).
- Lightbox SVG dùng `innerHTML = svgMarkup` từ `.mermaid-preview` đã render — mermaid đã `securityLevel: "strict"` nên nội dung đã sanitize. KHÔNG chấp nhận markup từ nguồn khác.
- Tôn trọng `prefers-reduced-motion`: transition transform phải tắt khi user bật reduce motion (đã có cơ chế chung).
- Widget decoration mermaid phải tái tạo nút expand mỗi lần rebuild (widget render function).
- KHÔNG thay đổi markdown parse/serialize, không thay đổi schema node.

**Ask First:**
- Nếu impact analysis cho hàm đã sửa trả về HIGH/CRITICAL risk, HALT và báo user.
- Nếu cần thêm dependency mới — HALT.

**Never:**
- Không destroy/recreate Tiptap editor khi mở/đóng lightbox.
- Không dùng `innerHTML` với dữ liệu không phải SVG đã render từ mermaid.
- Không đặt nút expand đè lên vị trí hint "Double-click to edit" (top-right) — dùng top-left.
- Không thêm thư viện zoom/pan bên ngoài (vd svg-pan-zoom, panzoom).
- Không tạo file overlay/HTML mới — mở rộng overlay hiện có trong `markdownEditorProvider.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Click expand trên preview đã render | `.mermaid-preview` chứa `<svg>`, không error | Lightbox mở, SVG hiển thị căn giữa, zoom 100% | N/A |
| Click button zoom-in tới MAX_SCALE | scale = 4 | Không vượt 400%, translate reset nếu cần | N/A |
| Cuộn chuột trong lightbox | wheel deltaY | Zoom in/out theo `SCALE_STEP`, preventDefault | N/A |
| Phím + / − / 0 / Esc khi lightbox active | keydown | +/−: zoom step; 0: reset scale=1, translate=0; Esc: đóng | N/A |
| Drag chuột khi scale > 1 | mousedown → mousemove → mouseup | Translate SVG theo delta chuột | N/A |
| Drag chuột khi scale ≤ 1 | mousedown | Bỏ qua — không pan | N/A |
| Mở lightbox khi preview đang render / error | click nút expand | Nút không hiển thị (CSS ẩn) hoặc no-op nếu không có SVG | Không log lỗi |
| Mở ảnh lightbox sau khi đã mở mermaid lightbox | `openLightbox(src, alt)` | Image hiển thị đúng, state zoom reset | N/A |
| Rebuild decoration khi sửa code mermaid | doc changed | Widget mới tạo lại, nút expand gắn lại, không leak listener | N/A |
| Đổi theme dark ↔ light khi lightbox đang mở | theme change | Lightbox vẫn hoạt động; overlay dark backdrop không đổi | N/A |

</frozen-after-approval>

## Code Map

- `src/webview/image-lightbox-plugin.ts` -- Generalize state (`target` element thay vì fix cứng `image`), thêm `openMermaidLightbox(svgMarkup, caption)`; giữ `openLightbox(src, alt)` backwards compat.
- `src/webview/mermaid-plugin.ts` -- Thêm nút expand vào widget decoration (`buildDecorations` widget factory); gắn click handler lấy SVG innerHTML và gọi `openMermaidLightbox`.
- `src/markdownEditorProvider.ts` -- HTML template: thêm slot `<div id="lightbox-svg">` bên trong `.lightbox-content`. CSS: `.mermaid-expand-btn` (floating, top-left preview, hover fade-in giống image expand), `.lightbox-svg-wrapper` (max-width/height, cursor grab/grabbing, transform origin center, reduce-motion guard).
- `CHANGELOG.md` -- Ghi Added entry.
- `README.md` -- Thêm 1 dòng vào feature list (Mermaid fullscreen).
- `CLAUDE.md` -- Cập nhật mục "Image Lightbox" → "Lightbox (Image & Mermaid)" với ghi chú về SVG target.

## Tasks & Acceptance

**Execution:**
- [x] `src/webview/image-lightbox-plugin.ts` -- Refactor state: đổi biến module `image: HTMLImageElement` thành `target: HTMLElement`; `getElements()` trả cả `image`, `svgWrapper`; `applyTransform()` set transform cho `currentTarget`; `closeLightbox()` reset cả hai; thêm export `openMermaidLightbox(svgMarkup: string, caption: string)` (set `svgWrapper.innerHTML = svgMarkup`, ẩn `image`, hiện `svgWrapper`, reset state); `openLightbox` ẩn `svgWrapper`, hiện `image`; mousedown/mousemove gắn trên cả 2 target (hoặc trên `.lightbox-content` để dùng chung).
- [x] `src/webview/mermaid-plugin.ts` -- Trong widget factory của `buildDecorations`, thêm `<button class="mermaid-expand-btn">` (inline SVG expand icon giống `EXPAND_ICON_SVG` trong image-edit-plugin). Click handler: `e.stopPropagation(); const svgEl = previewEl.querySelector('svg'); if (svgEl) openMermaidLightbox(svgEl.outerHTML, '');`. Không kích hoạt double-click edit khi click nút.
- [x] `src/markdownEditorProvider.ts` -- HTML: thêm `<div id="lightbox-svg" class="lightbox-svg-wrapper hidden"></div>` trong `.lightbox-content` sau `<img>`. CSS: `.lightbox-svg-wrapper` (max-width 90vw, max-height 80vh, display flex center, transition transform 0.15s, user-select none, cursor grab; `.grabbing` khi drag; `svg` con `max-width: 100%; height: auto`). `.mermaid-expand-btn` (position absolute top 8px left 8px, size 28px, bg/color dùng biến theme, opacity 0 → `.mermaid-preview:hover .mermaid-expand-btn { opacity: 0.8 }`, z-index trên SVG). `@media (prefers-reduced-motion: reduce)` tắt transition transform. Ẩn nút khi `.mermaid-preview.mermaid-error` hoặc `.mermaid-code-block.mermaid-editing + .mermaid-preview`.
- [x] `CHANGELOG.md` -- Thêm entry "Added: Mermaid diagram fullscreen lightbox with zoom and pan".
- [x] `README.md` -- Thêm dòng "Mermaid diagram fullscreen viewer — click expand on any mermaid preview to view with zoom + pan".
- [x] `CLAUDE.md` -- Cập nhật mục "Image Lightbox" thành "Lightbox (Image & Mermaid)" với mô tả `openMermaidLightbox` + shared zoom/pan state.

**Acceptance Criteria:**
- Given một file markdown có mermaid block đã render, when hover lên preview, then nút expand hiện ở góc trên trái với fade-in (không đè hint top-right).
- Given lightbox đang mở với mermaid SVG, when nhấn `+`/`-`/`0`, then scale lần lượt tăng/giảm theo `SCALE_STEP` và reset về 100%.
- Given lightbox đang mở với `scale > 1`, when mousedown + drag, then SVG dịch chuyển theo con trỏ; khi `scale = 1`, drag không có hiệu ứng.
- Given lightbox đang mở, when nhấn Esc hoặc click backdrop, then lightbox đóng, state zoom/pan reset về mặc định.
- Given mermaid preview đang ở trạng thái `mermaid-error` hoặc `mermaid-editing`, when hover, then nút expand không hiển thị.
- Given ảnh thường, when mở image lightbox như cũ, then hành vi image lightbox không regression (zoom, pan, caption đều hoạt động).
- Given double-click trên preview (không phải trên nút expand), when xảy ra, then vẫn vào chế độ edit mermaid như cũ (click stopPropagation trên nút expand).
- Given `npm run lint`, when chạy, then `tsc --noEmit` pass không lỗi.

## Design Notes

**Pattern tái dùng:** Image lightbox hiện đã có đủ state (scale, translateX/Y, isDragging, drag handlers, wheel, keyboard). Cách đơn giản nhất là generalize "target element": dùng chung logic, chỉ hoán đổi giữa `<img>` và `<div>` chứa SVG.

Ví dụ skeleton (5-10 dòng) cho `openMermaidLightbox`:

```ts
export function openMermaidLightbox(svgMarkup: string, caption: string): void {
  const { overlay, image, svgWrapper, caption: cap } = getElements();
  if (!overlay || !svgWrapper) return;
  scale = 1; translateX = 0; translateY = 0;
  svgWrapper.innerHTML = svgMarkup;
  svgWrapper.classList.remove('hidden');
  image?.classList.add('hidden');
  currentTarget = svgWrapper;
  overlay.classList.add('active');
  applyTransform();
}
```

`applyTransform` đọc `currentTarget` thay vì `image`. `mousedown` listener gắn trên `.lightbox-content` (container chung) để bắt cả hai target.

**Nút expand vị trí top-left:** CSS hint "Double-click to edit" đã chiếm top-right, nên nút expand dùng top-left. Width 28px, z-index 2 (trên SVG, dưới lightbox z-index 1000).

## Verification

**Commands:**
- `npm run lint` -- expected: không lỗi TypeScript
- `npm run build:dev` -- expected: build thành công, tạo `out/webview/main.js` + `out/extension.js`

**Manual checks:**
- Mở file markdown có mermaid block lớn (ví dụ flowchart nhiều node) trong VSCode Extension Host.
- Hover preview → nút expand hiện top-left; click → lightbox mở hiển thị SVG ở giữa.
- Thử zoom buttons, wheel, phím +/−/0/Esc.
- Khi scale > 100%, drag trong lightbox → SVG dịch chuyển.
- Đóng → mở lại: state reset (scale 100%, position center).
- Test image lightbox (hover ảnh → expand) để đảm bảo không regression.
- Test double-click preview mermaid → vẫn vào edit mode như cũ.
- Bật theme dark → kiểm tra lightbox + nút expand vẫn hiển thị rõ.
