# Báo cáo Sóng 10: Image path translation (#147)

Nhánh: `hoangvantuan/w10-image-path`
Merge-base: `20e502b2a8c1006318cc1957ab40f98f470b4b9f`
Ngày: 2026-09-21

## 1. Tóm tắt bản sửa

### Nguyên nhân gốc (Nhân, Duyên, Quả)
- Quả (triệu chứng): Trạng thái ánh xạ đường dẫn ảnh bị phân tán giữa `main.ts` và `image-edit-plugin.ts`. Các biến map và bộ đếm phiên bản được quản lý riêng rẽ, dẫn đến bộ ba lệnh `currentImageMap = ...; imageMapVersion++; setImageMap(...)` lặp lại tại 4 vị trí trong `main.ts`. Seam harness trước đây phải import trực tiếp `main.ts`, kéo theo việc `main.ts` phải mang hai guard `typeof acquireVsCodeApi`, gate `init()`, và làm phình kích thước bundle harness từ 2754242 B lên 3043044 B. Ngoài ra, việc tra cứu ngược quét toàn bộ map bằng `sameResource` cho mỗi URL tốn kém O(N).
- Nhân (nguyên nhân cốt lõi): Chưa có một module duy nhất sở hữu toàn vẹn bản đồ ảnh, bộ đếm phiên bản, cache reverse map và các phép dịch đường dẫn ảnh độc lập với môi trường runtime của VS Code extension host.
- Duyên (điều kiện kích hoạt): Bản sửa lỗi #142 tạm thời kết nối harness seam vào `main.ts` để kiểm chứng việc vô hiệu hóa cache và cập nhật node, để lại nợ kỹ thuật là sự phụ thuộc của harness vào module webview entry point.

### Giải pháp cấu trúc
1. Module mới `src/webview/image-path-translation.ts`:
   - Hoàn toàn Node-safe (không đụng `document`, `window`, `acquireVsCodeApi`).
   - Độc quyền sở hữu trạng thái bản đồ ảnh (`currentImageMap`), bộ đếm phiên bản (`imageMapVersion`), cache reverse map (`cachedReverseImageMap`, `cachedReverseImageMapVersion`).
   - Cung cấp các thao tác đột biến duy nhất: `setImageMap(map)` (thay thế toàn bộ, tự động tăng phiên bản) và `mutateImageMap(fn)` (chỉnh sửa tại chỗ qua callback, tự động tăng phiên bản).
   - Tối ưu hóa tra cứu ngược O(1): Chuẩn hóa URL webview thành khóa tài nguyên kinh điển `toResourceKey(url)` (dùng `normalizeResourceUrl` và `extractVscodeResourcePath`), lập chỉ mục một lần khi dựng cache reverse map thay vì quét O(N) qua `sameResource` mỗi lần tra cứu.
   - Cung cấp `transformForDisplay`, `transformForSave`, và `lookupOriginalPath`.
   - Cung cấp hàm ProseMirror thuần `updateEditorImageNodeSrc(editor, oldSrc, newSrc)` và hàm hoàn tất rename `applyImageRenameTranslation(oldSrc, oldPath, newPath, webviewUri, editor)`.
2. `src/webview/main.ts`:
   - Gỡ bỏ toàn bộ biến trạng thái bản đồ ảnh ở phạm vi module.
   - Gỡ bỏ hai guard `typeof acquireVsCodeApi === "function"` (tại khởi tạo `vscode` và gate `init()`).
   - Khôi phục header comment chuẩn: "Module scope calls `acquireVsCodeApi()`, so this file cannot be imported from Node."
   - Thay thế các bộ ba thao tác map bằng một lệnh duy nhất gọi tới module dịch ảnh.
   - Giữ wrapper mỏng `handleImageRenamed` làm điểm chạm với #148: giữ nguyên việc bật/tắt cờ `isUpdatingFromExtension` và lời gọi `resetContentBaseline()`.
   - Gỡ bỏ `export` của `updateImageNodeSrc` và `applyImageRename` (chuyển thành hàm cục bộ).
3. `src/webview/image-edit-plugin.ts`:
   - Gỡ bỏ biến `currentImageMap` và hàm `setImageMap`.
   - Dùng `lookupOriginalPath` để tra cứu ngược đường dẫn ảnh gốc trong `triggerOpenInTab` và `requestUrlEdit`.
   - Dùng `mutateImageMap` trong nhánh fallback của `handleImageRenameResponse`.
4. `harness/image-path-seam.ts`:
   - Chuyển sang import trực tiếp `src/webview/image-path-translation.ts` và `createHarnessEditor`, không còn bất kỳ import nào từ `main.ts`.
   - Giữ nguyên toàn bộ 7 ca kiểm thử của #142 và bổ sung 3 ca mới kiểm tra các hành vi của module (`set-map-reverse`, `mutate-map-reverse`, `consecutive-set-map`).

## 2. Danh sách hàm và mã nguồn thực tế

### Danh sách hàm liên quan trong `image-path-translation.ts` (sinh bằng `git grep`)

Lệnh:
```sh
git grep -n "setImageMap\|mutateImageMap\|getImageMap\|transformForDisplay\|transformForSave\|updateEditorImageNodeSrc\|applyImageRenameTranslation" src/webview/image-path-translation.ts
```

Output:
```
src/webview/image-path-translation.ts:59:export function setImageMap(map: Record<string, string>): void {
src/webview/image-path-translation.ts:68:export function mutateImageMap(fn: (map: Record<string, string>) => void): void {
src/webview/image-path-translation.ts:76:export function getImageMap(): Record<string, string> {
src/webview/image-path-translation.ts:83:export function getImageMapVersion(): number {
src/webview/image-path-translation.ts:137:export function transformForDisplay(
src/webview/image-path-translation.ts:150:export function transformForSave(
src/webview/image-path-translation.ts:175:export function updateEditorImageNodeSrc(
src/webview/image-path-translation.ts:220:export function applyImageRenameTranslation(
src/webview/image-path-translation.ts:227:  mutateImageMap((map) => {
src/webview/image-path-translation.ts:235:    updateEditorImageNodeSrc(editor, oldSrc, webviewUri);
```

### Mã nguồn cơ chế tra cứu ngược tối ưu và quản lý cache trong `src/webview/image-path-translation.ts`

Lệnh:
```sh
sed -n '32,86p' src/webview/image-path-translation.ts
```

Output:
```ts
function toResourceKey(url: string): string {
  const norm = normalizeResourceUrl(url);
  const vscPath = extractVscodeResourcePath(norm);
  return vscPath !== null ? "vsc:" + vscPath : "raw:" + norm;
}

/**
 * Build or retrieve the cached reverse map (webview URI -> relative path).
 * Rebuilt lazily only when imageMapVersion changes.
 */
function getReverseMap(): Map<string, string> {
  if (cachedReverseImageMapVersion !== imageMapVersion || cachedReverseImageMap === null) {
    const reverseMap = new Map<string, string>();
    for (const [relativePath, uri] of Object.entries(currentImageMap)) {
      reverseMap.set(uri, relativePath);
      reverseMap.set(toResourceKey(uri), relativePath);
    }
    cachedReverseImageMap = reverseMap;
    cachedReverseImageMapVersion = imageMapVersion;
  }
  return cachedReverseImageMap;
}

/**
 * Replace the current image map, increment the version counter,
 * and invalidate the cached reverse map.
 */
export function setImageMap(map: Record<string, string>): void {
  currentImageMap = { ...map };
  imageMapVersion++;
}

/**
 * Mutate the image map via a callback, increment the version counter,
 * and invalidate the cached reverse map.
 */
export function mutateImageMap(fn: (map: Record<string, string>) => void): void {
  fn(currentImageMap);
  imageMapVersion++;
}

/**
 * Get a snapshot of the current image map.
 */
export function getImageMap(): Record<string, string> {
  return { ...currentImageMap };
}

/**
 * Get the current version counter of the image map.
 */
export function getImageMapVersion(): number {
  return imageMapVersion;
}
```

### Mã nguồn wrapper đồng bộ `handleImageRenamed` và `updateImageNodeSrc` trong `src/webview/main.ts`

Lệnh:
```sh
sed -n '476,500p' src/webview/main.ts
```

Output:
```ts
// Rename completion: delegates map mutation and editor node updates to the
// image translation module, keeping extension sync flags and baseline re-anchoring
// in this module (#142, #147).
function handleImageRenamed(
  oldSrc: string,
  oldPath: string,
  newPath: string,
  webviewUri: string,
): void {
  if (!editor) return;
  try {
    isUpdatingFromExtension = true;
    applyImageRenameTranslation(oldSrc, oldPath, newPath, webviewUri, editor);
  } finally {
    queueMicrotask(() => {
      isUpdatingFromExtension = false;
    });
  }
  resetContentBaseline();
}

setOnImageRenamed((oldSrc, oldPath, newPath, webviewUri) => {
  handleImageRenamed(oldSrc, oldPath, newPath, webviewUri);
});
```

Lệnh:
```sh
sed -n '230,242p' src/webview/main.ts
```

Output:
```ts
function updateImageNodeSrc(oldSrc: string, newSrc: string): boolean {
  if (!editor) return false;
  try {
    isUpdatingFromExtension = true;
    return updateEditorImageNodeSrc(editor, oldSrc, newSrc);
  } finally {
    queueMicrotask(() => {
      isUpdatingFromExtension = false;
    });
  }
}

const pendingImageSaves = new Map<string, number>();
```

## 3. Fact kiểm tra tính cô lập và dọn nợ #142

### Kiểm tra biến trạng thái bản đồ ảnh trong `main.ts` và `image-edit-plugin.ts`
Lệnh:
```sh
grep -n 'currentImageMap\|imageMapVersion\|cachedReverseImageMap' src/webview/main.ts src/webview/image-edit-plugin.ts
```
Output:
```
(rỗng)
```

### Kiểm tra các hook thử nghiệm và guard acquireVsCodeApi trong `main.ts`
Lệnh:
```sh
grep -n 'typeof acquireVsCodeApi\|_testResetReverseCache\|setCurrentImageMap' src/webview/main.ts
```
Output:
```
(rỗng)
```

### Kiểm tra import main.ts từ harness
Lệnh:
```sh
grep -n "from \"../src/webview/main\"" harness/*.ts
```
Output:
```
(rỗng)
```

### Kiểm tra tính Node-safe của module mới
Lệnh:
```sh
grep -n 'acquireVsCodeApi\|document\.\|window\.' src/webview/image-path-translation.ts
```
Output:
```
(rỗng)
```

## 4. Đo lường kích thước bundle harness

Lệnh:
```sh
ls -l out/harness/roundtrip.js
```

Output:
```
-rw-r--r--@ 1 tuanhv  staff  2767622 Sep 21 14:04 out/harness/roundtrip.js
```

So sánh kích thước:
- Mốc trước #142: 2754242 B
- Sau #142 (seam import trực tiếp `main.ts`): 3043044 B
- Sau #147 (seam chỉ import module mới): 2767622 B (giảm ~275 KB so với đỉnh điểm của #142, trở về sát mốc gốc 2754242 B).

## 5. Phép thử răng (Teeth Tests)

### Phép thử răng 1: Bỏ tăng phiên bản khi thay đổi bản đồ ảnh
Thực hiện comment dòng `imageMapVersion++;` trong `setImageMap` và `mutateImageMap` tại `src/webview/image-path-translation.ts`.

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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
FAIL     seams/image-path.txt (+6 -6 lines)
  --- golden/seams/image-path.txt
  +++ current/seams/image-path.txt
  @@ -47,18 +47,18 @@
   
   ## set-map-reverse
   # setImageMap replaces the map, version increments, reverse lookup uses new entries
  -saved: ![photo](media/photo.png)
  -version-bumped: true
  +saved: ![photo](https://file+.vscode-resource.vscode-cdn.net/ws/media/photo.png)
  +version-bumped: false
   
   ## mutate-map-reverse
   # mutateImageMap modifies map in place, invalidates reverse cache, new path is translated
  -primed: ![pic](media/old-pic.png)
  -saved-after-mutate: ![pic](media/new-pic.png)
  +primed: ![pic](https://file+.vscode-resource.vscode-cdn.net/ws/media/old-pic.png)
  +saved-after-mutate: ![pic](https://file+.vscode-resource.vscode-cdn.net/ws/media/new-pic.png)
   
   ## consecutive-set-map
   # two consecutive setImageMap calls increment version monotonically and use latest map
  -version-increased: true
  +version-increased: false
   first-entry-gone: true
  -second-entry-saved: ![second](media/second.png)
  +second-entry-saved: ![second](https://file+.vscode-resource.vscode-cdn.net/ws/media/second.png)
   
   

──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Số ca đỏ: Đúng 3 ca kiểm thử liên quan đến quản lý phiên bản và cache (`set-map-reverse`, `mutate-map-reverse`, `consecutive-set-map`) bị đỏ với 6 dòng diff, chứng minh bộ đếm phiên bản thực sự kiểm soát việc hủy cache reverse map. Khôi phục lại: 60/60 xanh.

### Phép thử răng 2: Giới hạn hàm cập nhật node chỉ đổi node đầu tiên
Trong `updateEditorImageNodeSrc` tại `src/webview/image-path-translation.ts`, giới hạn vòng lặp `for (const { pos, node, nodeSize } of nodesToUpdate.slice(0, 1))` chỉ cập nhật 1 node đầu tiên.

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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
FAIL     seams/image-path.txt (+1 -1 lines)
  --- golden/seams/image-path.txt
  +++ current/seams/image-path.txt
  @@ -30,7 +30,7 @@
   saved: ![first](media/icon.png)
   
   ![second](media/icon.png)
  -saved-after-rename: ![first](media/icon-renamed.png)
  +saved-after-rename: ![first](https://file+.vscode-resource.vscode-cdn.net/ws/media/icon.png)
   
   ![second](media/icon-renamed.png)
   

──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Số ca đỏ: Đúng 1 dòng đỏ tại ca `two-nodes-same-image`. Node thứ hai không được cập nhật webview URI mới nên khi dịch ngược để lưu bị rớt về địa chỉ webview cũ. Khôi phục lại: 60/60 xanh.

## 6. Kết quả kiểm tra trước khi hoàn thành

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
webview bundle: 1024393 B / 1100000 B budget
```
Dung lượng bundle webview: 1024393 B (nằm an toàn dưới ngưỡng 1100000 B).

### npm test
Lệnh:
```sh
npm test
```
Output:
```
ℹ tests 97
ℹ suites 27
ℹ pass 97
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 306.192875
```

### npm run roundtrip (Vòng 1)
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
markdown roundtrip harness: mode: check
corpus: 42 fixtures (37 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
42 markdown fixtures + 18 seams: 60 passed, 0 failed, 0 missing, 0 errored
```

### Chốt chặn fixtures cũ không bị sửa
Lệnh:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output:
```
(rỗng)
```

### Kiểm tra thay đổi golden
Lệnh:
```sh
git status --short harness/golden
```
Output:
```
 M harness/golden/seams/image-path.txt
```

## 7. Kiểm tra sàn VS Code (npm run verify:vscode-floor)

Lệnh:
```sh
npm run verify:vscode-floor
```

Dòng detail của 4 check theo yêu cầu của TASK.md:
```
PASS  double-click rename leaves every reference on the new relative path (#142): asked=1 shown="media/icon.png" renamedOnDisk=true oldGone=true newRelative=2 oldRelative=0 webviewUrls=0 (two references in sample.md, so two must come out on the new name; a webview address here is the #142 lossy shape, an oldRelative>0 is the second image node serialized from a stale map; the later save may trash a dangling reference)
PASS  double-click image rename could be driven: picked the last of 2 icon.png img(s) of 4 total; src was https://file%2B.vscode-resource.vscode-cdn.net/tmp/tuimd-flo...; nodes now on icon-renamed=2 after 253ms (0 means the host never answered or the plugin never updated the node; the host records what the file holds)
PASS  the edit does not bounce between host and webview: version 6 then 6 after 3s idle
PASS  a keystroke undone inside the debounce window leaves the document clean: isDirty=false version=1; typed and removed "Z" 15ms apart, debounce 300ms
```
Ghi nhận:
Cả 4 check liên quan đến tính năng rename, map translation và sync baseline đều XANH hoàn toàn (PASS). Check rename #142 ghi nhận 2 tham chiếu được cập nhật chính xác sang đường dẫn tương đối mới, 0 URL webview và 0 tham chiếu đường dẫn cũ sót lại trên đĩa (newRelative=2 oldRelative=0 webviewUrls=0).

## 8. Câu chữ cho CHANGELOG

```markdown
### Refactored
- **Image path translation module (#147)**: Consolidated webview image path mapping, version tracking, reverse-lookup cache, and path transformations into a dedicated, Node-safe module (`src/webview/image-path-translation.ts`). Simplified `main.ts` and `image-edit-plugin.ts` into callers, optimized reverse lookup to O(1) canonical key matching, eliminated Node-environment guards in `main.ts`, and restored harness bundle size to pre-#142 levels.
```

## 9. Câu chữ cho AGENTS.md

Thêm vào mục File Structure dưới `src/webview/`:
```markdown
    ├── image-path-translation.ts # Image path translation: map ownership, versioning, reverse cache, and display/save transforms (#147)
```
