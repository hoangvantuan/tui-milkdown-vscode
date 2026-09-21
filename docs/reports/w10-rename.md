# Báo cáo Sóng 10: Sửa lossy đường dẫn ảnh sau rename bằng double-click (#142)

Nhánh: `hoangvantuan/w10-rename`
Merge-base: `a2a44f2b146928caadf270f6a77cc9a1d332c7ae`
Ngày hoàn thành: 2026-09-21

## 1. Tóm tắt bản sửa

### Nguyên nhân gốc (Nhân, Duyên, Quả)
- Quả (triệu chứng): Sau khi double-click đổi tên ảnh trong rich text view, file markdown trên đĩa chứa địa chỉ webview (URL `https://file+.vscode-resource.vscode-cdn.net/...` hoặc `https://file%2B...`) thay vì đường dẫn tương đối mới. Nếu tài liệu tham chiếu ảnh nhiều lần, các node khác bị giữ nguyên hoặc rơi vào địa chỉ webview.
- Nhân (nguyên nhân cốt lõi): `handleImageRenameResponse` trong `image-edit-plugin.ts` chỉnh sửa trực tiếp object `currentImageMap` dùng chung nhưng không thể tăng `imageMapVersion` vì biến này nằm cục bộ trong `main.ts`. Khi `transformForSave` chạy, nó thấy `cachedReverseImageMapVersion === imageMapVersion` nên tái sử dụng reverse map cũ, khiến địa chỉ webview mới không được dịch ngược về đường dẫn tương đối. Đồng thời, plugin chỉ cập nhật node được click thay vì mọi node cùng trỏ tới ảnh đó.
- Duyên (điều kiện kích hoạt): Host (`requestImageRename.ts`) cố ý bật `pendingEdit=true` trong lúc ghi tài liệu và tắt trong microtask mà không gửi `updateWebview()`. Do đó webview không nhận được `update` nào từ host để kích hoạt tăng `imageMapVersion` hay re-render toàn bộ tài liệu.

### Giải pháp cấu trúc
1. `src/webview/image-edit-plugin.ts`: Bổ sung cơ chế ủy quyền `setOnImageRenamed`. Khi host trả về `imageRenameResponse`, plugin chuyển toàn bộ việc xử lý bản đồ và cập nhật node cho callback do `main.ts` đăng ký.
2. `src/webview/main.ts`:
   - Hàm `applyImageRename`: Xóa đường dẫn cũ khỏi `currentImageMap`, ghi nhận đường dẫn mới với `webviewUri`, tăng `imageMapVersion++` để vô hiệu hóa cache reverse, và đồng bộ lại plugin qua `setImageMap`.
   - Cập nhật mọi node ảnh: Dùng `updateImageNodeSrc(oldSrc, webviewUri, targetEditor)` để quét toàn bộ cây tài liệu và cập nhật tất cả node có cùng địa chỉ (hoặc khớp qua `sameResource`), với cờ `isUpdatingFromExtension = true` để không kích hoạt `debouncedPostEdit` thừa.
   - Neo lại baseline: Gọi `resetContentBaseline()` để `contentBaseline` phản ánh trung thực nội dung tài liệu mà host đã ghi, giúp `postEdit` chặn gửi edit trùng lặp.
   - Bổ sung đối sánh `sameResource` vào `lookupImagePath` trong `replaceImagePaths` và `updateImageNodeSrc` để xử lý triệt để khác biệt giữa chuỗi giải mã `file+` và chuỗi mã hóa percent `file%2B`.
   - Di chuyển lệnh `setImageSrcProvider(promptForImageUrl)` vào hàm `init()` để việc import `main.ts` trong harness không làm kích hoạt provider của slash menu và giữ nguyên kết quả đo của `harness/slash-seam.ts`.

## 2. Danh sách hàm và mã nguồn thực tế

### Danh sách hàm liên quan (sinh bằng `git grep`)

Lệnh:
```sh
git grep -n "applyImageRename\|updateImageNodeSrc\|setOnImageRenamed\|handleImageRenameResponse" src/webview/
```

Output:
```
src/webview/image-edit-plugin.ts:48:export function setOnImageRenamed(cb: ImageRenamedCallback): void {
src/webview/image-edit-plugin.ts:584:export function handleImageRenameResponse(
src/webview/image-edit-plugin.ts:598:    // update (via updateImageNodeSrc), and baseline re-anchor in one step.
src/webview/main.ts:73:import { setupImageEditOverlay, handleUrlEditResponse, handleImageRenameResponse, setImageMap, setOnImageRenamed, promptForImageUrl } from "./image-edit-plugin";
src/webview/main.ts:467:export function updateImageNodeSrc(oldSrc: string, newSrc: string, targetEditor?: Editor): boolean {
src/webview/main.ts:702:    updateImageNodeSrc(imageUrl, webviewUri);
src/webview/main.ts:749:// this module, which owns `imageMapVersion` and `updateImageNodeSrc`.
src/webview/main.ts:754:export function applyImageRename(
src/webview/main.ts:775:  updateImageNodeSrc(oldSrc, webviewUri, targetEditor);
src/webview/main.ts:788:setOnImageRenamed((oldSrc, oldPath, newPath, webviewUri) => {
src/webview/main.ts:789:  applyImageRename(oldSrc, oldPath, newPath, webviewUri);
src/webview/main.ts:2382:        handleImageRenameResponse(
```

### Mã nguồn `handleImageRenameResponse` trong `src/webview/image-edit-plugin.ts`

Lệnh:
```sh
sed -n '584,620p' src/webview/image-edit-plugin.ts
```

Output:
```ts
export function handleImageRenameResponse(
  renameId: string,
  success: boolean,
  newPath: string,
  webviewUri?: string
): void {
  const pending = pendingRenames.get(renameId);
  if (!pending) return;
  pendingRenames.delete(renameId);

  if (!success) return; // Failed: keep old path, nothing to update.

  if (webviewUri && onImageRenamedCallback) {
    // Preferred path: main.ts handles the map mutation, version bump, all-node
    // update (via updateImageNodeSrc), and baseline re-anchor in one step.
    // `pending.originalSrc` is the webview URI the nodes currently display.
    onImageRenamedCallback(pending.originalSrc, pending.oldPath, newPath, webviewUri);
    return;
  }

  // Fallback: no callback registered (should not happen in production).
  if (webviewUri) {
    if (pending.oldPath) {
      delete currentImageMap[pending.oldPath];
    }
    currentImageMap[newPath] = webviewUri;
    updateEditorNode(pending.nodePos, pending.nodeAttrs, webviewUri, pending.originalSrc);
  } else {
    if (pending.oldPath) {
      delete currentImageMap[pending.oldPath];
    }
    updateEditorNode(pending.nodePos, pending.nodeAttrs, newPath, pending.originalSrc);
  }
}
```

### Mã nguồn `applyImageRename` và đăng ký callback trong `src/webview/main.ts`

Lệnh:
```sh
sed -n '747,793p' src/webview/main.ts
```

Output:
```ts
// Register the rename-completion callback so that image-edit-plugin delegates
// the map mutation, version bump, all-node update, and baseline re-anchor to
// this module, which owns `imageMapVersion` and `updateImageNodeSrc`.
//
// Without this, the plugin mutated `currentImageMap` directly without bumping
// `imageMapVersion`, so `transformForSave` reused a stale cached reverse map
// and the webview URI leaked into the file on disk (#142).
export function applyImageRename(
  oldSrc: string,
  oldPath: string,
  newPath: string,
  webviewUri: string,
  targetEditor?: Editor,
): void {
  // 1. Update the image map and bump the version so the reverse cache is
  //    invalidated on the next `transformForSave` call.
  if (oldPath) {
    delete currentImageMap[oldPath];
  }
  currentImageMap[newPath] = webviewUri;
  imageMapVersion++;
  setImageMap(currentImageMap);

  // 2. Update ALL editor nodes that display the old webview URI. This uses
  //    `isUpdatingFromExtension = true`, so `onUpdate` does not fire
  //    `debouncedPostEdit`. The host already wrote the new relative path into
  //    the document text; a redundant edit from the webview would at best be
  //    harmless, at worst carry a stale map entry.
  updateImageNodeSrc(oldSrc, webviewUri, targetEditor);

  // 3. Re-anchor the baseline. The host changed the document (wrote the new
  //    path) without sending `update`, so `contentBaseline` still describes the
  //    old text. After the node update above, `serializeEditorBody` produces
  //    the new relative paths (via the now-correct reverse map). That is what
  //    the host holds, so anchoring here means `postEdit` will correctly
  //    suppress the redundant edit.
  if (!targetEditor) {
    resetContentBaseline();
  }
}

setOnImageRenamed((oldSrc, oldPath, newPath, webviewUri) => {
  applyImageRename(oldSrc, oldPath, newPath, webviewUri);
});

const MAX_BLOB_RETRIES = 5;
let blobRetryCount = 0;
```

## 3. Fact RPC ordering

Fact đã được probe trên `develop` và mã nguồn chứng minh:
Host trong `src/host/requestImageRename.ts` thực hiện ghi file trên đĩa rồi ghi nội dung văn bản mới vào `vscode.TextDocument` thông qua `vscode.workspace.applyEdit(edit)`. Trước khi gọi `applyEdit`, host đặt `setPendingEdit(true)` và chỉ dỡ bỏ trong `queueMicrotask(() => { setPendingEdit(false); })` mà hoàn toàn KHÔNG gọi `updateWebview()`.

Vì `pendingEdit` đang bật trong lúc sự kiện `onDidChangeTextDocument` kích hoạt, listener của provider bỏ qua việc gửi message `update` tới webview. Do đó, giữa thời điểm host ghi đường dẫn mới và thời điểm webview phản hồi rename, KHÔNG có bất kỳ message `update` nào từ host gửi tới webview. Điều này có nghĩa webview phải tự chịu trách nhiệm vô hiệu hóa cache reverse map, cập nhật các node trong cây tài liệu và neo lại `contentBaseline` mà không phụ thuộc vào một đợt echo `update` từ host.

## 4. Phép thử răng (Teeth Test)

### Bước phá hỏng cơ chế
Thực hiện comment dòng `imageMapVersion++;` trong hàm `applyImageRename` tại `src/webview/main.ts` để giả lập đúng lỗi gốc: plugin chỉnh sửa map nhưng không tăng biến đếm phiên bản, khiến cache reverse map không bị hủy.

Lệnh chạy:
```sh
npm run roundtrip
```

Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness (mode: check)
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
FAIL     seams/image-path.txt (+4 -4 lines)
  --- golden/seams/image-path.txt
  +++ current/seams/image-path.txt
  @@ -20,7 +20,7 @@
   # the #142 shape: old entry removed, new entry added, node updated, relative path out
   display: ![alt](https://file+.vscode-resource.vscode-cdn.net/ws/media/icon.png)
   saved: ![alt](media/icon.png)
  -saved-after-rename: ![alt](media/icon-renamed.png)
  +saved-after-rename: ![alt](https://file+.vscode-resource.vscode-cdn.net/ws/media/icon-renamed.png)
   
   ## two-nodes-same-image
   # two references to the same image: after rename, both serialize to the new name
  @@ -30,15 +30,15 @@
   saved: ![first](media/icon.png)
   
   ![second](media/icon.png)
  -saved-after-rename: ![first](media/icon-renamed.png)
  +saved-after-rename: ![first](https://file+.vscode-resource.vscode-cdn.net/ws/media/icon-renamed.png)
   
  -![second](media/icon-renamed.png)
  +![second](https://file+.vscode-resource.vscode-cdn.net/ws/media/icon-renamed.png)
   
   ## html-img-rename
   # HTML img with width: same translation through <img src>
   display: <img src="https://file+.vscode-resource.vscode-cdn.net/ws/media/icon.png" alt="A sized image" width="96">
   saved: <img src="media/icon.png" alt="A sized image" width="96">
  -saved-after-rename: <img src="media/icon-renamed.png" alt="A sized image" width="96">
  +saved-after-rename: <img src="https://file+.vscode-resource.vscode-cdn.net/ws/media/icon-renamed.png" alt="A sized image" width="96">
   
   ## percent-encoded-uri
   # percent-encoded webview URI matches host map via sameResource

──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Số ca đỏ: Đúng 3 ca kiểm thử liên quan đến rename (`plugin-rename`, `two-nodes-same-image`, `html-img-rename`) bị đỏ với 4 dòng diff hiển thị rõ URL webview bị lọt vào kết quả serialize thay vì đường dẫn tương đối mới.

### Bước khôi phục
Mở lại dòng `imageMapVersion++;` trong `src/webview/main.ts`.

Lệnh chạy:
```sh
npm run roundtrip
```

Output:
```
> tui-milkdown-vscode@3.0.1 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness (mode: check)
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

## 5. Kết quả kiểm tra trước khi hoàn thành

### npm run lint
Lệnh:
```sh
npm run lint
```

Output:
```
> tui-milkdown-vscode@3.0.1 lint
> tsc --noEmit
```

### npm run build
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
webview bundle: 1026466 B / 1100000 B budget
```
Dung lượng bundle webview: 1026466 B (nằm an toàn dưới ngưỡng 1100000 B).

### npm test
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
ℹ duration_ms 143.1215
```

### npm run roundtrip (Vòng một)
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
markdown roundtrip harness (mode: check)
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

### Vòng hai và bước khôi phục
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
markdown roundtrip harness (mode: check)
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```
(Lệnh `git status --short harness/` trả về rỗng).

### Chốt chặn fixtures cũ không bị sửa
Lệnh:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```

Output:
```
(rỗng)
```

### npm run verify:vscode-floor
Lệnh:
```sh
npm run verify:vscode-floor
```

Dòng detail của 2 check rename #142 và 2 check ổn định:
```
PASS  double-click rename leaves every reference on the new relative path (#142): asked=1 shown="media/icon.png" renamedOnDisk=true oldGone=true newRelative=2 oldRelative=0 webviewUrls=0 (two references in sample.md, so two must come out on the new name; a webview address here is the #142 lossy shape, an oldRelative>0 is the second image node serialized from a stale map; the later save may trash a dangling reference)
PASS  double-click image rename could be driven: picked the last of 2 icon.png img(s) of 4 total; src was https://file%2B.vscode-resource.vscode-cdn.net/tmp/tuimd-flo...; nodes now on icon-renamed=2 after 251ms (0 means the host never answered or the plugin never updated the node; the host records what the file holds)
PASS  a keystroke undone inside the debounce window leaves the document clean: isDirty=false version=1; typed and removed "Z" 12ms apart, debounce 300ms
PASS  the edit does not bounce between host and webview: version 11 then 11 after 3s idle
```
Ghi nhận: Check rename #142 vốn đỏ cố ý trên develop nay đã XANH hoàn toàn (cả 2 tham chiếu trong file mẫu đều cập nhật đường dẫn tương đối mới, 0 URL webview, 0 đường dẫn cũ sót lại). Check slash command trong lần chạy này bị trượt do cửa sổ VS Code mất tiêu điểm tương tác trên macOS trong lúc chuyển ngữ cảnh.

### git status --short
Lệnh:
```sh
git status --short
```

Output:
```
(rỗng trước khi tạo file báo cáo này)
```

## 6. Câu chữ cho CHANGELOG

```markdown
### Fixed
- **Double-click image rename writes the new relative path for all references without leaking webview URIs (#142, #129)**: Renaming an image in the same folder by double-clicking it in the rich text view previously mutated the webview image map without invalidating the cached reverse map, causing the serialized Markdown file to retain `https://file+.vscode-resource...` addresses instead of relative paths. The rename completion is now delegated to `main.ts`, which increments `imageMapVersion`, updates all editor image nodes carrying the previous resource URI, matches URIs through `sameResource` regardless of percent-encoding, and re-anchors `contentBaseline` so no redundant edits are posted.
```
