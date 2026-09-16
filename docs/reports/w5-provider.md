# W5 / W1 — #88: tách `resolveCustomTextEditor` thành handler và một object phiên

Nhánh `hoangvantuan/w5-provider`, tách từ `develop` tại `205334a`.
Hai mốc commit trên cùng một nhánh, không mở pull request.

| Mốc | SHA | Nội dung |
| --- | --- | --- |
| PR1 | `aa08ccb` | bóc thân các case lớn ra `src/host/`, `switch` giữ nguyên |
| PR2 | `3a91f26` | bảng dispatch khoá theo union + lớp `EditorSession` |

Đây là refactor thuần. Không có hành vi nào người dùng quan sát được bị đổi.

---

## 1. Quy mô

```
205334a: 1737
HEAD:    460
 src/host/config.ts             |  155 +++++
 src/host/documentSave.ts       |   81 +++
 src/host/exportDocument.ts     |  140 +++++
 src/host/imagePaths.ts         |  129 ++++
 src/host/lineEndings.ts        |   23 +
 src/host/messageHandlers.ts    |  301 +++++++++
 src/host/openLocalFile.ts      |   39 ++
 src/host/openWikiLink.ts       |   68 ++
 src/host/readClipboardImage.ts |  178 ++++++
 src/host/requestImageRename.ts |  137 ++++
 src/host/saveImage.ts          |  112 ++++
 src/host/savedPreferences.ts   |   46 ++
 src/host/session.ts            |  208 ++++++
 src/host/systemFonts.ts        |   59 ++
 src/host/typedWebview.ts       |   13 +
 src/host/workspaceFiles.ts     |   28 +
 src/markdownEditorProvider.ts  | 1353 ++--------------------------------------
 17 files changed, 1755 insertions(+), 1315 deletions(-)
```

Mọi file bị chạm đều nằm trong phạm vi sở hữu (`src/markdownEditorProvider.ts`,
`src/host/**`). `src/extension.ts` không cần sửa. Không chạm `harness/`, `test/`,
`package.json`, `.github/`, `.vscodeignore`, `src/webview/`, hay bất kỳ `.md` nào ở gốc.

---

## 2. PR1 — bóc thân case (`aa08ccb`)

### Tiêu chí: không thân `case` nào quá 30 dòng

Thân một case = từ dòng `case` của nó tới ngay trước dòng `case` kế tiếp; case cuối tính
tới dòng đóng `switch`. Đếm bảo thủ: kể cả dòng `case` và dòng `break`.

```sh
f=src/markdownEditorProvider.ts
end=$(awk '/^        switch \(msg\.type\) \{$/{s=1} s && /^        \}$/{print NR; exit}' "$f")
grep -n "^ *case ['\"]" "$f" | awk -F'[:"]' -v end="$end" '
  NR>1 { printf "%-22s %3d dong  (dong %d-%d)\n", pn, $1-ps, ps, $1-1 }
  { ps=$1; pn=$3 }
  END { printf "%-22s %3d dong  (dong %d-%d)\n", pn, end-ps, ps, end-1 }
'
```

Output tại `aa08ccb`:

```
ready                   16 dong  (dong 516-531)
edit                     6 dong  (dong 532-537)
viewSource              10 dong  (dong 538-547)
themeChange             10 dong  (dong 548-557)
fontChange              10 dong  (dong 558-567)
zoomChange              15 dong  (dong 568-582)
saveImage                4 dong  (dong 583-586)
showWarning              7 dong  (dong 587-593)
readClipboardImage       8 dong  (dong 594-601)
requestImageUrlEdit     28 dong  (dong 602-629)
openLink                13 dong  (dong 630-642)
openImageInTab           6 dong  (dong 643-648)
requestLinkEdit         18 dong  (dong 649-666)
requestImageRename      13 dong  (dong 667-679)
fileSearch              21 dong  (dong 680-700)
wikiLinkSearch          21 dong  (dong 701-721)
openWikiLink             4 dong  (dong 722-725)
export                  12 dong  (dong 726-737)
```

Lớn nhất là `requestImageUrlEdit` 28 dòng. **Đạt.**

Cùng lệnh đó trên nền `205334a`, trước khi bóc:

```
ready                   45 dong  (dong 569-613)
edit                     6 dong  (dong 614-619)
viewSource              10 dong  (dong 620-629)
themeChange             10 dong  (dong 630-639)
fontChange              10 dong  (dong 640-649)
zoomChange              15 dong  (dong 650-664)
saveImage               92 dong  (dong 665-756)
showWarning              7 dong  (dong 757-763)
readClipboardImage     155 dong  (dong 764-918)
requestImageUrlEdit     28 dong  (dong 919-946)
openLink                13 dong  (dong 947-959)
openImageInTab           6 dong  (dong 960-965)
requestLinkEdit         18 dong  (dong 966-983)
requestImageRename     103 dong  (dong 984-1086)
fileSearch              21 dong  (dong 1087-1107)
wikiLinkSearch          21 dong  (dong 1108-1128)
openWikiLink            58 dong  (dong 1129-1186)
export                 112 dong  (dong 1187-1298)
```

Sáu case vượt 30 trên nền: `ready` 45, `saveImage` 92, `readClipboardImage` 155,
`requestImageRename` 103, `openWikiLink` 58, `export` 96.

### File mới ở PR1

```sh
git show --stat --oneline aa08ccb | grep "src/host"
```

```
aa08ccb refactor(provider): lift the large message cases into src/host (#88)
 src/host/exportDocument.ts     | 140 +++++++++
 src/host/openWikiLink.ts       |  68 +++++
 src/host/readClipboardImage.ts | 178 ++++++++++++
 src/host/requestImageRename.ts | 137 +++++++++
 src/host/saveImage.ts          | 112 ++++++++
 src/host/savedPreferences.ts   |  46 +++
 src/host/systemFonts.ts        |  59 ++++
 src/host/typedWebview.ts       |  13 +
```

Spec liệt năm file (`saveImage`, `readClipboardImage`, `requestImageRename`,
`exportDocument`, `systemFonts`). Tôi thêm ba, và đã `ask` xác nhận trước khi đi tiếp:

- `savedPreferences.ts` và `openWikiLink.ts` — bắt buộc, vì `ready` (45 dòng) và
  `openWikiLink` (58 dòng) vượt 30 mà danh sách năm file không phủ.
- `typedWebview.ts` — `TypedWebview` phải rời provider để các hàm ở `src/host/` dùng
  được. Không đặt được vào `src/shared/messages.ts`: file đó bị bundle webview import và
  phải sạch `vscode`. Cũng không import ngược từ provider vào host: vòng import.

Coordinator trả lời: *"Danh sách 5 file trong spec là VÍ DỤ lấy từ thân issue, không phải
giới hạn. Tiêu chí 30 dòng mới là ràng buộc thật."*

---

## 3. PR2 — bảng dispatch và `EditorSession` (`3a91f26`)

### Tiêu chí: `resolveCustomTextEditor` dưới 150 dòng, không còn `switch (msg.type)`

```sh
f=src/markdownEditorProvider.ts
awk '/^  async resolveCustomTextEditor\($/ {s=NR}
     s && /^  \}$/ {print "resolveCustomTextEditor: dong " s " den " NR " = " NR-s+1 " dong"; exit}' "$f"
echo "switch (msg.type) con lai: $(grep -c 'switch (msg.type)' "$f")"
echo "moi 'switch' trong provider: $(grep -c '\bswitch\b' "$f")"
```

```
resolveCustomTextEditor: dong 56 den 146 = 91 dong
switch (msg.type) con lai: 0
moi 'switch' trong provider: 0
```

**Đạt: 91 dòng, không còn `switch` nào trong provider.**

Toàn văn phương thức sau refactor:

```sh
sed -n '56,146p' src/markdownEditorProvider.ts
```

```ts
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const fileSize = Buffer.byteLength(document.getText(), "utf8");

    if (fileSize > MAX_FILE_SIZE) {
      const proceed = await vscode.window.showWarningMessage(
        `This file is ${(fileSize / 1024).toFixed(0)}KB. Large files may cause performance issues.`,
        "Open Anyway",
        "Open with Default Editor",
      );

      if (proceed !== "Open Anyway") {
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor",
        );
        await vscode.commands.executeCommand("vscode.open", document.uri);
        return;
      }
    }

    // Store original image paths for rename detection
    const docKey = document.uri.toString();
    this.originalImagePaths.set(
      docKey,
      buildOriginalImageMap(document.getText(), document.uri),
    );

    // Build localResourceRoots with document folder and workspace
    const documentFolder = vscode.Uri.joinPath(document.uri, "..");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;

    const localResourceRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, "out"),
      vscode.Uri.joinPath(this.context.extensionUri, "node_modules"),
      documentFolder,
    ];
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder);
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const session = new EditorSession(document, webviewPanel, this.originalImagePaths);
    const handlerContext: HandlerContext = {
      session,
      document,
      webview: session.webview,
      globalState: this.context.globalState,
      originalImagePaths: this.originalImagePaths,
      notifyClipboardError: (target, reason, warningMessage) =>
        this.notifyClipboardError(target, reason, warningMessage),
    };

    // The six listeners that have to be disposed with the panel. `onDidDispose`
    // below is deliberately NOT among them: it belongs to the panel itself and
    // dies with it.
    session.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          e.document.uri.toString() === document.uri.toString() &&
          !session.pendingEdit &&
          e.contentChanges.length > 0
        ) {
          session.updateWebview();
        }
      }),
      webviewPanel.webview.onDidReceiveMessage((message: unknown) =>
        dispatchMessage(message, handlerContext),
      ),
      webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) session.updateWebview();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => session.sendTheme()),
      vscode.workspace.onDidChangeConfiguration((e) =>
        handleConfigurationChange(e, document, () => session.sendConfig()),
      ),
      vscode.workspace.onDidSaveTextDocument((savedDoc) =>
        handleDocumentSave(savedDoc, document, docKey, this.originalImagePaths),
      ),
    );

    webviewPanel.onDidDispose(() => session.dispose());
  }
```

### Chỗ đắt giá nhất: thiếu handler thành lỗi `tsc`

Bảng khoá theo union, không phải `switch`:

```sh
sed -n '58,66p' src/host/messageHandlers.ts
```

```ts
type Handler<K extends WebviewToHostMessage["type"]> = (
  msg: Extract<WebviewToHostMessage, { type: K }>,
  ctx: HandlerContext,
) => void | Promise<void>;

type HandlerTable = {
  [K in WebviewToHostMessage["type"]]: Handler<K>;
};
```

Phép thử: thêm tạm một kind `probe` vào `src/shared/messages.ts`, chạy `tsc`, khôi phục.

```sh
cp src/shared/messages.ts /tmp/messages.bak.ts
python3 -c "
p='src/shared/messages.ts'
s=open(p,encoding='utf-8').read()
s=s.replace('export type WebviewToHostMessage =','export interface ProbeMessage {\n  type: \"probe\";\n}\n\nexport type WebviewToHostMessage =\n  | ProbeMessage',1)
open(p,'w',encoding='utf-8').write(s)
"
npx tsc --noEmit
cp /tmp/messages.bak.ts src/shared/messages.ts && npx tsc --noEmit
```

Output thật của lần `tsc` đầu:

```
src/host/messageHandlers.ts(67,7): error TS2741: Property 'probe' is missing in type '{ ready: (_msg: ReadyMessage, ctx: HandlerContext) => void; edit: (msg: EditMessage, ctx: HandlerContext) => Promise<void>; ... 15 more ...; export: (msg: ExportMessage, ctx: HandlerContext) => void; }' but required in type 'HandlerTable'.
```

Sau khi khôi phục, lần `tsc` thứ hai không có output và `git status --short
src/shared/messages.ts` rỗng. Trước đây thiếu một case chỉ là một message âm thầm không
làm gì lúc chạy.

### `hasOwnProperty` trước khi gọi

`switch` rơi xuyên khi `msg.type` lạ. Tra thẳng object literal thì không:

```sh
node -e '
const handlers = { ready: () => "ran" };
for (const t of ["__proto__", "constructor", "toString", "nosuch"]) {
  const raw = handlers[t];
  const own = Object.prototype.hasOwnProperty.call(handlers, t);
  console.log(t.padEnd(12), "lookup:", typeof raw, "| truthy:", !!raw, "| hasOwnProperty:", own);
}
'
```

```
__proto__    lookup: object | truthy: true | hasOwnProperty: false
constructor  lookup: function | truthy: true | hasOwnProperty: false
toString     lookup: function | truthy: true | hasOwnProperty: false
nosuch       lookup: undefined | truthy: false | hasOwnProperty: false
```

Một message bịa `type: "constructor"` sẽ gọi `Object.prototype.constructor` nếu chỉ kiểm
`if (!handler) return`. Nên `dispatch` kiểm quyền sở hữu khoá:

```sh
sed -n '/^export async function dispatchMessage/,$p' src/host/messageHandlers.ts
```

```ts
export async function dispatchMessage(
  message: unknown,
  ctx: HandlerContext,
): Promise<void> {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const msg = message as WebviewToHostMessage;
  if (!Object.prototype.hasOwnProperty.call(handlers, msg.type)) return;
  const handler = handlers[msg.type] as (
    m: WebviewToHostMessage,
    c: HandlerContext,
  ) => void | Promise<void>;
  await handler(msg, ctx);
}
```

### Chín thứ trạng thái per-document, không thiếu không thừa

```sh
sed -n '/^export class EditorSession/,/^  readonly disposables/p' src/host/session.ts
```

```ts
export class EditorSession {
  readonly docKey: string;
  readonly webview: TypedWebview;
  isDisposed = false;
  inFlightEdit: Promise<void> | null = null;
  pendingEdit = false;
  renameInProgress = false;
  exportInProgress = false;
  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly disposables: vscode.Disposable[] = [];
```

`originalImagePaths` KHÔNG nằm trong chín thứ đó. Thân issue viết nó là biến closure;
sai. Nó là field của provider, khoá theo `docKey`, và vẫn ở nguyên đó:

```sh
grep -n "originalImagePaths" src/markdownEditorProvider.ts
```

```
30:  private originalImagePaths: Map<string, Map<string, string>> = new Map();
81:    this.originalImagePaths.set(
106:    const session = new EditorSession(document, webviewPanel, this.originalImagePaths);
112:      originalImagePaths: this.originalImagePaths,
141:        handleDocumentSave(savedDoc, document, docKey, this.originalImagePaths),
```

Session chỉ giữ một tham chiếu tới nó, và mọi nơi cần nó đều tra **sống** bằng
`.get(docKey)` tại thời điểm chạy, không chụp map con:

```sh
grep -n "originalImagePaths" src/host/session.ts src/host/documentSave.ts src/host/messageHandlers.ts src/host/requestImageRename.ts
```

```
src/host/session.ts:20: * `originalImagePaths` is the PROVIDER's map, not session state: it is keyed by
src/host/session.ts:57:    private readonly originalImagePaths: Map<string, Map<string, string>>,
src/host/session.ts:105:      const originalMap = this.originalImagePaths.get(this.docKey);
src/host/session.ts:204:      this.originalImagePaths.delete(this.docKey);
src/host/documentSave.ts:9: * `originalImagePaths` is the whole per-document map plus the key, never the
src/host/documentSave.ts:27:  originalImagePaths: Map<string, Map<string, string>>,
src/host/documentSave.ts:35:  const originalMap = originalImagePaths.get(docKey);
src/host/documentSave.ts:44:    originalImagePaths.set(
src/host/documentSave.ts:75:  // Always rebuild originalImagePaths after save to capture newly added images
src/host/documentSave.ts:77:  originalImagePaths.set(
src/host/messageHandlers.ts:49:  originalImagePaths: Map<string, Map<string, string>>;
src/host/messageHandlers.ts:221:      ctx.originalImagePaths,
src/host/requestImageRename.ts:16: * `originalImagePaths` arrives as the whole per-document map plus `docKey`,
src/host/requestImageRename.ts:33:  originalImagePaths: Map<string, Map<string, string>>,
src/host/requestImageRename.ts:97:      // Update originalImagePaths
src/host/requestImageRename.ts:98:      const originalMap = originalImagePaths.get(docKey);
```

Lý do: dòng cuối `handleDocumentSave` **thay** cả map con sau mỗi lần lưu. Ai giữ tham
chiếu tới map cũ sẽ im lặng ngừng phát hiện rename. Đây là bẫy dễ dính nhất khi bóc hàm
này ra, và không có check tự động nào bắt được.

```sh
sed -n '73,80p' src/host/documentSave.ts
```

```ts
  }

  // Always rebuild originalImagePaths after save to capture newly added images
  // This ensures delete detection works for images added during editing session
  originalImagePaths.set(
    docKey,
    buildOriginalImageMap(savedDoc.getText(), savedDoc.uri),
  );
```

---

## 4. Disposable — sáu listener, từng cái nằm đâu trong code MỚI

Trên nền `205334a`:

```sh
git show 205334a:src/markdownEditorProvider.ts | grep -n "onDidChangeTextDocument\|onDidReceiveMessage\|onDidChangeViewState\|onDidChangeActiveColorTheme\|onDidChangeConfiguration\|onDidSaveTextDocument\|onDidDispose\|disposables"
```

```
325:    const disposables: vscode.Disposable[] = [];
338:      // Debounce rapid calls (e.g., from applyEdit + onDidChangeTextDocument)
554:    disposables.push(
555:      vscode.workspace.onDidChangeTextDocument((e) => {
564:      webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
1301:      webviewPanel.onDidChangeViewState((e) => {
1304:      vscode.window.onDidChangeActiveColorTheme(sendTheme),
1305:      vscode.workspace.onDidChangeConfiguration((e) => {
1333:      vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
1389:    webviewPanel.onDidDispose(() => {
1402:        disposables.forEach((d) => d.dispose());
```

Sau refactor:

```sh
grep -n "onDidChangeTextDocument\|onDidReceiveMessage\|onDidChangeViewState\|onDidChangeActiveColorTheme\|onDidChangeConfiguration\|onDidSaveTextDocument\|onDidDispose\|disposables" src/markdownEditorProvider.ts src/host/session.ts
```

```
src/markdownEditorProvider.ts:117:    // The six listeners that have to be disposed with the panel. `onDidDispose`
src/markdownEditorProvider.ts:120:    session.disposables.push(
src/markdownEditorProvider.ts:121:      vscode.workspace.onDidChangeTextDocument((e) => {
src/markdownEditorProvider.ts:130:      webviewPanel.webview.onDidReceiveMessage((message: unknown) =>
src/markdownEditorProvider.ts:133:      webviewPanel.onDidChangeViewState((e) => {
src/markdownEditorProvider.ts:136:      vscode.window.onDidChangeActiveColorTheme(() => session.sendTheme()),
src/markdownEditorProvider.ts:137:      vscode.workspace.onDidChangeConfiguration((e) =>
src/markdownEditorProvider.ts:140:      vscode.workspace.onDidSaveTextDocument((savedDoc) =>
src/markdownEditorProvider.ts:145:    webviewPanel.onDidDispose(() => session.dispose());
src/host/session.ts:52:  readonly disposables: vscode.Disposable[] = [];
src/host/session.ts:66:    // Debounce rapid calls (e.g., from applyEdit + onDidChangeTextDocument)
src/host/session.ts:205:      this.disposables.forEach((d) => d.dispose());
```

Đối chiếu:

| Listener | Nền `205334a` | Sau refactor |
| --- | --- | --- |
| `onDidChangeTextDocument` | provider:555 | provider:121 |
| `onDidReceiveMessage` | provider:564 | provider:130 (thân ở `messageHandlers.ts`) |
| `onDidChangeViewState` | provider:1301 | provider:133 |
| `onDidChangeActiveColorTheme` | provider:1304 | provider:136 |
| `onDidChangeConfiguration` | provider:1305 | provider:137 (thân ở `config.ts`) |
| `onDidSaveTextDocument` | provider:1333 | provider:140 (thân ở `documentSave.ts`) |

Cả sáu vẫn nằm trong đúng MỘT lời gọi `push` (provider:120), và mảng đó vẫn được dispose
đúng một chỗ (`session.ts:205`). `webviewPanel.onDidDispose` (provider:145) vẫn KHÔNG nằm
trong mảng và vẫn không được dispose — nó là listener của chính panel, giữ nguyên như cũ,
không "sửa".

Thân `dispose()` là bản sao từng dòng của `onDidDispose` cũ, kể cả thứ tự của `#104`:

```sh
sed -n '/^  dispose(): void {/,$p' src/host/session.ts
```

```ts
  dispose(): void {
    if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);
    // Allow any edit in-flight during teardown (e.g. flushed on pagehide) to be applied if the document is still open
    setImmediate(async () => {
      if (this.inFlightEdit) {
        try {
          await this.inFlightEdit;
        } catch {
          /* ignore */
        }
      }
      this.isDisposed = true;
      this.originalImagePaths.delete(this.docKey);
      this.disposables.forEach((d) => d.dispose());
    });
  }
}
```

---

## 5. Bốn lớp chốt chống vòng lặp edit — giữ đủ cả bốn

```sh
grep -n "pendingEdit" src/markdownEditorProvider.ts src/host/session.ts src/host/messageHandlers.ts src/host/requestImageRename.ts
```

```
src/markdownEditorProvider.ts:124:          !session.pendingEdit &&
src/host/session.ts:10: * - `pendingEdit` is the host's own WorkspaceEdit in progress. It is checked in
src/host/session.ts:48:  pendingEdit = false;
src/host/session.ts:64:    if (this.pendingEdit || this.isDisposed) return;
src/host/session.ts:164:    this.pendingEdit = true;
src/host/session.ts:175:        this.pendingEdit = false;
src/host/session.ts:176:        // Send updated imageMap AFTER pendingEdit is reset
src/host/messageHandlers.ts:224:        ctx.session.pendingEdit = value;
src/host/requestImageRename.ts:11: * - Writing the document sets `pendingEdit` and clears it in a `queueMicrotask`
```

- Lớp 1: `!session.pendingEdit` trong `onDidChangeTextDocument` (provider:124)
- Lớp 2: `this.pendingEdit || this.isDisposed` ở đầu `updateWebview` (session.ts:65)
- Lớp 3: `applyEdit` đặt `true`, `queueMicrotask` đặt lại `false` rồi **cố ý** gọi
  `updateWebview()` để đẩy imageMap mới (session.ts:183-190)
- Lớp 4: `lastSentState` trong `src/webview/main.ts` — không chạm

Và khác biệt tinh tế được giữ nguyên: `requestImageRename` cũng đặt `pendingEdit` nhưng
`queueMicrotask` của nó **không** gọi `updateWebview()`, khác `applyEdit`:

```sh
sed -n '80,96p' src/host/requestImageRename.ts
```

```ts
        `$1${newPath}$2`
      );
      if (updatedText !== currentText) {
        setPendingEdit(true);
        try {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(currentText.length),
          );
          edit.replace(document.uri, fullRange, updatedText);
          await vscode.workspace.applyEdit(edit);
        } finally {
          queueMicrotask(() => { setPendingEdit(false); });
        }
      }
```

---

## 6. Ranh giới đồng bộ/bất đồng bộ — giữ từng case, không đồng nhất hoá

```sh
grep -n "^  [a-zA-Z]*: \(async \)\?(" src/host/messageHandlers.ts
```

```
51:  notifyClipboardError: (
68:  ready: (_msg, ctx) => {
84:  edit: async (msg, ctx) => {
91:  viewSource: async (_msg, ctx) => {
101:  themeChange: async (msg, ctx) => {
111:  fontChange: async (msg, ctx) => {
121:  zoomChange: async (msg, ctx) => {
136:  saveImage: async (msg, ctx) => {
140:  showWarning: (msg) => {
147:  readClipboardImage: (_msg, ctx) => {
151:  requestImageUrlEdit: (msg, ctx) => {
179:  openLink: (msg, ctx) => {
192:  openImageInTab: (msg, ctx) => {
198:  requestLinkEdit: (msg, ctx) => {
216:  requestImageRename: (msg, ctx) => {
229:  fileSearch: async (_msg, ctx) => {
250:  wikiLinkSearch: async (_msg, ctx) => {
271:  openWikiLink: async (msg) => {
275:  export: (msg, ctx) => {
```

- Có `async`, được `await`, message kế tiếp phải chờ: `edit`, `viewSource`,
  `themeChange`, `fontChange`, `zoomChange`, `saveImage`, `fileSearch`, `wikiLinkSearch`,
  `openWikiLink`.
- Không `async`, trả về ngay sau khi phóng việc bất đồng bộ của chính nó và trả lời
  webview từ bên trong đó: `ready`, `readClipboardImage`, `requestImageUrlEdit`,
  `requestLinkEdit`, `requestImageRename`, `export`, cùng ba case thuần đồng bộ
  `showWarning`, `openLink`, `openImageInTab`.

Riêng `export`: mọi thứ trước IIFE vẫn chạy ĐỒNG BỘ, đúng thứ tự cũ — kiểm bận, đọc
`document.getText()`, rồi mới lấy khoá. Đọc muộn hơn là export nội dung khác với cái người
dùng bấm export; lấy khoá muộn hơn là hai request cùng qua được kiểm bận.

```sh
sed -n '31,62p' src/host/exportDocument.ts
```

```ts
  const exportMsg = msg;

  // Reject duplicate export requests so two save dialogs / two
  // Chromium instances cannot race to the same output path.
  if (isExportInProgress()) {
    webview.postMessage({
      type: "exportDone",
      success: false,
      reason: "busy",
    });
    vscode.window.showWarningMessage(
      "Export in progress, please wait for the current export to finish.",
    );
    return;
  }

  const mermaidImages = exportMsg.mermaidImages || [];
  const exportFormat = exportMsg.format || "docx";
  const fontFamily = exportMsg.fontFamily || "";
  const configuredPageSize = vscode.workspace
    .getConfiguration("tuiMarkdown")
    .get<string>("exportPageSize", "A4");
  const pageSize: "A4" | "Letter" =
    configuredPageSize === "Letter" ? "Letter" : "A4";

  const rawText = document.getText();
  const stripped = rawText.replace(/^﻿/, "");
  const parsedFm = parseContent(stripped);
  const normalized = parsedFm.body;

  setExportInProgress(true);
  (async () => {
```

---

## 7. `normalizeLineEndings` — ràng buộc từ harness

`harness/crlf-seam.ts` import nó từ `src/markdownEditorProvider`. Harness không được sửa,
nên hàm chuyển sang `src/host/lineEndings.ts` và provider **re-export**:

```sh
grep -n "normalizeLineEndings" src/markdownEditorProvider.ts harness/crlf-seam.ts
```

```
src/markdownEditorProvider.ts:14:// `normalizeLineEndings` lives in src/host/lineEndings.ts; it is re-exported
src/markdownEditorProvider.ts:16:export { normalizeLineEndings } from "./host/lineEndings";
harness/crlf-seam.ts:4: * Exercises normalizeLineEndings from src/markdownEditorProvider.ts,
harness/crlf-seam.ts:12:import { normalizeLineEndings } from "../src/markdownEditorProvider";
harness/crlf-seam.ts:121:  const normalizedCrlf = normalizeLineEndings(reconstructed, 2);
harness/crlf-seam.ts:122:  const normalizedLf = normalizeLineEndings(reconstructed, 1);
harness/crlf-seam.ts:125:  lines.push("note: rawBlock replay in reconstructContent followed by normalizeLineEndings produces no mixed endings");
harness/crlf-seam.ts:136:    "crlf seam: normalizeLineEndings (src/markdownEditorProvider.ts)",
harness/crlf-seam.ts:142:    const actual = normalizeLineEndings(testCase.input, testCase.eol);
```

Seam `crlf` vẫn xanh trong roundtrip (mục 8), tức đường import đó còn nguyên.

---

## 8. Kết quả kiểm thử

### Cuối PR1 (`aa08ccb`)

```
$ npm run lint
> tsc --noEmit
(khong output, exit 0)

$ npm run build
Building (production)...
Build complete (production)

$ npm run build:dev
Building (development)...
Build complete (development)

$ npm run roundtrip
markdown roundtrip harness — mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)
39 markdown fixtures + 7 seams: 46 passed, 0 failed, 0 missing, 0 errored

$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
39 markdown fixtures + 7 seams: 46 passed, 0 failed, 0 missing, 0 errored
$ git checkout -- harness/fixtures/synthetic/
$ git status --short harness/
(rong)
```

`npm run verify:vscode-floor` ở PR1: xem mục 9 — chạy hai lần trên cùng SHA, hai kết quả.

### Cuối PR2 (`3a91f26`)

```
$ npm run lint
(khong output, exit 0)

$ npm run build
Build complete (production)

$ npm run build:dev
Build complete (development)

$ npm run roundtrip
39 markdown fixtures + 7 seams: 46 passed, 0 failed, 0 missing, 0 errored

$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
39 markdown fixtures + 7 seams: 46 passed, 0 failed, 0 missing, 0 errored
$ git checkout -- harness/fixtures/synthetic/
$ git status --short harness/
(rong)
```

Roundtrip không đổi một dòng golden nào, đúng như dự đoán: việc này không chạm chuỗi
markdown đi qua editor. Bước khôi phục `git checkout -- harness/fixtures/synthetic/` đã
chạy sau cả hai vòng hai, và `git status` xác nhận cây sạch.

### `require` động còn nguyên sau khi đổi file

Ba module nạp trễ bằng `require(path.join(__dirname, ...))` phải còn trong bundle sau khi
`export` rời provider.

```sh
for s in markdown-ast.js export-pdf.js export-docx.js; do echo "$s: $(grep -c -F "$s" out/extension.js)"; done
for s in markdown-ast.js export-pdf.js export-docx.js; do b=$(git show 205334a:src/markdownEditorProvider.ts | grep -c -F "$s"); n=$(cat src/markdownEditorProvider.ts src/host/*.ts | grep -c -F "$s"); echo "$s: base=$b now=$n"; done
```

```
bundle markdown-ast.js: 1
bundle export-pdf.js: 2
bundle export-docx.js: 1
source markdown-ast.js: base=1 now=1
source export-pdf.js: base=2 now=2
source export-docx.js: base=1 now=1
```

### `npm run verify:vscode-floor` cuối PR2 (`3a91f26`)

```
PASS  floor VS Code build launched — 2 debug target(s)
PASS  vscode version — 1.85.0
PASS  extension resolves — /Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w5-provider
PASS  extension activates — isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  custom editor opens the document — sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified — isDirty=false
PASS  custom editor still open after the hold — held 25000ms
PASS  document still unmodified after the hold — isDirty=false
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 1→2
PASS  the edit does not bounce between host and webview — version 2 then 2 after 3s idle
PASS  view source opens the raw markdown in a text editor — 1 visible text editor(s)
PASS  webview mounts the editor — vscode-webview://1g27omff8ekp7hllee18vmo
PASS  document content rendered in the webview — heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders — rendered=4 errors=0 stuckPlaceholders=0
PASS  toolbar and metadata panel present — toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven — typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  no CSP violation in the console — 2 console entries, none CSP
19 checks: 19 passed, 0 failed
```

**19/19.** Lệnh chỉ chạy đúng ba lần trong cả nhiệm vụ (hai ở PR1, một ở PR2), vì nó mở
một cửa sổ VS Code thật.

---

## 9. Floor check không tất định — phát hiện, không phải hồi quy

Ở cuối PR1 tôi chạy `npm run verify:vscode-floor` hai lần trên **cùng SHA `aa08ccb`**,
không sửa một ký tự nào giữa hai lần, và nhận hai kết quả khác nhau.

### Lần 1 — 18/19

```
PASS  custom editor still open after the hold — held 25000ms
FAIL  document still unmodified after the hold — isDirty=true
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 2→3
PASS  the edit does not bounce between host and webview — version 3 then 3 after 3s idle
PASS  view source opens the raw markdown in a text editor — 1 visible text editor(s)
PASS  webview mounts the editor — vscode-webview://0kr6tpqoa83llf1276k4rif
PASS  document content rendered in the webview — heading="▼H1Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders — rendered=4 errors=0 stuckPlaceholders=0
PASS  webview interactions could be driven — typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  no CSP violation in the console — 2 console entries, none CSP

19 checks: 18 passed, 1 failed

Error: 1 extension-host check(s) failed: document still unmodified after the hold
kept: /tmp/tuimd-floor-WiF4Wt
```

### Lần 2 — 19/19, cùng SHA, không sửa gì

```
PASS  document still unmodified after the hold — isDirty=false
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 1→2
PASS  the edit does not bounce between host and webview — version 2 then 2 after 3s idle
19 checks: 19 passed, 0 failed
```

### Dòng bị đổi trong lần đỏ

Lần đỏ giữ lại workspace tạm. So với fixture gốc:

```
$ diff harness/vscode-floor/sample.md /tmp/tuimd-floor-WiF4Wt/ws/sample.md
9c9
< Some **bold** text and a [link](https://example.com).
---
> Some **bold** text and a [link](https://example.com).FLOORPROBE
15a16
> 
28a30
> >
```

`FLOORPROBE` là do runner gõ, đúng thiết kế. Hai đổi còn lại — một dòng trống thêm ở
dòng 15 và một dấu `>` thêm ở dòng 28 — là chuẩn hoá của serializer trong webview.

### Vì sao nó nằm ngoài phạm vi thay đổi của tôi

1. Check đó chạy **sau 25 giây hold nhưng TRƯỚC** khi extension host ghi marker
   `phase-interact`, và runner chỉ gõ sau khi thấy marker đó
   (`harness/vscode-floor/extension-tests.ts:148` ghi marker, `run.mjs:396` chờ marker).
   Nên tài liệu đã bẩn trước khi pha lái chạy một dòng nào.
2. `version 2→3` ở lần đỏ so với `version 1→2` ở lần xanh: lần đỏ có **một** edit đã được
   áp dụng trong 25 giây hold. Nội dung của edit đó là chuẩn hoá serializer, do
   `src/webview/` sinh ra — phần tôi không chạm, cả PR1 lẫn PR2.
3. Việc của tôi là host-side thuần. Không có đường nào từ đó khiến webview phát một `edit`
   mà trước đó nó không phát.

### Vì sao nó đáng ghi lại

`AGENTS.md` hiện khẳng định `harness/vscode-floor/sample.md` "không phải điểm bất động
vòng một dưới `roundtripMarkdown` **nhưng webview không ghi edit nào cho nó**, và đó là lý
do floor check xanh". Bằng chứng trên cho thấy mệnh đề đó chỉ đúng **phần lớn** thời gian.
Có một điều kiện thời điểm khiến webview thỉnh thoảng ghi một edit chuẩn hoá trong lúc
hold. Nghi phạm gần nhất của tôi là thời điểm mermaid nạp trễ hoàn tất so với thời điểm
chốt `lastSentState`, nhưng **tôi CHƯA truy ra và CHƯA kiểm chứng nghi phạm đó**.
Coordinator đã nhận việc truy tiếp và mở issue riêng.

Không lần chạy nào ở PR2 gặp lại hiện tượng này. Tôi chỉ ghi nhận `19/19` cho PR2; cho
PR1 tôi ghi nhận cả hai lần, không ghi nhận riêng con số đẹp.

---

## 10. CHƯA kiểm được

Tiêu chí nghiệm thu của issue đòi tám thao tác tay trên một cửa sổ VS Code sống.
**Hai** trong tám nay đã tự động nhờ floor harness mở rộng ở `205334a`:

- `view source` — check `view source opens the raw markdown in a text editor`
- đường đi `edit` — check `a typed character reaches the document` và
  `the edit does not bounce between host and webview`

**Sáu cái còn lại tôi CHƯA kiểm được, và không có cách nào kiểm từ terminal:**

1. **Dán ảnh** (`saveImage` + `readClipboardImage`) — cần clipboard hệ thống có ảnh và
   một thao tác dán thật trong webview.
2. **Đổi tên đường dẫn ảnh** (`requestImageRename`, và rename detection trong
   `applyEdit`) — cần sửa đường dẫn trong editor sống rồi quan sát file trên đĩa.
3. **Xoá ảnh** (`handleDocumentSave` + `executeImageDeletes`) — cần một lần lưu thật và
   kiểm Thùng rác.
4. **Export DOCX** — cần hộp thoại lưu file.
5. **Export PDF** — cần hộp thoại lưu file và một Chromium thật.
6. **`@` mention và `[[` wiki link** — cần gõ vào popup gợi ý và chọn.

Không cái nào trong sáu cái đó được mô tả ở thì quá khứ ở bất kỳ đâu trong báo cáo này.
Chúng chưa chạy.

Thứ tôi CÓ bằng chứng cho sáu đường đó chỉ là: `tsc` xanh, bundle dựng được, và mã của
chúng được dời **nguyên văn** — mọi khối trong mục 2 và 3 đều sinh bằng `sed -n` từ file
thật, và các lệnh `sed` dùng để bóc đã được kiểm bằng assert trên nội dung dòng biên.

---

## 11. Hai chỗ thân issue `#88` viết sai

Spec đã cảnh báo trước; tôi tự mở file xác nhận cả hai.

**1. `originalImagePaths` không phải biến closure.** Issue viết: *"Per-document state
(`pendingEdit`, `renameInProgress`, the update debounce timer, `originalImagePaths`) lives
in closure variables of that one method"*. Trên nền `205334a` nó là field của provider:

```sh
git show 205334a:src/markdownEditorProvider.ts | sed -n '186,191p'
```

```ts
  /**
   * Stores original image paths per document for rename detection.
   * Key: document.uri.toString()
   * Value: Map<relativePath, absolutePathString>
   */
  private originalImagePaths: Map<string, Map<string, string>> = new Map();
```

**2. Issue sót `isDisposed` và `inFlightEdit`.** Danh sách đầy đủ biến closure
per-document trên nền:

```sh
git show 205334a:src/markdownEditorProvider.ts | sed -n '292p'
```

```ts
    const docKey = document.uri.toString();
```

```sh
git show 205334a:src/markdownEditorProvider.ts | sed -n '318,325p'
```

```ts
    const webview = webviewPanel.webview as TypedWebview;
    let isDisposed = false;
    let inFlightEdit: Promise<void> | null = null;
    let pendingEdit = false;
    let renameInProgress = false;
    let exportInProgress = false;
    let updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposables: vscode.Disposable[] = [];
```

Chín dòng, chín thứ. Đó chính là bề mặt `EditorSession` đã dựng ở mục 3.

Con số dòng trong thân issue cũng lệch (issue viết *"line 225 to line 1232"*, thực tế trên
`205334a` là 268 đến 1403) vì file đã lớn lên sau khi issue được viết. Không ảnh hưởng gì
tới việc.

---

## 12. Câu chữ đề xuất cho `CHANGELOG.md` và `AGENTS.md`

Ràng buộc sóng cấm tôi sửa `.md` ở gốc. Dưới đây là câu chữ để coordinator tự áp dụng sau
khi merge.

### `CHANGELOG.md` — mục Changed

```markdown
- **`resolveCustomTextEditor` tách thành handler và một object phiên (#88)**: phương thức
  đó dài 1.136 dòng và giữ toàn bộ hợp đồng per-document trong biến closure, nên không có
  gì để dựng mà kiểm thử. Thân của mười tám case `onDidReceiveMessage` chuyển thành hàm tự
  do dưới `src/host/`, `switch (msg.type)` thành một bảng khoá theo
  `WebviewToHostMessage["type"]`, và chín thứ trạng thái per-document vào lớp
  `EditorSession`. Phương thức còn 91 dòng, provider từ 1.737 xuống 460. Không đổi hành
  vi: thứ tự các lần gửi khi `ready`, case nào được `await` và case nào phóng việc bất
  đồng bộ rồi trả về ngay, thứ tự teardown của #104, và cả bốn lớp chốt chống vòng lặp
  edit đều giữ nguyên. Cái được: thêm một kind message mà quên handler nay là lỗi `tsc`,
  không còn là một message âm thầm không làm gì lúc chạy.
```

### `AGENTS.md` — File Structure, thêm vào cây `src/`

```markdown
├── host/                     # Extension-host side of resolveCustomTextEditor (#88)
│   ├── session.ts            # EditorSession: the 9 per-document state fields + updateWebview/sendTheme/sendConfig/applyEdit/dispose
│   ├── messageHandlers.ts    # Record<WebviewToHostMessage["type"], Handler> + dispatchMessage (hasOwnProperty guard)
│   ├── typedWebview.ts       # TypedWebview — here, not shared/messages.ts, which must stay free of `vscode`
│   ├── config.ts             # tuiMarkdown.* getters, buildConfigMessage, handleConfigurationChange
│   ├── imagePaths.ts         # extractImagePaths / resolveImagePath / buildImageMap / buildOriginalImageMap
│   ├── lineEndings.ts        # normalizeLineEndings (re-exported by the provider for harness/crlf-seam.ts)
│   ├── documentSave.ts       # onDidSaveTextDocument: image delete detection + map rebuild
│   ├── workspaceFiles.ts     # buildExcludePattern / getDocFolder for the @ and [[ pickers
│   ├── openLocalFile.ts      # openLocalFileInEditor, shared by openLink and openImageInTab
│   ├── savedPreferences.ts   # ready: replay the saved theme/font/zoom
│   ├── systemFonts.ts        # system font enumeration (module-level cache)
│   ├── saveImage.ts          # saveImage: filename + folder validation, write, reply
│   ├── readClipboardImage.ts # native clipboard read (osascript / PowerShell / xclip)
│   ├── requestImageRename.ts # rename on disk + rewrite this document + workspace references
│   ├── openWikiLink.ts       # [[name]] resolution and open
│   └── exportDocument.ts     # export: busy lock, synchronous read, lazy require of the renderers
```

Và sửa dòng mô tả provider thành:

```markdown
├── markdownEditorProvider.ts # CustomTextEditorProvider: HTML template + wiring; the per-document work is in src/host/
```

### `AGENTS.md` — Conventions & Gotchas, thêm ba mục

```markdown
- Một kind message mới trong `src/shared/messages.ts` phải có handler trong
  `src/host/messageHandlers.ts`; bảng khoá theo union nên thiếu handler là lỗi `tsc`, chứ
  không còn là một message âm thầm không làm gì. `dispatch` kiểm `hasOwnProperty` trước
  khi gọi: `switch` cũ rơi xuyên với `type` lạ, còn tra object literal sẽ tìm thấy
  `constructor` / `toString` trên `Object.prototype` và gọi nó
- `originalImagePaths` luôn được truyền NGUYÊN map ngoài kèm `docKey`, không bao giờ
  truyền map con. `handleDocumentSave` THAY map con sau mỗi lần lưu, nên ai giữ tham chiếu
  map cũ sẽ im lặng ngừng phát hiện rename. Không check tự động nào bắt được lỗi này
- `normalizeLineEndings` nằm ở `src/host/lineEndings.ts` nhưng vẫn được
  `src/markdownEditorProvider.ts` re-export, vì `harness/crlf-seam.ts` import nó từ đó và
  harness không được sửa
```

---

## 13. Việc còn lại

- Coordinator truy tiếp và mở issue cho mục 9 (floor check không tất định). Tôi không
  điều tra tiếp theo chỉ đạo.
- Sáu thao tác tay ở mục 10 cần một người ngồi trước cửa sổ VS Code.
- `src/host/messageHandlers.ts` 301 dòng là file lớn nhất trong `src/host/`. Nó vẫn đọc
  được vì mỗi handler ngắn, nhưng nếu sóng sau thêm message thì nên tách theo nhóm. Tôi
  không tách trong phạm vi này: issue không đòi, và tách thêm là thêm rủi ro mà không đổi
  lấy gì đo được.
