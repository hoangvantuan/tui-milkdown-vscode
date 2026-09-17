# Báo cáo hoàn thành nhiệm vụ W1: Slash command menu và Find/Replace (#114, #115)

## 1. Tóm tắt những việc đã làm

- **#114 (Slash command menu `/` for block insertion)**:
  - Tạo mới extension `src/webview/slash-command-plugin.ts` sử dụng `@tiptap/suggestion` và `SuggestionPopup` dùng chung từ `src/webview/suggestion-popup.ts`.
  - Cấu hình kích hoạt nghiêm ngặt: chỉ mở menu khi người dùng gõ ký tự `/` tại vị trí bắt đầu của một đoạn văn rỗng (`$from.parentOffset === 0 && $from.parent.textContent.length === range.to - range.from`), không kích hoạt khi gõ `/` ở giữa văn bản hoặc trong các block khác.
  - Hỗ trợ đầy đủ 17 mục chèn khối theo đúng yêu cầu:
    - Heading 1, Heading 2, Heading 3
    - Bullet list, Numbered list, Task list
    - Table (3x3 tiêu chuẩn)
    - Code block
    - Mermaid diagram (khối code block ngôn ngữ mermaid)
    - 5 loại GitHub alerts: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
    - Image
    - Quote (blockquote)
    - Horizontal rule (chuẩn hóa thành `---`, không tự tạo node mới)
  - Tích hợp tìm kiếm mờ (fuzzy filtering) qua `fuzzysort` dựa trên `title`, `description` và `keywords` phong phú.
  - Render icon SVG rõ nét, giao diện bo góc hiện đại hài hòa với toàn bộ các theme (Light/Dark).
  - Tích hợp vào danh sách extension trong `initEditor()` tại `src/webview/main.ts`.
  - Viết harness seam `harness/slash-seam.ts` ghi nhận kết quả serialized markdown và node type của cả 17 mục, hoàn thành kiểm tra răng (17/17 ca đỏ khi gỡ extension).

- **#115 (Find and Replace in the search bar)**:
  - Nâng cấp `src/webview/search-plugin.ts`: bổ sung phím tắt `Mod-h` (phát ra custom event `toggle-search-bar` với `{ showReplace: true }`), các hàm điều khiển `setCaseSensitivity`, `getCaseSensitivity`, `setReplaceTerm`, `replaceCurrent`, `replaceAllMatches`.
  - Cập nhật khối HTML `#search-bar` trong `src/markdownEditorProvider.ts`: bổ sung nút mũi tên chevron để mở rộng/thu gọn hàng Replace, nút chuyển đổi phân biệt hoa thường (`Aa`), ô nhập Replace (`#replace-input`), nút Replace (`#replace-btn`), và nút Replace All (`#replace-all-btn`).
  - Cập nhật `setupSearchBar()` trong `src/webview/main.ts`: hỗ trợ đóng mở hàng Replace linh hoạt qua nút chevron hoặc phím tắt `Mod-h`, điều khiển trạng thái tìm kiếm phân biệt hoa/thường, phím tắt `Enter` để Replace một kết quả, `Alt+Enter` để Replace All, `Escape` để đóng thanh tìm kiếm.
  - Bổ sung CSS trong `src/webview/editor.css` cho giao diện 2 dòng gọn gàng, hiệu ứng xoay chevron, trạng thái active của nút `Aa`, khoảng thụt lề hàng dưới thẳng hàng với ô tìm kiếm.
  - Viết harness seam `harness/replace-seam.ts` kiểm tra 10 ca toàn diện: không khớp (replace / replaceAll), một kết quả khớp, nhiều kết quả khớp, bật/tắt phân biệt hoa thường, và chuỗi thay thế chứa ký tự markdown đặc biệt (`**`, `[]()`, `#`, `` ` ``).
  - Hoàn thành kiểm tra răng cho `harness/replace-seam.ts`: phá đường replace khiến đúng 8/10 ca đỏ (2 ca không khớp giữ nguyên).

---

## 2. Danh sách file và thay đổi

Lệnh sinh danh sách thay đổi so với merge-base:
```bash
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat
```

Output:
```
 harness/golden/seams/replace.txt    |  44 ++++-
 harness/golden/seams/slash.txt      |  21 ++-
 harness/replace-seam.ts             | 155 +++++++++++++--
 harness/slash-seam.ts               |  53 ++++--
 src/markdownEditorProvider.ts       |  42 +++--
 src/webview/editor.css              | 120 +++++++++++-
 src/webview/main.ts                 | 109 ++++++++++-
 src/webview/search-plugin.ts        |  60 +++++-
 src/webview/slash-command-plugin.ts | 367 ++++++++++++++++++++++++++++++++++++
 9 files changed, 918 insertions(+), 53 deletions(-)
```

### Danh sách hàm và export được bổ sung

Lệnh sinh export của `src/webview/slash-command-plugin.ts`:
```bash
grep -n -E "export (const|function|class|type|interface)" src/webview/slash-command-plugin.ts
```
Output:
```
28:export interface SlashCommandItem {
40:export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
242:export function filterSlashCommands(query: string): SlashCommandItem[] {
262:export function executeSlashCommand(
312:export const SlashCommand = Extension.create({
```

Danh sách 17 mục slash command được định nghĩa:
```bash
grep -n "id:" src/webview/slash-command-plugin.ts
```
Output:
```
29:  id: string;
42:    id: "heading-1",
52:    id: "heading-2",
62:    id: "heading-3",
72:    id: "bullet-list",
82:    id: "numbered-list",
92:    id: "task-list",
102:    id: "table",
112:    id: "code-block",
122:    id: "mermaid",
135:    id: "alert-note",
149:    id: "alert-tip",
163:    id: "alert-important",
177:    id: "alert-warning",
191:    id: "alert-caution",
205:    id: "image",
215:    id: "quote",
225:    id: "horizontal-rule",
```

Lệnh sinh export của `src/webview/search-plugin.ts`:
```bash
grep -n -E "export (const|function|class|type|interface)" src/webview/search-plugin.ts
```
Output:
```
8:export interface SearchMatchInfo {
37:export const SearchPlugin = FindAndReplace.extend({
65:export function performSearch(editor: Editor, queryText: string): void {
76:export function setCaseSensitivity(editor: Editor, caseSensitive: boolean): void {
87:export function getCaseSensitivity(editor: Editor): boolean {
92:export function setReplaceTerm(editor: Editor, term: string): void {
101:export function replaceCurrent(editor: Editor, replaceText?: string): boolean {
117:export function replaceAllMatches(editor: Editor, replaceText?: string): boolean {
125:export function clearSearch(editor: Editor): void {
130:export function searchNext(editor: Editor): void {
137:export function searchPrev(editor: Editor): void {
185:export function getMatchInfo(editor: Editor): SearchMatchInfo {
```

---

## 3. Ranh giới sở hữu code

Theo quy định tại `.wave7-spec/COMMON.md` và `.wave7-spec/TASK.md`:
1. `src/markdownEditorProvider.ts`: Chỉ chỉnh sửa khối `#search-bar`, không chạm vào phần nào khác ngoài khối này để không gây xung đột với W2 và W3.
2. `src/webview/main.ts`: Chỉ chỉnh sửa hàm `setupSearchBar()` và danh sách extension trong `initEditor()`.
3. `src/webview/suggestion-popup.ts`: Không sửa đổi, sử dụng lớp `SuggestionPopup` nguyên bản.
4. `src/shared/messages.ts` và `src/host/messageHandlers.ts`: Hoàn toàn không chỉnh sửa.
5. `harness/editor.ts` và `harness/roundtrip.ts`: Hoàn toàn không chỉnh sửa.
6. `package.json`: Hoàn toàn không thêm bớt dependency mới.
7. Không chỉnh sửa bất kỳ file `.md` nào ở gốc repository.

---

## 4. Bằng chứng nghiệm thu từng Issue

### 4.1. Issue #114: Slash command menu (`/`) for block insertion

- **Tiêu chí 1: `harness/slash-seam.ts` ghi nhận kết quả từng entry trên tài liệu rỗng**
  - Thực thi: `harness/slash-seam.ts` chạy `executeSlashCommand` trên từng entry trong danh sách 17 mục, ghi nhận `ok`, `node` type, và `md` output.
  - Kết quả golden tại `harness/golden/seams/slash.txt`:
```
slash command seam: markdown output per menu entry on empty document
one line per entry: [id] ok=... node=... md=...

[heading-1] ok=true node=heading(h1) md=""
[heading-2] ok=true node=heading(h2) md=""
[heading-3] ok=true node=heading(h3) md=""
[bullet-list] ok=true node=bulletList md="- \n"
[numbered-list] ok=true node=orderedList md="1. \n"
[task-list] ok=true node=taskList md="- [ ] \n"
[table] ok=true node=table md="|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n\n"
[code-block] ok=true node=codeBlock md="```\n\n```\n"
[mermaid] ok=true node=codeBlock(mermaid) md="```mermaid\n\n```\n"
[alert-note] ok=true node=alert(NOTE) md="> [!NOTE]\n>\n>\n"
[alert-tip] ok=true node=alert(TIP) md="> [!TIP]\n>\n>\n"
[alert-important] ok=true node=alert(IMPORTANT) md="> [!IMPORTANT]\n>\n>\n"
[alert-warning] ok=true node=alert(WARNING) md="> [!WARNING]\n>\n>\n"
[alert-caution] ok=true node=alert(CAUTION) md="> [!CAUTION]\n>\n>\n"
[image] ok=true node=image md="![]()\n"
[quote] ok=true node=blockquote md=">\n"
[horizontal-rule] ok=true node=horizontalRule md="---\n"
```

- **Tiêu chí 2: Chứng minh RĂNG cho `harness/slash-seam.ts`**
  - Thao tác: Gỡ `SlashCommand` khỏi cấu hình harness editor (`extraExtensions: []`).
  - Lệnh chạy:
```bash
sed -i '' 's/extraExtensions: \[SlashCommand\]/extraExtensions: \[\]/' harness/slash-seam.ts && node esbuild.harness.config.js && node out/harness/roundtrip.js; git checkout -- harness/slash-seam.ts
```
  - Output khi gỡ extension (chính xác **17 trên 17 ca đỏ**, toàn bộ chuyển sang `ok=false node=paragraph md="/"`):
```
harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

──────────────────────────────────────────
FAIL     seams/slash.txt (+0 -0 lines)
  --- golden/seams/slash.txt
  +++ current/seams/slash.txt
  @@ -1,21 +1,21 @@
   slash command seam: markdown output per menu entry on empty document
   one line per entry: [id] ok=... node=... md=...
   
  -[heading-1] ok=true node=heading(h1) md=""
  -[heading-2] ok=true node=heading(h2) md=""
  -[heading-3] ok=true node=heading(h3) md=""
  -[bullet-list] ok=true node=bulletList md="- \n"
  -[numbered-list] ok=true node=orderedList md="1. \n"
  -[task-list] ok=true node=taskList md="- [ ] \n"
  -[table] ok=true node=table md="|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n\n"
  -[code-block] ok=true node=codeBlock md="```\n\n```\n"
  -[mermaid] ok=true node=codeBlock(mermaid) md="```mermaid\n\n```\n"
  -[alert-note] ok=true node=alert(NOTE) md="> [!NOTE]\n>\n>\n"
  -[alert-tip] ok=true node=alert(TIP) md="> [!TIP]\n>\n>\n"
  -[alert-important] ok=true node=alert(IMPORTANT) md="> [!IMPORTANT]\n>\n>\n"
  -[alert-warning] ok=true node=alert(WARNING) md="> [!WARNING]\n>\n>\n"
  -[alert-caution] ok=true node=alert(CAUTION) md="> [!CAUTION]\n>\n>\n"
  -[image] ok=true node=image md="![]()\n"
  -[quote] ok=true node=blockquote md=">\n"
  -[horizontal-rule] ok=true node=horizontalRule md="---\n"
  +[heading-1] ok=false node=paragraph md="/"
  +[heading-2] ok=false node=paragraph md="/"
  +[heading-3] ok=false node=paragraph md="/"
  +[bullet-list] ok=false node=paragraph md="/"
  +[numbered-list] ok=false node=paragraph md="/"
  +[task-list] ok=false node=paragraph md="/"
  +[table] ok=false node=paragraph md="/"
  +[code-block] ok=false node=paragraph md="/"
  +[mermaid] ok=false node=paragraph md="/"
  +[alert-note] ok=false node=paragraph md="/"
  +[alert-tip] ok=false node=paragraph md="/"
  +[alert-important] ok=false node=paragraph md="/"
  +[alert-warning] ok=false node=paragraph md="/"
  +[alert-caution] ok=false node=paragraph md="/"
  +[image] ok=false node=paragraph md="/"
  +[quote] ok=false node=paragraph md="/"
  +[horizontal-rule] ok=false node=paragraph md="/"
   

──────────────────────────────────────────
39 markdown fixtures + 12 seams: 50 passed, 1 failed, 0 missing, 0 errored
```
  - Khi khôi phục: `51 passed, 0 failed`.

- **Tiêu chí 3: Bộ kiểm tra tự động giữ màu xanh**
  - `npm run lint`, `npm run build`, `npm run roundtrip` đều pass sạch sẽ.

---

### 4.2. Issue #115: Find and Replace in the search bar

- **Tiêu chí 1: `harness/replace-seam.ts` ghi nhận kết quả thay thế cho bảng test case đa dạng**
  - Bao gồm: không khớp (replace và replaceAll), một kết quả khớp, nhiều kết quả khớp, toggle phân biệt chữ hoa/chữ thường bật và tắt, và chuỗi thay thế chứa ký tự cú pháp markdown.
  - Kết quả golden tại `harness/golden/seams/replace.txt`:
```
find-and-replace seam: document text after replace / replaceAll
observes the markdown string after replacement operations

[no-match-replace] search="cat" replace="tiger" action=replace caseSensitive=false ok=false
  initial: "The quick brown fox jumps over the lazy dog."
  actual:  "The quick brown fox jumps over the lazy dog."

[no-match-replace-all] search="cat" replace="tiger" action=replaceAll caseSensitive=false ok=false
  initial: "The quick brown fox jumps over the lazy dog."
  actual:  "The quick brown fox jumps over the lazy dog."

[one-match-replace] search="world" replace="friend" action=replace caseSensitive=false ok=true
  initial: "Hello world from VS Code."
  actual:  "Hello friend from VS Code."

[one-match-replace-all] search="world" replace="friend" action=replaceAll caseSensitive=false ok=true
  initial: "Hello world from VS Code."
  actual:  "Hello friend from VS Code."

[several-matches-replace-one] search="foo" replace="qux" action=replace caseSensitive=false ok=true
  initial: "foo bar foo baz foo"
  actual:  "qux bar foo baz foo"

[several-matches-replace-all] search="foo" replace="qux" action=replaceAll caseSensitive=false ok=true
  initial: "foo bar foo baz foo"
  actual:  "qux bar qux baz qux"

[case-toggle-off] search="foo" replace="bar" action=replaceAll caseSensitive=false ok=true
  initial: "Case test: Foo foo FOO."
  actual:  "Case test: bar bar bar."

[case-toggle-on] search="foo" replace="bar" action=replaceAll caseSensitive=true ok=true
  initial: "Case test: Foo foo FOO."
  actual:  "Case test: Foo bar FOO."

[markdown-syntax-in-replacement] search="replaced" replace="**bold** and [link](<url>) and # h1" action=replace caseSensitive=false ok=true
  initial: "Normal text to be replaced here."
  actual:  "Normal text to be \\*\\*bold\\*\\* and \\[link\\](&lt;url&gt;) and # h1 here."

[markdown-syntax-in-replacement-all] search="alpha" replace="*italic* and `code`" action=replaceAll caseSensitive=false ok=true
  initial: "Alpha beta alpha gamma."
  actual:  "\\*italic\\* and \\`code\\` beta \\*italic\\* and \\`code\\` gamma."
```

- **Tiêu chí 2: Chứng minh RĂNG cho `harness/replace-seam.ts`**
  - Thao tác: Vô hiệu hóa lệnh thay thế trong `src/webview/search-plugin.ts` (`replaceCurrent` trả về `false`, `replaceAllMatches` trả về `false`).
  - Lệnh chạy:
```bash
node -e '
const fs = require("fs");
const file = "src/webview/search-plugin.ts";
let content = fs.readFileSync(file, "utf8");
content = content.replace("const ok = editor.commands.replace();", "const ok = false;");
content = content.replace("return editor.commands.replaceAll();", "return false;");
fs.writeFileSync(file, content);
' && node esbuild.harness.config.js && node out/harness/roundtrip.js; git checkout -- src/webview/search-plugin.ts
```
  - Output khi vô hiệu hóa (chính xác **8 trên 10 ca đổi và đỏ**, 2 ca no-match giữ nguyên như kỳ vọng):
```
harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

──────────────────────────────────────────
FAIL     seams/replace.txt (+0 -0 lines)
  --- golden/seams/replace.txt
  +++ current/seams/replace.txt
  @@ -9,36 +9,36 @@
     initial: "The quick brown fox jumps over the lazy dog."
     actual:  "The quick brown fox jumps over the lazy dog."
   
  -[one-match-replace] search="world" replace="friend" action=replace caseSensitive=false ok=true
  +[one-match-replace] search="world" replace="friend" action=replace caseSensitive=false ok=false
     initial: "Hello world from VS Code."
  -  actual:  "Hello friend from VS Code."
  +  actual:  "Hello world from VS Code."
   
  -[one-match-replace-all] search="world" replace="friend" action=replaceAll caseSensitive=false ok=true
  +[one-match-replace-all] search="world" replace="friend" action=replaceAll caseSensitive=false ok=false
     initial: "Hello world from VS Code."
  -  actual:  "Hello friend from VS Code."
  +  actual:  "Hello world from VS Code."
   
  -[several-matches-replace-one] search="foo" replace="qux" action=replace caseSensitive=false ok=true
  +[several-matches-replace-one] search="foo" replace="qux" action=replace caseSensitive=false ok=false
     initial: "foo bar foo baz foo"
  -  actual:  "qux bar foo baz foo"
  +  actual:  "foo bar foo baz foo"
   
  -[several-matches-replace-all] search="foo" replace="qux" action=replaceAll caseSensitive=false ok=true
  +[several-matches-replace-all] search="foo" replace="qux" action=replaceAll caseSensitive=false ok=false
     initial: "foo bar foo baz foo"
  -  actual:  "qux bar qux baz qux"
  +  actual:  "foo bar foo baz foo"
   
  -[case-toggle-off] search="foo" replace="bar" action=replaceAll caseSensitive=false ok=true
  +[case-toggle-off] search="foo" replace="bar" action=replaceAll caseSensitive=false ok=false
     initial: "Case test: Foo foo FOO."
  -  actual:  "Case test: bar bar bar."
  +  actual:  "Case test: Foo foo FOO."
   
  -[case-toggle-on] search="foo" replace="bar" action=replaceAll caseSensitive=true ok=true
  +[case-toggle-on] search="foo" replace="bar" action=replaceAll caseSensitive=true ok=false
     initial: "Case test: Foo foo FOO."
  -  actual:  "Case test: Foo bar FOO."
  +  actual:  "Case test: Foo foo FOO."
   
  -[markdown-syntax-in-replacement] search="replaced" replace="**bold** and [link](<url>) and # h1" action=replace caseSensitive=false ok=true
  +[markdown-syntax-in-replacement] search="replaced" replace="**bold** and [link](<url>) and # h1" action=replace caseSensitive=false ok=false
     initial: "Normal text to be replaced here."
  -  actual:  "Normal text to be \\*\\*bold\\*\\* and \\[link\\](&lt;url&gt;) and # h1 here."
  +  actual:  "Normal text to be replaced here."
   
  -[markdown-syntax-in-replacement-all] search="alpha" replace="*italic* and `code`" action=replaceAll caseSensitive=false ok=true
  +[markdown-syntax-in-replacement-all] search="alpha" replace="*italic* and `code`" action=replaceAll caseSensitive=false ok=false
     initial: "Alpha beta alpha gamma."
  -  actual:  "\\*italic\\* and \\`code\\` beta \\*italic\\* and \\`code\\` gamma."
  +  actual:  "Alpha beta alpha gamma."
   
   

──────────────────────────────────────────
39 markdown fixtures + 12 seams: 50 passed, 1 failed, 0 missing, 0 errored
```
  - Khi khôi phục: `51 passed, 0 failed`.

- **Tiêu chí 3: Bộ kiểm tra tự động giữ màu xanh**
  - `npm run lint`, `npm run build`, `npm run roundtrip` đều pass sạch sẽ.

---

## 5. Tiêu chí chưa kiểm được hoặc giới hạn môi trường

- **Tương tác trực tiếp bằng tay trên giao diện webview thực tế**:
  - Giao diện slash command popup và thao tác click chuột/phím mũi tên trên popup thực tế phụ thuộc vào việc người dùng tương tác trong cửa sổ webview trực tiếp.
  - Chúng tôi đã kiểm tra kích hoạt logic và chèn node qua seam test tự động và chạy `npm run verify:vscode-floor` (mở môi trường VS Code 1.85.0 thực tế) để bảo đảm webview tải và mount hoàn toàn không có lỗi CSP, không có ngoại lệ DOM hoặc lỗi khởi tạo editor nào.

---

## 6. Đề xuất cập nhật tài liệu cho điều phối viên (áp dụng sau khi merge)

Vì worker bị cấm sửa đổi các file markdown ở gốc repository, dưới đây là nội dung chuẩn bị sẵn để điều phối viên cập nhật vào các tài liệu tương ứng sau khi tích hợp:

### 6.1. Cập nhật `CHANGELOG.md`
```markdown
### Added
- Slash command menu (`/`): type `/` at the start of an empty paragraph to open block insertion popup (Headings 1-3, Bullet/Numbered/Task lists, Table, Code block, Mermaid diagram, GitHub alerts, Image, Quote, Horizontal rule) (#114).
- Find and Replace in search bar: toggle replace row via chevron button or `Cmd+H` (`Ctrl+H`), replace current match (`Enter`), replace all matches (`Alt+Enter`), and case-sensitive matching toggle (`Aa`) (#115).
```

### 6.2. Cập nhật `README.md`
```markdown
### Keyboard Shortcuts & Editing
- **Slash commands**: Type `/` on an empty line to quickly insert blocks (headings, lists, tables, code blocks, mermaid diagrams, alerts, images, quotes, and horizontal rules).
- **Find and Replace**: Press `Cmd+H` (or `Ctrl+H`) or click the chevron in the search bar to reveal Replace options. Supports single replace (`Enter`), replace all (`Alt+Enter`), and case-sensitive search toggle (`Aa`).
```

### 6.3. Cập nhật `AGENTS.md`
Trong phần File Structure:
```markdown
│   ├── slash-command-plugin.ts # Slash command menu for block insertion via @tiptap/suggestion (#114)
```
Trong phần Tiptap Integration (danh sách Extensions):
```markdown
SlashCommand (block insertion menu via /), SearchPlugin (Cmd+F search and Cmd+H replace via @tiptap/extension-find-and-replace with case-sensitivity and replace all)
```

---

## 7. Toàn bộ kết quả kiểm tra trước khi gửi `worker_done`

### 7.1. `npm run lint`
```
> tui-milkdown-vscode@2.16.0 lint
> tsc --noEmit
```

### 7.2. `npm run build`
```
> tui-milkdown-vscode@2.16.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```

### 7.3. `npm test`
```
> tui-milkdown-vscode@2.16.0 test
> node esbuild.harness.config.js --test && node --test "out/test/**/*.test.js"

harness built: out/test
▶ frontmatter-parser
  ▶ 1. standard frontmatter
    ✔ parses valid standard frontmatter (1.433041ms)
    ✔ parses standard frontmatter with invalid YAML as isValid: false (0.336625ms)
    ✔ reconstructs standard frontmatter to exact input when unchanged (0.164292ms)
  ✔ 1. standard frontmatter (2.282208ms)
  ▶ 2. implicit frontmatter
    ✔ parses valid implicit frontmatter with known keys (0.255458ms)
    ✔ does not treat markdown without known keys or <2 keys as implicit frontmatter (0.112791ms)
    ✔ reconstructs implicit frontmatter verbatim when unchanged (0.109041ms)
    ✔ falls back to canonical implicit template when edited (0.080584ms)
  ✔ 2. implicit frontmatter (0.9745ms)
  ▶ 3. empty frontmatter
    ✔ parses empty delimiters (---\n---) (0.060084ms)
    ✔ replays empty delimiters verbatim when unchanged (0.071459ms)
    ✔ returns safeBody when frontmatter is trimmed empty and rawBlock does not match (0.052209ms)
  ✔ 3. empty frontmatter (0.272625ms)
  ▶ 4. comment-only frontmatter
    ✔ parses comment-only standard frontmatter as valid (0.063041ms)
    ✔ parses blank-line-only standard frontmatter as valid (0.037833ms)
    ✔ verifies isBlankOrCommentOnly helper correctly identifies comment/blank lines (0.035584ms)
  ✔ 4. comment-only frontmatter (0.195292ms)
  ▶ 5. rawBlock replay
    ✔ preserves trailing whitespace on delimiter lines (0.094875ms)
    ✔ preserves zero blank lines between closing delimiter and body (0.053875ms)
    ✔ preserves multiple blank lines between closing delimiter and body (0.0455ms)
    ✔ discards rawBlock and falls back to canonical template when frontmatter is edited (0.040458ms)
    ✔ returns unmodified body when frontmatter is null (0.018583ms)
    ✔ handles inputs exceeding MAX_FILE_SIZE gracefully (0.024708ms)
    ✔ handles empty and non-string inputs safely (0.022958ms)
  ✔ 5. rawBlock replay (0.365708ms)
✔ frontmatter-parser (4.354583ms)
▶ image-rename-handler
  ▶ path helpers
    ✔ normalizePath normalizes backslashes, leading ./, and multiple slashes (1.163666ms)
    ✔ hasPathTraversal detects traversal and absolute paths (0.621208ms)
  ✔ path helpers (2.140792ms)
  ▶ detectImageRenames
    ✔ detects image rename within the same folder when source file exists (0.986542ms)
    ✔ does NOT detect rename when directory changes (different folder) (1.140417ms)
    ✔ does NOT detect rename when path has path traversal (0.644625ms)
    ✔ does NOT detect rename when source file does not exist on disk (0.377042ms)
    ✔ does NOT detect rename when original path was not removed from document (0.594083ms)
  ✔ detectImageRenames (3.906917ms)
  ▶ executeImageRenames
    ✔ renames source file to target file on disk (3.457708ms)
    ✔ prompts warning and skips rename when target file already exists and user chooses Skip (1.304334ms)
    ✔ overwrites target file when user chooses Overwrite (1.118167ms)
  ✔ executeImageRenames (6.090625ms)
  ▶ detectImageDeletes and executeImageDeletes
    ✔ detects image deletion when original path is absent from current paths (0.721791ms)
    ✔ does NOT detect delete when same filename exists in another folder (move operation) (0.554041ms)
    ✔ executes image deletes by removing file from disk (2.408042ms)
  ✔ detectImageDeletes and executeImageDeletes (3.815791ms)
  ▶ updateWorkspaceReferences
    ✔ rewrites standard references, space-containing paths wrapped in <...>, and HTML img tags, skipping code fences (1.955209ms)
    ✔ skips excluded active document URI (0.800167ms)
  ✔ updateWorkspaceReferences (2.833958ms)
✔ image-rename-handler (19.078708ms)
ℹ tests 35
ℹ suites 12
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 64.33325
```

### 7.4. `npm run roundtrip`
```
> tui-milkdown-vscode@2.16.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
```

### 7.5. Vòng hai roundtrip và bước khôi phục
Lệnh chạy:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output:
```
> tui-milkdown-vscode@2.16.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
```
Trạng thái `harness/`: Hoàn toàn rỗng.

### 7.6. `npm run verify:vscode-floor`
Output chạy thực tế trên target version 1.85.0:
```
> tui-milkdown-vscode@2.16.0 verify:vscode-floor
> npm run build && npm run build:floor-tests && node harness/vscode-floor/run.mjs


> tui-milkdown-vscode@2.16.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)

> tui-milkdown-vscode@2.16.0 build:floor-tests
> node esbuild.harness.config.js --floor-tests

harness built: out/harness/vscode-floor-tests.js
VS Code floor check: target version 1.85.0

PASS  floor VS Code build launched: 2 debug target(s)
PASS  vscode version: 1.85.0
PASS  extension resolves: /Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w7-slash
PASS  extension activates: isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  custom editor opens the document: sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified: isDirty=false
PASS  custom editor still open after the hold: held 25000ms
PASS  document still unmodified after the hold: isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean: isDirty=false version=1; typed and removed "Z" 12ms apart, debounce 300ms
PASS  a typed character reaches the document: isDirty=true sentinelInText=true version 1→2
PASS  the edit does not bounce between host and webview: version 2 then 2 after 3s idle
PASS  view source opens the raw markdown in a text editor: 1 visible text editor(s)
PASS  webview mounts the editor: vscode-webview://0ogb280i7sa67l5vphvar90, mounted 3059ms into the probe
PASS  document content rendered in the webview: heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders: rendered=1 errors=0 stuckPlaceholders=0 scheduled=1 visibility=visible; 1505ms after mount, budget 40000ms
PASS  toolbar and metadata panel present: toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven: typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  no CSP violation in the console: 2 console entries, none CSP

20 checks: 20 passed, 0 failed
```

### 7.7. Chốt chặn fixture tổng hợp
Lệnh chạy:
```bash
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: Rỗng (0 fixture cũ bị thay đổi).

### 7.8. Kiểm tra trạng thái Git cuối cùng
Lệnh chạy:
```bash
git status --short
```
Output: Rỗng (mọi file đều đã được commit sạch sẽ).
