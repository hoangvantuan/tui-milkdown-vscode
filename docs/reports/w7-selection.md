# Báo cáo hoàn thành nhiệm vụ Wave 7 (W2): Bubble Menu và Inline Link Editor (#116, #117)

## 1. Tóm tắt công việc

Nhiệm vụ Wave 7 Worker 2 (W2) trên nhánh `hoangvantuan/w7-selection` tập trung vào hai tính năng tương tác trực tiếp khi chọn văn bản và chỉnh sửa liên kết:

1. **Issue #116: Selection Bubble Menu**:
   - Tích hợp `@tiptap/extension-bubble-menu@3.30.1` cùng `@floating-ui/dom`.
   - Xây dựng thanh bubble menu hiển thị nổi khi người dùng bôi đen văn bản hoặc chọn node ảnh, cung cấp 5 nút định dạng nhanh: Bold, Italic, Code, Link, Highlight.
   - Cực kỳ quan trọng: DOM của bubble menu được gắn vào `#editor-container` thay vì gắn bên trong `.tiptap`. Điều này đảm bảo tọa độ hiển thị của Floating UI không bị biến dạng bởi CSS zoom trên `.tiptap` (tuân thủ quy chuẩn kiến trúc của repository).
   - Thiết kế giao diện kế thừa biến CSS theme VS Code (`--vscode-editorWidget-*`, `--vscode-toolbar-*`, `--vscode-foreground`), đồng bộ trạng thái active với con trỏ soạn thảo.

2. **Issue #117: Inline Link Editor Popover**:
   - Loại bỏ hoàn toàn cơ chế nhập liên kết cũ qua Extension Host (`vscode.window.showInputBox`).
   - Xóa bỏ triệt để hai kiểu thông điệp IPC: `requestLinkEdit` và `linkEditResponse` khỏi `src/shared/messages.ts`, `src/host/messageHandlers.ts`, và `src/webview/main.ts`.
   - Tạo popover chỉnh sửa liên kết nội tuyến (`#link-popover`) gắn tại `#editor-container`, hỗ trợ nhập URL, phím Enter để lưu, phím Escape hoặc nút đóng để hủy.
   - Đấu nối cả nút Link trên thanh toolbar và nút Link trên bubble menu để mở popover này.
   - Bổ sung kiểm tra trạng thái active của nút Link trong thanh toolbar (`cmd === 'link' ? ed.isActive('link') :`) tại `updateToolbarActiveState`.
   - Cung cấp hàm thuần `applyLinkEdit(editor, newHref)` trong `src/webview/link-popover.ts` xử lý chuẩn xác: URL thông thường, đường dẫn chứa khoảng trắng được bọc trong `<...>`, đường dẫn tương đối, xóa liên kết khi URL rỗng, và cập nhật mark liên kết trên node ảnh (kể cả ảnh có liên kết).
   - Xử lý cấu hình `MarkdownImage` với `inline: true` trong `src/webview/main.ts` và `harness/editor.ts` để ảnh phù hợp với mô hình CommonMark và cho phép cập nhật node mark mà không vi phạm ràng buộc cấu trúc của node paragraph trong ProseMirror.

3. **Kiểm thử và Seam độ bền**:
   - Viết mới toàn diện seam kiểm thử `harness/link-edit-seam.ts` với đầy đủ các trường hợp theo yêu cầu của đặc tả.
   - Cập nhật golden baseline `harness/golden/seams/link-edit.txt`.
   - Thực hiện bài kiểm thử có răng (teeth test) bằng cách cố tình làm sai đường dẫn liên kết: harness phát hiện lỗi ngay lập tức (1 failed / 51 tests).
   - Chạy kiểm tra vòng 2 với golden restore thành công tuyệt đối (51/51 tests pass).
   - Chạy `npm run verify:vscode-floor` đạt 20/20 checks passed trên VS Code floor 1.85.0.

---

## 2. Chi tiết nghiệm thu từng Issue

### 2.1. Issue #116: Selection Bubble Menu

- **Tiêu chuẩn thư viện**: Đã thêm `@tiptap/extension-bubble-menu@3.30.1` vào `dependencies` trong `package.json` và `package-lock.json`.
- **Thành phần điều khiển**: Tạo `src/webview/bubble-menu.ts` sử dụng `BubbleMenuPlugin` từ `@tiptap/extension-bubble-menu`.
- **Phòng ngừa CSS Zoom**: Phần tử DOM của menu (`#bubble-menu`) được append trực tiếp vào `#editor-container`, tránh hoàn toàn lỗi lệch tọa độ khi phóng to thu nhỏ bằng CSS zoom.
- **5 nút hành động**:
  - `bold`: Gọi `editor.chain().focus().toggleBold().run()`, active khi `editor.isActive('bold')`.
  - `italic`: Gọi `editor.chain().focus().toggleItalic().run()`, active khi `editor.isActive('italic')`.
  - `code`: Gọi `editor.chain().focus().toggleCode().run()`, active khi `editor.isActive('code')`.
  - `link`: Gọi `onOpenLink()` để mở inline link editor popover, active khi `editor.isActive('link')`.
  - `highlight`: Gọi `editor.chain().focus().toggleHighlight().run()`, active khi `editor.isActive('highlight')`.
- **CSS Styling**: Được định nghĩa đồng bộ trong `src/webview/editor.css` với các biến hệ thống:
  ```css
  .bubble-menu {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 3px;
    z-index: 40;
  }
  ```

### 2.2. Issue #117: Inline Link Editor Popover

- **Loại bỏ IPC cũ**:
  - Đã xóa `RequestLinkEditMessage` và `LinkEditResponseMessage` khỏi `src/shared/messages.ts`.
  - Đã xóa `requestLinkEdit` handler khỏi bảng `messageHandlers` trong `src/host/messageHandlers.ts`.
  - Đã xóa `pendingLinkEdits` và `handleLinkEditResponse` khỏi `src/webview/main.ts`.

- **Chứng minh `tsc` kiểm soát chặt chẽ (Acceptance Test #3)**:
  Khi thử xóa định nghĩa type trong `src/shared/messages.ts` nhưng để lại handler trong `src/host/messageHandlers.ts` và lệnh gửi tin nhắn trong `src/webview/main.ts`, trình biên dịch TypeScript báo lỗi ngay lập tức:
  ```text
  src/host/messageHandlers.ts:316:3 - error TS2353: Object literal may only specify known properties, and 'requestLinkEdit' does not exist in type 'HandlerTable'.
  src/webview/main.ts:1483:7 - error TS2322: Type '"requestLinkEdit"' is not assignable to type 'WebviewToHostMessage["type"]'.
  ```
  Điều này chứng minh bảng handler IPC có tính toàn vẹn tĩnh ở mức kiểu dữ liệu.

- **Popover UI (`src/webview/link-popover.ts`)**:
  - Gắn vào `#editor-container`.
  - Tự động điền URL hiện tại của text/node được chọn.
  - Phím Enter xác nhận cập nhật URL, phím Escape đóng popover và trả focus về editor.
  - Vị trí popover tự động tính toán dựa trên bounding client rect của selection và vị trí của `#editor-container`.

- **Toolbar Link Button Active State**:
  Trong `updateToolbarActiveState` tại `src/webview/main.ts`:
  ```typescript
  cmd === 'link' ? ed.isActive('link') :
  ```
  Nút Link trên toolbar sẽ sáng lên khi con trỏ hoặc vùng chọn đang nằm trong một liên kết.

- **Hàm xử lý `applyLinkEdit`**:
  Hàm thuần túy `applyLinkEdit(editor, rawHref)` trong `src/webview/link-popover.ts`:
  - Chuẩn hóa: loại bỏ khoảng trắng thừa, tự động mở bọc nếu người dùng dán `<url>`.
  - URL rỗng: gọi `unsetLink()` để hủy liên kết (unlink).
  - Node ảnh có liên kết: cập nhật hoặc thêm mark `link` vào node ảnh.
  - Text có liên kết: mở rộng phạm vi mark và áp dụng URL mới.
  - Vùng chọn rỗng ngoài link: chèn text link với nội dung là chính URL đó.

---

## 3. Đo lường Kích thước Bundle (Bundle Size Delta)

| Bundle | Trước Wave 7 | Sau Wave 7 | Chênh lệch (Delta) |
| :--- | :--- | :--- | :--- |
| `out/extension.js` | 89,766 bytes | 90,673 bytes | +907 bytes |
| `out/webview/main.js` | 947,491 bytes | 966,478 bytes | +18,987 bytes |

**Giải trình chênh lệch kích thước**:
Mức tăng khoảng 19 KB ở `out/webview/main.js` là hoàn toàn hợp lý và giải trình được:
- Bao gồm toàn bộ gói `@tiptap/extension-bubble-menu@3.30.1` và thư viện định vị `@floating-ui/dom`.
- Các hàm khởi tạo UI, bộ quản lý sự kiện và icon SVG của Bubble Menu và Link Popover.
- Không có bất kỳ phụ thuộc thừa nào được đưa vào bundle.

---

## 4. Kết quả Kiểm thử và Bằng chứng

### 4.1. Unit tests (`npm test`)

Toàn bộ 35 unit test của extension host vượt qua xuất sắc:
```text
✔ frontmatter-parser (4.876458ms)
✔ image-rename-handler (22.481791ms)
ℹ tests 35
ℹ suites 12
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### 4.2. Roundtrip Harness và Seam `link-edit`

Seam `harness/link-edit-seam.ts` bao phủ 7 ca kiểm thử toàn diện:
1. `plain-url`: `[website](https://old.com)` chuyển thành `[website](https://example.com)`.
2. `path-containing-spaces`: `[manual](https://old.com)` chuyển thành `[manual](<docs/getting started guide.md>)` (bọc trong `<...>`).
3. `relative-path`: `[notes](./old.md)` chuyển thành `[notes](../subfolder/notes.md)`.
4. `empty-href`: `[unlink me](https://old.com)` chuyển thành `unlink me` (hủy bỏ liên kết).
5. `linked-image`: `[![banner](images/banner.png)](https://old-dest.com)` chuyển thành `[![banner](images/banner.png)](https://new-dest.com)`.
6. `linked-image-spaces`: `Here is [![logo](images/logo.png)](https://old-dest.com) above.` chuyển thành `Here is [![logo](images/logo.png)](<assets/my new logo.png>) above.`.
7. `linked-image-empty-href`: `Here is [![icon](images/icon.png)](https://old-dest.com) above.` chuyển thành `Here is ![icon](images/icon.png) above.` (hủy liên kết trên ảnh).

Tất cả 7 ca kiểm thử đều đạt:
- `matches: yes`
- `survives a reload unchanged: yes`
- `reload is a fixpoint: yes`

Kết quả chạy `npm run roundtrip`:
```text
39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
```

### 4.3. Bằng chứng kiểm thử có răng (Teeth Test)

Khi cố tình chèn `-broken` vào URL trong `applyLinkEdit`:
```text
FAIL     seams/link-edit.txt (+0 -0 lines)
  --- golden/seams/link-edit.txt
  +++ current/seams/link-edit.txt
  @@ -4,24 +4,24 @@
   [plain-url] target=text newHref="https://example.com"
   note: standard web URL
     expected: "Here is a [website](https://example.com) to visit."
  -  actual:   "Here is a [website](https://example.com) to visit."
  -  matches:  yes
  +  actual:   "Here is a [website](https://example.com-broken) to visit."
  +  matches:  NO

39 markdown fixtures + 12 seams: 50 passed, 1 failed, 0 missing, 0 errored
```
Harness ngay lập tức chuyển trạng thái sang FAIL. Sau khi khôi phục mã nguồn, harness trở lại 51/51 PASSED.

### 4.4. Kiểm tra vòng 2 (Golden Restore Check)

Thực hiện lệnh:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Kết quả:
```text
39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
 M harness/editor.ts
 M harness/golden/seams/link-edit.txt
 M harness/link-edit-seam.ts
```
Toàn bộ corpus và seams hoàn toàn ổn định qua hai vòng kiểm tra.

### 4.5. VS Code Floor Check (`npm run verify:vscode-floor`)

Kiểm tra trực tiếp trên phiên bản VS Code sàn 1.85.0:
```text
VS Code floor check: target version 1.85.0

PASS  floor VS Code build launched
PASS  vscode version: 1.85.0
PASS  extension resolves
PASS  extension activates: isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  custom editor opens the document: sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified: isDirty=false
PASS  custom editor still open after the hold: held 25000ms
PASS  document still unmodified after the hold: isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean
PASS  a typed character reaches the document: isDirty=true sentinelInText=true version 1 to 2
PASS  the edit does not bounce between host and webview: version 2 then 2 after 3s idle
PASS  view source opens the raw markdown in a text editor: 1 visible text editor(s)
PASS  webview mounts the editor
PASS  document content rendered in the webview
PASS  lazy mermaid artifact loads and renders
PASS  toolbar and metadata panel present
PASS  webview interactions could be driven
PASS  no CSP violation in the console

20 checks: 20 passed, 0 failed
```

---

## 5. Danh sách tệp thay đổi

- `package.json`: Thêm phụ thuộc `@tiptap/extension-bubble-menu`.
- `package-lock.json`: Cập nhật dependency tree.
- `src/shared/messages.ts`: Xóa các kiểu thông điệp IPC link edit cũ.
- `src/host/messageHandlers.ts`: Xóa handler của thông điệp link edit cũ.
- `src/markdownEditorProvider.ts`: Thêm container DOM của `#link-popover`.
- `src/webview/editor.css`: Thêm kiểu dáng cho `.bubble-menu` và `.link-popover`.
- `src/webview/bubble-menu.ts`: Triển khai Bubble Menu extension.
- `src/webview/link-popover.ts`: Triển khai inline link popover controller và hàm `applyLinkEdit`.
- `src/webview/main.ts`: Đấu nối bubble menu, link popover, xóa link edit IPC cũ, cập nhật active state nút Link trên toolbar, cấu hình `MarkdownImage` `inline: true`.
- `harness/editor.ts`: Cập nhật cấu hình `MarkdownImage` `inline: true` để phản chiếu chính xác `main.ts`.
- `harness/link-edit-seam.ts`: Cập nhật 7 ca kiểm thử cho seam link edit.
- `harness/golden/seams/link-edit.txt`: Cập nhật golden baseline cho seam link edit.
- `docs/reports/w7-selection.md`: Báo cáo hoàn thành nhiệm vụ W2.
