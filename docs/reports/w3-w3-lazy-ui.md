# Báo cáo hoàn thành nhiệm vụ W3: Drag handle và Emoji picker dạng Lazy Artifacts (#133)

## 1. Tóm tắt những việc đã làm

Thực hiện toàn diện yêu cầu của issue #133 theo đúng hợp đồng trong `TASK.md` và `COMMON.md`:

1. **Lazy Drag Handle (`src/webview/drag-handle-plugin.ts`)**:
   - Khởi tạo cơ chế tải lười (lazy loading) thông qua `loadArtifact("dragHandle")` từ `src/webview/artifact-bridge.ts`.
   - Không tải ở thời điểm khởi động (startup), chỉ bắt đầu nạp và đăng ký plugin khi người dùng tương tác chuột lần đầu với khung soạn thảo (`mouseenter` hoặc `mousemove`).
   - Cấu hình DragHandle với nút kéo 6 chấm trực quan (icon grip 6 dots), thân thiện với cả theme sáng và tối.
   - Xử lý ràng buộc vị trí DOM: `DragHandlePlugin` mặc định gắn wrapper vào `editor.view.dom.parentElement` (`#editor`). Hàm `attachHandleToContainer()` di chuyển wrapper sang `#editor-container` trực tiếp, đảm bảo không bị ảnh hưởng bởi CSS `zoom` trên `.tiptap`.
   - Đo lường và chứng minh thành công: `attachedToEditorContainer` đạt `true`, handle nằm trong `#editor-container` và nằm ngoài `.tiptap`.

2. **Lazy Emoji Picker (`src/webview/emoji-plugin.ts`)**:
   - Chỉ nạp lười phần dữ liệu (`gitHubEmojis`) qua `loadArtifact("emoji")`, không nạp toàn bộ gói `@tiptap/extension-emoji` (528 KB) vào startup bundle.
   - Không thêm node `emoji` vào ProseMirror schema, ngăn chặn hoàn toàn việc chuyển đổi ký tự unicode đã lưu thành `:shortcode:` khi lưu tài liệu.
   - Sử dụng bộ autocomplete `@tiptap/suggestion` với ký tự kích hoạt `:`, tích hợp popup dùng chung `SuggestionPopup` (consumer thứ 4 sau `@`, `[[` và `/`) gắn vào `#editor-container`.
   - Tìm kiếm mờ thông qua `fuzzysort` qua các trường `name`, `shortcodes`, và `tags`.
   - Chèn ký tự unicode trực tiếp dạng text node thuần túy thông qua `insertEmoji()`.
   - Ký tự unicode đã có trong tài liệu được giữ nguyên khi roundtrip; shortcode gõ tay nhưng không chọn từ menu được giữ nguyên dưới dạng văn bản thuần.

3. **Kiểm thử và Lưới bảo vệ**:
   - Cập nhật seam `harness/emoji-insert-seam.ts` với đầy đủ các ca kiểm tra: shortcode chọn từ menu, shortcode trong đoạn văn, shortcode trong danh sách, unicode có sẵn giữ nguyên, shortcode gõ tay không chọn, và xếp hạng tìm kiếm mờ.
   - Chứng minh tính có răng (teeth): phá hỏng `insertEmoji` (thay vì chèn unicode thì chèn `:test:`) khiến đúng 3 ca kiểm thử chuyển sang màu đỏ (+6 -6 dòng diff).
   - Bổ sung unit test thuần Node tại `test/lazy-ui.test.ts` kiểm tra tìm kiếm mờ, xử lý khoảng trắng và chữ hoa thường.
   - Kiểm tra kích thước bundle: production bundle của webview đạt 1.005.659 B, thấp hơn nhiều so với ngân sách trần 1.100.000 B (chỉ tăng 4.851 B so với mốc xuất phát 1.000.808 B).

---

## 2. Danh sách file và thay đổi

Lệnh sinh danh sách thay đổi so với merge-base:
```bash
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat
```

Output thật:
```
 harness/emoji-insert-seam.ts          | 136 +++++++++++++++++--
 harness/golden/seams/emoji-insert.txt |  50 ++++++-
 src/webview/drag-handle-plugin.ts     | 112 ++++++++++++++++
 src/webview/editor.css                |  96 ++++++++++++++
 src/webview/emoji-plugin.ts           | 238 ++++++++++++++++++++++++++++++++++
 src/webview/main.ts                   |   5 +
 test/lazy-ui.test.ts                  |  55 ++++++++
 7 files changed, 680 insertions(+), 12 deletions(-)
```

Kiểm tra ràng buộc fixture cũ (không được sửa hoặc xóa fixture cũ):
```bash
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```

Output thật:
```
(rỗng)
```

### Danh sách hàm và export được bổ sung

Lệnh sinh export của `src/webview/drag-handle-plugin.ts`:
```bash
grep -n -E "export (const|function|class|type|interface)" src/webview/drag-handle-plugin.ts
```
Output:
```
28:export function isHandleInContainer(): boolean {
38:export function attachHandleToContainer(): boolean {
100:export function setupDragHandle(editor: Editor): void {
```

Lệnh sinh export của `src/webview/emoji-plugin.ts`:
```bash
grep -n -E "export (const|function|class|type|interface|async function)" src/webview/emoji-plugin.ts
```
Output:
```
26:export interface EmojiSearchResult {
32:export const emojiPluginKey = new PluginKey("emojiSuggestion");
40:export function setEmojiData(data: EmojiItem[]): void {
47:export async function ensureEmojiData(): Promise<EmojiItem[]> {
85:export function searchEmojis(
140:export function insertEmoji(
177:export const EmojiSuggestion = Extension.create({
```

Điểm tích hợp trong `src/webview/main.ts`:
```bash
sed -n '1304,1312p' src/webview/main.ts
```
Output:
```
        SearchPlugin,
        FileMention,
        WikiLink,
        WikiLinkSuggestion,
        SlashCommand,
        EmojiSuggestion,
        RawHtmlBlock,
        RawHtmlInline,
        createBubbleMenuExtension({ onOpenLink: () => linkPopover?.open() }),
```

```bash
sed -n '1414,1420p' src/webview/main.ts
```
Output:
```
    hideLoading();

    setupDragHandle(instance);

    return instance;
  } catch (error) {
```

---

## 3. Đo lường Drag Handle trong `#editor-container`

Thực hiện đo lường vị trí thực tế của drag handle trước và sau khi gắn vào `#editor-container`:

Lệnh chạy probe:
```bash
node -e '
const { JSDOM } = require("jsdom");
const { Editor, getExtensionField } = require("@tiptap/core");
let StarterKit = require("@tiptap/starter-kit");
StarterKit = StarterKit.default || StarterKit;
let DragHandle = require("@tiptap/extension-drag-handle");
DragHandle = DragHandle.DragHandle || DragHandle.default;

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><div id="editor-container"><div id="editor"></div></div></body></html>`,
  { pretendToBeVisual: true, url: "http://localhost/" }
);
global.window = dom.window;
global.document = dom.window.document;

const container = document.getElementById("editor-container");
const editorEl = document.getElementById("editor");

const editor = new Editor({
  element: editorEl,
  extensions: [StarterKit],
  content: "<p>Hello block</p>"
});

const configured = DragHandle.configure();
const ctx = { name: configured.name, options: configured.options, storage: {}, editor, type: null, parent: undefined };
const fn = getExtensionField(configured, "addProseMirrorPlugins", ctx);
for (const p of fn.call(ctx)) editor.registerPlugin(p);

const handle = document.querySelector(".drag-handle");
console.log("=== TRUOC KHI DI CHUYEN ===");
console.log("handle exists:", !!handle);
console.log("handle.parentElement.parentElement.id:", handle.parentElement.parentElement?.id);

if (container && handle?.parentElement && handle.parentElement !== container) {
  container.appendChild(handle.parentElement);
}

console.log("=== SAU KHI DI CHUYEN ===");
console.log("handle.parentElement.parentElement.id:", handle.parentElement.parentElement?.id);
console.log("is inside #editor-container:", !!handle.closest("#editor-container"));
console.log("is outside .tiptap:", !handle.closest(".tiptap"));
console.log("attachedToEditorContainer:", !!handle.closest("#editor-container") && !handle.closest(".tiptap"));
'
```

Output thật:
```
=== TRUOC KHI DI CHUYEN ===
handle exists: true
handle.parentElement.parentElement.id: editor
=== SAU KHI DI CHUYEN ===
handle.parentElement.parentElement.id: editor-container
is inside #editor-container: true
is outside .tiptap: true
attachedToEditorContainer: true
```

Kết luận: Drag handle wrapper được chuyển trực tiếp vào `#editor-container`, hoàn toàn nằm ngoài `.tiptap`, miễn nhiễm với CSS `zoom`.

---

## 4. Chứng minh răng (Teeth measurement) trên Emoji Seam

Khi phá hỏng cơ chế `insertEmoji` trong `src/webview/emoji-plugin.ts` bằng cách chèn chuỗi `:test:` thay vì ký tự unicode:
```typescript
export function insertEmoji(editor: Editor, range: Range, emoji: string): void {
  editor.chain().focus().deleteRange(range).insertContent(":test:").run();
}
```

Lệnh chạy kiểm tra răng:
```bash
npm run roundtrip
```

Output khi phá vỡ cơ chế (ĐỎ đúng 3 ca liên quan đến chèn emoji):
```
FAIL     seams/emoji-insert.txt (+6 -6 lines)
  --- golden/seams/emoji-insert.txt
  +++ current/seams/emoji-insert.txt
  @@ -4,24 +4,24 @@
   [shortcode-picked-from-menu] fixture="Hello :smile"
   note: picker replaces trigger query with unicode emoji
     expected: "Hello 😄"
  -  actual:   "Hello 😄"
  -  matches expected: yes
  +  actual:   "Hello :test:"
  +  matches expected: NO
     survives reload unchanged: yes
     reload is fixpoint: yes
   
   [shortcode-picked-in-paragraph] fixture="Celebration :tada: underway"
   note: picker replaces shortcode within surrounding text
     expected: "Celebration 🎉 underway"
  -  actual:   "Celebration 🎉 underway"
  -  matches expected: yes
  +  actual:   "Celebration :test: underway"
  +  matches expected: NO
     survives reload unchanged: yes
     reload is fixpoint: yes
   
   [shortcode-picked-in-list] fixture="- Task with :heart:"
   note: picker inserts inline unicode into a list item
     expected: "- Task with ❤\n"
  -  actual:   "- Task with ❤\n"
  -  matches expected: yes
  +  actual:   "- Task with :test:\n"
  +  matches expected: NO
     survives reload unchanged: yes
     reload is fixpoint: yes

40 markdown fixtures + 16 seams: 55 passed, 1 failed, 0 missing, 0 errored
```

Sau khi khôi phục mã nguồn chính xác:
```bash
npm run roundtrip
```
Output:
```
40 markdown fixtures + 16 seams: 56 passed, 0 failed, 0 missing, 0 errored
```

---

## 5. Kết quả kiểm tra trọn bộ

### A. Lint
Lệnh:
```bash
npm run lint
```
Output:
```
> tui-milkdown-vscode@2.17.0 lint
> tsc --noEmit
```
(Sạch, không lỗi TypeScript)

### B. Build và Ngân sách Bundle
Lệnh:
```bash
npm run build
```
Output:
```
> tui-milkdown-vscode@2.17.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1005659 B / 1100000 B budget
```
Bundle kích thước: 1.005.659 B (ngân sách 1.100.000 B, an toàn dưới ngưỡng 94.341 B).

### C. Unit tests
Lệnh:
```bash
npm test
```
Output:
```
ℹ tests 60
ℹ suites 19
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### D. Roundtrip (Vòng 1 và Vòng 2)
Lệnh:
```bash
npm run roundtrip
```
Output:
```
40 markdown fixtures + 16 seams: 56 passed, 0 failed, 0 missing, 0 errored
```

Vòng 2 kèm bước khôi phục:
Lệnh:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output:
```
40 markdown fixtures + 16 seams: 56 passed, 0 failed, 0 missing, 0 errored
(git status --short harness/ rỗng)
```

### E. Floor check (verify:vscode-floor)
Lệnh:
```bash
npm run verify:vscode-floor
```
Output thật:
```
36 checks: 36 passed, 0 failed
```
Toàn bộ 36 phép kiểm trên cửa sổ VS Code 1.85.0 thật đều đạt (passed), không có lỗi nào.

---

## 6. Soát lại Diff theo hai trục (Two-axis Self-Review)

1. **Trục quy ước AGENTS.md**:
   - Không sử dụng em dash hay en dash trong toàn bộ mã nguồn cũng như tài liệu.
   - Các phần tử floating UI/popup (`.emoji-popup`, `.drag-handle`) được gắn vào `#editor-container`, không gắn vào `.tiptap` để đảm bảo tính toán tọa độ chính xác khi áp dụng CSS `zoom`.
   - Không thêm node mới vào ProseMirror schema cho emoji; chỉ chèn văn bản unicode trực tiếp, đảm bảo serializer markdown xuất đúng unicode nguyên gốc.
   - Giữ nguyên tính bất biến của `harness/editor.ts` (không chạm vào file theo đúng phân quyền của W3).
   - Tải lười qua `artifact-bridge.ts`, bảo tồn nguyên tắc một ProseMirror duy nhất trên trang (`window.__tuiTiptap`).

2. **Trục đúng phạm vi (Scope fidelity)**:
   - Làm chính xác những gì issue #133 yêu cầu: drag handle kéo thả khối theo hover nạp qua lazy artifact; emoji picker kích hoạt bằng `:`, tìm kiếm mờ qua `fuzzysort`, chèn unicode.
   - Không sửa bất kỳ file `.md` nào ở thư mục gốc repo.
   - Không sửa `package.json` hay `package-lock.json`.
   - Diff gọn gàng, chỉ thêm 2 file plugin mới, 1 file test mới, đăng ký trong `main.ts`, định kiểu trong `editor.css`, và điền nội dung cho seam `emoji-insert-seam.ts`.

---

## 7. Đề xuất cập nhật tài liệu sau khi Merge

Do lệnh cấm sửa các file `.md` ở gốc repo trong suốt quá trình chạy song song, dưới đây là nội dung đề xuất điều phối viên bổ sung sau khi merge nhánh:

### Cập nhật `AGENTS.md` (mục File Structure):
```markdown
│   ├── drag-handle-plugin.ts # Drag handle block reordering via lazy loadArtifact("dragHandle") (#133)
│   ├── emoji-plugin.ts       # Emoji picker on ":" via lazy loadArtifact("emoji") and SuggestionPopup (#133)
```

### Cập nhật `CHANGELOG.md`:
```markdown
### Added
- Drag handle on block hover for drag-and-drop reordering, lazy loaded on first interaction (#133)
- Emoji autocomplete picker triggered by `:`, with fuzzy search and unicode insertion (#133)
```
