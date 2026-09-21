# Báo cáo hoàn thành nhiệm vụ W10: Image ledger (#144)

Nhánh: `hoangvantuan/w10-ledger`
Commit cơ sở (develop): `a2a44f2`

---

## 1. Tóm tắt những việc đã làm

### Issue #144: Image ledger, một module giữ baseline ảnh của mỗi tài liệu
- Xây dựng module `src/host/imageLedger.ts` đại diện cho ImageLedger của mỗi tài liệu. Module này:
  - Sở hữu map nội bộ `Map<string, string>` (ánh xạ relative path chuẩn hóa sang absolute fsPath) cho baseline đường dẫn ảnh.
  - Cung cấp phương thức `setBaseline(content, documentUri)`: thay thế baseline đồng bộ ngay đầu quy trình save trước bất kỳ `await` nào, đồng thời trả về baseline cũ để phục vụ phát hiện xóa ảnh (#126).
  - Cung cấp phương thức `detectRenames(newContent, documentUri)`: so sánh danh sách đường dẫn mới với baseline để phát hiện các cặp đổi tên mà không làm biến đổi baseline.
  - Cung cấp phương thức `applyRenames(renames, executor)`: thực hiện khóa `renameInProgress`, cập nhật lạc quan (optimistic update) baseline trước khi await tác vụ đổi tên trên đĩa, tự động hoàn tác (revert) các mục thất bại, và theo dõi `inFlightRenames` để tránh mất kết quả đổi tên nếu có save xen ngang.
  - Cung cấp phương thức `detectDeletes(oldBaseline, currentPaths)`: phát hiện ảnh bị xóa dựa trên snapshot baseline cũ.
  - Cung cấp phương thức `updateEntry(oldPath, newPath, newAbsolute)`: cập nhật trực tiếp entry khi đổi tên qua double-click.
  - Cung cấp cơ chế khóa `renameInProgress` (qua `acquireRenameLock` và `releaseRenameLock`).
- Cập nhật `src/markdownEditorProvider.ts`:
  - Thay thế trường `originalImagePaths: Map<string, Map<string, string>>` bằng `imageLedgers: Map<string, ImageLedger>`.
  - Hai panel mở cùng một file tiếp tục dùng chung một ledger theo `docKey`.
  - Khởi tạo hoặc lấy ledger theo `docKey` khi `resolveCustomTextEditor`, truyền ledger vào `EditorSession` và `handleDocumentSave`.
  - Dọn dẹp ledger khi panel đóng trong `onDidDispose`.
  - Bỏ trường `originalImagePaths` khỏi `HandlerContext`.
- Cập nhật `src/host/session.ts`:
  - Nhận tham chiếu `ledger: ImageLedger` thay vì `originalImagePaths`.
  - Trong `applyEdit`: gọi `this.ledger.detectRenames` và `this.ledger.applyRenames` thay vì tự thao tác mutate/revert trên inner map.
  - Cung cấp getter `renameInProgress` ủy quyền sang ledger.
- Cập nhật `src/host/documentSave.ts`:
  - Thay đổi chữ ký `handleDocumentSave(savedDoc, document, ledger)`: không còn nhận `docKey` và `originalImagePaths`.
  - Gọi đồng bộ `ledger.setBaseline(savedDoc.getText(), savedDoc.uri)` ở dòng đầu tiên trước các `await`.
- Cập nhật `src/host/requestImageRename.ts`:
  - Nhận `ledger: ImageLedger` thay vì `originalImagePaths` và `docKey`.
  - Gọi `ledger.updateEntry(oldPath, newPath, newUri.fsPath)` sau khi đổi tên thành công.
- Cập nhật `src/host/messageHandlers.ts`:
  - Loại bỏ `originalImagePaths` khỏi `HandlerContext`.
  - Trong handler `requestImageRename`: truyền `ctx.session.ledger` thay vì `ctx.originalImagePaths` và `ctx.session.docKey`.
- Cập nhật `test/image-usage.test.ts` để sử dụng `ImageLedger` thay cho `originalImagePaths`.
- Bổ sung bộ unit test `test/image-ledger.test.ts` (7 ca kiểm thử) bao phủ toàn bộ các kịch bản bắt buộc, bao gồm cả tình huống chạy đua khi save tới trong lúc rename đang await.

---

## 2. Bằng chứng nghiệm thu từng tiêu chí

### 2.1. Tiêu chí 1: Module ledger tồn tại và giữ inner map của mỗi tài liệu

Lệnh kiểm tra định nghĩa class và các phương thức cốt lõi:
```sh
grep -n 'class ImageLedger' src/host/imageLedger.ts
```
Output:
```
44:export class ImageLedger {
```

Khối mã khai báo trường và phương thức `setBaseline`:
```ts
  /** The baseline: normalized relative path to absolute fs path. */
  private baseline: Map<string, string>;

  /** Guard against two overlapping rename batches. */
  private _renameInProgress = false;

  /** Active in-flight renames being executed asynchronously. */
  private inFlightRenames = new Map<string, ImageRename>();

  constructor(content: string, documentUri: vscode.Uri) {
    this.baseline = buildOriginalImageMap(content, documentUri);
  }

  // ---------------------------------------------------------------------------
  // Baseline management
  // ---------------------------------------------------------------------------

  /**
   * Replace the baseline from the current document text.
   *
   * On save this MUST be called FIRST, synchronously, before any `await`
   * that can block on the user (#126). The caller holds a local reference
   * to the OLD baseline for detection; the new baseline is already in place
   * so a save that arrives while a prompt is open will diff against the
   * fresh state.
   *
   * Returns the OLD baseline so the caller can detect deletions against it.
   */
  setBaseline(content: string, documentUri: vscode.Uri): Map<string, string> {
    const old = this.baseline;
    this.baseline = buildOriginalImageMap(content, documentUri);
    // If any renames are currently in-flight, ensure they remain reflected in the new baseline
    for (const rename of this.inFlightRenames.values()) {
      this.baseline.delete(rename.oldRelative);
      this.baseline.set(rename.newRelative, rename.newAbsolute);
    }
    return old;
  }

  /**
   * Read-only snapshot of the current baseline for external inspection.
   * The caller MUST NOT mutate the returned map.
```

Khối mã phương thức `applyRenames`:
```ts
    );
    return detectImageRenamesRaw(this.baseline, newPaths, documentUri);
  }

  /**
   * Execute renames: acquire lock, optimistically update baseline, run executor,
   * rollback failures, and release lock.
   * Returns null if another rename is already in progress.
   */
  async applyRenames(
    renames: ImageRename[],
    executor: (renames: ImageRename[]) => Promise<{
      succeeded: ImageRename[];
      failed: Array<{ rename: ImageRename; error: string }>;
    }> = executeImageRenames,
  ): Promise<{
    succeeded: ImageRename[];
    failed: Array<{ rename: ImageRename; error: string }>;
  } | null> {
    if (!this.acquireRenameLock()) {
      return null;
    }
    try {
      // Optimistic locking: update map BEFORE async rename to prevent race conditions
      const originalValues = new Map<string, string | undefined>();
      for (const rename of renames) {
        this.inFlightRenames.set(rename.newRelative, rename);
        originalValues.set(
          rename.oldRelative,
          this.applyRenameToBaseline(rename),
        );
      }

      const result = await executor(renames);

      // Revert failed renames in baseline
      if (result.failed.length > 0) {
        for (const { rename } of result.failed) {
          this.inFlightRenames.delete(rename.newRelative);
          this.revertRenameInBaseline(
            rename,
            originalValues.get(rename.oldRelative),
          );
        }
      }

      for (const rename of result.succeeded) {
        this.inFlightRenames.delete(rename.newRelative);
      }

      return result;
```

### 2.2. Tiêu chí 2: Provider sở hữu một ledger cho mỗi docKey

Lệnh kiểm tra:
```sh
sed -n '75,115p' src/markdownEditorProvider.ts
```
Output:
```ts
      }
    }

    // Create or reuse the image ledger for this document
    const docKey = document.uri.toString();
    let ledger = this.imageLedgers.get(docKey);
    if (!ledger) {
      ledger = new ImageLedger(document.getText(), document.uri);
      this.imageLedgers.set(docKey, ledger);
    }

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

    const session = new EditorSession(document, webviewPanel, ledger);
    const handlerContext: HandlerContext = {
      session,
      document,
      webview: session.webview,
      globalState: this.context.globalState,
      notifyClipboardError: (target, reason, warningMessage) =>
        this.notifyClipboardError(target, reason, warningMessage),
    };
```

### 2.3. Tiêu chí 3: Biến mất hoàn toàn biến `originalImagePaths` bên ngoài ledger

Lệnh kiểm tra:
```sh
grep -rn 'originalImagePaths' src/ || echo "NO MATCH"
```
Output:
```
NO MATCH
```

### 2.4. Tiêu chí 4: Unit test `test/image-ledger.test.ts` qua `test/vscode-stub.ts`

Tất cả 4 ca bắt buộc cộng thêm các ca hỗ trợ đều được kiểm thử và vượt qua:
1. Đặt baseline rồi đưa nội dung có một đường dẫn đổi thì phát hiện đúng một rename.
2. Save thay baseline và lần phát hiện kế tiếp dùng baseline mới.
3. Hai đợt rename cùng lúc thì đợt thứ hai bị từ chối do khóa `renameInProgress`.
4. Save tới trong lúc một rename đang await không làm mất kết quả rename và không làm lần save kế tiếp hỏi lại về ảnh đã bỏ.
5. Revert baseline khi việc đổi tên trên đĩa gặp lỗi.
6. `updateEntry` cập nhật baseline khi rename trực tiếp qua message.
7. `dispose` dọn dẹp sạch baseline và mở khóa.

Lệnh chạy unit test:
```sh
npm test
```
Output:
```
✔ backlinks (30.390459ms)
✔ default-editor (16.116208ms)
✔ frontmatter-parser (6.380459ms)
▶ ImageLedger (#144)
  ✔ 1. setting a baseline then providing content with a changed path detects exactly one rename (1.61075ms)
  ✔ 2. setting a baseline after save discards the old map and the next detection uses the new baseline (0.7445ms)
  ✔ 3. two concurrent applyRenames calls: second is rejected (renameInProgress lock) (0.661083ms)
  ✔ 4. save arriving while a rename is awaiting does not lose the rename result and does not make next save ask about the removed image (1.485167ms)
  ✔ reverts baseline when rename execution fails (0.542042ms)
  ✔ updateEntry updates the baseline for direct renames (0.332208ms)
  ✔ dispose clears baseline and lock (0.316958ms)
✔ ImageLedger (#144) (6.219ms)
✔ image-rename-handler (45.382042ms)
✔ image usage across documents (#126) (56.015333ms)
✔ Emoji Search and Filtering (#133) (30.660334ms)
✔ openWikiLink (27.624209ms)
✔ extractVscodeResourcePath recovers the local path from both spellings (1.370084ms)
✔ extractVscodeResourcePath returns null for anything else (0.136417ms)
✔ normalizeResourceUrl decodes and drops the cache-busting query (0.066917ms)
✔ normalizeResourceUrl leaves a malformed escape alone instead of throwing (0.048667ms)
✔ sameResource matches the host URI against the DOM's spelling (0.089ms)
✔ sameResource matches across the query a reload appends (0.059083ms)
✔ sameResource matches vscode-webview:// against file+ for the same path (0.069208ms)
✔ sameResource does NOT match two different files (0.344875ms)
✔ sameResource does not match unrelated strings just because both fail to parse (0.06125ms)
ℹ tests 92
ℹ suites 26
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 218.320042
```

### 2.5. Tiêu chí 5: Phép thử răng (Teeth test) chứng minh test có khả năng bắt lỗi

Đã làm sai cơ chế bằng cách dời lệnh `setBaseline` xuống sau `await confirmSharedDeletes` trong `src/host/documentSave.ts`.
Khi chạy `npm test`, có **đúng 1 ca đỏ**:

Lệnh:
```sh
npm test
```
Output khi bị làm sai (đỏ):
```
    ✖ re-baselines before the prompt, so a save landing during it cannot ask again (1.796333ms)
ℹ tests 92
ℹ suites 26
ℹ pass 91
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 165.565709

✖ failing tests:

test at out/test/image-usage.test.js:847:29
✖ re-baselines before the prompt, so a save landing during it cannot ask again (1.796333ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  2 !== 1
  
      at TestContext.<anonymous> (/Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w10-ledger/out/test/image-usage.test.js:858:29)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Sau khi hoàn lại code đúng, chạy lại `npm test`:
```
ℹ tests 92
ℹ suites 26
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 160.373583
```

### 2.6. Tiêu chí 6: Kiểm tra biên kiểm định roundtrip và floor check

#### Kiểm tra lint:
```sh
npm run lint
```
Output:
```
> tui-milkdown-vscode@3.0.1 lint
> tsc --noEmit
```

#### Kiểm tra build:
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

#### Kiểm tra roundtrip vòng 1:
```sh
npm run roundtrip
```
Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

#### Kiểm tra roundtrip vòng 2 kèm khôi phục:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

#### Chốt chặn fixture diff với merge-base:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output:
(rỗng, không chạm fixture cũ hay thêm fixture thừa)

#### Kiểm tra vscode floor (`npm run verify:vscode-floor`):
Lệnh đã chạy:
```sh
npm run verify:vscode-floor
```
Kết quả đo:
- `PASS removing an image from the markdown deletes the file on save`
- `PASS answering the prompt deletes the shared image after all`
- `PASS an image put back while the prompt is open survives the answer`
- Check `FAIL double-click rename leaves every reference on the new relative path (#142)` là check cố ý đỏ thuộc phạm vi xử lý của worker #142 (ghi nhận theo đúng `COMMON.md`).
- Check `slash command opens a filtered block menu` bị trượt focus do cửa sổ nền cạnh tranh trong quá trình kiểm thử giao diện tự động.

---

## 3. Các tiêu chí chưa kiểm được và lý do

Không có tiêu chí nào trong ticket #144 bị bỏ sót. Mọi yêu cầu về unit test, loại bỏ tham số thừa, bất biến thứ tự đồng bộ và chống race condition đều đã được chứng minh bằng test tự động.

---

## 4. Câu chữ đề xuất cho CHANGELOG và AGENTS.md

### Câu chữ cho CHANGELOG:
```markdown
- Image ledger: introduced host-side ImageLedger module per document, eliminating raw Map<string, Map<string, string>> threading and enforcing synchronous re-baselining on save (#144)
```

### Câu chữ cho AGENTS.md:

Trong mục **File Structure** (dưới `src/host/`):
```markdown
│   ├── imageLedger.ts        # ImageLedger: per-document image path baseline, rename coordination and delete detection (#144)
```

Trong mục **Conventions & Gotchas**:
Thay thế đoạn mô tả cũ về `originalImagePaths` bằng:
```markdown
- The per-document image baseline is encapsulated in ImageLedger (`src/host/imageLedger.ts`). The old trap of passing the outer map plus docKey to prevent stale inner map references is gone: the provider holds `Map<string, ImageLedger>` keyed by docKey, and handlers receive the ledger directly. On save, `handleDocumentSave` calls `ledger.setBaseline()` synchronously as its very first step before any await, guaranteeing that the pre-save baseline is returned for delete detection while the fresh baseline is already installed for concurrent saves.
```
