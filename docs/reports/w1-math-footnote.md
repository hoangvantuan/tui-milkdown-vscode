# Báo cáo kết quả Wave 8: Worker W1 (Issue #131)

- Nhánh: `hoangvantuan/w1-math-footnote`
- Merge-base: `9a48a76` (tách từ `develop`)
- Commit: `cc671f1` (`feat(math-footnote): implement math and footnote extensions (#131)`)
- Bundle webview: `1012396 B / 1100000 B budget` (dưới ngân sách 87.604 B)

---

## 1. Danh sách file và thay đổi

Lệnh sinh danh sách file thay đổi so với merge-base:
```sh
git diff --stat $(git merge-base develop HEAD)..HEAD
```
Output thật:
```
 harness/editor.ts                              |   2 +
 harness/fixtures/synthetic/math-passthrough.md |   9 +
 harness/golden/seams/math-footnote.txt         |  72 +++++-
 harness/golden/synthetic/math-passthrough.md   |   9 +
 harness/math-footnote-seam.ts                  | 139 ++++++++++-
 src/webview/editor.css                         |  59 +++++
 src/webview/footnote-extension.ts              | 301 ++++++++++++++++++++++++
 src/webview/main.ts                            |   2 +
 src/webview/math-extension.ts                  | 308 +++++++++++++++++++++++++
 9 files changed, 888 insertions(+), 13 deletions(-)
```

### Ranh giới marker block

Lệnh kiểm tra marker block:
```sh
git diff $(git merge-base develop HEAD)..HEAD -- harness/editor.ts src/webview/main.ts
```
Output thật:
```diff
diff --git a/harness/editor.ts b/harness/editor.ts
index 86c2289..c93a9c3 100644
--- a/harness/editor.ts
+++ b/harness/editor.ts
@@ -375,6 +375,8 @@ function buildMarkdownExtensions(
     // the two branches merge without a conflict. Delete the markers once 3.0
     // has shipped and the mirror is stable again.
     // --- W1: math + footnotes ---
+    ...require("../src/webview/math-extension").mathExtensions,
+    ...require("../src/webview/footnote-extension").footnoteExtensions,
     // --- end W1 ---
     // --- W2: html whitelist (details / kbd / sub / sup) ---
     // --- end W2 ---
diff --git a/src/webview/main.ts b/src/webview/main.ts
index d6ef87c..f5e4c97 100644
--- a/src/webview/main.ts
+++ b/src/webview/main.ts
@@ -1314,6 +1314,8 @@ function initEditor(initialContent: string = ""): Editor | null {
         // the two branches merge without a conflict. Delete the markers once 3.0
         // has shipped and the mirror is stable again.
         // --- W1: math + footnotes ---
+        ...require("./math-extension").mathExtensions,
+        ...require("./footnote-extension").footnoteExtensions,
         // --- end W1 ---
         // --- W2: html whitelist (details / kbd / sub / sup) ---
         // --- end W2 ---
```

---

## 2. Mã nguồn cơ chế chính

### 2.1 Tokenizer của InlineMath và BlockMath (`src/webview/math-extension.ts`)

Lệnh trích xuất InlineMath tokenizer:
```sh
sed -n '66,88p' src/webview/math-extension.ts
```
Output thật:
```ts
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start(src: string) {
      const match = src.match(/(^|[^\\])\$/);
      return typeof match?.index === "number" ? match.index + (match[1] ? match[1].length : 0) : -1;
    },
    tokenize(src: string) {
      // Delimiter rules:
      // 1. Opening $ not followed by whitespace or $
      // 2. Formula body contains no unescaped $ or newline
      // 3. Closing $ not preceded by whitespace
      // 4. Closing $ not followed by digit
      const match = src.match(/^\$((?:\\\$|[^\s\$\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\s\$\n]))?)\$(?!\d)/);
      if (!match) return undefined;
      return {
        type: "inlineMath",
        raw: match[0],
        latex: match[1],
        text: match[1],
        tokens: [],
      };
    },
```

Lệnh trích xuất BlockMath tokenizer:
```sh
sed -n '205,227p' src/webview/math-extension.ts
```
Output thật:
```ts
  markdownTokenName: "blockMath",

  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: () => -1,
    tokenize(src: string) {
      // Matches $$...$$ single-line or multi-line block
      const match = src.match(/^[ \t]{0,3}\$\$([ \t]*\n[\s\S]*?\n[ \t]*|[^\n]*?)\$\$(?:\n+|$)/);
      if (!match) return undefined;
      const rawContent = match[1];
      const isMultiline = rawContent.includes("\n");
      const latex = isMultiline ? rawContent.trim() : rawContent;
      return {
        type: "blockMath",
        raw: match[0],
        latex,
        text: latex,
        multiline: isMultiline,
      };
    },
  },
```

### 2.2 Tokenizer của FootnoteReference và FootnoteDefinition (`src/webview/footnote-extension.ts`)

Lệnh trích xuất FootnoteReference tokenizer:
```sh
sed -n '90,111p' src/webview/footnote-extension.ts
```
Output thật:
```ts
  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start(src: string) {
      const match = src.match(/(^|[^\\])\[\^/);
      return typeof match?.index === "number" ? match.index + (match[1] ? match[1].length : 0) : -1;
    },
    tokenize(src: string) {
      // Matches [^label] not followed by a colon
      const match = src.match(/^\[\^([^\]\s]+)\](?!\:)/);
      if (!match) return undefined;
      return {
        type: "footnoteReference",
        raw: match[0],
        label: match[1],
        text: match[0],
        tokens: [],
      };
    },
  },
```

Lệnh trích xuất FootnoteDefinition tokenizer:
```sh
sed -n '235,255p' src/webview/footnote-extension.ts
```
Output thật:
```ts
  markdownTokenName: "footnoteDefinition",

  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start: () => -1,
    tokenize(src: string) {
      // Matches [^label]: content
      // Allows optional 0-3 leading spaces; continuation lines continue until blank line or next footnote definition
      const match = src.match(/^[ \t]{0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?!\n|[ \t]{0,3}\[\^).*)*)(?:\n|$)/);
      if (!match) return undefined;
      const content = match[2].trimEnd();
      return {
        type: "footnoteDefinition",
        raw: match[0],
        label: match[1],
        content,
        text: content,
      };
    },
  },
```

### 2.3 CSS của Math và Footnotes (`src/webview/editor.css`)

Lệnh trích xuất CSS:
```sh
sed -n '2575,2635p' src/webview/editor.css
```
Output thật:
```css
/* --- Math & Footnotes (#131) --- */
.inline-math {
  display: inline-block;
  padding: 0 2px;
  vertical-align: baseline;
}
.block-math {
  display: flex;
  justify-content: center;
  margin: 16px 0;
  padding: 12px 16px;
  overflow-x: auto;
  text-align: center;
}
.footnote-reference {
  cursor: pointer;
  font-size: 0.8em;
  vertical-align: super;
  color: var(--vscode-textLink-foreground, #3794ff);
  padding: 0 2px;
  font-family: inherit;
  user-select: none;
}
.footnote-reference:hover {
  text-decoration: underline;
}
.footnote-definition {
  display: block;
  font-size: 0.9em;
  line-height: 1.5;
  color: var(--vscode-descriptionForeground, #71717a);
  padding: 4px 8px;
  margin: 6px 0;
  border-left: 2px solid var(--vscode-editorBracketHighlight-foreground1, #3b82f6);
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.08));
  border-radius: 2px;
}
.footnote-def-label {
  font-weight: 600;
  color: var(--vscode-textLink-foreground, #3794ff);
  margin-right: 6px;
}
.footnote-tooltip {
  position: absolute;
  z-index: 1000;
  max-width: 320px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground, #cccccc);
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  word-break: break-word;
}
```

---

## 3. Bằng chứng có răng (Teeth Test)

### 3.1 Đo đỏ trên nền `9a48a76` trước khi sửa code

Khi thêm fixture `harness/fixtures/synthetic/math-passthrough.md` và golden mong muốn vào nền `9a48a76`:
Lệnh chạy:
```sh
npm run roundtrip
```
Output thật (đỏ):
```
FAIL     synthetic/math-passthrough.md (+3 -4 lines)
  --- golden/synthetic/math-passthrough.md
  +++ current/synthetic/math-passthrough.md
  @@ -1,10 +1,9 @@
  -Fraction $\frac{a}{b}$ and $\alpha$.
  +Fraction $\\frac{a}{b}$ and $\\alpha$.
   
  -$$\int_0^1 x^2 dx$$
  +$$\\int\_0^1 x^2 dx$$
   
   $$
  -\int_0^1 x^2 dx
  +\\int\_0^1 x^2 dx
   $$
   
   It costs $5 and $10.
  -
```
Dấu `\` và `_` trong công thức bị `markdown-text-escape.ts` escape làm hỏng dữ liệu, trong khi `$5 and $10` được giữ nguyên.

### 3.2 Đo răng bằng cách gỡ bỏ extension khỏi `harness/editor.ts`

Tạm thời comment out extension trong `harness/editor.ts` để chứng minh seam và fixture phụ thuộc trực tiếp vào cơ chế:
Lệnh chạy:
```sh
npm run roundtrip
```
Output thật (đo được **9 ca đỏ**: 1 fixture hỏng và 8 ca seam hỏng):
```
FAIL     synthetic/math-passthrough.md (+3 -3 lines)
  --- golden/synthetic/math-passthrough.md
  +++ current/synthetic/math-passthrough.md
  @@ -1,9 +1,9 @@
  -Fraction $\frac{a}{b}$ and $\alpha$.
  +Fraction $\\frac{a}{b}$ and $\\alpha$.
   
  -$$\int_0^1 x^2 dx$$
  +$$\\int\_0^1 x^2 dx$$
   
   $$
  -\int_0^1 x^2 dx
  +\\int\_0^1 x^2 dx
   $$
   
   It costs $5 and $10.

──────────────────────────────────────────
FAIL     seams/math-footnote.txt (+11 -13 lines)
  --- golden/seams/math-footnote.txt
  +++ current/seams/math-footnote.txt
  @@ -5,27 +5,26 @@
   
   [inline-math-fraction] inline math with fraction and greek letter
     input: Fraction $\frac{a}{b}$ and $\alpha$.
  -  parsed: node=inlineMath attrs={"latex":"\\frac{a}{b}"}
  -  parsed: node=inlineMath attrs={"latex":"\\alpha"}
  -  serialized: Fraction $\frac{a}{b}$ and $\alpha$.
  +  parsed: (none)
  +  serialized: Fraction $\\frac{a}{b}$ and $\\alpha$.
   
   [inline-math-equation] inline math equation without special characters
     input: $E = mc^2$
  -  parsed: node=inlineMath attrs={"latex":"E = mc^2"}
  +  parsed: (none)
     serialized: $E = mc^2$
   
   [block-math-single-line] single-line block math formula
     input: $$\int_0^1 x^2 dx$$
  -  parsed: node=blockMath attrs={"latex":"\\int_0^1 x^2 dx","multiline":false}
  -  serialized: $$\int_0^1 x^2 dx$$
  +  parsed: (none)
  +  serialized: $$\\int\_0^1 x^2 dx$$
   
   [block-math-multi-line] multi-line block math formula
     input: $$
   \int_0^1 x^2 dx
   $$
  -  parsed: node=blockMath attrs={"latex":"\\int_0^1 x^2 dx","multiline":true}
  +  parsed: (none)
     serialized: $$
  -\int_0^1 x^2 dx
  +\\int\_0^1 x^2 dx
   $$
   
   [currency-not-math] dollar amounts that must remain plain text
  @@ -40,19 +39,18 @@
   
   [footnote-reference] inline footnote references in paragraph
     input: Here is note[^first] and [^second].
  -  parsed: node=footnoteReference attrs={"label":"first"}
  -  parsed: node=footnoteReference attrs={"label":"second"}
  +  parsed: (none)
     serialized: Here is note[^first] and [^second].
   
   [footnote-definition] single-line footnote definition
     input: [^first]: First footnote definition.
  -  parsed: node=footnoteDefinition attrs={"label":"first","content":"First footnote definition."}
  +  parsed: (none)
     serialized: [^first]: First footnote definition.
   
   [footnote-definition-multiline] multi-line footnote definition
     input: [^second]: Second footnote definition, which is long and spans
   multiple lines of text in the source.
  -  parsed: node=footnoteDefinition attrs={"label":"second","content":"Second footnote definition, which is long and spans\nmultiple lines of text in the source."}
  +  parsed: (none)
     serialized: [^second]: Second footnote definition, which is long and spans
   multiple lines of text in the source.
   
  @@ -60,7 +58,7 @@
     input: | Col |
   | --- |
   | Cell[^first] |
  -  parsed: node=footnoteReference attrs={"label":"first"}
  +  parsed: (none)
     serialized: | Col          |
   | ------------ |
   | Cell[^first] |
```

Số ca đỏ ghi nhận: **9 ca đỏ** (1 fixture và 8 mục kiểm trong seam).

---

## 4. Kết quả kiểm thử trọn bộ (Full Verification)

### 4.1 `npm run lint`
Output thật:
```
> tui-milkdown-vscode@2.17.0 lint
> tsc --noEmit
```
(Thoát mã 0, không có lỗi linter/typecheck).

### 4.2 `npm run build`
Output thật:
```
> tui-milkdown-vscode@2.17.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1012396 B / 1100000 B budget
```

### 4.3 `npm test`
Output thật:
```
> tui-milkdown-vscode@2.17.0 test
> node esbuild.harness.config.js --test && node --test "out/test/**/*.test.js"

harness built: out/test
ℹ tests 58
ℹ suites 18
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 131.770166
```

### 4.4 `npm run roundtrip`
Output thật:
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

### 4.5 Vòng hai và bước khôi phục
Lệnh chạy:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output thật:
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
(Lệnh `git status --short harness/` trả về rỗng).

### 4.6 `npm run verify:vscode-floor`
Lệnh chạy:
```sh
npm run verify:vscode-floor
```
Output thật:
```
VS Code floor check — target version 1.85.0

PASS  floor VS Code build launched — 2 debug target(s); window raised
PASS  vscode version — 1.85.0
PASS  extension resolves — /Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w1-math-footnote
PASS  extension activates — isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  command registered: tuiMarkdown.useAsDefaultEditor
PASS  custom editor opens the document — sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified — isDirty=false
PASS  custom editor still open after the hold — held 25000ms
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 10ms apart, debounce 300ms
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 1→8
PASS  the edit does not bounce between host and webview — version 8 then 8 after 3s idle
PASS  view source opens the raw markdown in a text editor — 1 visible text editor(s)
PASS  export produces a real DOCX file — floor-export.docx bytes=32048 magic=504b0304 (expected 504b0304)
PASS  export produces a real PDF file — floor-export.pdf bytes=116569 magic=25504446 (expected 25504446)
PASS  removing an image from the markdown deletes the file on save — baselined=true loneImageDeleted=true foundIn~/.Trash=no; imageStillUsedByFloorOther.mdDeleted=true (#126: true is the current behaviour, the reference in floor-other.md is not consulted)
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
PASS  webview mounts the editor — vscode-webview://1bhmhhof9b6kr5drj2jtlo0, mounted 1547ms into the probe
PASS  document content rendered in the webview — heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders — rendered=1 errors=0 stuckPlaceholders=0 scheduled=1 visibility=visible; 0ms after mount, budget 40000ms
PASS  toolbar and metadata panel present — toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven — typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  table context menu is operable from the keyboard and offers alignment — selectionInCell=true focusInEditor=false openedImmediately=true open=true items=13 alignEntries=3 focusInside=true focus="⬌Select Row" afterArrowDown="⬍Select Column" reachedAlignIn=6steps("←Align Column Left") enterChangedAlign=false ((none)->(none); reported, not asserted: focusInEditor=false means the ProseMirror selection never reached the table) closedOnEscape=true
PASS  slash command opens a filtered block menu — open=true items=17 attachedToEditorContainer=true
PASS  bubble menu appears on a text selection — present=true visible=true buttons=5 [bold,italic,code,link,highlight] attachedToEditorContainer=true
PASS  link editor opens as a popover at the caret — present=true open=true input=true focusInside=true
PASS  an image with a width is an image node, not a raw-HTML badge — sizedImgCssWidth=96px parent=<p> imgs=4 real=2 [p:icon.png p:(empty) p:icon.png p:(empty)] classes=[(none) ProseMirror-separator (none) ProseMirror-separator] rawHtmlBadges=0 resizeHandles=2
PASS  lightbox takes focus on open and gives it back on Escape — opened=true focusInside=true (BUTTON.lightbox-btn) role=dialog visibility=visible waitedForFocus=108ms; afterEscape closed=true focusLeftOverlay=true (IMG)
PASS  bubble menu still tracks the selection at a non-100% zoom — zoom=1.2 present=true visible=true attachedToEditorContainer=true selCenterX=128 menuCenterX=128 dx=0 selTop=217 menuTop=173 dy=44
PASS  @ mention popup lists workspace files — open=true items=2 first="icon.pngmedia" attachedToEditorContainer=true
PASS  [[ wiki link popup lists workspace files — open=true items=1 first="sample" attachedToEditorContainer=true
PASS  export button could be driven for both formats — clicked #btn-export-go for docx and pdf; the host checks what they wrote
PASS  no CSP violation in the console — 2 console entries, none CSP

36 checks: 36 passed, 0 failed
```

### 4.7 Chốt chặn bảo vệ fixture cũ
Lệnh chạy:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output thật:
```
 harness/fixtures/synthetic/math-passthrough.md | 9 +++++++++
 1 file changed, 9 insertions(+)
```
(Chỉ có 1 file fixture mới được thêm, 0 file cũ bị sửa).

### 4.8 `git status --short`
Lệnh chạy:
```sh
git status --short
```
(Output rỗng, sạch sẽ trước khi commit báo cáo).

---

## 5. Tự soát diff theo hai trục

### Trục 1: Quy ước `AGENTS.md`
- Tuân thủ cấu trúc phân tầng: không can thiệp bên ngoài marker block được giao trong `harness/editor.ts` và `src/webview/main.ts`.
- Sử dụng mô hình node attribute lưu trữ LaTeX và nội dung footnote, giải quyết triệt để vấn đề escape mà không làm sửa đổi quy tắc `installMarkdownTextEscape` chung.
- Không sửa file `.md` tại gốc repo, không vi phạm các ràng buộc cứng của sóng 8.

### Trục 2: Đúng phạm vi yêu cầu của issue #131
- Hoàn thành đầy đủ:
  1. Hỗ trợ `inlineMath` và `blockMath` lưu trữ source trong attribute node, vượt qua quá trình serialize không bị hỏng dấu gạch chéo ngược hay dấu gạch dưới.
  2. Tuân thủ bộ quy tắc delimiter của GitHub (giữ nguyên `$5 and $10`, không match khoảng trắng mở/đóng hay ký tự số liền sau `$`).
  3. Cung cấp renderer KaTeX lazy loading qua `loadArtifact("katex")` và tự động gắn link stylesheet từ `getKatexAssetsUri()`.
  4. Hỗ trợ footnote references và definitions với hiển thị chỉ số, tooltip hover preview nội dung định nghĩa, giữ nguyên passthrough byte-identical cho `footnotes-passthrough.md`.
- Hạn chế đã ghi nhận: KaTeX chưa có probe kiểm thử tự động trong `vscode-floor` do file mẫu `sample.md` chưa bổ sung công thức toán (đây là trách nhiệm của điều phối viên sau khi merge theo quy định tại TASK.md).
