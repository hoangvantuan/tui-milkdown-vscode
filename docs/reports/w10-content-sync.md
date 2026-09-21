# Báo cáo Sóng 10: Content Sync (#148)

## 1. Tóm tắt điều hành

Đã tách toàn bộ trạng thái đồng bộ văn bản giữa webview và extension host ra module độc lập `src/webview/content-sync.ts`. Module sở hữu 9 biến trạng thái (`currentBody`, `currentFrontmatter`, `currentFormat`, `currentRawBlock`, `contentBaseline`, `lastSentState`, `isUpdatingFromExtension`, `debounceTimer`, `blobRetryCount`) và 7 phương thức/hàm đồng bộ (`postEdit`, `resetContentBaseline`, `debouncedPostEdit`, `flushPendingEdit`, `serializeEditorBody`, `buildContent`, `serializeStateForEcho`).

Module mới hoàn toàn Node-safe (không truy cập DOM, `window`, hay `acquireVsCodeApi`), nhận `postMessage` thông qua dependency injection. Toàn bộ `src/webview/*.ts` hiện chỉ có duy nhất 1 dòng gửi message `type: "edit"`.

Seam `harness/content-sync-seam.ts` đã được lấp đầy đủ 5 ca kiểm thử thông qua `ManualClock` scheduler, vượt qua 60/60 phép kiểm roundtrip. Cả hai phép thử răng (loại bỏ baseline gate và loại bỏ neo lại baseline) đều gây đỏ có thể đếm được số dòng.

## 2. Bằng chứng nghiệm thu quan sát được

### 2.1. Chín biến trạng thái đã rời khỏi module scope của `src/webview/main.ts`

Lệnh kiểm tra:
```sh
grep -n '^let \(currentBody\|currentFrontmatter\|currentFormat\|currentRawBlock\|contentBaseline\|lastSentState\|debounceTimer\|blobRetryCount\)' src/webview/main.ts
```

Output: (rỗng, exit code 1)

Ghi chú về `isUpdatingFromExtension`: Biến này được giữ lại ở `main.ts` làm alias tạm thời cho điểm chạm với worker song song #147 (`updateImageNodeSrc` gán trực tiếp cờ này). `contentSync` nhận predicate `isExternalUpdating: () => isUpdatingFromExtension` nên cả hai vị trí đều hòa hợp.

### 2.2. Lối ra duy nhất cho `type: "edit"` trong webview

Lệnh kiểm tra:
```sh
grep -n 'type: "edit"' src/webview/*.ts
```

Output:
```
src/webview/content-sync.ts:135:    this.options.postMessage({ type: "edit", content });
```
Đúng 1 dòng duy nhất trong toàn bộ `src/webview/*.ts`.

### 2.3. Tính Node-safe của module `src/webview/content-sync.ts`

Lệnh kiểm tra:
```sh
grep -nE '(acquireVsCodeApi|document\.|window\.)' src/webview/content-sync.ts
```

Output: (rỗng, exit code 1)

### 2.4. Kết quả 5 ca kiểm thử trong `harness/content-sync-seam.ts`

Nội dung file golden `harness/golden/seams/content-sync.txt`:
```
# content sync seam: which edits the rich text view posts to the host, and which it does not

[type-undo-in-debounce] posts=0
[alert-trailing-node-load] posts=0
[baseline-reanchors-after-post] posts=2
[rapid-edits-single-post] posts=1 content="Alpha Beta Gamma"
[flush-pending-debounce-posts-immediately] posts=1 flushed=true content="First Second"
```

Cơ chế debounce trong harness: Dùng `ManualClock` thực hiện scheduler điều khiển thời gian một cách đồng bộ và tất định (deterministic), không dùng sleep hay setTimeout thực tế trong harness, loại bỏ hoàn toàn nguy cơ flaky test.

### 2.5. Phép thử răng (Teeth test)

#### Răng 1: Bỏ gate baseline trong `postEdit`
Tạm sửa `src/webview/content-sync.ts` bỏ dòng `if (content === this.contentBaseline) return false;`:
Lệnh chạy: `npm run roundtrip`
Output thất bại:
```
FAIL     seams/content-sync.txt (+2 -2 lines)
  --- golden/seams/content-sync.txt
  +++ current/seams/content-sync.txt
  @@ -1,7 +1,7 @@
   # content sync seam: which edits the rich text view posts to the host, and which it does not
   
  -[type-undo-in-debounce] posts=0
  -[alert-trailing-node-load] posts=0
  +[type-undo-in-debounce] posts=1
  +[alert-trailing-node-load] posts=1
   [baseline-reanchors-after-post] posts=2
   [rapid-edits-single-post] posts=1 content="Alpha Beta Gamma"
   [flush-pending-debounce-posts-immediately] posts=1 flushed=true content="First Second"

──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Đúng 2 ca kiểm thử thất bại, đếm được (+2 -2 lines).

#### Răng 2: Bỏ neo lại baseline sau post thật
Tạm sửa `src/webview/content-sync.ts` bỏ dòng `this.contentBaseline = content;`:
Lệnh chạy: `npm run roundtrip`
Output thất bại:
```
FAIL     seams/content-sync.txt (+1 -1 lines)
  --- golden/seams/content-sync.txt
  +++ current/seams/content-sync.txt
  @@ -2,7 +2,7 @@
   
   [type-undo-in-debounce] posts=0
   [alert-trailing-node-load] posts=0
  -[baseline-reanchors-after-post] posts=2
  +[baseline-reanchors-after-post] posts=1
   [rapid-edits-single-post] posts=1 content="Alpha Beta Gamma"
   [flush-pending-debounce-posts-immediately] posts=1 flushed=true content="First Second"

──────────────────────────────────────────
42 markdown fixtures + 18 seams: 59 passed, 1 failed, 0 missing, 0 errored
```
Đúng 1 ca kiểm thử thất bại, đếm được (+1 -1 lines).

Khôi phục cả hai: `npm run roundtrip` đạt 60 passed, 0 failed.

### 2.6. Kiểm tra kích thước bundle và các bộ test

```sh
npm run lint
```
Output:
```
> tui-milkdown-vscode@3.0.1 lint
> tsc --noEmit
```
Mã thoát: 0 (sạch).

```sh
npm run build
```
Output:
```
> tui-milkdown-vscode@3.0.1 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1027558 B / 1100000 B budget
```
Kích thước bundle webview: 1027558 B, dưới ngân sách 1100000 B (còn dư 72442 B).

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
ℹ duration_ms 308.918167
```

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

Round 2 roundtrip và khôi phục:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
```
Output: 60 passed, 0 failed. `git status --short harness/` rỗng.

Kiểm tra fixture so với merge-base:
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: rỗng. Không có fixture cũ nào bị sửa đổi.

### 2.7. Kiểm tra sàn VS Code và phát hiện lỗi window.setTimeout

#### Phát hiện lỗi window.setTimeout
- Lỗi phát hiện bằng gì: Phát hiện thông qua kiểm tra sàn VS Code (`npm run verify:vscode-floor`), tại check `a typed character reaches the document` (`isDirty=true sentinelInText=false version 1->2`).
- Cơ chế lỗi: Trong thiết kế ban đầu của `src/webview/content-sync.ts`, để phục vụ tính Node-safe mà không phụ thuộc vào `window`, fallback của `scheduler` được viết là:
  `const scheduler = this.options.scheduler ?? { setTimeout, clearTimeout };`
  Khi chạy trong môi trường trình duyệt Chromium của VS Code webview, gọi `scheduler.setTimeout(...)` sẽ gắn context `this` thành đối tượng trần `{ setTimeout, clearTimeout }`. Chromium thực thi hàm Web API `window.setTimeout` với yêu cầu nghiêm ngặt rằng receiver phải là `Window`, dẫn tới ném ngoại lệ `TypeError: Illegal invocation`. Lỗi xảy ra đồng bộ ngay khi `debouncedPostEdit()` được kích hoạt bởi sự kiện gõ ký tự, làm chết hàm lập lịch và không có thông điệp edit nào được gửi đi.
- Vì sao các bộ kiểm trước không bắt được:
  1. `npm test` và `npm run roundtrip` chạy trên Node.js. `global.setTimeout` trong Node không kiểm tra receiver ngữ cảnh như Chromium Web API.
  2. `harness/content-sync-seam.ts` truyền vào một `ManualClock` tường minh, do đó nhánh fallback mặc định của `scheduler` hoàn toàn không được kích hoạt trong seam.
- Khắc phục:
  Định nghĩa `defaultScheduler: TimerScheduler` bọc qua arrow function:
  ```ts
  const defaultScheduler: TimerScheduler = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
  };
  ```
  Cách viết này bảo toàn tính Node-safe (không tham chiếu chữ `window`), đồng thời đảm bảo khi chạy trong Chromium, hàm `setTimeout` được gọi trực tiếp trong ngữ cảnh toàn cục đúng đắn.

#### Kết quả kiểm tra sàn sau khi sửa
Sau khi sửa, kiểm tra `a typed character reaches the document` chuyển sang trạng thái PASS thành công.

Lệnh chạy:
```sh
npm run verify:vscode-floor
```

Chi tiết 5 kiểm tra đồng bộ văn bản theo yêu cầu:
1. `PASS  opening the document leaves it unmodified : isDirty=false`
2. `PASS  document still unmodified after the hold : isDirty=false`
3. `PASS  a keystroke undone inside the debounce window leaves the document clean : isDirty=false version=1; typed and removed "Z" 27ms apart, debounce 300ms`
4. `PASS  a typed character reaches the document : isDirty=true sentinelInText=true version 1->7`
5. `PASS  the edit does not bounce between host and webview : version 7 then 7 after 3s idle`

Tổng kết toàn bộ 55 kiểm tra:
`55 checks: 54 passed, 1 failed`
- Kiểm tra không đạt: `FAIL  the VS Code window is on screen when the surfaces start : visibility=hidden reraise=raised`.
- Nguyên nhân: Lượt chạy diễn ra khi màn hình đang được bàn giao cho worker khác, cửa sổ VS Code bị che khuất (`visibility=hidden`), không phải khiếm khuyết trong mã nguồn.
- Điều phối viên sẽ chạy lượt nghiệm thu trên nhánh đã merge develop, đó mới là lượt quyết định.

## 3. Điểm chạm với worker song song #147

Trong `src/webview/main.ts`, hai vị trí thuộc sở hữu của #147:
1. `updateImageNodeSrc` (dòng 321 đến 365):
   - Đang trực tiếp gán `isUpdatingFromExtension = true` và nhả trong `queueMicrotask(() => { isUpdatingFromExtension = false; })`.
   - Để tránh xung đột với #147, `main.ts` giữ biến `let isUpdatingFromExtension = false;` và truyền `isExternalUpdating: () => isUpdatingFromExtension` vào `contentSync`.
   - Sau khi merge #147, điều phối viên có thể chuyển trực tiếp sang `contentSync.guardExtensionUpdate(...)` hoặc `contentSync.setUpdatingFromExtension(...)`.
2. `applyImageRename` (dòng 577 đến 610):
   - Gọi `resetContentBaseline()`.
   - Hàm `export function resetContentBaseline(): void` được giữ tại `main.ts` và ủy quyền vào `contentSync.resetContentBaseline()`.

## 4. Câu chữ cho CHANGELOG

```markdown
- Refactor document synchronization state into a Node-safe ContentSync module owning baseline tracking, debounced edit scheduling, echo suppression, and the postEdit gate (#148).
```

## 5. Câu chữ cho AGENTS.md

### Thêm vào File Structure:
```
│   ├── content-sync.ts       # Content sync: baseline, debounce, flush, and edit post gate (#148)
```

### Cập nhật Conventions:
```markdown
- Content synchronization state between webview and extension host is owned by `src/webview/content-sync.ts` (`ContentSync`). The webview posts an `edit` only when serialized content differs from `contentBaseline`, measured after StarterKit's `trailingNode` settles via an empty transaction. Baseline re-anchors on every real post.
- All edit posts pass through `ContentSync.postEdit()`, which is the single exit point for `{ type: "edit" }` messages in the webview.
```
