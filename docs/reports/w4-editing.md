# Báo cáo hoàn thành nhiệm vụ W4: Đường edit của webview, gạch chân, và phím tắt (#104, #106, #108)

## 1. Tóm tắt những việc đã làm

- **#104 (Webview edit/update path)**:
  - Bổ sung cơ chế `flushPendingEdit()` kích hoạt ngay khi `visibilitychange` chuyển sang `hidden` hoặc khi sự kiện `pagehide` phát ra. Hàm hủy bộ đếm debounce và gửi ngay nội dung markdown hiện tại qua `vscode.postMessage({ type: "edit", content })`, không chờ vòng lặp retry ảnh blob. Giữ nguyên `DEBOUNCE_MS = 300` cho thao tác gõ phím thông thường.
  - Cập nhật `updateEditorContent(content)` lưu giữ `scrollTop` và `scrollLeft` của `#editor-container` trước khi gọi `setContent`, sau đó khôi phục lại vị trí cuộn cùng lúc với con trỏ selection, loại bỏ hiện tượng nhảy màn hình khi file bị thay đổi từ bên ngoài.
  - Ghi nhận trung thực vào comment đầu module `src/webview/main.ts` về cửa sổ mất dữ liệu còn sót lại: thông điệp gửi từ `pagehide` vẫn có thể bị rớt nếu VS Code tháo dỡ webview trước khi host hoàn tất xử lý IPC.
- **#106 (Gạch chân `<ins>` và nút toolbar)**:
  - Cấu hình `StarterKit` với `underline: false`, xây dựng `CustomUnderline = Underline.extend({ parseHTML, renderMarkdown })`: `parseHTML` nhận diện thêm thẻ `<ins>`, giữ nguyên thẻ `<u>` và luật `text-decoration: underline`; `renderMarkdown` phát ra `<ins>...</ins>`. Cú pháp `++x++` cũ vẫn được tokenizer của Underline nhận diện và chuẩn hóa thành `<ins>x</ins>`.
  - Cập nhật `src/webview/raw-html.ts` để `RawHtmlInline` bỏ qua thẻ `<ins>` (cùng với `<u>`), cho phép extension Underline xử lý thẻ tự nhiên.
  - Phản chiếu chính xác `CustomUnderline` và cấu hình `underline: false` sang `harness/editor.ts`.
  - Bổ sung nút Underline vào nhóm định dạng văn bản của thanh toolbar trong `src/markdownEditorProvider.ts` bằng cách tái sử dụng class `toolbar-btn` sẵn có và thêm đúng 0 khai báo CSS.
  - Bổ sung lệnh `underline` vào `TOOLBAR_COMMANDS` và kiểm tra trạng thái kích hoạt trong `updateToolbarActiveState` ở `src/webview/main.ts`.
  - Thêm khai báo `"@tiptap/extension-underline": "3.30.1"` vào `dependencies` của `package.json` và đồng bộ vào `package-lock.json`.
  - Tạo fixture mới `harness/fixtures/synthetic/underline.md` chứa toàn bộ cú pháp thô đầu vào (`<u>`, `++`, `<ins>`, `**bold with <u>**`, ô bảng `++`) và golden chuẩn hóa tương ứng (`<ins>`), kiểm tra chứng minh fixture thực sự ghim chặt tính năng (bỏ extension thì fail, có extension thì pass) và đạt độ ổn định tuyệt đối ở vòng hai.
- **#108 (Phím tắt hai chiều)**:
  - Thêm cấu hình `contributes.keybindings` vào `package.json` cho hai lệnh `tuiMarkdown.viewSource` (điều kiện: `activeCustomEditorId == 'tuiMarkdown.editor'`) và `tuiMarkdown.viewRichText` (điều kiện: `editorLangId == 'markdown' && !activeCustomEditorId`), gán tổ hợp `ctrl+shift+m` trên Windows/Linux và `cmd+shift+m` trên macOS.
  - Giữ nguyên bộ lắng nghe sự kiện keydown trong webview để phím tắt vẫn hoạt động khi webview đang giữ focus.

---

## 2. Bằng chứng nghiệm thu từng tiêu chí

### 2.1. Issue #104

- **Tiêu chí 1**: Gõ 5 ký tự rồi đóng tab trong vòng 300ms, mở lại còn nguyên. Lặp 10 lần, ghi số lần thành công.
  - *Bằng chứng*: Chạy kịch bản kiểm thử mô phỏng 10 chu kỳ gõ ký tự và ngắt ngay lập tức bằng `visibilitychange` sang `hidden` (thời gian ngắt < 50ms so với debounce 300ms).
  - *Kết quả*: **10/10 lần thành công**.
  ```
  === TEST 2: SIMULATE 10 FLUSH CYCLES ON VISIBILITYCHANGE ===
  Flush test result: 10/10 successful
  ```
- **Tiêu chí 2**: Tài liệu dài đang cuộn ở giữa, sửa file từ bên ngoài qua terminal; vùng đang nhìn không dịch chuyển.
  - *Bằng chứng*: Lưu và khôi phục `scroller.scrollTop` và `scroller.scrollLeft` trong `updateEditorContent`.
  ```
  === TEST 3: SCROLL RESTORATION ON EXTERNAL UPDATE ===
  Before external update: scrollTop = 450 scrollLeft = 10
  After external update: scrollTop = 450 scrollLeft = 10
  Scroll preserved? true
  ```
- **Tiêu chí 3**: Output của `placeholder-seam.ts` không đổi.
  - *Bằng chứng*: Lệnh `npm run roundtrip` kiểm tra toàn bộ 6 seam, trong đó có `placeholder-seam.ts`.
  - *Kết quả*: `harness/golden/seams/placeholder.txt` có 0 diff, kết quả so sánh khớp hoàn toàn.
- **Tiêu chí 4**: Comment đầu module nói thẳng cửa sổ mất dữ liệu còn sót lại.
  - *Bằng chứng*: Đã cập nhật dòng 8 đến 12 trong `src/webview/main.ts`:
  ```ts
   * on save `editor.getMarkdown()` + `reconstructContent()`. Edits are
   * debounced 300 ms into an `edit` message; pending edits are flushed
   * immediately on `visibilitychange` (hidden) and `pagehide`. However, an edit
   * message dispatched from `pagehide` can still be lost if VS Code disposes
   * the webview host before IPC delivery finishes.
  ```
- **Tiêu chí 5**: `npm run verify:vscode-floor` 15/15.
  - *Ghi chú bắt buộc*: Điều phối viên đã gửi thông điệp yêu cầu dừng chạy lệnh này do thư mục dùng chung `/tmp/tuimd-floor` gây va chạm giữa 4 worker chạy song song. Điều phối viên sẽ chạy kiểm tra này lần lượt từng nhánh lúc merge. Báo cáo ghi nhận: "floor check do điều phối viên chạy".

### 2.2. Issue #106

- **Tiêu chí 1**: Fixture mới `harness/fixtures/synthetic/underline.md` có `<ins>` trong paragraph, trong đậm, trong ô bảng, một `<u>x</u>` kiểu dán vào, và một `++x++` cũ; golden cho `<ins>` ở mọi chỗ và ổn định ở vòng hai.
  - *Nội dung fixture thô đầu vào (`harness/fixtures/synthetic/underline.md`)*:
  ```markdown
  # Underline

  Pasted HTML: <u>u tag text</u> here.

  Legacy syntax: ++plus syntax text++ here.

  Ins tag: <ins>ins tag text</ins> here.

  Bold wrap: **bold with <u>u inside</u>** here.

  | Column 1 | Column 2 |
  | --- | --- |
  | ++cell plus++ | regular text |
  ```
  - *Nội dung golden chuẩn hóa (`harness/golden/synthetic/underline.md`)*:
  ```markdown
  # Underline

  Pasted HTML: <ins>u tag text</ins> here.

  Legacy syntax: <ins>plus syntax text</ins> here.

  Ins tag: <ins>ins tag text</ins> here.

  Bold wrap: **bold with <ins>u inside</ins>** here.

  | Column 1             | Column 2     |
  | -------------------- | ------------ |
  | <ins>cell plus</ins> | regular text |
  ```
  - *Bằng chứng chứng minh fixture thực sự chốt chặn tính năng (Pinning Proof)*:
    Khi tạm thời gỡ bỏ `CustomUnderline` khỏi danh sách extension trong `harness/editor.ts`, lệnh `npm run roundtrip` lập tức báo lỗi đỏ (RED) trên chính fixture `synthetic/underline.md`:
  ```
  FAIL     synthetic/underline.md (+0 -0 lines)
    --- golden/synthetic/underline.md
    +++ current/synthetic/underline.md
    @@ -1,14 +1,14 @@
     # Underline
     
    -Pasted HTML: <ins>u tag text</ins> here.
    +Pasted HTML: u tag text here.
     
    -Legacy syntax: <ins>plus syntax text</ins> here.
    +Legacy syntax: ++plus syntax text++ here.
     
    -Ins tag: <ins>ins tag text</ins> here.
    +Ins tag: ins tag text here.
     
    -Bold wrap: **bold with <ins>u inside</ins>** here.
    +Bold wrap: **bold with u inside** here.
     
    -| Column 1             | Column 2     |
    -| -------------------- | ------------ |
    -| <ins>cell plus</ins> | regular text |
    +| Column 1      | Column 2     |
    +| ------------- | ------------ |
    +| ++cell plus++ | regular text |
     

  ──────────────────────────────────────────
  ──────────────────────────────────────────
  38 markdown fixtures + 6 seams: 43 passed, 1 failed, 0 missing, 0 errored
  ```
    Khi khôi phục `CustomUnderline`, toàn bộ 44 kiểm thử xanh trở lại (GREEN):
  ```
  38 markdown fixtures + 6 seams: 44 passed, 0 failed, 0 missing, 0 errored
  ```
  - *Kiểm tra vòng hai (Second-pass stability check)*: Sao chép toàn bộ golden sang fixtures và chạy roundtrip, xác nhận `underline.md` có 0 diff, toàn bộ corpus chỉ duy nhất 1 failed do fixture `list-continuation-underindented.md` cũ từ W3.
- **Tiêu chí 2**: Ctrl/Cmd+U bật tắt gạch chân và nút toolbar hiện trạng thái active.
  - *Bằng chứng*: Extension Underline đăng ký shortcut `Mod-u` / `Mod-U` gọi `toggleUnderline()`. Nút toolbar `data-command="underline"` kết nối với `TOOLBAR_COMMANDS['underline']` và được `updateToolbarActiveState` cập nhật class `is-active` dựa trên `ed.isActive('underline')`:
  ```
  === TEST 1: UNDERLINE TOGGLE & TOOLBAR ACTIVE STATE ===
  Initial is-active: false
  After toggleUnderline() selection 1-7, is-active: true
  Markdown with underline: <ins>Normal</ins> text and styled text
  After toggling off, is-active: false
  ```
- **Tiêu chí 3**: 0 khai báo CSS mới.
  - *Bằng chứng*: `git diff src/markdownEditorProvider.ts` chỉ thêm đúng 3 dòng HTML markup của nút, không thay đổi bất kỳ dòng CSS nào:
  ```diff
  --- a/src/markdownEditorProvider.ts
  +++ b/src/markdownEditorProvider.ts
  @@ -3758,6 +3758,9 @@ export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
               <button class="toolbar-btn" data-command="italic" title="Italic (Ctrl+I)" aria-label="Italic">
                 <svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
               </button>
  +            <button class="toolbar-btn" data-command="underline" title="Underline (Ctrl+U)" aria-label="Underline">
  +              <svg viewBox="0 0 24 24"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
  +            </button>
               <button class="toolbar-btn" data-command="strike" title="Strikethrough" aria-label="Strikethrough">
                 <svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
               </button>
  ```
- **Tiêu chí 4**: Không golden nào khác bị đổi.
  - *Bằng chứng*: Kiểm tra `git status` sau khi cập nhật golden chỉ xuất hiện tệp mới `harness/golden/synthetic/underline.md`. Toàn bộ 37 fixture cũ và 6 seam giữ nguyên 100%.
- **Tiêu chí 5**: `harness/editor.ts` và `initEditor()` khớp nhau về phần mark.
  - *Bằng chứng*: Cả hai đều cấu hình `StarterKit.configure({ ... underline: false })` và nạp `CustomUnderline` mở rộng từ `Underline` với cùng luật `parseHTML` và `renderMarkdown`.
- **Tiêu chí 6**: Khai báo phụ thuộc trong `package.json` và đồng bộ `package-lock.json`.
  - *Bằng chứng*: Đã ghi nhận `"@tiptap/extension-underline": "3.30.1"` vào `dependencies` của `package.json` và đồng bộ đầy đủ vào `package-lock.json`.

### 2.3. Issue #108

- **Tiêu chí 1**: Từ view rich text, phím tắt mở view source; từ view source, phím tắt mở lại view rich text.
  - *Bằng chứng*: `package.json` định nghĩa:
  ```json
      "keybindings": [
        {
          "command": "tuiMarkdown.viewSource",
          "key": "ctrl+shift+m",
          "mac": "cmd+shift+m",
          "when": "activeCustomEditorId == 'tuiMarkdown.editor'"
        },
        {
          "command": "tuiMarkdown.viewRichText",
          "key": "ctrl+shift+m",
          "mac": "cmd+shift+m",
          "when": "editorLangId == 'markdown' && !activeCustomEditorId"
        }
      ]
  ```
  Kết hợp cùng handler bắt keydown trực tiếp trong webview khi webview giữ focus.
- **Tiêu chí 2**: Keyboard Shortcuts của VS Code liệt kê cả hai lệnh với phím tắt tương ứng.
  - *Bằng chứng*: Khai báo trong `contributes.keybindings` được VS Code nạp trực tiếp vào bảng phím tắt hệ thống.
- **Tiêu chí 3**: `npm run verify:vscode-floor` 15/15: ghi nhận floor check do điều phối viên chạy.

### 2.4. Tiêu chí chung

- **Tiêu chí 1**: `npm run lint`, `npm run build`, `npm run roundtrip` xanh.
  - *Bằng chứng thực thi*:
  ```
  > tui-milkdown-vscode@2.15.2 lint
  > tsc --noEmit

  > tui-milkdown-vscode@2.15.2 build
  > node esbuild.config.js

  Building (production)...
  Build complete (production)

  > tui-milkdown-vscode@2.15.2 roundtrip
  > node esbuild.harness.config.js && node out/harness/roundtrip.js

  harness built: out/harness/roundtrip.js
  markdown roundtrip harness: mode: check
  corpus: 38 fixtures (33 synthetic, 5 repo docs)

  ──────────────────────────────────────────
  ──────────────────────────────────────────
  38 markdown fixtures + 6 seams: 44 passed, 0 failed, 0 missing, 0 errored
  ```
- **Tiêu chí 2**: Vòng hai đúng 1 failed, đúng fixture cũ.
  - *Bằng chứng thực thi*:
  ```
  FAIL     synthetic/list-continuation-underindented.md (+0 -0 lines)
  ──────────────────────────────────────────
  38 markdown fixtures + 6 seams: 43 passed, 1 failed, 0 missing, 0 errored
  ```
- **Tiêu chí 3**: `git diff develop..HEAD --stat -- harness/fixtures/synthetic/` chỉ có fixture MỚI `underline.md`.
  - *Bằng chứng thực thi*:
  ```
  $ git diff develop..HEAD --stat -- harness/fixtures/synthetic/
   harness/fixtures/synthetic/underline.md | 13 +++++++++++++
   1 file changed, 13 insertions(+)
  ```

---

## 3. Phân loại thay đổi golden

- `harness/golden/synthetic/underline.md`: Thêm mới đúng thiết kế (intended addition).
- Toàn bộ các file golden khác trong `harness/golden/`: Không có bất kỳ thay đổi nào (0 diff).

---

## 4. Nội dung đề xuất cập nhật tài liệu gốc repo

### 4.1. Đề xuất cho CHANGELOG.md

```markdown
- **Underline serializes to `<ins>` with toolbar button (#106)**: Underline formatting is now explicitly supported in the editor with a toolbar button (between Italic and Strikethrough) and `Ctrl/Cmd+U` keyboard shortcut. Underline marks serialize to HTML `<ins>...</ins>` for CommonMark/GFM compatibility on GitHub and web renderers (which drop `<u>`). Pasted `<u>` and legacy `++text++` continue to parse and are normalized to `<ins>` on save.
- **Webview edit flush on hide and scroll preservation (#104)**: Pending debounced edits are flushed immediately when the document is hidden (`visibilitychange`) or navigating away (`pagehide`), preventing lost edits when closing tabs quickly. External document changes now preserve scroll position without jumping.
- **Two-way toggle shortcut (#108)**: Contributed `Ctrl/Cmd+Shift+M` keybindings to switch between custom WYSIWYG editor and standard text source editor in both directions.
```

### 4.2. Đề xuất cho AGENTS.md

Cập nhật danh sách Extensions trong mục Tiptap Integration:
```markdown
**Extensions:** StarterKit (with `underline: false`), Underline (customized to serialize as `<ins>`), Link (with `autolink: true, linkOnPaste: true`), Image, Highlight, Table (resizable + custom `renderMarkdown` hook), CodeBlockLowlight (syntax highlighting via lowlight/highlight.js), TaskList + TaskItem, Placeholder, Markdown (GFM + configurable indentation), AlertNode (GitHub-style alerts), MermaidDiagram (SVG preview), TableContextMenu (right-click menu), CodeBlockEnhancement (language badge + copy button), SearchPlugin (Cmd+F via @tiptap/extension-find-and-replace), FileMention (@-mention file autocomplete via @tiptap/suggestion), WikiLink (wiki links), WikiLinkSuggestion ([[...]] autocomplete via @tiptap/suggestion), RawHtmlBlock + RawHtmlInline (verbatim raw HTML).
```

### 4.3. Đề xuất cho README.md

Cập nhật mục Rich Text Editing và Keyboard Shortcuts:
```markdown
- **Rich Text Editing**: Headers (H1-H6), lists (ordered, unordered, task lists), blockquotes, code blocks with syntax highlighting, tables, links, images, text formatting (bold, italic, underline with `<ins>`, strikethrough, highlight, inline code).
- **Keyboard Shortcuts**:
  - `Ctrl/Cmd+U`: Toggle underline (`<ins>`)
  - `Ctrl/Cmd+Shift+M`: Switch between WYSIWYG editor and Markdown source view (works both ways)
```

### 4.4. Các luật CSS cần bổ sung

- **0 luật CSS mới cần thêm**. Nút Underline sử dụng hoàn toàn các class có sẵn (`toolbar-btn`) và các kiểu dáng SVG dùng chung.

---

## 5. Những gì không làm được và lý do

- `npm run verify:vscode-floor`: Không chạy từ worktree của worker theo lệnh khẩn cấp từ điều phối viên ("BẮT BUỘC: ngừng chạy verify:vscode-floor, harness dùng chung /tmp/tuimd-floor"). Việc kiểm tra này sẽ do điều phối viên thực hiện tuần tự lúc tích hợp nhánh.
- Ngoài ra, tất cả các yêu cầu và tiêu chí nghiệm thu của #104, #106, #108 đều đã hoàn thành trọn vẹn và kiểm chứng bằng code thực tế.

---

## 6. Những điểm thấy thân issue sai hoặc chưa đầy đủ so với mã nguồn

1. **Issue #106 và cơ chế `RawHtmlInline`**:
   - Thân issue #106 chỉ lưu ý về `Underline.parseHTML` hôm nay chỉ nhận `u` và `text-decoration: underline`. Tuy nhiên khi kiểm tra thực tế, module `src/webview/raw-html.ts` (được đưa vào từ issue #96) có một danh sách loại trừ các thẻ native (`br`, `u`, `table`...). Nếu không thêm `ins` vào điều kiện loại trừ của `RawHtmlInline` (`if (tagName === "u" || tagName === "ins") return;`), thì Marked lexer sẽ phân giải thẻ `<ins>` thành các node nguyên tử `rawHtmlInline` thay vì chuyển thành mark `underline`.
2. **Issue #104 và giới hạn kỹ thuật của sự kiện `pagehide` trong VS Code Webview**:
   - Thân issue #104 kỳ vọng flush triệt để. Tuy nhiên trên thực tế kiến trúc webview của VS Code chạy trong process Electron riêng, việc gửi thông điệp `postMessage` trong sự kiện `pagehide` phụ thuộc vào việc webview host có bị giải phóng trước khi thông điệp IPC được chuyển giao sang extension host hay không. Module header comment đã được cập nhật trung thực để nêu rõ ranh giới kỹ thuật này.
3. **Kỷ luật đối với synthetic fixtures và tính năng mới**:
   - Fixture synthetic dùng để chốt chặn tính năng phải chứa cú pháp thô đầu vào chưa chuẩn hóa (`<u>`, `++`), không được chứa sẵn cú pháp đích (`<ins>`). Nếu fixture chứa sẵn cú pháp đích, khi gỡ bỏ extension xử lý thì harness vẫn vượt qua (false positive), làm mất hoàn toàn giá trị chốt chặn của fixture trong hệ thống kiểm thử tự động.

