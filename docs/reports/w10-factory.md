# Báo cáo hoàn thành nhiệm vụ W10: Extension factory (#143)

Nhánh: `hoangvantuan/w10-factory`
Commit cơ sở (develop): `a2a44f2`
Ticket: #143 (thuộc spec cha #137)

---

## 1. Tóm tắt những việc đã làm

- Đã tạo module mới `src/webview/extension-factory.ts` hoàn toàn Node-safe (không phụ thuộc browser globals, DOM hay API host). Module này trở thành nguồn chân lý duy nhất (single source of truth) định nghĩa toàn bộ các tiện ích mở rộng Tiptap liên quan tới Markdown:
  - `EscapeToken`: xử lý token escape từ marked parser.
  - `BlankLineHandler`: phân tích dòng trống giữa các khối văn bản.
  - `CustomUnderline`: thẻ `<ins>`, `<u>` và style `text-decoration`.
  - Patch `MarkdownManager.prototype` (#95): bảo toàn chính xác các dòng trống liên tiếp, được trang bị guard idempotent với `Symbol.for("tui-markdown-manager-patched")` chống patch hai lần.
  - `expandPrefixTabsInText`: chuyển đổi tab thụt lề đầu dòng và sau marker danh sách thành mốc 4 khoảng trắng.
  - `createCustomMarked`: cấu hình lexer tùy chỉnh với `expandPrefixTabsInText`.
  - `Blockquote.extend`: nhận diện GitHub alerts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
  - `Document.extend`: tuần tự hóa tài liệu Markdown với dòng trống chính xác.
  - `CodeBlockLowlight.extend`: tự động điều chỉnh độ dài rào chắn fence khi gặp code block lồng nhau.
  - `Table.extend`: tuần tự hóa bảng GFM nhiều dòng (`renderTableToMarkdown`).
  - Danh sách ngôn ngữ highlight cho lowlight (`LOWLIGHT_LANGUAGES`).
  - Bộ cờ cấu hình `StarterKit.configure` và cấu hình `Markdown` (`indentation`, `markedOptions`).
  - Tích hợp các extension toán học (`mathExtensions`), chú thích cuối trang (`footnoteExtensions`), HTML whitelist (`htmlMarkExtensions`, `detailsExtensions`).
  - Hàm xuất xưởng `buildMarkdownExtensions(config: ExtensionFactoryConfig)` nhận cấu hình thụt lề, tabSize và đối tượng lowlight tùy chọn.
- Đã cấu trúc lại `harness/editor.ts` để sử dụng `buildMarkdownExtensions` từ `src/webview/extension-factory.ts`, xóa bỏ toàn bộ các khối định nghĩa phản chiếu (mirror definitions).
- Không chạm vào `src/webview/main.ts` trong ticket này theo đúng phân định trách nhiệm (ticket #145 sẽ chuyển `main.ts` sang dùng factory sau khi merge).

---

## 2. Bằng chứng nghiệm thu từng tiêu chí

### 2.1. Tiêu chí 1: Xóa bỏ hoàn toàn định nghĩa phản chiếu trong harness/editor.ts

Lệnh kiểm tra số lượng chú thích mirror trong `harness/editor.ts`:
```sh
grep -c 'Mirror of' harness/editor.ts; echo "exit=$?"
```
Output:
```
0
exit=1
```

Lệnh kiểm tra vị trí của các định nghĩa trùng lặp trước đây:
```sh
for name in EscapeToken BlankLineHandler CustomUnderline expandPrefixTabsInText createCustomMarked createImplicitEmptyParagraphsFromSpace; do
  echo "=== $name ==="
  grep -rn "\b$name\b" src/webview/extension-factory.ts src/webview/main.ts harness/editor.ts 2>/dev/null
done
```
Output:
```
=== EscapeToken ===
src/webview/extension-factory.ts:125:export const EscapeToken = Extension.create({
src/webview/extension-factory.ts:403:    EscapeToken,
src/webview/main.ts:114:const EscapeToken = Extension.create({
src/webview/main.ts:1303:        EscapeToken,
=== BlankLineHandler ===
src/webview/extension-factory.ts:147:export const BlankLineHandler = Extension.create({
src/webview/extension-factory.ts:404:    BlankLineHandler,
src/webview/main.ts:124:// `createImplicitEmptyParagraphsFromSpace`, completely bypassing `BlankLineHandler.parseMarkdown`.
src/webview/main.ts:176:const BlankLineHandler = Extension.create({
src/webview/main.ts:1304:        BlankLineHandler,
=== CustomUnderline ===
src/webview/extension-factory.ts:160:export const CustomUnderline = Underline.extend({
src/webview/extension-factory.ts:309:    CustomUnderline,
src/webview/main.ts:189:export const CustomUnderline = Underline.extend({
src/webview/main.ts:1200:          underline: false, // Replaced by CustomUnderline below (<ins> serialization)
src/webview/main.ts:1203:        CustomUnderline,
=== expandPrefixTabsInText ===
src/webview/extension-factory.ts:192:export function expandPrefixTabsInText(src: string): string {
src/webview/extension-factory.ts:248:      return super.lex(expandPrefixTabsInText(src));
src/webview/main.ts:1102:function expandPrefixTabsInText(src: string): string {
src/webview/main.ts:1158:      return super.lex(expandPrefixTabsInText(src));
=== createCustomMarked ===
src/webview/extension-factory.ts:244:export function createCustomMarked(): any {
src/webview/extension-factory.ts:297:  const customMarked = createCustomMarked();
src/webview/main.ts:1154:function createCustomMarked(): any {
src/webview/main.ts:1165:const customMarked = createCustomMarked();
=== createImplicitEmptyParagraphsFromSpace ===
src/webview/extension-factory.ts:93:  (MarkdownManager.prototype as any).createImplicitEmptyParagraphsFromSpace = function (
src/webview/main.ts:124:// `createImplicitEmptyParagraphsFromSpace`, completely bypassing `BlankLineHandler.parseMarkdown`.
src/webview/main.ts:139:(MarkdownManager.prototype as any).createImplicitEmptyParagraphsFromSpace = function (
```
Kết quả: Các định nghĩa chỉ còn xuất hiện tại `src/webview/extension-factory.ts` và `src/webview/main.ts` (chờ #145 chuyển giao), hoàn toàn không còn trong `harness/editor.ts`.

---

### 2.2. Tiêu chí 2: Tính an toàn trong môi trường Node.js (Node-safe)

Lệnh kiểm tra sự vắng mặt của các biến toàn cục trình duyệt:
```sh
grep -n 'acquireVsCodeApi\|document\.\|window\.' src/webview/extension-factory.ts; echo "exit=$?"
```
Output:
```
exit=1
```
(Hoàn toàn rỗng, mã trả về 1 chứng tỏ không tìm thấy bất kỳ khớp nối nào).

Lệnh kiểm tra việc nạp module và chạy harness trong môi trường Node.js thuần:
```sh
node -e "require('./out/harness/roundtrip.js')"
```
Output:
```
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

---

### 2.3. Tiêu chí 3: Phép thử có răng (Teeth tests)

#### Phép thử răng 1: Làm sai cơ chế nhận diện Alert trong factory
Sửa dòng lấy nội dung text đầu tiên trong `Blockquote.extend` thành `null`:
```sh
sed -i '' 's/const firstText = getFirstText(token);/const firstText = null; \/\/ BROKEN FOR TEETH TEST/' src/webview/extension-factory.ts && npm run roundtrip 2>&1
```
Output khi bị phá:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

FAIL     synthetic/alerts.md (+6 -12 lines)
  --- golden/synthetic/alerts.md
  +++ current/synthetic/alerts.md
  @@ -1,25 +1,19 @@
  -> [!NOTE]
  ->
  +> \[!NOTE\]
   > Useful information that users should know, even when skimming content.
   
  -> [!TIP]
  ->
  +> \[!TIP\]
   > Helpful advice for doing things better or more easily.
   
  -> [!IMPORTANT]
  ->
  +> \[!IMPORTANT\]
   > Key information users need to know to achieve their goal.
   
  -> [!WARNING]
  ->
  +> \[!WARNING\]
   > Urgent info that needs immediate user attention to avoid problems.
   
  -> [!CAUTION]
  ->
  +> \[!CAUTION\]
   > Advises about risks or negative outcomes of certain actions.
   
  -> [!NOTE]
  ->
  +> \[!NOTE\]
   > First paragraph of a multi-paragraph note.
   >
   > Second paragraph with **bold** text.

FAIL     repo/README.md (+1 -2 lines)
  --- golden/repo/README.md
  +++ current/repo/README.md
  @@ -107,8 +107,7 @@
   
   WYSIWYG export via headless Chromium (`puppeteer-core`). Requires Chrome, Edge, Chromium, or Brave installed locally (not bundled). Auto-detects common install paths.
   
  -> [!TIP]
  ->
  +> \[!TIP\]
   > If auto-detection fails, set `tuiMarkdown.chromiumPath` in VS Code settings to the absolute path of your browser executable.
   
   ## Configuration

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 58 passed, 2 failed, 0 missing, 0 errored
```
Kết quả: Có đúng 2 fixtures thất bại (`synthetic/alerts.md` và `repo/README.md`).

Khôi phục lại:
```sh
sed -i '' 's/const firstText = null; \/\/ BROKEN FOR TEETH TEST/const firstText = getFirstText(token);/' src/webview/extension-factory.ts && npm run roundtrip 2>&1
```
Output sau khi khôi phục:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

#### Phép thử răng 2: Làm sai quy tắc render của CustomUnderline trong factory
Sửa hàm `renderMarkdown` của `CustomUnderline` trả về `<ins-broken>`:
```sh
sed -i '' 's/return `<ins>${helpers.renderChildren(node)}<\/ins>`;/return `<ins-broken>${helpers.renderChildren(node)}<\/ins-broken>`;/' src/webview/extension-factory.ts && npm run roundtrip 2>&1
```
Output khi bị phá:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

FAIL     synthetic/underline.md (+7 -7 lines)
  --- golden/synthetic/underline.md
  +++ current/synthetic/underline.md
  @@ -1,14 +1,14 @@
   # Underline
   
  -Pasted HTML: <ins>u tag text</ins> here.
  +Pasted HTML: <ins-broken>u tag text</ins-broken> here.
   
  -Legacy syntax: <ins>plus syntax text</ins> here.
  +Legacy syntax: <ins-broken>plus syntax text</ins-broken> here.
   
  -Ins tag: <ins>ins tag text</ins> here.
  +Ins tag: <ins-broken>ins tag text</ins-broken> here.
   
  -Bold wrap: **bold with <ins>u inside</ins>** here.
  +Bold wrap: **bold with <ins-broken>u inside</ins-broken>** here.
   
  -| Column 1             | Column 2     |
  -| -------------------- | ------------ |
  -| <ins>cell plus</ins> | regular text |
  +| Column 1                           | Column 2     |
  +| ---------------------------------- | ------------ |
  +| <ins-broken>cell plus</ins-broken> | regular text |
   

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Kết quả: Có đúng 1 fixture thất bại (`synthetic/underline.md`).

Khôi phục lại:
```sh
sed -i '' 's/return `<ins-broken>${helpers.renderChildren(node)}<\/ins-broken>`;/return `<ins>${helpers.renderChildren(node)}<\/ins>`;/' src/webview/extension-factory.ts && npm run roundtrip 2>&1
```
Output sau khi khôi phục:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

Hai phép thử trên chứng minh dứt khoát rằng harness đang đo trực tiếp các tiện ích mở rộng từ module factory, không còn sử dụng bất kỳ bản sao nào.

---

### 2.4. Tiêu chí 4: Kiểm tra bộ lệnh chất lượng

#### npm run lint
Lệnh:
```sh
npm run lint
```
Output:
```
> tui-milkdown-vscode@3.0.1 lint
> tsc --noEmit
```

#### npm run build
Lệnh:
```sh
npm run build
```
Output:
```
> tui-milkdown-vscode@3.0.1 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1025959 B / 1100000 B budget
```
Dung lượng webview bundle giữ nguyên 1025959 B (dưới ngân sách 1100000 B).

#### npm test
Lệnh:
```sh
npm test
```
Output:
```
ℹ tests 85
ℹ suites 25
ℹ pass 85
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 150.021208
```

#### npm run roundtrip
Lệnh:
```sh
npm run roundtrip
```
Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

#### Kiểm tra vòng hai và khôi phục
Lệnh:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness : mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```
Trạng thái `git status --short harness/` hoàn toàn sạch sau khi khôi phục.

#### Kiểm tra thay đổi golden và fixture
Lệnh:
```sh
git status --short harness/golden
```
Output: Rỗng (không có tệp golden nào bị thay đổi).

Lệnh:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: Rỗng (không có fixture nào bị thêm hoặc sửa).

---

## 3. Các đoạn mã then chốt

### 3.1. Header và Idempotent Guard của MarkdownManager Prototype Patch trong src/webview/extension-factory.ts
Lệnh sinh mã:
```sh
sed -n '1,16p' src/webview/extension-factory.ts
sed -n '71,117p' src/webview/extension-factory.ts
```
Mã nguồn:
```typescript
/**
 * Extension factory: the one place that decides which Markdown rules the
 * editor knows (#143).
 *
 * Both the rich text view (src/webview/main.ts, via #145) and the roundtrip
 * harness (harness/editor.ts) build their editor from this module, so a rule
 * changed here is tested and shipped as the same rule.
 *
 * Node-safe: no browser globals, DOM access, or extension host APIs.
 * DOM-touching extensions (math, footnote, details) are imported here for
 * their parseMarkdown/renderMarkdown hooks; their addNodeView callbacks only
 * execute in a browser context at editor runtime, not at import time.
 *
 * installMarkdownTextEscape() is NOT called here: it stays in its current
 * module and is called once by each entry point (main.ts and harness/editor.ts).
 */
```
```typescript
// ---------------------------------------------------------------------------
// MarkdownManager prototype patch (#95)
//
// Side effect on first import. An idempotent guard prevents double patching
// when both main.ts and harness/editor.ts (or a future second consumer) run
// in the same process.
// ---------------------------------------------------------------------------
const PATCH_GUARD = Symbol.for("tui-markdown-manager-patched");

if (!(MarkdownManager.prototype as any)[PATCH_GUARD]) {
  const origParseTokens = (MarkdownManager.prototype as any).parseTokens;
  (MarkdownManager.prototype as any).parseTokens = function (tokens: any[], parseImplicitEmptyParagraphs = false) {
    const prevTokens = (this as any)._currentTokens;
    const normalizedTokens = parseImplicitEmptyParagraphs ? extractAbsorbedBlankLines(tokens) : tokens;
    (this as any)._currentTokens = normalizedTokens;
    try {
      return origParseTokens.call(this, tokens, parseImplicitEmptyParagraphs);
    } finally {
      (this as any)._currentTokens = prevTokens;
    }
  };

  (MarkdownManager.prototype as any).createImplicitEmptyParagraphsFromSpace = function (
    token: any,
    previousNonSpaceTokenIndex: number,
    nextNonSpaceTokenIndex: number,
  ) {
    const newlines = (token.raw?.replace(/\r\n/g, "\n").match(/\n/g) || []).length;
    if (newlines === 0) return [];
    const prevToken = previousNonSpaceTokenIndex >= 0 ? (this as any)._currentTokens?.[previousNonSpaceTokenIndex] : null;
    const prevIsTable = prevToken?.type === "table";
    let emptyCount = 0;
    if (nextNonSpaceTokenIndex === -1) {
      // EOF
      emptyCount = prevIsTable ? Math.max(0, newlines - 1) : newlines;
    } else if (previousNonSpaceTokenIndex === -1) {
      // BOF
      emptyCount = Math.max(0, newlines - 2);
    } else {
      // Between blocks
      emptyCount = prevIsTable ? Math.max(0, newlines - 3) : Math.max(0, newlines - 2);
    }
    return Array.from({ length: emptyCount }, () => ({ type: "paragraph", content: [] }));
  };

  (MarkdownManager.prototype as any)[PATCH_GUARD] = true;
}
```

### 3.2. Cấu trúc xuất xưởng buildMarkdownExtensions trong src/webview/extension-factory.ts
Lệnh sinh mã:
```sh
sed -n '285,317p' src/webview/extension-factory.ts
```
Mã nguồn:
```typescript
export function buildMarkdownExtensions(config: ExtensionFactoryConfig = {}): any[] {
  const {
    indentation = { style: "space", size: 2 },
    tabSize = 2,
  } = config;

  let ll = config.lowlight;
  if (!ll) {
    ll = createLowlight();
    ll.register(LOWLIGHT_LANGUAGES);
  }

  const customMarked = createCustomMarked();

  return [
    StarterKit.configure({
      codeBlock: false,
      paragraph: false,
      document: false,
      blockquote: false,
      link: false,
      underline: false,
      orderedList: false, // Replaced by CustomOrderedList below (#109)
    }),
    CustomUnderline,
    MarkdownLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    // Custom Blockquote that detects GitHub-style alerts [!NOTE], [!TIP], etc.
    Blockquote.extend({
      parseMarkdown(token: any, helpers: any) {
```

### 3.3. Sử dụng factory trong harness/editor.ts
Lệnh sinh mã:
```sh
sed -n '125,145p' harness/editor.ts
```
Mã nguồn:
```typescript
export function createHarnessEditor(options: HarnessEditorOptions): {
  editor: Editor;
  host: HTMLElement;
  dispose: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const editor = new Editor({
    element: host,
    extensions: [
      ...buildMarkdownExtensions({
        indentation: options.indentation,
        tabSize: options.tabSize,
      }),
      ...((options.extraExtensions ?? []) as any[]),
    ],
    content: options.content,
    contentType: options.contentType ?? "markdown",
  });
```

---

## 4. Tiêu chí chưa kiểm được và lý do

Không có tiêu chí nào chưa kiểm được. Toàn bộ các yêu cầu của ticket #143 đã được hiện thực hóa và kiểm thử nghiêm ngặt.
Riêng lệnh `npm run verify:vscode-floor` không cần chạy ở ticket này theo đúng chỉ định trong `TASK.md` (do `src/webview/main.ts` không thay đổi trong ticket này).

---

## 5. Câu chữ chuẩn bị cho CHANGELOG.md và AGENTS.md

### 5.1. Câu chữ cho CHANGELOG.md (mục Changed)
```markdown
- Extracted shared markdown extension factory (`src/webview/extension-factory.ts`) containing all markdown-relevant extension definitions and the idempotent `MarkdownManager.prototype` patch (#143)
- Switched roundtrip harness (`harness/editor.ts`) to import extensions directly from the extension factory, eliminating all mirror definitions (#143)
```

### 5.2. Câu chữ cho AGENTS.md

#### Trong mục File Structure:
Thêm dòng sau vào danh sách tệp dưới `src/webview/`:
```markdown
    ├── extension-factory.ts  # Extension factory: single source of truth for markdown-relevant extensions (#143)
```

Cập nhật dòng cho `harness/editor.ts`:
```markdown
├── editor.ts                       # Editor factory building Tiptap editor from extension-factory.ts (#143)
```

#### Trong mục Conventions & Gotchas:
Thay thế câu mô tả về bản gương của `harness/editor.ts` bằng:
```markdown
- `harness/editor.ts` imports its markdown-relevant extensions from `src/webview/extension-factory.ts` (#143); after #145 switches `main.ts` to the factory, there is no mirror between the harness and the webview, ensuring the harness tests the exact rules shipped in production. It is NOT a full mirror of all extensions (UI and decoration plugins remain in webview only), and `harness/vscode-floor/sample.md` is not a first-pass fixed point under `roundtripMarkdown`. The webview writes no edit for it, and since #111 that is a guarantee rather than a tendency: it posts an `edit` only when the serialized content differs from `contentBaseline`, the string it last agreed with the host on. Before #111 it merely usually held, and the same SHA produced both 18/19 and 19/19
```
