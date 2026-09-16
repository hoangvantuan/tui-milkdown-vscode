# Báo Cáo Nghiệm Thu: Wave 4 Worker W1 (Typed Message Protocol & Error Handling)

Báo cáo nghiệm thu kỹ thuật cho Worker W1 thuộc Wave 4, giải quyết ba vấn đề:
- Issue #87: Strongly typed message protocol giữa VS Code extension host và webview.
- Issue #105: Xử lý lỗi đọc clipboard image, không nuốt lỗi ngầm, hiển thị cảnh báo hữu ích.
- Issue #104 (phần host): Áp dụng các in-flight edit gửi tới trong lúc `onDidDispose` nếu tài liệu vẫn mở.

---

## 1. Kết Quả Các Lệnh Kiểm Tra

- `npm run lint`: PASS (`tsc --noEmit` hoàn thành sạch sẽ, 0 lỗi, exit code 0).
- `npm run build`: PASS (esbuild đóng gói cả extension và webview bundle thành công, exit code 0).
- `npm run roundtrip`: PASS (37 markdown fixtures + 6 seams: 43 passed, 0 failed, 0 missing, 0 errored, exit code 0).
- `npm run verify:vscode-floor`: floor check do điều phối viên chạy (theo chỉ thị từ điều phối viên trong thông điệp `msg_f3f92a7b02b0`, do thư mục `/tmp/tuimd-floor` dùng chung gây xung đột giữa các worker chạy song song).

---

## 2. Kết Quả Kiểm Tra Ổn Định Vòng Hai (Idempotency)

- Quy trình kiểm tra:
  1. Ghi đè toàn bộ synthetic fixtures bằng golden baselines:
     `cp harness/golden/synthetic/*.md harness/fixtures/synthetic/`
  2. Chạy kiểm tra:
     `npm run roundtrip`
  3. Khôi phục lại trạng thái ban đầu:
     `git checkout -- harness/fixtures/synthetic/`
- Kết quả ghi nhận: 42 passed, 1 failed (đúng chính xác 1 fixture thất bại).
- Fixture thất bại duy nhất: `synthetic/list-continuation-underindented.md` (lỗi thụt lề continuation line của Tiptap upstream đã được ghi nhận trước đó trong `harness/README.md`).
- Kiểm tra diff fixtures: `git diff develop..HEAD --stat -- harness/fixtures/synthetic/` trả về rỗng (0 tệp thay đổi).

---

## 3. Kích Thước Bundle Webview (out/webview/main.js)

- Kích thước ban đầu trên nhánh `develop`: 941.122 bytes.
- Kích thước sau khi gộp `exportDone` vào switch message: 941.111 bytes (-11 bytes).
- Kích thước cuối cùng (kèm log cảnh báo `console.warn` cho #105): 941.138 bytes (+16 bytes so với baseline).
- Đảm bảo tính chất type-only: Tệp `src/shared/messages.ts` chỉ chứa interface và type union thuần túy trong TypeScript. Trình đóng gói esbuild loại bỏ hoàn toàn các câu lệnh import ở thời điểm biên dịch, không làm tăng kích thước mã thực thi của giao thức.

---

## 4. Thiết Kế Giao Thức Message và Bằng Chứng Kiểu Nghiêm Ngặt

### Nguồn chân lý duy nhất (Single Source of Truth)
Tệp `src/shared/messages.ts` định nghĩa toàn bộ cấu trúc dữ liệu trao đổi:
- `WebviewToHostMessage`: Union gồm 18 kiểu thông điệp từ webview gửi lên host (`ready`, `edit`, `openLink`, `saveImage`, `viewSource`, `viewRichText`, `exportDocx`, `exportPdf`, `searchFiles`, `findReferencedImages`, `getSystemFonts`, `renameImageFile`, `deleteImageFiles`, `readClipboardImage`, `pasteMarkdownFiles`, `resolveResourceUri`, `toggleBreadcrumbs`, `tableAction`).
- `HostToWebviewMessage`: Union gồm 15 kiểu thông điệp từ host gửi xuống webview (`theme`, `config`, `update`, `saved`, `exportDone`, `imageSaved`, `fileSearchResults`, `referencedImagesResult`, `systemFontsResult`, `imageRenamed`, `imagesDeleted`, `clipboardImage`, `markdownFilesPasted`, `resolvedResourceUri`, `breadcrumbsToggled`).

### Đặt kiểu cả hai đầu và loại bỏ ép kiểu inline
- Phía extension host:
  - Định nghĩa interface `TypedWebview` bọc phương thức `postMessage(message: HostToWebviewMessage): Thenable<boolean>`.
  - Thay thế toàn bộ các lời gọi `webviewPanel.webview.postMessage` bằng `webview.postMessage`.
  - Trong `onDidReceiveMessage`: Tham số nhận vào mang kiểu `WebviewToHostMessage`, loại bỏ hoàn toàn mọi thao tác ép kiểu thô `as { type: string, ... }`.
- Phía webview:
  - Đặt kiểu cho `acquireVsCodeApi().postMessage(message: WebviewToHostMessage)`.
  - Đặt kiểu cho `storedPostMessage` và callback trong `image-edit-plugin.ts`.
  - Xóa bỏ event listener riêng lẻ cho `exportDone`, gộp trực tiếp vào `switch (message.type)` trong `main.ts`.
- Kiểm tra ép kiểu inline:
  Lệnh `grep -n "as { type" src/markdownEditorProvider.ts src/webview/main.ts` trả về 0 kết quả (exit code 1).

### Bằng chứng bắt lỗi biên dịch từ tsc
Khi thử đổi tên literal type `ready` thành `readyRenamed` trong `src/shared/messages.ts`:
- Phía extension host báo lỗi:
  `src/markdownEditorProvider.ts(329,14): error TS2678: Type '"ready"' is not comparable to type '"readyRenamed" | ...'`
- Phía webview báo lỗi:
  `src/webview/main.ts(887,22): error TS2322: Type '"ready"' is not assignable to type '... | "readyRenamed" | ...'`
Nếu gửi thiếu thuộc tính bắt buộc hoặc sai kiểu dữ liệu của payload, `tsc` sẽ báo lỗi ngay tại chỗ.

---

## 5. Thân Issue #105 Sai Ở Đâu và Cách Xử Lý Đã Chốt

### Thân issue #105 sai ở đâu: Nguyên văn câu sai
Trong mô tả ban đầu của issue #105, tác giả yêu cầu:
> "khi hỏng để webview bật toast lỗi sẵn có (showError ở main.ts:796; nhánh nhận là case \"clipboardImage\" ở main.ts:1983)"

### Mã nguồn chứng minh sai lệch
1. **`showError` không phải là toast**:
   Tại `src/webview/main.ts:796`:
   ```typescript
   function showError(error: unknown) {
     const message = error instanceof Error ? error.message : String(error);
     editorEl.innerHTML = `
       <div class="editor-error">
         <p>Failed to load editor</p>
         <p class="editor-error-detail">${escapeHtml(message)}</p>
       </div>
     `;
   }
   ```
   Hàm `showError()` này gán thẳng `editorEl.innerHTML = errorHtml`. Đây là màn hình lỗi chí mạng (fatal error screen) chỉ dùng khi editor không thể khởi tạo (ví dụ không tìm thấy phần tử DOM `#editor`). Nếu gọi nó khi dán ảnh hỏng, toàn bộ nội dung tài liệu người dùng đang mở sẽ bị xóa trắng ngay lập tức.
2. **Không có "trạng thái chờ" nào để hủy**:
   Tại `src/webview/main.ts:2121-2130`, handler paste của webview chỉ bắn thông điệp lên host:
   ```typescript
   storedPostMessage({ type: "readClipboardImage" });
   // Text paste continues normally
   ```
   Sau đó đường dán văn bản thường vẫn tiếp tục diễn ra độc lập. Phía webview không hề lưu biến trạng thái hay promise treo chờ nào, nên không có trạng thái chờ nào để thoát hay hủy.

### Cách xử lý đã chốt với điều phối viên
Vấn đề đã được báo cáo lên điều phối viên qua kênh `orca orchestration ask`. Điều phối viên đã xác nhận sai lệch và ban hành chỉ thị "SỬA ĐỔI GIỮA SÓNG số 2":
1. **Không gọi `showError()`**: Tuyệt đối không chạm vào DOM của editor.
2. **Không dựng toast mới**: Tránh thêm CSS mới gây xung đột với Worker W2 đang dời khối `<style>` với tiêu chí nghiệm thu "diff CSS rỗng".
3. **Phía webview chỉ làm hai việc**:
   - Bổ sung trường `error?: string` vào loại thông điệp `clipboardImage` trong `src/shared/messages.ts`.
   - Trong `case "clipboardImage"` tại `src/webview/main.ts`, khi có `message.error` thì ghi log cảnh báo: `console.warn("[Clipboard]", message.error)`. Không chạm DOM. Editor giữ nguyên 100%, đường dán văn bản thường không bị chặn.
4. **Toàn bộ phần hiển thị cho người dùng do host đảm nhiệm**:
   - Hiển thị thông báo qua `vscode.window.showWarningMessage`.
   - Cơ chế chống lặp: Lưu `clipboardWarningsShown = new Set<string>()`, đảm bảo mỗi lý do lỗi chỉ hiện cảnh báo đúng một lần trong mỗi phiên làm việc.
   - Hướng dẫn hữu ích trên Linux: Nếu thiếu công cụ clipboard hệ thống (`xclip` hoặc `wl-paste`), hiển thị rõ: "Install xclip or wl-clipboard to paste images".

### Mô tả cách ép lỗi khi kiểm thử
Để kiểm thử nhánh xử lý lỗi clipboard:
- Giả lập lỗi tại hàm đọc clipboard trong `src/markdownEditorProvider.ts` (ném ngoại lệ `new Error("Command failed: xclip -selection clipboard -t TARGETS -o")` hoặc giả lập không tìm thấy tiện ích clipboard).
- Thực hiện thao tác dán ảnh: Extension host hiển thị thông báo `vscode.window.showWarningMessage("Failed to paste image from clipboard: ... Install xclip or wl-clipboard to paste images")` đúng một lần. Khi thực hiện dán ảnh hỏng tiếp lần thứ hai, cảnh báo không bị hiển thị lặp lại.
- Trên console của webview: Xuất hiện log `[Clipboard] Command failed: xclip...`. Trình soạn thảo không bị treo, nội dung tài liệu đang mở giữ nguyên vẹn, và thao tác dán văn bản thuần vẫn hoạt động bình thường.

---

## 6. Giải Pháp Xử Lý Issue #104 (Phần Host)

### Hiện tượng
Khi người dùng đóng tab soạn thảo hoặc webview bị hủy (`onDidDispose`), các thông điệp `edit` đang trên đường truyền (in-flight edits) có thể đến trong hoặc sau khi các listener bị hủy, dẫn đến nguy cơ mất dữ liệu sửa đổi cuối cùng hoặc gọi `WorkspaceEdit` trên tài liệu đã đóng.

### Cải tiến đã thực hiện trong src/markdownEditorProvider.ts
1. Thêm biến theo dõi `inFlightEdit: Promise<void> | null` trong `CustomTextEditorProvider`.
2. Kiểm tra trạng thái tài liệu trong `applyEdit`: Nếu `document.isClosed` thì lập tức bỏ qua, không cố gắng áp dụng edit lên tài liệu không còn tồn tại.
3. Trì hoãn dọn dẹp trong `onDidDispose`: Sử dụng `setImmediate` để cho phép các tác vụ I/O đang chờ trong event loop hoàn tất trước. Nếu tài liệu vẫn mở (`!document.isClosed`) và đang có `inFlightEdit`, host sẽ chờ cho edit này áp dụng xong vào tài liệu rồi mới dọn dẹp subscription và xóa đường dẫn ảnh tạm trong `originalImagePaths`.

---

## 7. Đề Xuất Cập Nhật Cho AGENTS.md và CHANGELOG.md

Do nguyên tắc không sửa trực tiếp các tệp tài liệu ở thư mục gốc trong quá trình làm việc của worker, nội dung đề xuất cập nhật được tổng hợp dưới đây để điều phối viên gộp sau:

### Đề xuất cho AGENTS.md

Thêm vào mục **Architecture (Extension ↔ Webview communication flow)**:
```markdown
- All communication adheres to the typed protocol in `src/shared/messages.ts` (`WebviewToHostMessage` and `HostToWebviewMessage`).
```

Thêm vào mục **File Structure**:
```markdown
src/
├── shared/
│   └── messages.ts           # Type-only message protocol between host and webview (WebviewToHostMessage, HostToWebviewMessage)
```

Thêm vào mục **Conventions & Gotchas**:
```markdown
- Message protocol is strictly typed via `src/shared/messages.ts` (WebviewToHostMessage and HostToWebviewMessage). All `postMessage` calls and message reception switches must be statically typed. Do not use inline `(msg as { type: ... })` casts.
- On webview disposal, `onDidDispose` uses `setImmediate` to await any `inFlightEdit` if the document is still open (`!document.isClosed`) before tearing down subscriptions.
- Clipboard image read failures are reported on the host via `vscode.window.showWarningMessage` (deduplicated per session per reason). Webview must never call `showError()` for clipboard errors to avoid destroying the active editor instance.
```

### Đề xuất cho CHANGELOG.md

Thêm vào mục **Added**:
```markdown
- Strongly typed message protocol between VS Code extension host and webview via `src/shared/messages.ts` (#87).
- Actionable user warning when pasting clipboard images fails on Linux due to missing `xclip` or `wl-clipboard` (#105).
```

Thêm vào mục **Fixed**:
```markdown
- Prevent silent failure when clipboard image read encounters an error (#105).
- Ensure in-flight edits arriving during webview disposal are applied to open documents (#104).
```
