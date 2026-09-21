# Báo cáo hoàn thành nhiệm vụ W10: Extension factory, main.ts chuyển sang factory (#145)

Nhánh: `hoangvantuan/w10-main-factory`
Commit cơ sở (develop): `efe382d`
Ticket: #145 (thuộc spec cha #137)

---

## 1. Tóm tắt những việc đã làm

- Đã chuyển đổi `initEditor` trong `src/webview/main.ts` sang sử dụng `buildMarkdownExtensions` từ module nhà máy mở rộng dùng chung `src/webview/extension-factory.ts` (#143, #145).
- Đã xóa bỏ toàn bộ 12 định nghĩa phản chiếu (mirror definitions) từng tồn tại song song giữa webview và harness:
  - `EscapeToken`: xử lý token escape từ marked parser.
  - `BlankLineHandler`: phân tích marked space tokens thành empty paragraphs.
  - `CustomUnderline`: xử lý thẻ `<ins>`, `<u>` và style `text-decoration`.
  - Bản patch prototype `MarkdownManager.prototype` (#95): bảo toàn dòng trống liên tiếp (được factory thực thi ngay khi import với guard idempotent).
  - `expandPrefixTabsInText`: chuẩn hóa tab thụt lề đầu dòng và sau marker danh sách.
  - `createCustomMarked`: cấu hình lexer tùy chỉnh sử dụng `expandPrefixTabsInText`.
  - `Blockquote.extend`: nhận diện GitHub alerts (`[!NOTE]`, `[!TIP]`, v.v.).
  - `Document.extend`: tuần tự hóa tài liệu Markdown với dòng trống chính xác.
  - `CodeBlockLowlight.extend`: độ dài rào chắn fence động cho code block lồng nhau.
  - `Table.extend`: tuần tự hóa bảng GFM nhiều dòng (`renderTableToMarkdown`).
  - Danh sách ngôn ngữ highlight cho lowlight (`LOWLIGHT_LANGUAGES`).
  - Cấu hình cờ `StarterKit.configure` và các tùy chọn `Markdown.configure`.
- Đã dọn dẹp các khối import không còn dùng trong `src/webview/main.ts` (các module highlight.js, tiptap markdown extensions đã được factory bao trọn).
- Đã xóa bỏ hoàn toàn các marker phân định sở hữu của wave 8 (`--- wave 8 ownership markers ---`, `--- W1 ---`, `--- W2 ---`, `--- end W ---`) trong `src/webview/main.ts`.
- Giữ nguyên các extension UI/DOM đặc thù của webview (`Placeholder`, `CodeExitHandler`, `MermaidDiagram`, `TableContextMenu`, `SearchPlugin`, `FileMention`, `WikiLinkSuggestion`, `SlashCommand`, `EmojiSuggestion`, `createBubbleMenuExtension`, `conditionalExtensions`).
- Dung lượng webview bundle giảm từ 1025959 B xuống 1023736 B (giảm 2223 B, nằm trong ngân sách 1100000 B).
- Toàn bộ các bộ kiểm tra tự động đều đạt: lint sạch, test 85/85, roundtrip 60/60 (vòng 1 và vòng 2 khôi phục), floor check 54/55 đạt (1 check đỏ là rename #142 cố ý).

---

## 2. Bằng chứng nghiệm thu từng tiêu chí

### 2.1. Tiêu chí 1: Xóa bỏ hoàn toàn định nghĩa phản chiếu trong src/webview/main.ts

Lệnh kiểm tra các định nghĩa phản chiếu:
```sh
grep -n -E 'Extension\.create|\.extend\(|MarkdownManager\.prototype|expandPrefixTabsInText|createCustomMarked' src/webview/main.ts
```
Output:
```
72:const CodeExitHandler = Extension.create({
```
Kết quả: Chỉ còn đúng `CodeExitHandler` (extension UI xử lý phím ArrowRight cho code mark, được phép giữ lại theo quy định của TASK.md). Toàn bộ 12 định nghĩa phản chiếu Markdown đã được xóa bỏ khỏi `src/webview/main.ts`.

---

### 2.2. Tiêu chí 2: Xóa bỏ marker sở hữu wave 8

Lệnh kiểm tra marker wave 8 trong `src/webview/main.ts`:
```sh
grep -c -E 'wave 8 ownership markers|--- W1|--- W2|--- end W' src/webview/main.ts; echo "exit=$?"
```
Output:
```
0
exit=1
```
Kết quả: Trả về 0, không còn bất kỳ marker wave 8 nào trong `src/webview/main.ts`.

---

### 2.3. Tiêu chí 3: Phép thử có răng (Teeth test)

Làm sai cơ chế nhận diện Alert trong factory (`src/webview/extension-factory.ts`), sửa dòng gán `firstText` thành `null`:
```sh
sed -i '' 's/const firstText = getFirstText(token);/const firstText = null; \/\/ BROKEN FOR TEETH TEST/' src/webview/extension-factory.ts && npm run roundtrip 2>&1
```
Output khi bị phá:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness: mode: check
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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```
Kết quả: 60/60 passed. Phép thử chứng minh harness và sản phẩm thực tế cùng đo chung quy tắc từ extension factory.

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
webview bundle: 1023736 B / 1100000 B budget
```
Dung lượng webview bundle đạt 1023736 B (dưới ngân sách 1100000 B, giảm 2223 B so với mốc commit ban đầu 1025959 B).

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
ℹ duration_ms 145.632166
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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

#### Vòng hai và bước khôi phục
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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```
Trạng thái `git status --short harness/` hoàn toàn sạch sau bước khôi phục.

#### npm run verify:vscode-floor
Lệnh:
```sh
npm run verify:vscode-floor
```
Output:
```
PASS  emoji picker loads its lazy dataset and lists matches: open=true items=20 attachedToEditorContainer=true
PASS  drag handle loads lazily and follows the block under the pointer: present=true attachedToEditorContainer=true hoveredAt=396,147 handleTop=95 dy(vs hovered block)=0 scrolledIntoView=false placed=true styleTop=912.391px position=absolute offsetParent=DIV containerScrollTop=869 visibility=visible underPointer="P:" handleLinesUpWith="P:"
PASS  bubble menu appears on a text selection: present=true visible=true buttons=5 [bold,italic,code,link,highlight] attachedToEditorContainer=true
PASS  link editor opens as a popover at the caret: present=true open=true input=true focusInside=true
PASS  an image with a width is an image node, not a raw-HTML badge: sizedImgCssWidth=96px parent=<p> imgs=4 real=2 [p:icon.png p:(empty) p:icon.png p:(empty)] classes=[(none) ProseMirror-separator (none) ProseMirror-separator] rawHtmlBadges=0 resizeHandles=2
PASS  lightbox takes focus on open and gives it back on Escape: opened=true focusInside=true (BUTTON.lightbox-btn) role=dialog visibility=visible waitedForFocus=0ms; afterEscape closed=true focusLeftOverlay=true (IMG)
PASS  bubble menu still tracks the selection at a non-100% zoom: zoom=1.2 present=true visible=true attachedToEditorContainer=true selCenterX=132 menuCenterX=132 dx=0 selTop=219 menuTop=175 dy=44
PASS  @ mention popup lists workspace files: open=true items=3 first="icon.pngmedia" attachedToEditorContainer=true
PASS  [[ wiki link popup lists workspace files: open=true items=2 first="links-here" attachedToEditorContainer=true
PASS  drag handle still tracks its block at a non-100% zoom: zoom=1.2 present=true attachedToEditorContainer=true blockTop=161 handleTop=161 dy=0 blockHeight=103 placed=true styleTop=1060px visibility=visible underPointer="P:" handleLinesUpWith="P:"
PASS  KaTeX fonts load and the glyphs are not a fallback face: check=true anyLoaded=true faces=20 families=KaTeX_AMS,KaTeX_Caligraphic,KaTeX_Fraktur,KaTeX_Main status=loaded width(KaTeX_Main)=247 width(missing font)=245
PASS  a click on <summary> opens and closes the disclosure: wasOpen=false afterFirstClick=true stillOpenAfter900ms=true attr=true afterSecondClick=false text="MoreHidden body."
PASS  hovering a footnote reference previews its definition: present=true visible=true text="The footnote body the hover preview must show." hoveredAt=352,413
PASS  backlinks panel lists the linking document and opens it on click: present=true visible=true hostAnswered=true entries=1 first="links-here.mdlinks-here.mdThis one point" clicked=true rightOfEditor=true panelLeft=568 editorRight=568 borderLeft=1px borderRight=0px toggleAfterPanel=true tocSide=hidden
PASS  focus mode hides the chrome and gives it back: bodyFlag=true toolbar=hidden matchesRule=true sheetRules=1 toc=hidden progress=hidden exitButton=true restored=true bodyClass="vscode-dark theme-frame-dark dark-theme focus-mode"
PASS  dragging the handle reorders the block: moved=true draggedBlockChangedIndex=true index 1->19 source="Some bold text" target="[[" dataTransferTypes=""
      before: ▼H1Heading One|Some bold text|Column AColumn|Task item chec|javascript con|flowchart TD
 |#m200-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0
      after:  ▼H1Heading One|Column AColumn|Task item chec|javascript con|flowchart TD
 |#m162-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0^|MoreHidden bo
PASS  double-click image rename could be driven: picked the last of 2 icon.png img(s) of 4 total; src was https://file%2B.vscode-resource.vscode-cdn.net/tmp/tuimd-flo...; nodes now on icon-renamed=1 after 253ms (0 means the host never answered or the plugin never updated the node; the host records what the file holds)
PASS  export button could be driven for both formats: clicked #btn-export-go for docx and pdf; the host checks what they wrote
PASS  no CSP violation in the console: 4 console entries, none CSP

55 checks: 54 passed, 1 failed

--- VS Code output ---
Error: 1 extension-host check(s) failed: double-click rename leaves every reference on the new relative path (#142)
```
Kết quả: 54/55 checks đạt (đúng 1 check đỏ là kiểm thử đổi tên #142 cố ý theo đúng quy định tại `COMMON.md`). Các check then chốt `webview mounts the editor`, `document content rendered`, `lazy KaTeX/mermaid artifact loads` đều xanh hoàn toàn.

---

### 2.5. Tiêu chí 5: Kiểm tra chốt chặn git diff

Lệnh:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: Rỗng (không có fixture synthetic nào bị thêm hoặc sửa).

Lệnh kiểm tra diff toàn bộ thay đổi so với merge-base:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat
```
Output:
```
 src/webview/main.ts | 356 +---------------------------------------------------
 1 file changed, 6 insertions(+), 350 deletions(-)
```

Lệnh kiểm tra trạng thái cây làm việc:
```sh
git status --short
```
Output: Rỗng (mọi thay đổi đã được commit).

---

## 3. Các đoạn mã then chốt

### 3.1. Header, imports và gọi installMarkdownTextEscape trong src/webview/main.ts
Lệnh sinh mã:
```sh
sed -n '1,70p' src/webview/main.ts
```
Mã nguồn:
```typescript
/**
 * Webview entry point: builds the Tiptap editor, wires the toolbar and the
 * message protocol with the extension host (markdownEditorProvider.ts).
 *
 * Load / save path: `parseContent()` splits frontmatter, the body is parsed
 * with `contentType: "markdown"`, then `transformTableCellsAfterParse()`;
 * on save `editor.getMarkdown()` + `reconstructContent()`. Edits are
 * debounced 300 ms into an `edit` message; pending edits are flushed
 * immediately on `visibilitychange` (hidden) and `pagehide`. However, an edit
 * message dispatched from `pagehide` can still be lost if VS Code disposes
 * the webview host before IPC delivery finishes. The provider's `pendingEdit`
 * flag (markdownEditorProvider.ts) keeps the resulting document change from
 * echoing back as an `update`. Markdown-relevant extensions are provided by
 * the shared extension factory (extension-factory.ts, #143, #145).
 *
 * Module scope calls `acquireVsCodeApi()`, so this file cannot be imported
 * from Node. Persist webview state with `{ ...getState(), key }`.
 */
import { Editor, Extension } from "@tiptap/core";
import { publishTiptapGlobals } from "./tiptap-globals";
import type {
  WebviewToHostMessage,
  HostToWebviewMessage,
} from "../shared/messages";
import { Placeholder } from "@tiptap/extension-placeholder";
import "./editor.css";
import "./themes/index.css";
import {
  parseContent,
  reconstructContent,
  validateYaml,
  type FrontmatterFormat,
} from "./frontmatter";
import { LineHighlight } from "./line-highlight-plugin";
import { HeadingLevel, headingSlug } from "./heading-level-plugin";
import { setupImageEditOverlay, handleUrlEditResponse, handleImageRenameResponse, setImageMap, promptForImageUrl } from "./image-edit-plugin";
import { transformTableCellsAfterParse } from "./table-cell-content-parser";
import { MermaidDiagram, updateMermaidTheme, clearMermaidCache } from "./mermaid-plugin";
import { TableContextMenu } from "./table-context-menu";
import { setupTocSidebar, updateTocFromEditor } from "./toc-sidebar";
import { HeadingCollapse, collapsePluginKey, getCollapsedHeadings, setCollapsedHeadings } from "./heading-collapse-plugin";
import { CodeBlockEnhancement } from "./code-block-plugin";
import { SearchPlugin, performSearch, clearSearch, searchNext, searchPrev, getMatchInfo, setCaseSensitivity, replaceCurrent, replaceAllMatches } from "./search-plugin";
import { initFontSelector, type FontSelectorAPI, sanitizeFontName } from "./font-selector";
import { initLightbox } from "./image-lightbox-plugin";
import { svgToPngBlob } from "./svg-to-png";
import { FileMention, setFileMentionFiles } from "./file-mention-plugin";
import { WikiLinkSuggestion, setWikiLinkFiles } from "./wiki-link-plugin";
import { installMarkdownTextEscape } from "./markdown-text-escape";
import { escapeHtml } from "./file-search-utils";
import { createBubbleMenuExtension } from "./bubble-menu";
import { initLinkPopover, type LinkPopoverController } from "./link-popover";
import { SlashCommand, setImageSrcProvider } from "./slash-command-plugin";
import { EmojiSuggestion } from "./emoji-plugin";
import { setupDragHandle } from "./drag-handle-plugin";
import { setupBacklinksPanel, updateBacklinks, refreshBacklinksIfVisible } from "./backlinks-panel";
import { setupFocusMode, handleFocusModeTransaction } from "./focus-mode";
import { buildMarkdownExtensions } from "./extension-factory";

// Install unified text escape overrides on MarkdownManager (#97, #99, #100, #101).
installMarkdownTextEscape();

// The slash menu's Image entry asks the host for a path through the same input
// box the image URL editor uses. Wired here because the plugin must stay free
// of any host handle.
setImageSrcProvider(promptForImageUrl);
```

### 3.2. Cấu hình mảng extension trong initEditor trong src/webview/main.ts
Lệnh sinh mã:
```sh
sed -n '943,989p' src/webview/main.ts
```
Mã nguồn:
```typescript
let currentListIndentation: { style: "space" | "tab"; size: number } = { style: "space", size: 2 };
let currentTabSize = 2;

// Editor initialization
function initEditor(initialContent: string = ""): Editor | null {
  // Publish Tiptap and ProseMirror on window BEFORE any lazy artifact can be
  // injected. An artifact that bundled its own ProseMirror would get its own
  // PluginKey identities and its own EditorState class, and the mismatch only
  // shows up at runtime (src/webview/tiptap-globals.ts).
  publishTiptapGlobals();

  const editorEl = getEditorEl();
  if (!editorEl) {
    console.error("[Tiptap] Editor element not found");
    showError("Editor element not found");
    return null;
  }

  try {
    // Build conditional extensions
    const conditionalExtensions = [
      HeadingLevel,
      HeadingCollapse,
      CodeBlockEnhancement,
      ...(highlightCurrentLine ? [LineHighlight] : []),
    ];

    const instance = new Editor({
      element: editorEl,
      extensions: [
        ...buildMarkdownExtensions({
          indentation: currentListIndentation,
          tabSize: currentTabSize,
        }),
        Placeholder.configure({
          placeholder: "Type something...",
        }),
        CodeExitHandler,
        MermaidDiagram,
        TableContextMenu,
        SearchPlugin,
        FileMention,
        WikiLinkSuggestion,
        SlashCommand,
        EmojiSuggestion,
        createBubbleMenuExtension({ onOpenLink: () => linkPopover?.open() }),
        ...conditionalExtensions,
      ],
      content: initialContent,
      contentType: 'markdown',
```

---

## 4. Tiêu chí chưa kiểm được và lý do

Không có. Toàn bộ các tiêu chí chấp nhận trong issue #145 và `TASK.md` đều đã được kiểm tra và thỏa mãn.

---

## 5. Câu chữ chuẩn bị cho CHANGELOG.md và AGENTS.md

### 5.1. Câu chữ cho CHANGELOG.md (mục Changed)
```markdown
- Switched `main.ts` to build markdown extensions via `extension-factory.ts` and eliminated local mirror definitions and wave 8 ownership markers (#145)
```

### 5.2. Câu chữ cho AGENTS.md

#### Trong mục Conventions & Gotchas:
Cập nhật câu mô tả về mối quan hệ giữa webview và harness:
```markdown
- `src/webview/main.ts` and `harness/editor.ts` both build their markdown-relevant extensions from `src/webview/extension-factory.ts` (#143, #145), ensuring production and the test harness share identical markdown rules with zero mirror definitions.
```
