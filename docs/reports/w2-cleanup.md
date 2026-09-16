# Báo Cáo Nghiệm Thu: Wave 4 Worker W2 (Cleanup và Di Chuyển CSS)

Báo cáo nghiệm thu kỹ thuật cho nhánh `hoangvantuan/w2-cleanup` thực hiện hai issue #86 và #91.

---

## 1. Tóm Tắt Công Việc Đã Thực Hiện

1. **Issue #86 (Dời stylesheet editor ra khỏi provider)**:
   - Di chuyển nguyên văn 2356 dòng CSS từ khối `<style>` trong `getHtmlForWebview()` (`src/markdownEditorProvider.ts`) sang file mới `src/webview/editor.css`.
   - Bỏ 10 khoảng trắng thụt lề dẫn đầu (vốn thuộc về template literal của TypeScript) để `editor.css` bắt đầu từ cột 0 theo chuẩn CSS. Nội dung bên trong không thay đổi bất kỳ ký tự, thuộc tính hay selector nào (diff văn bản chuẩn hóa rỗng 100%).
   - Xóa bỏ hoàn toàn thẻ `<style>` trong `src/markdownEditorProvider.ts`, chỉ giữ lại thẻ `<link rel="stylesheet" href="${cssUri}">`.
   - Nhập `editor.css` vào `src/webview/main.ts` trước `themes/index.css`. esbuild kết hợp toàn bộ CSS vào `out/webview/main.css` theo đúng thứ tự: CSS editor đứng trước (bắt đầu từ vị trí byte 29), CSS theme đứng sau (vị trí byte 18575), bảo đảm cascade của theme hoạt động chính xác.
   - Cam kết riêng thành commit `09f74f8` theo yêu cầu của spec.

2. **Issue #91 (Dọn dẹp các lỗi vụn)**:
   - Xóa bỏ file chết `src/webview/index.html` (commit `c05a79a`).
   - Thống nhất hàm `escapeHtml`: cập nhật phiên bản tại `src/webview/file-search-utils.ts` để escape đầy đủ 5 ký tự `&`, `<`, `>`, `"`, `'` (thay vì thiếu nháy đơn như trước), xuất hàm này và dùng chung tại `src/webview/main.ts` cùng `src/webview/mermaid-plugin.ts`, đồng thời xóa bỏ hai bản định nghĩa DOM cục bộ (commit `dfeb2e6`).
   - Nâng phiên bản Node.js trong `.github/workflows/publish.yml` từ Node 20 lên Node 22 cho tương thích với `ci.yml` (commit `dfeb2e6`).
   - Thêm chú thích giải thích vai trò của `webviewConfig` cùng cơ chế gộp CSS trong `esbuild.config.js` (commit `dfeb2e6`).
   - Viết chú thích chuẩn hóa list lỏng thành list chặt theo đúng hướng dẫn của điều phối viên tại `BlankLineHandler` trong cả `src/webview/main.ts` và `harness/editor.ts` (commit `abc7f61`).

---

## 2. Kết Quả Các Lệnh Kiểm Tra

### a. `npm run lint`
- Trạng thái: PASS (exit code 0).
- Lệnh: `npm run lint`
- Kết quả:
```
> tui-milkdown-vscode@2.15.2 lint
> tsc --noEmit
```

### b. `npm run build`
- Trạng thái: PASS (exit code 0).
- Lệnh: `npm run build`
- Kết quả:
```
> tui-milkdown-vscode@2.15.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```

### c. `npm run build:dev`
- Trạng thái: PASS (exit code 0).
- Lệnh: `npm run build:dev`
- Kết quả:
```
> tui-milkdown-vscode@2.15.2 build:dev
> node esbuild.config.js --dev

Building (development)...
Build complete (development)
```

### d. `npm run roundtrip`
- Trạng thái: PASS (exit code 0).
- Lệnh: `npm run roundtrip`
- Kết quả:
```
> tui-milkdown-vscode@2.15.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness : mode: check
corpus: 37 fixtures (32 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
37 markdown fixtures + 6 seams: 43 passed, 0 failed, 0 missing, 0 errored
```

### e. Kiểm tra ổn định vòng hai (Idempotency check)
- Lệnh:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/
npm run roundtrip
git checkout -- harness/fixtures/synthetic/
```
- Kết quả:
```
FAIL     synthetic/list-continuation-underindented.md (+0 -0 lines)
...
37 markdown fixtures + 6 seams: 42 passed, 1 failed, 0 missing, 0 errored
```
- Đánh giá: Đúng chính xác 1 failed (`synthetic/list-continuation-underindented.md`, issue #109 thuộc phạm vi của W3). Số lượng và fixture thất bại giữ nguyên 100% so với baseline ban đầu của `develop`.

### f. `npm run verify:vscode-floor`
- Ghi chú: floor check do điều phối viên chạy.
- Lý do: Theo chỉ thị khẩn giữa sóng của điều phối viên, `harness/vscode-floor/run.mjs` dùng chung thư mục `/tmp/tuimd-floor`, gây xung đột IPC và ghi đè dữ liệu khi nhiều worker chạy song song. Điều phối viên sẽ chạy kiểm tra này lần lượt từng nhánh khi merge.
- (Trước khi có chỉ thị ngừng chạy, lệnh đã được thực thi độc lập một lần và đạt kết quả 15/15 checks pass, trong đó có check `no CSP violation in the console`).

---

## 3. Bằng Chứng Từng Tiêu Chí Nghiệm Thu (Observable Acceptance)

### Tiêu chí 1: Không còn thẻ `<style>` trong `src/markdownEditorProvider.ts`, `src/webview/editor.css` tồn tại
- Lệnh:
```bash
grep -n "<style>" src/markdownEditorProvider.ts
```
- Kết quả: Exit code 1 (không có dòng nào chứa `<style>`).
- Lệnh kiểm tra sự tồn tại của `src/webview/editor.css`:
```bash
wc -l src/webview/editor.css
```
- Kết quả: `2356 src/webview/editor.css`.

### Tiêu chí 2: Diff văn bản CSS trước và sau rỗng ngoài việc dời
- Lệnh kiểm tra:
```bash
git show develop:src/markdownEditorProvider.ts | sed -n '1393,3748p' > /tmp/css-before.txt
sed -e 's/^          //' /tmp/css-before.txt > /tmp/css-before-normalized.txt
diff -u /tmp/css-before-normalized.txt src/webview/editor.css
```
- Kết quả: Rỗng hoàn toàn (exit code 0, không có bất kỳ dòng khác biệt nào).
- Lệnh kiểm tra bỏ qua khoảng trắng (`diff -w`):
```bash
diff -w /tmp/css-before.txt src/webview/editor.css
```
- Kết quả: Rỗng hoàn toàn (exit code 0). Điều này chứng minh 2356 dòng CSS được giữ nguyên vẹn 100%, chỉ loại bỏ 10 khoảng trắng thụt lề dẫn đầu của template string.

### Tiêu chí 3: Thứ tự nạp CSS: editor trước theme
- Lệnh kiểm tra trong bundle phát ra bởi esbuild (`out/webview/main.css`):
```bash
node -e "
const fs = require('fs');
const css = fs.readFileSync('out/webview/main.css', 'utf8');
const editorIndex = css.indexOf('--heading-h1-size');
const themeIndex = css.indexOf('.theme-nord');
console.log('editor CSS index:', editorIndex);
console.log('theme CSS index:', themeIndex);
if (editorIndex < themeIndex) console.log('ORDER VERIFIED: editor is BEFORE theme');
"
```
- Kết quả:
```
editor CSS index: 29
theme CSS index: 18575
ORDER VERIFIED: editor is BEFORE theme
```
- Đánh giá: Thứ tự xuất hiện trong bundle được bảo toàn tuyệt đối, CSS editor làm nền tảng và CSS theme ghi đè lên trên.

### Tiêu chí 4: `src/webview/index.html` đã bị xóa
- Lệnh:
```bash
git status --short src/webview/index.html
```
- Kết quả: File đã bị xóa khỏi cây thư mục (commit `c05a79a`).

### Tiêu chí 5: Đúng một định nghĩa `escapeHtml` duy nhất trong `src/webview/` và escape cả `'`
- Lệnh kiểm tra định nghĩa:
```bash
grep -rn "function escapeHtml\|const escapeHtml" src/webview/
```
- Kết quả:
```
src/webview/file-search-utils.ts:26:export function escapeHtml(text: string): string {
```
- Nội dung hàm tại `src/webview/file-search-utils.ts`:
```ts
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```
- Đánh giá: Thoát đầy đủ cả 5 ký tự đặc biệt của HTML bao gồm dấu nháy đơn (`'`), không dùng DOM API nên chạy an toàn cả trên môi trường Node.js (harness) lẫn trình duyệt.

### Tiêu chí 6: `publish.yml` chạy Node 22
- Lệnh kiểm tra:
```bash
git diff develop:./.github/workflows/publish.yml .github/workflows/publish.yml
```
- Kết quả:
```diff
@@ -15,7 +15,7 @@ jobs:
       - name: Setup Node.js
         uses: actions/setup-node@v4
         with:
-          node-version: '20'
+          node-version: '22'
           cache: 'npm'
```

### Tiêu chí 7: Chú thích chuẩn hóa list lỏng nằm đúng chỗ
- Vị trí: Đặt tại `BlankLineHandler` trong `src/webview/main.ts` (dòng 137) và `harness/editor.ts` (dòng 139) theo chỉ thị cụ thể của điều phối viên qua lệnh `orca orchestration ask`.
- Nội dung chú thích:
```ts
// Loose list normalization (#91):
// A loose list (`- a\n\n- b`) is serialized back as a tight list (`- a\n- b`).
// This behavior originates upstream in @tiptap/extension-list (bulletList /
// orderedList serializers join child items with '\n', not '\n\n') rather than
// in our own code, so it cannot be customized here.
// Per CONTEXT.md, this is an accepted Normalized change: surface syntax is
// allowed to normalize on first save as long as it reaches a fixed point and
// remains stable from the second save onward, which it does.
```

### Tiêu chí 8: Khóa chặn fixture tổng hợp
- Lệnh kiểm tra:
```bash
git diff develop..HEAD --stat -- harness/fixtures/synthetic/
```
- Kết quả: Rỗng hoàn toàn (không có fixture nào bị sửa đổi hay thay thế).

---

## 4. Phân Loại Thay Đổi Golden

- Toàn bộ 37 fixture và 6 seam giữ nguyên kết quả, không có bất kỳ file golden nào bị thay đổi diff:
  - Golden sửa đổi: 0
  - Golden mới thêm: 0
  - Hồi quy (Regression): 0

---

## 5. Những Điểm Khác Biệt Giữa Mã Nguồn Và Thân Issue

1. **Khái niệm "chỗ serialize list" trong issue #91**:
   - Thân issue #91 yêu cầu "viết comment đầu chỗ serialize list". Tuy nhiên kiểm tra mã nguồn thực tế cho thấy repo không có module nào tự serialize danh sách thông thường; việc này do thư viện upstream `@tiptap/extension-list` (`bulletList.renderMarkdown` và `orderedList.renderMarkdown`) thực hiện bằng cách nối các phần tử con bằng `\n`.
   - Việc tự ý tạo thêm extension mới chỉ để treo comment là không phù hợp (nghịch duyên) và có thể gây xung đột với worker W3 đang xử lý issue #109.
   - Sau khi trao đổi qua lệnh `orca orchestration ask`, điều phối viên đã chỉ định vị trí chính xác nhất là khối chú thích của `BlankLineHandler` (nơi quản lý các token dòng trống giữa các khối trong tài liệu Markdown) trong cả `src/webview/main.ts` và `harness/editor.ts`.

2. **Xung đột trong harness `verify:vscode-floor`**:
   - Khi chạy song song nhiều worker, `harness/vscode-floor/run.mjs` sử dụng đường dẫn cố định `/tmp/tuimd-floor` dẫn đến việc các worker ghi đè dữ liệu của nhau. Điều phối viên đã phát thông báo khẩn yêu cầu toàn bộ worker dừng chạy lệnh này và chuyển việc xác thực sang giai đoạn merge từng nhánh.

---

## 6. Đề Xuất Bổ Sung Văn Bản Gốc (Áp Dụng Sau Merge)

Theo Ràng buộc chung số 1, worker không được sửa các file `.md` ở gốc repo. Dưới đây là nội dung chuẩn xác đề xuất cho điều phối viên:

### a. Đề xuất cho `README.md`
1. Cập nhật badge phiên bản tại dòng 9:
```markdown
  [![Version](https://img.shields.io/badge/version-2.15.2-blue?style=flat-square)](CHANGELOG.md)
```
2. Bổ sung mục Wiki links vào phần Features (dưới mục `Writing Experience`):
```markdown
- **Wiki Links ([[...]])** : Type `[[` to autocomplete and link to workspace documents
```

### b. Đề xuất cho `AGENTS.md`
1. Cập nhật cây thư mục `src/webview/`:
   - Xóa dòng:
     ```
     ├── index.html            # HTML template for webview (loaded by markdownEditorProvider)
     ```
   - Thêm các dòng mới:
     ```
     ├── editor.css            # Base editor styles (layout, toolbar, tiptap, popups, print)
     ├── css-modules.d.ts      # TypeScript ambient declarations for *.css imports
     ```
2. Cập nhật mục **Configuration Settings**:
   - Bổ sung hai cài đặt:
     ```markdown
     - `chromiumPath` (string, default: `""`) : Custom path to Chromium/Chrome executable for PDF export
     - `exportPageSize` (`"A4"` | `"Letter"`, default: `"A4"`) : Page size for PDF export
     ```
3. Cập nhật mục **Tiptap Integration**:
   - Cập nhật danh sách extensions để ghi nhận Underline đi kèm StarterKit:
     ```markdown
     **Extensions:** StarterKit (includes Underline, and Link with `autolink: true, linkOnPaste: true`), Image, ...
     ```

### c. Đề xuất cho `CHANGELOG.md`
Thêm vào phiên bản hiện tại trong `CHANGELOG.md`:
```markdown
- **Editor CSS extracted to separate stylesheet (#86)**: The 2356-line `<style>` block in `markdownEditorProvider.ts` has been moved to `src/webview/editor.css` and imported via `src/webview/main.ts`, bundled into `out/webview/main.css` before theme stylesheets to preserve cascade order.
- **Cleanup and consistency improvements (#91)**:
  - Removed dead template file `src/webview/index.html`.
  - Unified three divergent `escapeHtml` implementations into a single safe implementation in `src/webview/file-search-utils.ts` escaping `&`, `<`, `>`, `"`, and `'`.
  - Upgraded GitHub Actions workflow `.github/workflows/publish.yml` from Node 20 to Node 22 to match `ci.yml`.
  - Documented loose list normalization rationale at `BlankLineHandler`.
```
