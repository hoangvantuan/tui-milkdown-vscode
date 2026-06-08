# Thiết kế: nút "Open in a new tab" khi hover ảnh

- **Issue:** #62 — Add "Open in a new tab" Button on Image Hover
- **Ngày:** 2026-06-08
- **Trạng thái:** Đã duyệt thiết kế, chờ viết plan

## Bối cảnh

Khi hover vào ảnh trong editor, overlay hiện 2 nút: sửa path (bút chì) và xem
fullscreen (expand). Người dùng issue #62 vẽ bằng Excalidraw, lưu ra file `.svg`,
muốn một nút để mở file đó trong tab riêng của VSCode. Họ đã cài plugin Excalidraw,
nên khi file mở bằng editor mặc định họ có thể edit và save trực tiếp.

Overlay hiện tại được tạo ở `createOverlay` trong
[image-edit-plugin.ts](../../../src/webview/image-edit-plugin.ts).

## Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Mở ảnh ở đâu | VSCode editor tab mới (`vscode.open`, tôn trọng editor mặc định nên Excalidraw plugin tự nhận `.svg`) |
| Nút hiện cho loại ảnh nào | Chỉ file local trong workspace. Ảnh base64 và URL http(s) không hiện nút |
| Hướng triển khai | Hướng A: message riêng `openImageInTab` + trích helper resolve dùng chung với `openLink` |

## Kiến trúc & luồng dữ liệu

```
Hover ảnh → mousemove detect (đã có) → showOverlay(img)
   └─ check img.src là local? → hiện/ẩn nút "open-in-tab"
Click nút → reverse-lookup originalPath từ currentImageMap
   └─ postMessage({ type: "openImageInTab", path })
Extension nhận → openLocalFileInEditor(path, document)
   └─ resolve theo docDir → security check workspace → vscode.open(uri)
        └─ VSCode mở bằng default editor (Excalidraw plugin tự nhận .svg)
```

## Thay đổi phía webview

File: [src/webview/image-edit-plugin.ts](../../../src/webview/image-edit-plugin.ts)

1. Thêm icon SVG mới `OPEN_TAB_ICON_SVG` (external-link: mũi tên thoát ô vuông,
   phân biệt rõ với expand icon 4 góc).
2. `createOverlay`: thêm nút thứ 3 `.image-open-tab-btn` vào cuối overlay. Thứ tự
   nút: sửa path → fullscreen → open-in-tab. Lưu reference nút ở module-level để
   toggle hiển thị.
3. Trích helper `isLocalImageSrc(src)` từ logic inline hiện có (kiểm tra
   `vscode-webview://` hoặc `vscode-resource.vscode-cdn.net`). Dùng lại cho cả
   `requestUrlEdit` (đang inline) và logic toggle nút mới.
4. `showOverlay(img)`: set `display` của nút open-in-tab theo `isLocalImageSrc(img.src)`.
   Chỉ ảnh local mới hiện nút.
5. Click handler nút: reverse-lookup `currentImageMap` để lấy `originalPath` (path
   tương đối gốc trong markdown). Có thì `postMessage({ type: "openImageInTab", path })`,
   không tìm thấy thì bỏ qua.

## Thay đổi phía extension

File: [src/markdownEditorProvider.ts](../../../src/markdownEditorProvider.ts)

1. Trích helper module-level `openLocalFileInEditor(relativePath, document)` từ
   nhánh `else` của case `openLink` (hiện ở khoảng dòng 765-788): tách file path
   khỏi anchor `#`, resolve theo `docDir`, security check trong workspace/document
   dir, `vscode.open`, `showWarningMessage` khi lỗi.
2. Refactor case `openLink` để gọi helper này (gỡ trùng lặp).
3. Thêm case `openImageInTab`: validate `path` không rỗng, gọi `openLocalFileInEditor(path, document)`.

## CSS

Nút mới tái dùng style sẵn có của overlay. Khi implement kiểm tra selector CSS:

- Nếu CSS đang style chung mọi `button` trong `.image-edit-overlay` thì không cần thêm.
- Nếu target từng class riêng thì thêm rule cho `.image-open-tab-btn` đồng bộ với
  `.image-edit-btn` / `.image-expand-btn`.

## Edge cases & xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Ảnh base64 / URL http(s) | Nút không hiện (chỉ local) |
| File đã bị xóa trên đĩa | `vscode.open` fail → `showWarningMessage` "Cannot open file" |
| Path traversal (`../../`) | Security check chặn, cảnh báo "Cannot open file outside workspace" |
| Ảnh local không có trong imageMap | Click không làm gì (hiếm gặp) |

## Testing & verify

- `npm run build:dev` và `npm run lint` (tsc --noEmit) phải sạch.
- Verify thủ công:
  - Ảnh local `.png` → mở trong editor VSCode.
  - Ảnh `.svg` → mở bằng Excalidraw (nếu cài plugin), nếu không thì editor mặc định.
  - Ảnh base64 và URL http(s) → nút không hiện.
  - File đã xóa khỏi đĩa → hiện cảnh báo.

## Cập nhật tài liệu

- `CHANGELOG.md`: thêm mục feature mới.
- `README.md`: mô tả ngắn gọn nút mới.
- `docs/internals/image-system.md`: bổ sung luồng và message `openImageInTab`.

## Lưu ý quy trình

Theo CLAUDE.md (GitNexus), trước khi sửa `openLink`, `createOverlay`, `showOverlay`
phải chạy `gitnexus_impact` để báo blast radius. Chạy `gitnexus_detect_changes`
trước khi commit.
