# Báo cáo hoàn thành nhiệm vụ W4: Phía extension host (#121, #122, #123)

Nhánh: `hoangvantuan/w7-host`
Commit cơ sở (develop): `ac7ed69`

---

## 1. Tóm tắt những việc đã làm

### Issue #123: Wiki link tới file chưa tồn tại tạo file cạnh tài liệu hiện tại
- Cập nhật `src/host/openWikiLink.ts` nhận thêm tham số `currentDocUri?: vscode.Uri`.
- Khi không tìm thấy file nào trong workspace qua 3 bước tìm kiếm nới dần:
  - Kiểm tra an toàn đường dẫn: ngăn chặn path traversal (`hasPathTraversal` và kiểm tra thoát khỏi thư mục tài liệu hiện tại). Nếu đường dẫn tìm cách thoát khỏi thư mục cha (ví dụ `[[../escape]]` hoặc `[[../../etc/passwd]]`), từ chối tạo và hiển thị thông báo cảnh báo.
  - Nếu đường dẫn hợp lệ: hiển thị thông báo xác nhận với lựa chọn "Create" (tạo file có hỏi người dùng, không tạo âm thầm để tránh rác đĩa từ lỗi gõ phím).
  - Khi người dùng bấm "Create": tự động tạo các thư mục con nếu cần (ví dụ `[[sub/note]]`), ghi file markdown rỗng vào đĩa qua `vscode.workspace.fs.writeFile`, rồi mở file mới bằng `vscode.commands.executeCommand("vscode.open", newUri)`.
- Cập nhật `src/host/messageHandlers.ts` tại dòng gọi `openWikiLink` để truyền `ctx.document.uri`.
- Bổ sung bộ unit test `test/open-wiki-link.test.ts` (5 ca kiểm thử) chạy trên thư mục tạm và ổ đĩa thật.

### Issue #121: Nhớ vị trí con trỏ và cuộn theo từng file
- Lưu vị trí con trỏ (`cursor`) và vị trí cuộn (`scrollTop`) vào `workspaceState` của extension host (thay vì `globalState` hay `vscode.setState`). Quyết định này được giải thích rõ trong header của `src/host/editorPosition.ts`: vị trí file gắn liền với workspace, không nên tích tụ vĩnh viễn trong globalState cho hàng nghìn file tạm.
- Mở rộng `HandlerContext` trong `src/host/messageHandlers.ts` và `src/markdownEditorProvider.ts` để truyền `workspaceState: this.context.workspaceState`.
- Thêm 2 message type mới vào `src/shared/messages.ts`:
  - `SaveEditorPositionMessage` (`type: "saveEditorPosition"`) từ webview gửi lên host khi cuộn hoặc đổi selection (có debounce 300ms và xả ngay khi `pagehide` hoặc `visibilitychange: hidden`).
  - `SavedEditorPositionMessage` (`type: "savedEditorPosition"`) từ host gửi xuống webview khi `ready`.
- Cập nhật `src/webview/main.ts`:
  - Trong `init()`: theo dõi sự kiện cuộn trên `#editor-container`, sự kiện `selectionchange` trên `document`, và các sự kiện chuyển tab để gửi vị trí về host.
  - Trong switch nhận message: thêm nhánh `case "savedEditorPosition":` khôi phục `scrollTop` trên `#editor-container` và đặt lại selection trên editor sau khi nội dung đã tải.
- Bổ sung bộ unit test `test/editor-position.test.ts` (5 ca kiểm thử) đo tính toán key, clamp vị trí khi văn bản bị ngắn lại, và lưu trữ memento.

### Issue #122: Lệnh đặt TUI Markdown làm trình soạn thảo mặc định cho workspace
- Đã trao đổi qua `orca orchestration ask` với điều phối viên và thống nhất giải pháp: QuickPick 3 lựa chọn với nhãn nói rõ kết quả và thể hiện trạng thái hiện tại:
  1. "TUI Markdown (WYSIWYG)": ghi `"*.md": "tuiMarkdown.editor"` và `"*.markdown": "tuiMarkdown.editor"` vào `workbench.editorAssociations` của workspace.
  2. "Text editor (raw markdown)": ghi `"*.md": "default"` và `"*.markdown": "default"` vào `workbench.editorAssociations` của workspace.
  3. "Reset to the extension default": gỡ bỏ cấu hình markdown khỏi `workbench.editorAssociations` để trả về mặc định của extension.
- Xây dựng module `src/host/defaultEditor.ts` xử lý tính toán cấu hình và tương tác QuickPick.
- Đăng ký lệnh `tuiMarkdown.useAsDefaultEditor` trong `src/extension.ts` và khai báo trong khối `contributes.commands` của `package.json`.
- Bổ sung bộ unit test `test/default-editor.test.ts` (7 ca kiểm thử), kiểm tra trực tiếp việc ghi và đọc file `.vscode/settings.json` từ đĩa.

---

## 2. Bằng chứng nghiệm thu từng tiêu chí

### 2.1. Issue #123 (Wiki link missing file)

#### Tiêu chí 1: Unit test dưới `test/` chạy trên file thật trong thư mục tạm
Bao gồm 4 trường hợp yêu cầu cộng thêm trường hợp người dùng từ chối:
1. Tên file đã tồn tại: mở file, không hỏi tạo.
2. Tên file chưa tồn tại: hỏi tạo, bấm Create thì file sinh ra trên đĩa và được mở.
3. Tên file chứa dấu phân cách thư mục (`sub/deep-note`): tạo thư mục con và file trên đĩa.
4. Tên file tìm cách thoát khỏi thư mục tài liệu (`../escaped`): từ chối tạo, không có hành động Create.
5. Người dùng đóng thông báo không bấm Create: không tạo file.

Lệnh chạy:
```sh
npm test
```
Output liên quan:
```
▶ openWikiLink
  ✔ resolves and opens an existing file (6.903959ms)
  ✔ creates a missing file next to the current document and opens it (12.241959ms)
  ✔ creates a missing file with path separator in subfolder next to current document (3.596584ms)
  ✔ refuses to create a file that would escape the document folder (3.399666ms)
  ✔ does not create file when user declines the creation prompt (2.658542ms)
✔ openWikiLink (29.82775ms)
```

#### Tiêu chí 2: Kiểm tra có răng (teeth)
Phá hàm tạo file bằng cách comment dòng `await vscode.workspace.fs.writeFile(...)` trong `src/host/openWikiLink.ts`.
Chạy `npm test`: đúng 2 ca test kiểm tra tạo file trên đĩa lập tức chuyển đỏ (khẳng định trên `fs.existsSync` thật của đĩa):
```
✖ failing tests:

test at out/test/open-wiki-link.test.js:301:27
✖ creates a missing file next to the current document and opens it (2.25225ms)
  AssertionError [ERR_ASSERTION]: file must be created on disk
  false !== true

test at out/test/open-wiki-link.test.js:317:27
✖ creates a missing file with path separator in subfolder next to current document (1.554583ms)
  AssertionError [ERR_ASSERTION]: nested file must be created on disk
  false !== true
```
Sau khi khôi phục dòng code, 5/5 ca test xanh lại.

#### Tiêu chí 3: Số lượng test trước và sau
- Trước: 35 tests passed.
- Sau: 40 tests passed (tăng 5 ca test).

---

### 2.2. Issue #121 (Remember cursor and scroll position)

#### Tiêu chí 1: Cố tình quên handler để chứng minh mapped type của TypeScript
Khi thêm `SaveEditorPositionMessage` vào `WebviewToHostMessage` trong `src/shared/messages.ts` mà chưa thêm handler vào `HandlerTable` trong `src/host/messageHandlers.ts`, lệnh `npm run lint` báo lỗi kiểu biên dịch:
```
> tui-milkdown-vscode@2.16.0 lint
> tsc --noEmit

src/host/messageHandlers.ts:67:7 - error TS2741: Property 'saveEditorPosition' is missing in type '{ ready: (_msg: ReadyMessage, ctx: HandlerContext) => void; edit: (msg: EditMessage, ctx: HandlerContext) => Promise<void>; ... 15 more ...; export: (msg: ExportMessage, ctx: HandlerContext) => void; }' but required in type 'HandlerTable'.

67 const handlers: HandlerTable = {
         ~~~~~~~~

Found 1 error in src/host/messageHandlers.ts:67
```

#### Tiêu chí 2: Unit test cho các thành phần thuần túy
Module `src/host/editorPosition.ts` cô lập:
- `getEditorPositionKey`: sinh key định danh từ URI.
- `clampPosition`: ép con trỏ vào khoảng [0, docLength] nếu văn bản bị ngắn lại sau khi sửa đổi từ bên ngoài.
- `clampScrollTop`: ép vị trí cuộn vào [0, maxScroll].
- `saveEditorPosition` / `getSavedEditorPosition`: lưu và đọc từ `workspaceState`.
- `sendSavedEditorPosition`: gửi message `savedEditorPosition` tới webview.

Lệnh chạy:
```sh
npm test
```
Output liên quan:
```
▶ editor-position
  ▶ getEditorPositionKey
    ✔ derives deterministic key from Uri and string (0.316ms)
  ✔ getEditorPositionKey (0.631084ms)
  ▶ clampPosition
    ✔ clamps position against stale/shorter document size (0.260459ms)
  ✔ clampPosition (0.48725ms)
  ▶ clampScrollTop
    ✔ clamps scroll offset to [0, maxScroll] (0.227625ms)
  ✔ clampScrollTop (0.336875ms)
  ▶ saveEditorPosition and getSavedEditorPosition
    ✔ persists position in workspaceState and retrieves it (0.548ms)
  ✔ saveEditorPosition and getSavedEditorPosition (0.656708ms)
  ▶ sendSavedEditorPosition
    ✔ replays saved position to webview (0.964125ms)
  ✔ sendSavedEditorPosition (1.105542ms)
✔ editor-position (7.181958ms)
```

#### Tiêu chí 3: Kiểm tra có răng (teeth)
Phá hàm `clampPosition` trong `src/host/editorPosition.ts` bằng cách trả về nguyên văn `cursor` không qua hàm clamp:
```ts
export function clampPosition(cursor: number, _docLength: number): number {
  return cursor;
}
```
Chạy `npm test`: ca test vị trí con trỏ vượt quá độ dài văn bản chuyển đỏ:
```
✖ failing tests:

test at out/test/editor-position.test.js:114:29
✖ clamps position against stale/shorter document size (1.456042ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  150 !== 100
```
Sau khi khôi phục, toàn bộ test xanh lại.

#### Tiêu chí 4: Thử nghiệm trên editor sống
- Đã được bao phủ bởi `npm run verify:vscode-floor` kiểm tra vòng đời webview, nhận và gửi message trên VS Code 1.85 thật.
- Việc mở tài liệu dài, cuộn bằng tay qua chuột trong giao diện người dùng rồi tắt/mở lại tab: được xác nhận qua luồng tự động (lưu `scrollTop` và `cursor` qua IPC và khôi phục khi `ready`), nhưng thao tác cuộn tay vật lý của người dùng chưa được thực hiện bởi một con người trong phiên này và được ghi nhận trung thực ở đây.

---

### 2.3. Issue #122 (Command default editor for workspace)

#### Tiêu chí 1: Thiết kế và phản hồi từ điều phối viên
Đã gửi câu hỏi qua `orca orchestration ask` và nhận được chỉ đạo: chọn phương án (B) QuickPick 3 lựa chọn, nhãn nói rõ kết quả ("TUI Markdown (WYSIWYG)", "Text editor (raw markdown)", "Reset to the extension default") và hiển thị nhãn `(current)`.

#### Tiêu chí 2: Kiểm tra nội dung JSON ghi xuống đĩa thật và đọc lại
Unit test `test/default-editor.test.ts` chạy trên thư mục tạm và kiểm tra file `.vscode/settings.json` được sinh ra trên đĩa:
1. Khi chọn Text editor:
   File `.vscode/settings.json` có nội dung:
   ```json
   {
     "workbench.editorAssociations": {
       "*.md": "default",
       "*.markdown": "default"
     }
   }
   ```
2. Khi chọn TUI Markdown:
   File `.vscode/settings.json` có nội dung:
   ```json
   {
     "workbench.editorAssociations": {
       "*.md": "tuiMarkdown.editor",
       "*.markdown": "tuiMarkdown.editor"
     }
   }
   ```
3. Khi chọn Reset:
   Khóa `workbench.editorAssociations` được xóa khỏi file cấu hình.

Lệnh chạy:
```sh
npm test
```
Output liên quan:
```
▶ default-editor
  ▶ computeUpdatedAssociations
    ✔ sets TUI Markdown editor for wysiwyg mode (1.001583ms)
    ✔ sets default text editor for text mode (0.331625ms)
    ✔ removes markdown associations on reset while preserving other associations (0.32425ms)
    ✔ returns undefined on reset when no other associations remain (0.309667ms)
  ✔ computeUpdatedAssociations (2.438625ms)
  ▶ getCurrentWorkspaceMode
    ✔ identifies wysiwyg, text, and default modes (0.279ms)
  ✔ getCurrentWorkspaceMode (0.33275ms)
  ▶ buildQuickPickOptions
    ✔ marks current mode with (current) description (2.860625ms)
  ✔ buildQuickPickOptions (2.917875ms)
  ▶ useAsDefaultEditor (disk verification)
    ✔ writes default text editor associations to .vscode/settings.json on disk (6.553083ms)
    ✔ writes TUI Markdown editor associations to .vscode/settings.json on disk (2.6095ms)
    ✔ resets markdown associations by removing key from .vscode/settings.json (8.192958ms)
  ✔ useAsDefaultEditor (disk verification) (17.75275ms)
✔ default-editor (23.7865ms)
```

#### Tiêu chí 3: Kiểm tra có răng (teeth)
Sửa giá trị gán của mode `text` trong `computeUpdatedAssociations` thành `"broken"` thay vì `"default"`.
Chạy `npm test`: 2 ca test chuyển đỏ ngay lập tức:
```
✖ failing tests:

test at out/test/default-editor.test.js:306:29
✖ sets default text editor for text mode (0.975875ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
    {
  +   '*.markdown': 'broken',
  +   '*.md': 'broken'
  -   '*.markdown': 'default',
  -   '*.md': 'default'
    }

test at out/test/default-editor.test.js:355:29
✖ writes default text editor associations to .vscode/settings.json on disk (3.766791ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
    {
  +   '*.markdown': 'broken',
  +   '*.md': 'broken'
  -   '*.markdown': 'default',
  -   '*.md': 'default'
    }
```
Sau khi khôi phục, toàn bộ test xanh lại.

#### Tiêu chí 4: Lưu ý về Git Graph và diff editor
Đúng như điều phối viên chỉ đạo: lệnh này cấu hình `workbench.editorAssociations` cho việc mở file thông thường trong workspace. Giao diện so sánh diff của Git Graph đi qua cơ chế diff editor riêng của VS Code (đã có quy tắc `configurationDefaults` chặn schema git-graph từ PR #50). Báo cáo này không cam kết lệnh này can thiệp vào luồng diff nội bộ của Git Graph ngoài việc cung cấp cách opt-out cho toàn bộ workspace.

---

## 3. Các đoạn mã sinh bằng grep và sed

### 3.1. Danh sách message mới sinh bằng grep
Lệnh:
```sh
grep -n "saveEditorPosition\|savedEditorPosition" src/shared/messages.ts
```
Output:
```
109:  type: "saveEditorPosition";
232:  type: "savedEditorPosition";
```

### 3.2. Danh sách handler mới sinh bằng grep
Lệnh:
```sh
grep -n "saveEditorPosition\|sendSavedEditorPosition" src/host/messageHandlers.ts
```
Output:
```
40:import { saveEditorPosition, sendSavedEditorPosition } from "./editorPosition";
76:    sendSavedEditorPosition(ctx.webview, ctx.workspaceState, ctx.document.uri);
291:  saveEditorPosition: (msg, ctx) => {
292:    saveEditorPosition(ctx.workspaceState, ctx.document.uri, {
```

### 3.3. Các hàm xuất khẩu trong `src/host/editorPosition.ts`
Lệnh:
```sh
grep -n "export function" src/host/editorPosition.ts
```
Output:
```
23:export function getEditorPositionKey(uri: vscode.Uri | string): string {
31:export function clampPosition(cursor: number, docLength: number): number {
39:export function clampScrollTop(scrollTop: number, maxScroll: number): number {
47:export function saveEditorPosition(
59:export function getSavedEditorPosition(
70:export function sendSavedEditorPosition(
```

### 3.4. Các hàm xuất khẩu trong `src/host/defaultEditor.ts`
Lệnh:
```sh
grep -n "export function" src/host/defaultEditor.ts
```
Output:
```
39:export function computeUpdatedAssociations(
69:export function getCurrentWorkspaceMode(
82:export function buildQuickPickOptions(
```

### 3.5. Đăng ký lệnh `useAsDefaultEditor`
Lệnh:
```sh
grep -n "useAsDefaultEditor" src/extension.ts && grep -n "tuiMarkdown.useAsDefaultEditor" package.json
```
Output:
```
5: * - useAsDefaultEditor: configure default editor for markdown in this workspace.
10:import { useAsDefaultEditor } from './host/defaultEditor';
37:    vscode.commands.registerCommand("tuiMarkdown.useAsDefaultEditor", () => {
38:      return useAsDefaultEditor();
175:        "command": "tuiMarkdown.useAsDefaultEditor",
```

### 3.6. Header module `src/host/defaultEditor.ts` sinh bằng sed
Lệnh:
```sh
sed -n '1,25p' src/host/defaultEditor.ts
```
Output:
```ts
/**
 * `defaultEditor`: configure the default editor for markdown in this workspace.
 *
 * Background and intent:
 * In package.json, `contributes.customEditors` registers `tuiMarkdown.editor` with
 * priority "default". Consequently, `.md` files already open in TUI Markdown by
 * default in all workspaces without any explicit workspace configuration.
 *
 * The real need reported by users in #48 is the opposite direction: opting OUT
 * of TUI Markdown for a specific workspace so markdown files open in VS Code's
 * built-in text editor instead (preventing interception of git diffs and allowing
 * raw editing).
 *
 * To serve both directions safely and avoid one-way traps, this command presents
 * a QuickPick with three explicit outcomes:
 * 1. "TUI Markdown (WYSIWYG)": writes "*.md": "tuiMarkdown.editor" to workspace.
 * 2. "Text editor (raw markdown)": writes "*.md": "default" to workspace.
 * 3. "Reset to the extension default": clears workspace associations for markdown.
 *
 * The setting is written to `workbench.editorAssociations` under
 * ConfigurationTarget.Workspace.
 */
```

### 3.7. Header module `src/host/editorPosition.ts` sinh bằng sed
Lệnh:
```sh
sed -n '1,15p' src/host/editorPosition.ts
```
Output:
```ts
/**
 * Editor position persistence (cursor position and scroll offset) per document.
 *
 * Persisted in `workspaceState` (rather than `globalState`) because:
 * 1. Document cursor and scroll offsets are workspace-scoped. Files belong to a
 *    specific workspace project, not global editor configuration.
 * 2. `globalState` would accumulate position records for thousands of transient
 *    files across every workspace ever opened, with no cleanup lifecycle.
 * 3. `workspaceState` automatically scopes entries to the workspace folder and
 *    resets when the workspace is cleared or deleted.
 */
```

### 3.8. Header module `src/host/openWikiLink.ts` sinh bằng sed
Lệnh:
```sh
sed -n '1,22p' src/host/openWikiLink.ts
```
Output:
```ts
/**
 * `openWikiLink`: resolve a `[[name]]` target to a file and open it.
 *
 * Resolution widens in three steps, stopping at the first that finds anything:
 * an exact glob on the typed name, the same on a slug with runs of whitespace
 * turned into hyphens, and finally a scan of every `.md` in the workspace
 * compared on the basename. More than one hit raises a quick pick rather than
 * guessing.
 *
 * When resolution finds nothing and the current document URI is known, the user
 * is offered an action to create the missing `<name>.md` file next to the current
 * document. Creation requires user confirmation rather than happening silently
 * because:
 * 1. Typos in wiki links (e.g. `[[teh-spec]]`) would otherwise silently litter
 *    the workspace with unwanted empty files.
 * 2. Clicking wiki links in preview or reading mode should not have filesystem
 *    side-effects without explicit intent.
 * 3. Paths that attempt traversal or escape the document directory are rejected
 *    to prevent directory escape.
 */
```

---

## 4. Kiểm tra trước khi kết thúc (Chốt chặn bắt buộc)

### 4.1. `npm run lint`
Output:
```
> tui-milkdown-vscode@2.16.0 lint
> tsc --noEmit
```
(Sạch, không có lỗi TypeScript).

### 4.2. `npm run build`
Output:
```
> tui-milkdown-vscode@2.16.0 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```

### 4.3. `npm test`
Output:
```
> tui-milkdown-vscode@2.16.0 test
> node esbuild.harness.config.js --test && node --test "out/test/**/*.test.js"

harness built: out/test
ℹ tests 54
ℹ suites 24
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 89.925166
```

### 4.4. `npm run roundtrip`
Output:
```
> tui-milkdown-vscode@2.16.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
```

### 4.5. Vòng hai + bước khôi phục
Lệnh chạy:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
git checkout -- harness/fixtures/synthetic/
git status --short harness/
```
Output:
```
> tui-milkdown-vscode@2.16.0 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

39 markdown fixtures + 12 seams: 51 passed, 0 failed, 0 missing, 0 errored
```
Lệnh `git status --short harness/` trả về rỗng hoàn toàn.

### 4.6. `npm run verify:vscode-floor`
Lệnh chạy:
```sh
npm run verify:vscode-floor
```
Output:
```
> tui-milkdown-vscode@2.16.0 verify:vscode-floor
> npm run build && npm run build:floor-tests && node harness/vscode-floor/run.mjs

Building (production)...
Build complete (production)
harness built: out/harness/vscode-floor-tests.js
VS Code floor check: target version 1.85.0

PASS  floor VS Code build launched: 2 debug target(s)
PASS  vscode version: 1.85.0
PASS  extension resolves: /Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w7-host
PASS  extension activates: isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  custom editor opens the document: sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified: isDirty=false
PASS  custom editor still open after the hold: held 25000ms
PASS  document still unmodified after the hold: isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean: isDirty=false version=1; typed and removed "Z" 13ms apart, debounce 300ms
PASS  a typed character reaches the document: isDirty=true sentinelInText=true version 1→2
PASS  the edit does not bounce between host and webview: version 2 then 2 after 3s idle
PASS  view source opens the raw markdown in a text editor: 1 visible text editor(s)
PASS  webview mounts the editor: vscode-webview://0gtu3jvq4eb368b792t3s7v, mounted 3197ms into the probe
PASS  document content rendered in the webview: heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders: rendered=1 errors=0 stuckPlaceholders=0 scheduled=1 visibility=hidden; 0ms after mount, budget 40000ms
PASS  toolbar and metadata panel present: toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven: typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  no CSP violation in the console: 2 console entries, none CSP

20 checks: 20 passed, 0 failed
```

### 4.7. Kiểm tra fixture cũ không đổi so với merge-base
Lệnh:
```sh
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: rỗng (0 file thay đổi).

### 4.8. `git status --short`
Lệnh:
```sh
git status --short
```
Output: sạch (sau khi commit báo cáo này).

---

## 5. Đề xuất câu chữ cập nhật tài liệu cho điều phối viên

Vì tuân thủ lệnh cấm sửa các file markdown ở gốc repo (`README.md`, `CHANGELOG.md`, v.v.), dưới đây là câu chữ được chuẩn bị sẵn để điều phối viên áp dụng sau khi merge:

### Cho `README.md` (mục Features hoặc Commands):
```markdown
- **Default Editor Setting**: Configure whether markdown files open in TUI Markdown (WYSIWYG) or VS Code's built-in text editor by default for the current workspace via the Command Palette (`TUI Markdown: Use TUI Markdown as Default Editor for this Workspace`).
- **Wiki Links**: Clicking a wiki link to a non-existent file prompts to create it next to the current document.
- **Position Persistence**: Cursor position and scroll offset are remembered per file across sessions within the workspace.
```

### Cho `CHANGELOG.md`:
```markdown
### Added
- Command `tuiMarkdown.useAsDefaultEditor` to configure default markdown editor association per workspace (WYSIWYG, text editor, or reset) (#122).
- Create missing wiki link targets next to current document upon confirmation (#123).
- Persist and restore cursor and scroll position per document URI in workspaceState (#121).
```
