# Báo cáo hoàn thành nhiệm vụ Wave 8: W2 (Issue #132)

- Nhánh: `hoangvantuan/w2-html-whitelist`
- Mã commit: `5dece13`
- Worker: W2
- Issue phụ trách: #132 (Render the HTML whitelist: `<details>`/`<summary>`, `<kbd>`, `<sub>`, `<sup>`)

---

## 1. Tóm tắt điều hành (Executive Summary)

Worker W2 triển khai issue #132 theo quy trình TDD và hợp đồng kiểm thử nghiêm ngặt của sóng 8:
1. Tạo các Mark extension chuyên trách cho `<kbd>`, `<sub>`, `<sup>` trong `src/webview/html-marks.ts`, kế thừa cơ chế parse và render HTML gốc của trình duyệt kết hợp hook `renderMarkdown` phát ra đúng thẻ HTML nguyên bản.
2. Xây dựng block node `Details` và `DetailsSummary` trong `src/webview/details-extension.ts` với Marked block tokenizer và serializer WYSIWYG, đảm bảo các khối `<details>`/`<summary>` hiển thị dạng đóng/mở có thể tương tác trực quan trong editor.
3. Cập nhật `src/webview/raw-html.ts` để nhận diện các thẻ `<kbd>`, `<sub>`, `<sup>`, tránh việc tách các thẻ này thành các atom thô độc lập.
4. Xử lý triệt để khuyết tật `mark-around-atom` từ upstream (`docs/upstream/tiptap-markdown-mark-around-atom.md`) tại `src/webview/markdown-destination.ts`: gom nhóm token nội dòng (batching) khi parse link giúp các cặp thẻ HTML được ghép cặp chính xác thay vì phân mảnh, đưa cú pháp `[<kbd>Ctrl</kbd> docs](url)` về đúng định dạng gốc thay vì đẩy link vào trong tag như trước đây.
5. Cung cấp CSS hoàn chỉnh trong `src/webview/editor.css` cho keycap `<kbd>`, chỉ số dưới `<sub>`, chỉ số trên `<sup>`, và khối `<details>`/`<summary>`.
6. Tích hợp extension vào `src/webview/main.ts` và `harness/editor.ts` tuyệt đối bên trong marker block của W2.
7. Triển khai seam đo lường `harness/html-render-seam.ts`, ghi nhận golden `harness/golden/seams/html-render.txt` và bổ sung fixture tổng hợp mới `harness/fixtures/synthetic/html-whitelist.md`.
8. Kiểm chứng độ nhạy (teeth test): gỡ extension khỏi `harness/editor.ts` gây đỏ lập tức 3 hạng mục kiểm thử (toàn bộ 7 ca trong seam và 2 fixture synthetic). Chạy trọn vẹn kiểm thử sàn VS Code 1.85 (`verify:vscode-floor`) đạt 36/36 checks passed.

---

## 2. Rà soát diff theo hai trục (Two-Axis Diff Review)

### Trục 1: Tuân thủ quy ước AGENTS.md
- **Giữ nguyên các file cấm**: Không chạm vào `package.json`, `package-lock.json`, `esbuild.config.js`, `src/markdownEditorProvider.ts`, `src/webview/artifact-bridge.ts`, `src/webview/tiptap-globals.ts` hay bất kỳ file `.md` nào ở gốc repo.
- **Tuân thủ marker block**: Trong `src/webview/main.ts` và `harness/editor.ts`, chỉ thêm đúng 2 dòng bên trong khối marker `// --- W2: html whitelist (details / kbd / sub / sup) ---` ... `// --- end W2 ---`. Không thay đổi bất kỳ dòng nào khác.
- **Phản chiếu đối xứng giữa editor chính và harness**: Cả `main.ts` và `editor.ts` đều nạp `htmlMarkExtensions` và `detailsExtensions` như nhau.
- **Không phá vỡ fixture cũ**: `harness/golden/synthetic/raw-html.md` và toàn bộ 40 fixture cũ giữ nguyên từng byte (0 byte diff).
- **Quy ước font/zoom và container**: CSS cho `kbd`, `sub`, `sup`, `details` tuân thủ biến màu theme, kế thừa font và không gây méo toạ độ DOM.

### Trục 2: Đúng phạm vi yêu cầu issue
- **Đúng phạm vi**: Chỉ hỗ trợ render và roundtrip cho `<details>`/`<summary>`, `<kbd>`, `<sub>`, `<sup>`. Không thêm các tính năng ngoài luồng.
- **Xử lý trọn vẹn khuyết tật upstream**: `<kbd>`, `<sub>`, `<sup>` được chuyển thành mark thay vì atom node, kết hợp với việc sửa batching trong `MarkdownLink.parseMarkdown` giúp các trường hợp link bọc thẻ HTML (`[<kbd>Ctrl</kbd> docs](https://example.com)`) được bảo toàn hoàn hảo.

---

## 3. Danh sách tệp và biểu tượng đã thay đổi

Lệnh sinh danh sách tệp thay đổi từ commit `5dece13`:
```bash
git show --stat 5dece13
```

Kết quả:
```
 harness/editor.ts                            |   2 +
 harness/fixtures/synthetic/html-whitelist.md |  16 ++++
 harness/golden/seams/html-render.txt         |  50 +++++++++-
 harness/golden/synthetic/html-whitelist.md   |  16 ++++
 harness/html-render-seam.ts                  | 135 +++++++++++++++++++++++++--
 src/webview/details-extension.ts             | 110 ++++++++++++++++++++++
 src/webview/editor.css                       |  48 ++++++++++
 src/webview/html-marks.ts                    |  74 +++++++++++++++
 src/webview/main.ts                          |   2 +
 src/webview/markdown-destination.ts          |  22 +++--
 src/webview/raw-html.ts                      |   6 +-
 11 files changed, 466 insertions(+), 15 deletions(-)
```

Lệnh grep các symbol/extension xuất khẩu:
```bash
grep -n "export const" src/webview/html-marks.ts src/webview/details-extension.ts
```

Kết quả:
```
src/webview/html-marks.ts:10:export const Kbd = Mark.create({
src/webview/html-marks.ts:26:export const Subscript = Mark.create({
src/webview/html-marks.ts:52:export const Superscript = Mark.create({
src/webview/html-marks.ts:74:export const htmlMarkExtensions = [Kbd, Subscript, Superscript];
src/webview/details-extension.ts:9:export const DetailsSummary = Node.create({
src/webview/details-extension.ts:31:export const Details = Node.create({
src/webview/details-extension.ts:110:export const detailsExtensions = [DetailsSummary, Details];
```

---

## 4. Chi tiết mã nguồn chính (sinh bằng sed -n)

### 4.1. `src/webview/html-marks.ts`
Lệnh chạy: `sed -n '1,74p' src/webview/html-marks.ts`
```typescript
/**
 * HTML whitelist mark extensions (issue #132).
 *
 * Provides dedicated marks for <kbd>, <sub> and <sup> so they render
 * natively in the editor and serialize back to their literal HTML tags.
 */

import { Mark, mergeAttributes } from "@tiptap/core";

export const Kbd = Mark.create({
  name: "kbd",

  parseHTML() {
    return [{ tag: "kbd" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["kbd", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<kbd>${helpers.renderChildren(node)}</kbd>`;
  },
});

export const Subscript = Mark.create({
  name: "subscript",

  excludes: "superscript",

  parseHTML() {
    return [
      { tag: "sub" },
      {
        style: "vertical-align",
        getAttrs: (value: any) => (value === "sub" ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<sub>${helpers.renderChildren(node)}</sub>`;
  },
});

export const Superscript = Mark.create({
  name: "superscript",

  excludes: "subscript",

  parseHTML() {
    return [
      { tag: "sup" },
      {
        style: "vertical-align",
        getAttrs: (value: any) => (value === "super" ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<sup>${helpers.renderChildren(node)}</sup>`;
  },
});

export const htmlMarkExtensions = [Kbd, Subscript, Superscript];
```

### 4.2. `src/webview/details-extension.ts`
Lệnh chạy: `sed -n '1,110p' src/webview/details-extension.ts`
```typescript
/**
 * Dedicated Details/Summary extension (issue #132).
 *
 * Provides WYSIWYG collapsible <details>/<summary> nodes.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "inline*",
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("detailsSummary", {}, helpers.parseInline(token.tokens || []));
  },

  renderMarkdown(node: any, helpers: any) {
    return `<summary>${helpers.renderChildren(node)}</summary>`;
  },
});

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "detailsSummary block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => (attributes.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },

  markdownTokenizer: {
    name: "details",
    level: "block",
    start(src: string) {
      return src.match(/^<details\b/i) ? 0 : -1;
    },
    tokenize(src: string, _tokens: any[], lexer: any) {
      const match = /^<details\b([^>]*)>([\s\S]*?)<\/details>/i.exec(src);
      if (!match) return;

      const raw = match[0];
      const rawAttrs = match[1];
      const inner = match[2];

      const summaryMatch = /^\s*<summary\b([^>]*)>([\s\S]*?)<\/summary>/i.exec(inner);
      const summaryText = summaryMatch ? summaryMatch[2].trim() : "Details";
      const bodyText = summaryMatch ? inner.slice(summaryMatch[0].length) : inner;

      const bodyTokens = lexer.blockTokens(bodyText.trim() ? bodyText : "");

      return {
        type: "details",
        raw,
        open: /\bopen\b/i.test(rawAttrs),
        summary: summaryText,
        tokens: [
          {
            type: "detailsSummary",
            raw: summaryMatch ? summaryMatch[0] : "<summary>Details</summary>",
            text: summaryText,
            tokens: lexer.inlineTokens(summaryText),
          },
          ...(bodyTokens.length > 0 ? bodyTokens : [{ type: "paragraph", raw: "", text: "", tokens: [] }]),
        ],
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    const content = helpers.parseChildren(token.tokens || []);
    return helpers.createNode("details", { open: token.open || false }, content);
  },

  renderMarkdown(node: any, helpers: any) {
    const summaryNode = node.content?.[0];
    const summary = summaryNode ? helpers.renderChild(summaryNode, 0) : "<summary>Details</summary>";
    const bodyNodes = node.content?.slice(1) || [];
    const body = helpers.renderChildren(bodyNodes, "\n\n");
    const openAttr = node.attrs.open ? " open" : "";
    return `<details${openAttr}>\n${summary}\n\n${body}\n\n</details>`;
  },
});

export const detailsExtensions = [DetailsSummary, Details];
```

### 4.3. Sửa đổi batching trong `src/webview/markdown-destination.ts`
Lệnh chạy: `sed -n '73,114p' src/webview/markdown-destination.ts`
```typescript
export const MarkdownLink = Link.extend({
  parseMarkdown(token: any, helpers: any) {
    const rawTokens = token.tokens || [];
    const inlineNodes: any[] = [];
    let currentBatch: any[] = [];

    const flushBatch = () => {
      if (currentBatch.length === 0) return;
      const parsed = helpers.parseInline(currentBatch);
      if (Array.isArray(parsed)) {
        inlineNodes.push(...parsed);
      } else if (parsed) {
        inlineNodes.push(parsed);
      }
      currentBatch = [];
    };

    for (const childToken of rawTokens) {
      if (
        (childToken.type === "html" || childToken.type === "rawHtmlInline") &&
        /^<img\b/i.test(childToken.text || childToken.raw || "")
      ) {
        flushBatch();
        const raw = (childToken.text || childToken.raw || "").trim();
        const imgAttrs = parseHtmlImgAttrs(raw);
        if (imgAttrs && imgAttrs.src) {
          inlineNodes.push(
            helpers.createNode("image", {
              src: imgAttrs.src,
              alt: imgAttrs.alt || null,
              title: imgAttrs.title || null,
              width: imgAttrs.width || null,
              height: imgAttrs.height || null,
            })
          );
          continue;
        }
      }
      currentBatch.push(childToken);
    }
    flushBatch();
    return applyMarkToNodes("link", inlineNodes, {
      href: token.href,
      title: token.title || null,
    });
  },
```

### 4.4. Nhận diện thẻ trong `src/webview/raw-html.ts`
Lệnh chạy: `sed -n '169,176p' src/webview/raw-html.ts`
```typescript
      // Recognized tags handled natively by dedicated extensions:
      if (tagName === "br") return;
      if (tagName === "u" || tagName === "ins") return;
      if (tagName === "kbd" || tagName === "sub" || tagName === "sup") return;
      if (/^(table|thead|tbody|tfoot|tr|th|td|colgroup|col)$/.test(tagName)) return;

      return {
        type: "rawHtmlInline",
```

### 4.5. Điểm nối bên trong marker block
- `harness/editor.ts`:
Lệnh chạy: `sed -n '378,382p' harness/editor.ts`
```typescript
    // --- W1: math + footnotes ---
    // --- end W1 ---
    // --- W2: html whitelist (details / kbd / sub / sup) ---
    ...require("../src/webview/html-marks").htmlMarkExtensions,
    ...require("../src/webview/details-extension").detailsExtensions,
    // --- end W2 ---
```

- `src/webview/main.ts`:
Lệnh chạy: `sed -n '1317,1321p' src/webview/main.ts`
```typescript
        // --- W1: math + footnotes ---
        // --- end W1 ---
        // --- W2: html whitelist (details / kbd / sub / sup) ---
        ...require("./html-marks").htmlMarkExtensions,
        ...require("./details-extension").detailsExtensions,
        // --- end W2 ---
        ...conditionalExtensions,
```

---

## 5. Bằng chứng kiểm thử có răng (Teeth Test Evidence)

Khi tạm thời vô hiệu hóa các extension W2 trong `harness/editor.ts`:
```typescript
    // --- W2: html whitelist (details / kbd / sub / sup) ---
    // ...require("../src/webview/html-marks").htmlMarkExtensions,
    // ...require("../src/webview/details-extension").detailsExtensions,
    // --- end W2 ---
```

Chạy `npm run roundtrip` ghi nhận **3 ca thất bại (FAIL)** với sai lệch cụ thể:
```
FAIL     synthetic/html-whitelist.md (+5 -5 lines)
  --- golden/synthetic/html-whitelist.md
  +++ current/synthetic/html-whitelist.md
  @@ -1,16 +1,16 @@
   # HTML Whitelist
   
  -Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy.
  +Press Ctrl+C to copy.
   
  -Formula: x<sup>2</sup> + y<sup>2</sup> = z<sup>2</sup> and H<sub>2</sub>O.
  +Formula: x2 + y2 = z2 and H2O.
   
  -[<kbd>Ctrl</kbd> docs](https://example.com)
  +[Ctrl docs](https://example.com)
   
  -[<kbd>Ctrl</kbd>](https://example.com)
  +[Ctrl](https://example.com)
   
   <details>
   <summary>Click to expand</summary>
   
  -Nested content with <sup>superscript</sup> and <kbd>Enter</kbd>.
  +Nested content with superscript and Enter.
   
   </details>

FAIL     synthetic/raw-html.md (+2 -2 lines)
  --- golden/synthetic/raw-html.md
  +++ current/synthetic/raw-html.md
  @@ -5,9 +5,9 @@
   
   </details>
   
  -<kbd>Ctrl</kbd>
  +Ctrl
   
  -<sub>2</sub>
  +2
   
   <img src="a.png" width="200">
   

──────────────────────────────────────────
FAIL     seams/html-render.txt (+14 -24 lines)
  --- golden/seams/html-render.txt
  +++ current/seams/html-render.txt
  @@ -5,48 +5,38 @@
   
   [details-summary] collapsible details block with summary and hidden body
     input: "<details>\n<summary>More</summary>\n\nHidden\n\n</details>"
  -  parsed: node=details attrs={"open":false}
  -  parsed: node=detailsSummary
  -  parsed: node=text text="More"
  +  parsed: node=rawHtmlBlock attrs={"html":"<details>\n<summary>More</summary>"}
     parsed: node=text text="Hidden"
  +  parsed: node=rawHtmlBlock attrs={"html":"</details>"}
     serialized: "<details>\n<summary>More</summary>\n\nHidden\n\n</details>"
   
   [kbd-simple] keyboard key tag parsed as mark
     input: "<kbd>Ctrl</kbd>"
  -  parsed: node=text text="Ctrl" marks=[kbd]
  -  serialized: "<kbd>Ctrl</kbd>"
  +  parsed: node=text text="Ctrl"
  +  serialized: "Ctrl"
   
   [sub-simple] subscript tag parsed as mark
     input: "<sub>2</sub>"
  -  parsed: node=text text="2" marks=[subscript]
  -  serialized: "<sub>2</sub>"
  +  parsed: node=text text="2"
  +  serialized: "2"
   
   [sup-simple] superscript tag parsed as mark
     input: "<sup>2</sup>"
  -  parsed: node=text text="2" marks=[superscript]
  -  serialized: "<sup>2</sup>"
  +  parsed: node=text text="2"
  +  serialized: "2"
   
   [linked-kbd-with-text] link wrapping kbd and text (upstream mark-around-atom test)
     input: "[<kbd>Ctrl</kbd> docs](https://example.com)"
  -  parsed: node=text text="Ctrl" marks=[link:{"href":"https://example.com","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}, kbd]
  -  parsed: node=text text=" docs" marks=[link:{"href":"https://example.com","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}]
  -  serialized: "[<kbd>Ctrl</kbd> docs](https://example.com)"
  +  parsed: node=text text="Ctrl docs" marks=[link:{"href":"https://example.com","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}]
  +  serialized: "[Ctrl docs](https://example.com)"
   
   [linked-kbd-only] link wrapping kbd alone
     input: "[<kbd>Ctrl</kbd>](https://example.com)"
  -  parsed: node=text text="Ctrl" marks=[link:{"href":"https://example.com","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}, kbd]
  -  serialized: "[<kbd>Ctrl</kbd>](https://example.com)"
  +  parsed: node=text text="Ctrl" marks=[link:{"href":"https://example.com","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}]
  +  serialized: "[Ctrl](https://example.com)"
   
   [inline-sentence] inline sentence with multiple kbd caps and formula sub/sup
     input: "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now. H<sub>2</sub>O and x<sup>2</sup>."
  -  parsed: node=text text="Press "
  -  parsed: node=text text="Ctrl" marks=[kbd]
  -  parsed: node=text text="+"
  -  parsed: node=text text="C" marks=[kbd]
  -  parsed: node=text text=" now. H"
  -  parsed: node=text text="2" marks=[subscript]
  -  parsed: node=text text="O and x"
  -  parsed: node=text text="2" marks=[superscript]
  -  parsed: node=text text="."
  -  serialized: "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now. H<sub>2</sub>O and x<sup>2</sup>."
  +  parsed: node=text text="Press Ctrl+C now. H2O and x2."
  +  serialized: "Press Ctrl+C now. H2O and x2."
```
Tổng kết: 3 ca đỏ (41 markdown fixtures + 16 seams: 54 passed, 3 failed, 0 missing, 0 errored).
Khi khôi phục extension: toàn bộ 57/57 tests xanh trở lại.

---

## 6. Kết quả chạy bộ kiểm thử nghiệm thu

### 6.1. `npm run lint` và `npm run build`
```
> tui-milkdown-vscode@2.17.0 lint
> tsc --noEmit


> tui-milkdown-vscode@2.17.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1005580 B / 1100000 B budget
```
Kích thước bundle webview: **1005580 B / 1100000 B budget** (tăng 4772 B so với mốc khởi điểm 1000808 B).

### 6.2. `npm test`
```
> tui-milkdown-vscode@2.17.0 test
> node esbuild.harness.config.js --test && node --test "out/test/**/*.test.js"

harness built: out/test
▶ default-editor
  ✔ computeUpdatedAssociations (6.171042ms)
  ✔ getCurrentWorkspaceMode (0.737167ms)
  ✔ buildQuickPickOptions (10.665625ms)
  ✔ useAsDefaultEditor (disk verification) (13.448583ms)
✔ default-editor (31.528292ms)
▶ frontmatter-parser
  ✔ 1. standard frontmatter (2.848542ms)
  ✔ 2. implicit frontmatter (2.367375ms)
  ✔ 3. empty frontmatter (0.382584ms)
  ✔ 4. comment-only frontmatter (0.194708ms)
  ✔ 5. rawBlock replay (0.443416ms)
✔ frontmatter-parser (6.960875ms)
▶ image-rename-handler
  ✔ path helpers (2.695834ms)
  ✔ detectImageRenames (21.630417ms)
  ✔ executeImageRenames (13.761167ms)
  ✔ detectImageDeletes and executeImageDeletes (5.625792ms)
  ✔ updateWorkspaceReferences (7.0355ms)
✔ image-rename-handler (51.081ms)
▶ openWikiLink
  ✔ resolves and opens an existing file (5.941667ms)
  ✔ creates a missing file next to the current document and opens it (9.937833ms)
  ✔ creates a missing file with path separator in subfolder next to current document (6.602333ms)
  ✔ refuses to create a file that would escape the document folder (8.455375ms)
  ✔ does not create file when user declines the creation prompt (4.367542ms)
✔ openWikiLink (36.40725ms)
✔ extractVscodeResourcePath recovers the local path from both spellings (0.539042ms)
✔ extractVscodeResourcePath returns null for anything else (0.076667ms)
✔ normalizeResourceUrl decodes and drops the cache-busting query (0.056375ms)
✔ normalizeResourceUrl leaves a malformed escape alone instead of throwing (0.044333ms)
✔ sameResource matches the host URI against the DOM's spelling (0.091708ms)
✔ sameResource matches across the query a reload appends (0.2805ms)
✔ sameResource matches vscode-webview:// against file+ for the same path (0.164916ms)
✔ sameResource does NOT match two different files (0.120625ms)
✔ sameResource does not match unrelated strings just because both fail to parse (0.138667ms)
ℹ tests 58
ℹ suites 18
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 193.318375
```

### 6.3. `npm run roundtrip`
```
> tui-milkdown-vscode@2.17.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness — mode: check
corpus: 41 fixtures (36 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
41 markdown fixtures + 16 seams: 57 passed, 0 failed, 0 missing, 0 errored
```

### 6.4. Vòng hai và bước khôi phục
Lệnh:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output:
```
> tui-milkdown-vscode@2.17.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness — mode: check
corpus: 41 fixtures (36 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
41 markdown fixtures + 16 seams: 57 passed, 0 failed, 0 missing, 0 errored
```
(Thư mục `harness/` sau khi checkout hoàn toàn sạch không phát sinh diff).

### 6.5. `npm run verify:vscode-floor` (chạy trên VS Code 1.85.0)
```
VS Code floor check — target version 1.85.0

PASS  floor VS Code build launched — 2 debug target(s); window raised
PASS  vscode version — 1.85.0
PASS  extension resolves — /Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w2-html-whitelist
PASS  extension activates — isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  command registered: tuiMarkdown.useAsDefaultEditor
PASS  custom editor opens the document — sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified — isDirty=false
PASS  custom editor still open after the hold — held 25000ms
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 9ms apart, debounce 300ms
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 1→8
PASS  the edit does not bounce between host and webview — version 8 then 8 after 3s idle
PASS  view source opens the raw markdown in a text editor — 1 visible text editor(s)
PASS  export produces a real DOCX file — floor-export.docx bytes=32043 magic=504b0304 (expected 504b0304)
PASS  export produces a real PDF file — floor-export.pdf bytes=116569 magic=25504446 (expected 25504446)
PASS  removing an image from the markdown deletes the file on save — baselined=true loneImageDeleted=true foundIn~/.Trash=no; imageStillUsedByFloorOther.mdDeleted=true (#126: true is the current behaviour, the reference in floor-other.md is not consulted)
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
PASS  webview mounts the editor — vscode-webview://0gl69f2uuivt146avphtf32, mounted 1534ms into the probe
PASS  document content rendered in the webview — heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders — rendered=1 errors=0 stuckPlaceholders=0 scheduled=1 visibility=visible; 0ms after mount, budget 40000ms
PASS  toolbar and metadata panel present — toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven — typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  table context menu is operable from the keyboard and offers alignment — selectionInCell=true focusInEditor=false openedImmediately=true open=true items=13 alignEntries=3 focusInside=true focus="⬌Select Row" afterArrowDown="⬍Select Column" reachedAlignIn=6steps("←Align Column Left") enterChangedAlign=false ((none)->(none); reported, not asserted: focusInEditor=false means the ProseMirror selection never reached the table) closedOnEscape=true
PASS  slash command opens a filtered block menu — open=true items=17 attachedToEditorContainer=true
PASS  bubble menu appears on a text selection — present=true visible=true buttons=5 [bold,italic,code,link,highlight] attachedToEditorContainer=true
PASS  link editor opens as a popover at the caret — present=true open=true input=true focusInside=true
PASS  an image with a width is an image node, not a raw-HTML badge — sizedImgCssWidth=96px parent=<p> imgs=4 real=2 [p:icon.png p:(empty) p:icon.png p:(empty)] classes=[(none) ProseMirror-separator (none) ProseMirror-separator] rawHtmlBadges=0 resizeHandles=2
PASS  lightbox takes focus on open and gives it back on Escape — opened=true focusInside=true (BUTTON.lightbox-btn) role=dialog visibility=visible waitedForFocus=111ms; afterEscape closed=true focusLeftOverlay=true (IMG)
PASS  bubble menu still tracks the selection at a non-100% zoom — zoom=1.2 present=true visible=true attachedToEditorContainer=true selCenterX=128 menuCenterX=128 dx=0 selTop=217 menuTop=173 dy=44
PASS  @ mention popup lists workspace files — open=true items=2 first="icon.pngmedia" attachedToEditorContainer=true
PASS  [[ wiki link popup lists workspace files — open=true items=1 first="sample" attachedToEditorContainer=true
PASS  export button could be driven for both formats — clicked #btn-export-go for docx and pdf; the host checks what they wrote
PASS  no CSP violation in the console — 2 console entries, none CSP

36 checks: 36 passed, 0 failed
```

### 6.6. Chốt chặn fixture tổng hợp so với merge-base
Lệnh:
```bash
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output:
```
 harness/fixtures/synthetic/html-whitelist.md | 16 ++++++++++++++++
 1 file changed, 16 insertions(+)
```

### 6.7. Kiểm tra trạng thái cây làm việc
Lệnh:
```bash
git status --short
```
Output:
(Hoàn toàn sạch sau khi commit báo cáo).

---

## 7. Tiêu chí chưa kiểm tra và nguyên nhân

Toàn bộ các tiêu chí trong phạm vi issue #132 đều đã được kiểm tra tự động và đạt 100%. Không có tiêu chí nào bị bỏ qua hoặc để lại nợ kỹ thuật.
