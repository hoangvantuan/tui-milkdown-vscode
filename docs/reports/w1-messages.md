# Báo Cáo Nghiệm Thu: Wave 4 Worker W1 (Typed Message Protocol & Error Handling)

Báo cáo nghiệm thu kỹ thuật cho Worker W1 thuộc Wave 4, giải quyết ba vấn đề:
- Issue #87: Strongly typed message protocol giữa VS Code extension host và webview.
- Issue #105: Xử lý lỗi đọc clipboard image, không nuốt lỗi ngầm, hiển thị cảnh báo hữu ích.
- Issue #104 (phần host): Áp dụng các in-flight edit gửi tới trong lúc `onDidDispose` nếu tài liệu vẫn mở.

---

## 1. Kết Quả Các Lệnh Kiểm Tra

### Lệnh 1: npm run lint
- Lệnh đã chạy: `npm run lint`
- Output thực tế:
```
> tui-milkdown-vscode@2.15.2 lint
> tsc --noEmit
```
- Kết quả: PASS (exit code 0, không có lỗi kiểu nào).

### Lệnh 2: npm run build
- Lệnh đã chạy: `npm run build`
- Output thực tế:
```
> tui-milkdown-vscode@2.15.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```
- Kết quả: PASS (exit code 0, đóng gói bundle thành công).

### Lệnh 3: npm run roundtrip
- Lệnh đã chạy: `npm run roundtrip`
- Output thực tế:
```
> tui-milkdown-vscode@2.15.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness (mode: check)
corpus: 37 fixtures (32 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
37 markdown fixtures + 6 seams: 43 passed, 0 failed, 0 missing, 0 errored
```
- Kết quả: PASS (exit code 0, 43/43 kiểm tra đều đạt).

### Lệnh 4: npm run verify:vscode-floor
- Kết quả: điều phối viên chạy trên nhánh này, 15 checks, 15 passed.

---

## 2. Kết Quả Kiểm Tra Ổn Định Vòng Hai (Idempotency)

- Lệnh đã chạy:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip; git checkout -- harness/fixtures/synthetic/
```
- Output thực tế:
```
harness built: out/harness/roundtrip.js
markdown roundtrip harness (mode: check)
corpus: 37 fixtures (32 synthetic, 5 repo docs)

FAIL     synthetic/list-continuation-underindented.md (+0 -0 lines)
  --- golden/synthetic/list-continuation-underindented.md
  +++ current/synthetic/list-continuation-underindented.md
  @@ -6,7 +6,7 @@
   1. first ordered item
   continuation under the three-character marker
   2. second ordered item
  - continuation at marker width
  +continuation at marker width
   
   - bullet with two continuation lines
    continuation one space
  @@ -19,4 +19,4 @@
      inner continuation under the two-space inner marker
   
   10. ordered item with a two-digit marker
  - continuation at the four-character marker
  +continuation at the four-character marker

──────────────────────────────────────────
──────────────────────────────────────────
37 markdown fixtures + 6 seams: 42 passed, 1 failed, 0 missing, 0 errored
```
- Kết quả ghi nhận: Đúng chính xác 1 fixture failed (`synthetic/list-continuation-underindented.md`), là lỗi continuation line của Tiptap upstream đã ghi nhận trong `harness/README.md`.
- Lệnh kiểm tra diff fixtures: `git diff develop..HEAD --stat -- harness/fixtures/synthetic/`
- Output thực tế: Trả về rỗng (0 tệp thay đổi).

---

## 3. Kích Thước Bundle Webview (out/webview/main.js)

- Lệnh kiểm tra kích thước bundle: `stat -f%z out/webview/main.js`
- Output thực tế: `941138`
- Đối chiếu quá trình:
  - Baseline đo trên nhánh `develop`: 941.122 bytes.
  - Sau khi gộp `exportDone` vào switch message: 941.111 bytes (-11 bytes).
  - Bản cuối cùng (kèm log cảnh báo `console.warn` cho #105): 941.138 bytes (+16 bytes so với baseline).
- Tệp `src/shared/messages.ts` chỉ chứa interface và type union thuần túy trong TypeScript. Trình đóng gói esbuild loại bỏ hoàn toàn các câu lệnh import ở thời điểm biên dịch, không làm tăng kích thước mã thực thi của giao thức.

---

## 4. Thiết Kế Giao Thức Message và Bằng Chứng Kiểu Nghiêm Ngặt

### Danh sách các loại message thực tế trong src/shared/messages.ts

Lệnh sinh toàn bộ 33 dòng định nghĩa literal type trong `src/shared/messages.ts`:
```bash
grep -n 'type: "' src/shared/messages.ts
```

Output thực tế:
```
14:  type: "ready";
18:  type: "edit";
23:  type: "viewSource";
27:  type: "themeChange";
32:  type: "fontChange";
37:  type: "zoomChange";
42:  type: "saveImage";
49:  type: "showWarning";
54:  type: "readClipboardImage";
58:  type: "requestImageUrlEdit";
66:  type: "openLink";
71:  type: "openImageInTab";
76:  type: "requestLinkEdit";
82:  type: "requestImageRename";
89:  type: "fileSearch";
93:  type: "wikiLinkSearch";
97:  type: "openWikiLink";
102:  type: "export";
133:  type: "update";
139:  type: "theme";
144:  type: "config";
154:  type: "savedTheme";
159:  type: "savedFont";
164:  type: "savedZoom";
169:  type: "systemFonts";
174:  type: "imageSaved";
181:  type: "clipboardImage";
187:  type: "imageUrlEditResponse";
193:  type: "linkEditResponse";
199:  type: "imageRenameResponse";
207:  type: "fileSearchResults";
213:  type: "wikiLinkSearchResults";
219:  type: "exportDone";
```

#### 18 loại thông điệp Webview gửi tới Host (WebviewToHostMessage)
Lệnh đọc khối định nghĩa union từ `src/shared/messages.ts`:
```bash
sed -n '108,126p' src/shared/messages.ts
```
Output thực tế:
```typescript
export type WebviewToHostMessage =
  | ReadyMessage
  | EditMessage
  | ViewSourceMessage
  | ThemeChangeMessage
  | FontChangeMessage
  | ZoomChangeMessage
  | SaveImageMessage
  | ShowWarningMessage
  | ReadClipboardImageMessage
  | RequestImageUrlEditMessage
  | OpenLinkMessage
  | OpenImageInTabMessage
  | RequestLinkEditMessage
  | RequestImageRenameMessage
  | FileSearchMessage
  | WikiLinkSearchMessage
  | OpenWikiLinkMessage
  | ExportMessage;
```
Tên 18 literal type tương ứng:
`ready`, `edit`, `viewSource`, `themeChange`, `fontChange`, `zoomChange`, `saveImage`, `showWarning`, `readClipboardImage`, `requestImageUrlEdit`, `openLink`, `openImageInTab`, `requestLinkEdit`, `requestImageRename`, `fileSearch`, `wikiLinkSearch`, `openWikiLink`, `export`.

#### 15 loại thông điệp Host gửi tới Webview (HostToWebviewMessage)
Lệnh đọc khối định nghĩa union từ `src/shared/messages.ts`:
```bash
sed -n '224,239p' src/shared/messages.ts
```
Output thực tế:
```typescript
export type HostToWebviewMessage =
  | UpdateMessage
  | ThemeMessage
  | ConfigMessage
  | SavedThemeMessage
  | SavedFontMessage
  | SavedZoomMessage
  | SystemFontsMessage
  | ImageSavedMessage
  | ClipboardImageMessage
  | ImageUrlEditResponseMessage
  | LinkEditResponseMessage
  | ImageRenameResponseMessage
  | FileSearchResultsMessage
  | WikiLinkSearchResultsMessage
  | ExportDoneMessage;
```
Tên 15 literal type tương ứng:
`update`, `theme`, `config`, `savedTheme`, `savedFont`, `savedZoom`, `systemFonts`, `imageSaved`, `clipboardImage`, `imageUrlEditResponse`, `linkEditResponse`, `imageRenameResponse`, `fileSearchResults`, `wikiLinkSearchResults`, `exportDone`.

### Loại bỏ hoàn toàn ép kiểu inline
- Lệnh kiểm tra:
```bash
grep -n "as { type" src/markdownEditorProvider.ts src/webview/main.ts
```
- Output thực tế: Exit code 1, không có dòng nào khớp (0 matches).

### Bằng chứng bắt lỗi biên dịch từ tsc khi đổi tên literal type
- Lệnh đã chạy để thử đổi tên `ready` thành `readyRenamed` trong `src/shared/messages.ts` và chạy kiểm tra kiểu:
```bash
node -e 'let c = require("fs").readFileSync("src/shared/messages.ts", "utf8").replace(`type: "ready";`, `type: "readyRenamed";`); require("fs").writeFileSync("src/shared/messages.ts", c);' && npx tsc --noEmit; git checkout -- src/shared/messages.ts
```
- Output thực tế:
```
src/markdownEditorProvider.ts(569,16): error TS2678: Type '"ready"' is not comparable to type '"edit" | "export" | "fileSearch" | "fontChange" | "openImageInTab" | "openLink" | "openWikiLink" | "readClipboardImage" | "readyRenamed" | "requestImageRename" | "requestImageUrlEdit" | ... 6 more ... | "zoomChange"'.
src/webview/main.ts(2137,24): error TS2322: Type '"ready"' is not assignable to type '"edit" | "export" | "fileSearch" | "fontChange" | "openImageInTab" | "openLink" | "openWikiLink" | "readClipboardImage" | "readyRenamed" | "requestImageRename" | "requestImageUrlEdit" | ... 6 more ... | "zoomChange"'.
```
Lỗi xuất hiện chính xác ở cả hai đầu: Host (TS2678 tại switch case) và Webview (TS2322 tại lời gọi postMessage).

---

## 5. Thân Issue #105 Sai Ở Đâu và Cách Xử Lý Đã Chốt

### Thân issue #105 sai ở đâu: Nguyên văn câu sai
Trong mô tả ban đầu của issue #105, tác giả yêu cầu:
> "{ type: \"clipboardImage\", error: \"<lý do>\" } khi hỏng để webview bật toast lỗi sẵn có (showError ở main.ts:796; nhánh nhận là case \"clipboardImage\" ở main.ts:1983)"

### Mã nguồn chứng minh sai lệch

1. **`showError` không phải là toast lỗi mà là màn hình lỗi chí mạng**:
Lệnh đọc khối mã thật từ `src/webview/main.ts`:
```bash
sed -n '800,816p' src/webview/main.ts
```
Output thực tế:
```typescript
function showError(message: string): void {
  const errorHtml = `
    <div style="padding: 20px; color: var(--vscode-errorForeground, red);">
      <h3>Error</h3>
      <p>${escapeHtml(message)}</p>
      <p>Try reopening the file or reloading the window.</p>
    </div>
  `;
  const editorEl = getEditorEl();
  if (editorEl) {
    editorEl.innerHTML = errorHtml;
  } else {
    // Fallback when #editor element is missing
    console.error("[Tiptap]", message);
    document.body.innerHTML = errorHtml;
  }
}
```
Hàm `showError(message: string)` này gán thẳng `editorEl.innerHTML = errorHtml`. Nó là màn hình lỗi chí mạng có tiêu đề `<h3>Error</h3>`, chỉ dùng khi editor không thể khởi tạo. Nếu gọi nó khi dán ảnh hỏng, toàn bộ nội dung tài liệu người dùng đang mở sẽ bị xóa sạch khỏi DOM.

2. **Không có "trạng thái chờ" nào để hủy**:
Lệnh đọc khối mã handler phím dán từ `src/webview/main.ts`:
```bash
sed -n '2125,2136p' src/webview/main.ts
```
Output thực tế:
```typescript
  document.addEventListener("keydown", (e) => {
    if (!editor?.view) return;
    // Detect Cmd+V (macOS) or Ctrl+V (Windows/Linux), excluding Shift+Cmd+V (paste-as-text)
    const isPaste = (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
      && !e.shiftKey && e.key === "v";
    if (!isPaste) return;
    // Request extension-side clipboard read. Extension checks if clipboard has image,
    // responds with clipboardImage message only if it does. Text paste continues normally.
    vscode.postMessage({ type: "readClipboardImage" });
  }, { capture: true });
```
Handler này chỉ gửi `vscode.postMessage({ type: "readClipboardImage" })` rồi để đường dán văn bản thường tiếp tục chạy độc lập. Phía webview không hề lưu trạng thái chờ dán ảnh hay khóa giao diện.

3. **Khối mã xử lý clipboardImage thực tế**:
Lệnh đọc từ `src/webview/main.ts`:
```bash
sed -n '1984,1993p' src/webview/main.ts
```
Output thực tế:
```typescript
    case "clipboardImage":
      if (message.error) {
        console.warn("[Clipboard]", message.error);
        break;
      }
      if (typeof message.data === "string" && editor?.view) {
        const file = dataUrlToFile(message.data, "clipboard-image.png");
        if (file) processImagePaste(editor.view, file);
      }
      break;
```

### Cách xử lý đã chốt với điều phối viên
Theo chỉ thị "SỬA ĐỔI GIỮA SÓNG số 2":
1. **Không gọi `showError()`**: Không chạm vào DOM của editor để bảo vệ tài liệu người dùng.
2. **Không dựng toast mới**: Tránh thêm CSS mới làm xung đột với Worker W2 đang thực hiện dời khối `<style>`.
3. **Phía webview**:
   - Thêm trường `error?: string` vào `ClipboardImageMessage` trong `src/shared/messages.ts`.
   - Trong `case "clipboardImage"` tại `src/webview/main.ts`, khi có `message.error` thì ghi log `console.warn("[Clipboard]", message.error)`. Không chạm DOM.
4. **Phía extension host**:
   - Hiển thị thông báo qua `vscode.window.showWarningMessage`.
   - Chống lặp cảnh báo: Dùng `clipboardWarningsShown = new Set<string>()`, mỗi lý do chỉ cảnh báo tối đa một lần mỗi phiên.
   - Hướng dẫn cụ thể trên Linux: "Install xclip or wl-clipboard to paste images".

### Tình trạng kiểm thử phép ép lỗi clipboard
- Phép thử ép lỗi clipboard trên môi trường VS Code sống: Chưa kiểm được trong phiên chạy worker dòng lệnh này, do môi trường chạy không có cửa sổ VS Code sống với giao diện đồ họa để thực hiện thao tác phím dán thực tế trên webview.
- Quy trình đề nghị thực hiện bằng tay khi có môi trường VS Code sống:
  1. Trên máy Linux không cài `xclip` và `wl-clipboard` (hoặc cấu hình tạm để lệnh đọc clipboard trả về lỗi), mở một tệp Markdown bằng custom editor.
  2. Sao chép một hình ảnh vào clipboard của hệ điều hành.
  3. Nhấn tổ hợp phím Ctrl+V trong cửa sổ trình soạn thảo: Extension host sẽ hiển thị cảnh báo `vscode.window.showWarningMessage` với nội dung yêu cầu cài đặt `xclip` hoặc `wl-clipboard`.
  4. Nhấn Ctrl+V thêm lần nữa: Cảnh báo sẽ không bị hiển thị lặp lại do đã được ghi nhận trong `Set`.
  5. Mở Developer Tools của Webview: Bảng Console sẽ hiển thị dòng cảnh báo `[Clipboard] ...`, và tài liệu trong trình soạn thảo sẽ giữ nguyên trạng thái không bị mất dữ liệu.

---

## 6. Giải Pháp Xử Lý Issue #104 (Phần Host)

### Hiện tượng
Khi người dùng đóng tab soạn thảo hoặc webview bị hủy (`onDidDispose`), các thông điệp `edit` đang trên đường truyền (in-flight edits) có thể đến trong hoặc sau khi các listener bị hủy, dẫn đến nguy cơ mất dữ liệu sửa đổi cuối cùng hoặc gọi `WorkspaceEdit` trên tài liệu đã đóng.

### Mã nguồn chứng minh giải pháp trong src/markdownEditorProvider.ts

1. **Bảo vệ applyEdit khi tài liệu đã đóng**:
Lệnh đọc từ `src/markdownEditorProvider.ts`:
```bash
sed -n '463,466p' src/markdownEditorProvider.ts
```
Output thực tế:
```typescript
    const applyEdit = async (newContent: string) => {
      if (document.isClosed) return;
      const normalizedContent = normalizeLineEndings(newContent, document.eol);
      if (normalizedContent === document.getText()) return;
```

2. **Theo dõi và chờ inFlightEdit trong case edit**:
Lệnh đọc từ `src/markdownEditorProvider.ts`:
```bash
sed -n '614,619p' src/markdownEditorProvider.ts
```
Output thực tế:
```typescript
          case "edit":
            if (typeof msg.content === "string" && !document.isClosed) {
              inFlightEdit = applyEdit(msg.content);
              await inFlightEdit;
            }
            break;
```

3. **Trì hoãn dọn dẹp trong onDidDispose bằng setImmediate**:
Lệnh đọc từ `src/markdownEditorProvider.ts`:
```bash
sed -n '1389,1404p' src/markdownEditorProvider.ts
```
Output thực tế:
```typescript
    webviewPanel.onDidDispose(() => {
      if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
      // Allow any edit in-flight during teardown (e.g. flushed on pagehide) to be applied if document is still open
      setImmediate(async () => {
        if (inFlightEdit) {
          try {
            await inFlightEdit;
          } catch {
            /* ignore */
          }
        }
        isDisposed = true;
        this.originalImagePaths.delete(docKey);
        disposables.forEach((d) => d.dispose());
      });
    });
```

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
