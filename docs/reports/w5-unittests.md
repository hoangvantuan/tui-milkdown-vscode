# Báo cáo hoàn thành nhiệm vụ W2: Dựng trình chạy unit test node:test và phủ image-rename-handler, frontmatter-parser (#89)

## 1. Tóm tắt những việc đã làm

- Đã thêm trình chạy unit test tích hợp sẵn của Node (`node:test`) thông qua cấu hình mục tiêu build mới trong `esbuild.harness.config.js` và script `"test"` trong `package.json`. Không thêm bất kỳ dependency nào từ bên ngoài.
- Đã cài đặt test stub hoàn chỉnh tại `test/vscode-stub.ts` thay thế cho chuỗi mock tĩnh trước đây, mô phỏng đúng 10 điểm tương tác thật của `src/utils/image-rename-handler.ts` với module `vscode` (thao tác file thật trên thư mục tạm với `node:fs/promises`, lớp `Uri` kèm `fsPath`, duyệt file với `workspace.findFiles`, và spy cảnh báo với `window.showWarningMessage`). Các phương thức giả lập cấu hình không dùng tới đã được dọn sạch hoàn toàn.
- Đã xây dựng bộ unit test cho `src/utils/frontmatter-parser.ts` (`test/frontmatter-parser.test.ts`) bao phủ đầy đủ 5 trường hợp theo yêu cầu: standard, implicit, empty, comment-only, và rawBlock replay.
- Đã xây dựng bộ unit test cho `src/utils/image-rename-handler.ts` (`test/image-rename-handler.test.ts`) bao phủ đầy đủ các ca: phát hiện đổi tên, từ chối đổi tên khi thư mục thay đổi, từ chối đường dẫn vượt cấp (path traversal), phát hiện xóa file, từ chối xóa khi cùng tên file ở thư mục khác (thao tác chuyển thư mục), viết lại tham chiếu trong workspace (bao gồm cả dạng đường dẫn có khoảng trắng bọc `<...>` và bảo vệ khối mã code fence), cảnh báo trùng lặp file và xử lý ghi đè hoặc bỏ qua. Hai ca test mô phỏng caller rỗng ruột đã được loại bỏ theo chỉ đạo vòng 2.
- Đã cập nhật `.vscodeignore` để loại trừ `test/**` và `out/test/**`, ngăn việc đóng gói test vào bản phát hành VSIX.
- Đã bổ sung bước kiểm thử `Unit tests` (`npm test`) vào quy trình CI tại `.github/workflows/ci.yml` ngay sau bước `Markdown roundtrip harness`.

## 2. Thống kê bề mặt vscode cần stub

Lệnh đã chạy để khảo sát toàn bộ điểm dùng `vscode` trong `src/utils/image-rename-handler.ts`:

```bash
grep -o "vscode\.[A-Za-z.]*" src/utils/image-rename-handler.ts | sort | uniq -c
```

Kết quả:

```
   2 vscode.Uri
   4 vscode.Uri.file
   1 vscode.window.showWarningMessage
   1 vscode.workspace.findFiles
   1 vscode.workspace.fs.createDirectory
   1 vscode.workspace.fs.delete
   1 vscode.workspace.fs.readFile
   1 vscode.workspace.fs.rename
   1 vscode.workspace.fs.stat
   1 vscode.workspace.fs.writeFile
```

Đúng 10 vị trí sử dụng, đã được cài đặt đầy đủ trong `test/vscode-stub.ts`.

## 3. Các khối mã cấu hình và stub chính (trích xuất bằng sed -n)

### 3.1. Cấu hình esbuild cho test trong `esbuild.harness.config.js` (dòng 75 đến 104)

Lệnh: `sed -n '75,104p' esbuild.harness.config.js`

```javascript
const vscodeTestPlugin = {
  name: 'vscode-test-stub',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({
      path: path.resolve(__dirname, 'test/vscode-stub.ts'),
    }));
  },
};

const testsConfig = {
  entryPoints: [
    'test/frontmatter-parser.test.ts',
    'test/image-rename-handler.test.ts',
  ],
  outdir: 'out/test',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  plugins: [vscodeTestPlugin],
  logLevel: 'warning',
};

const target = process.argv.includes('--test')
  ? testsConfig
  : process.argv.includes('--floor-tests')
  ? floorTestsConfig
  : roundtripConfig;
```

### 3.2. Script test trong `package.json` (dòng 209 đến 214)

Lệnh: `sed -n '209,214p' package.json`

```json
    "roundtrip": "node esbuild.harness.config.js && node out/harness/roundtrip.js",
    "roundtrip:update": "node esbuild.harness.config.js && node out/harness/roundtrip.js --update",
    "build:floor-tests": "node esbuild.harness.config.js --floor-tests",
    "test": "node esbuild.harness.config.js --test && node --test out/test/",
    "verify:vscode-floor": "npm run build && npm run build:floor-tests && node harness/vscode-floor/run.mjs",
    "package": "vsce package"
```

### 3.3. Loại trừ test trong `.vscodeignore` (dòng 8 đến 15)

Lệnh: `sed -n '8,15p' .vscodeignore`

```
# Dependency-verification harness (dev-only, never shipped)
harness/**
out/harness/**

# Unit tests (dev-only, never shipped)
test/**
out/test/**
```

### 3.4. Bước test trong `.github/workflows/ci.yml` (dòng 51 đến 58)

Lệnh: `sed -n '51,58p' .github/workflows/ci.yml`

```yaml
      - name: Markdown roundtrip harness
        run: npm run roundtrip

      # Unit tests using Node's built-in node:test runner. Covers pure utilities
      # and extension-host logic (e.g. image-rename-handler, frontmatter-parser)
      # with zero extra test-framework dependencies.
      - name: Unit tests
        run: npm test
```

### 3.5. Trích đoạn `test/vscode-stub.ts`: Lớp Uri (dòng 4 đến 27)

Lệnh: `sed -n '4,27p' test/vscode-stub.ts`

```typescript
export class Uri {
  readonly scheme: string;
  readonly path: string;
  readonly fsPath: string;

  private constructor(fsPath: string, scheme = "file") {
    this.fsPath = path.resolve(fsPath);
    this.path = this.fsPath;
    this.scheme = scheme;
  }

  static file(fsPath: string): Uri {
    return new Uri(fsPath, "file");
  }

  static parse(uriString: string): Uri {
    const parsed = new URL(uriString);
    return new Uri(parsed.pathname, parsed.protocol.replace(/:$/, ""));
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}
```

### 3.6. Trích đoạn `test/vscode-stub.ts`: window và workspace.fs (dòng 80 đến 132)

Lệnh: `sed -n '80,132p' test/vscode-stub.ts`

```typescript
export const window = {
  async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    warningCalls.push({ message, items });
    if (typeof warningChoiceHandler === "function") {
      return warningChoiceHandler(message, items);
    }
    if (typeof warningChoiceHandler === "string") {
      return warningChoiceHandler;
    }
    return items.length > 0 ? items[0] : undefined;
  },
};

export const workspace = {
  fs: {
    async stat(uri: Uri): Promise<{ type: number; size: number; mtime: number }> {
      const stats = await fs.promises.stat(uri.fsPath);
      return {
        type: stats.isDirectory() ? 2 : 1,
        size: stats.size,
        mtime: stats.mtimeMs,
      };
    },

    async readFile(uri: Uri): Promise<Uint8Array> {
      return await fs.promises.readFile(uri.fsPath);
    },

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fs.promises.writeFile(uri.fsPath, content);
    },

    async createDirectory(uri: Uri): Promise<void> {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    },

    async rename(source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void> {
      await fs.promises.mkdir(path.dirname(target.fsPath), { recursive: true });
      if (!options?.overwrite && fs.existsSync(target.fsPath)) {
        throw new Error(`Target file already exists: ${target.fsPath}`);
      }
      await fs.promises.rename(source.fsPath, target.fsPath);
    },

    async delete(uri: Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
      deletedUris.push(uri);
      await fs.promises.rm(uri.fsPath, {
        force: true,
        recursive: options?.recursive ?? false,
      });
    },
  },
```

### 3.7. Trích đoạn `test/vscode-stub.ts`: workspace.findFiles (dòng 134 đến 149)

Lệnh: `sed -n '134,149p' test/vscode-stub.ts`

```typescript
  async findFiles(
    include: string,
    _exclude?: string,
    _maxResults?: number
  ): Promise<Uri[]> {
    if (!currentWorkspaceRoot) {
      return [];
    }
    const allFiles = await walkDir(currentWorkspaceRoot);
    // When include is "**/*.md", filter for .md files
    if (include === "**/*.md" || include.endsWith(".md")) {
      return allFiles
        .filter((file) => file.endsWith(".md"))
        .map((file) => Uri.file(file));
    }
    return allFiles.map((file) => Uri.file(file));
```

## 4. Kết quả thực thi các lệnh kiểm chứng

### 4.1. Lệnh `npm run lint`

Lệnh: `npm run lint`

Output thật:
```
> tui-milkdown-vscode@2.15.2 lint
> tsc --noEmit
```
Trạng thái: Mã thoát 0, không có lỗi linter/type.

### 4.2. Lệnh `npm run build`

Lệnh: `npm run build`

Output thật:
```
> tui-milkdown-vscode@2.15.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```
Trạng thái: Mã thoát 0, build thành công.

### 4.3. Lệnh `npm run roundtrip`

Lệnh: `npm run roundtrip`

Output thật:
```
> tui-milkdown-vscode@2.15.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness — mode: check
corpus: 39 fixtures (34 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
39 markdown fixtures + 7 seams: 46 passed, 0 failed, 0 missing, 0 errored
```
Trạng thái: 46/46 passed, 0 failed, khớp hoàn toàn với baseline.

### 4.4. Lệnh `npm test`

Lệnh: `npm test`

Output thật:
```
> tui-milkdown-vscode@2.15.2 test
> node esbuild.harness.config.js --test && node --test out/test/

harness built: out/test
▶ frontmatter-parser
  ▶ 1. standard frontmatter
    ✔ parses valid standard frontmatter (1.617709ms)
    ✔ parses standard frontmatter with invalid YAML as isValid: false (0.373334ms)
    ✔ reconstructs standard frontmatter to exact input when unchanged (0.170041ms)
  ✔ 1. standard frontmatter (2.5825ms)
  ▶ 2. implicit frontmatter
    ✔ parses valid implicit frontmatter with known keys (0.261458ms)
    ✔ does not treat markdown without known keys or <2 keys as implicit frontmatter (0.119292ms)
    ✔ reconstructs implicit frontmatter verbatim when unchanged (0.108125ms)
    ✔ falls back to canonical implicit template when edited (0.091584ms)
  ✔ 2. implicit frontmatter (0.996292ms)
  ▶ 3. empty frontmatter
    ✔ parses empty delimiters (---\n---) (0.064334ms)
    ✔ replays empty delimiters verbatim when unchanged (0.079167ms)
    ✔ returns safeBody when frontmatter is trimmed empty and rawBlock does not match (0.054417ms)
  ✔ 3. empty frontmatter (0.290542ms)
  ▶ 4. comment-only frontmatter
    ✔ parses comment-only standard frontmatter as valid (0.092667ms)
    ✔ parses blank-line-only standard frontmatter as valid (0.094209ms)
    ✔ verifies isBlankOrCommentOnly helper correctly identifies comment/blank lines (0.055959ms)
  ✔ 4. comment-only frontmatter (0.33425ms)
  ▶ 5. rawBlock replay
    ✔ preserves trailing whitespace on delimiter lines (0.110042ms)
    ✔ preserves zero blank lines between closing delimiter and body (0.066ms)
    ✔ preserves multiple blank lines between closing delimiter and body (0.048375ms)
    ✔ discards rawBlock and falls back to canonical template when frontmatter is edited (0.043375ms)
    ✔ returns unmodified body when frontmatter is null (0.019958ms)
    ✔ handles inputs exceeding MAX_FILE_SIZE gracefully (0.028083ms)
    ✔ handles empty and non-string inputs safely (0.054667ms)
  ✔ 5. rawBlock replay (0.468667ms)
✔ frontmatter-parser (4.960625ms)
▶ image-rename-handler
  ▶ path helpers
    ✔ normalizePath normalizes backslashes, leading ./, and multiple slashes (1.324166ms)
    ✔ hasPathTraversal detects traversal and absolute paths (0.827792ms)
  ✔ path helpers (2.55375ms)
  ▶ detectImageRenames
    ✔ detects image rename within the same folder when source file exists (0.945834ms)
    ✔ does NOT detect rename when directory changes (different folder) (1.106125ms)
    ✔ does NOT detect rename when path has path traversal (0.590292ms)
    ✔ does NOT detect rename when source file does not exist on disk (0.459834ms)
    ✔ does NOT detect rename when original path was not removed from document (0.523792ms)
  ✔ detectImageRenames (3.786458ms)
  ▶ executeImageRenames
    ✔ renames source file to target file on disk (3.33575ms)
    ✔ prompts warning and skips rename when target file already exists and user chooses Skip (2.309583ms)
    ✔ overwrites target file when user chooses Overwrite (2.098708ms)
  ✔ executeImageRenames (7.994834ms)
  ▶ detectImageDeletes and executeImageDeletes
    ✔ detects image deletion when original path is absent from current paths (0.73625ms)
    ✔ does NOT detect delete when same filename exists in another folder (move operation) (0.599625ms)
    ✔ executes image deletes by removing file from disk (1.951334ms)
  ✔ detectImageDeletes and executeImageDeletes (3.410167ms)
  ▶ updateWorkspaceReferences
    ✔ rewrites standard references, space-containing paths wrapped in <...>, and HTML img tags, skipping code fences (3.425417ms)
    ✔ skips excluded active document URI (1.040875ms)
  ✔ updateWorkspaceReferences (4.593666ms)
✔ image-rename-handler (22.656584ms)
ℹ tests 35
ℹ suites 12
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70.547125
```
Trạng thái: 35/35 tests pass, 12 suites, thời gian chạy khoảng 70ms. (Đã loại bỏ 2 ca rỗng ruột từ 37 xuống đúng 35 ca).

## 5. Phép thử bắt buộc: Chứng minh test có răng

### 5.1. Phép thử với hàm `normalizePath` trong `src/utils/image-rename-handler.ts`

Hành động: Làm hỏng hàm `normalizePath` bằng cách không gỡ bỏ tiền tố `./` mà thay bằng `./broken/`.

Lệnh: `npm test`

Output thật (thất bại ở đúng ca liên quan):
```
✖ normalizePath normalizes backslashes, leading ./, and multiple slashes (1.71225ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + './broken/images/pic.png'
  - 'images/pic.png'
  
      at TestContext.<anonymous> (/Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w5-unittests/out/test/image-rename-handler.test.js:451:29)
...
✖ failing tests:
test at out/test/image-rename-handler.test.js:449:29
✖ normalizePath normalizes backslashes, leading ./, and multiple slashes (1.71225ms)
```

Khôi phục file:
```bash
git checkout -- src/utils/image-rename-handler.ts
```

Chạy lại: `npm test` -> Xanh toàn bộ 35 tests.

### 5.2. Phép thử với hàm `parseContent` trong `src/utils/frontmatter-parser.ts`

Hành động: Làm hỏng xử lý empty frontmatter trong hàm `parseContent` (trả về `frontmatter: "broken_empty"` thay vì `frontmatter: ""`).

Lệnh: `npm test`

Output thật (thất bại ở đúng 2 ca liên quan đến empty frontmatter):
```
✖ parses empty delimiters (---\n---) (0.882041ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  'broken_empty' !== ''
  
      at TestContext.<anonymous> (/Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w5-unittests/out/test/frontmatter-parser.test.js:2615:29)
...
✖ replays empty delimiters verbatim when unchanged (0.171875ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + '---\nbroken_empty\n---\n\n# Empty Frontmatter Body\n'
  - '---\n---\n\n# Empty Frontmatter Body\n'
  
      at TestContext.<anonymous> (/Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w5-unittests/out/test/frontmatter-parser.test.js:2628:29)
```

Khôi phục file:
```bash
git checkout -- src/utils/frontmatter-parser.ts
```

Chạy lại: `npm test` -> Xanh toàn bộ 35 tests.

### 5.3. Phép thử với hàm `detectImageRenames` trong `src/utils/image-rename-handler.ts`

Hành động: Làm hỏng hàm `detectImageRenames` bằng cách cho trả về ngay mảng rỗng `return [];`.

Lệnh: `npm test`

Output thật (đo được chính xác **1 trên 35 ca đỏ**):
```
✖ detectImageRenames (4.127625ms)
...
✖ failing tests:

test at out/test/image-rename-handler.test.js:446:29
✖ detects image rename within the same folder when source file exists (1.326708ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  0 !== 1
  
      at TestContext.<anonymous> (/Users/tuanhv/orca/workspaces/tui-milkdown-vscode/w5-unittests/out/test/image-rename-handler.test.js:454:29)
```

Lập luận về con số 1 ca đỏ đo được:
Con số **1/35 ca đỏ** này là **hoàn toàn hợp lý và phản ánh đúng bản chất của unit test**:
1. Trong suite `detectImageRenames` có 5 ca test:
   - 4 ca là ca phủ định (negative assertions): từ chối rename khi thư mục thay đổi, từ chối khi có path traversal, từ chối khi file nguồn không tồn tại, từ chối khi đường dẫn cũ chưa bị gỡ khỏi văn bản. Cả 4 ca này đều khẳng định `assert.equal(renames.length, 0)`. Khi hàm bị phá trả về `[]`, mảng rỗng có độ dài 0 nên 4 ca này vẫn thấy 0 và vượt qua một cách tự nhiên.
   - 1 ca là ca khẳng định dương tính (positive assertion): `detects image rename within the same folder when source file exists`, khẳng định `assert.equal(renames.length, 1)`. Ca này lập tức đỏ với lỗi `0 !== 1`.
2. Các suite khác trong file (`executeImageRenames`, `updateWorkspaceReferences`, `detectImageDeletes`, `executeImageDeletes`) không bị ảnh hưởng vì đây là các unit test độc lập. Mỗi hàm được test với dữ liệu đầu vào trực tiếp (ví dụ `executeImageRenames` nhận thẳng một mảng `ImageRename[]` do test tự dựng trên thư mục tạm chứ không phụ thuộc vào `detectImageRenames`). Trong kiến trúc thực tế của repo, `detectImageRenames` và `executeImageRenames` là hai hàm tiện ích rời nhau được tầng provider gọi nối tiếp, không hàm nào lồng hàm nào. Do đó, việc phá `detectImageRenames` chỉ làm đỏ đúng ca dương tính gọi nó là bằng chứng cho thấy các unit test được cô lập tốt, không bị ghép nối phụ thuộc (tight coupling).

Khôi phục file:
```bash
git checkout -- src/utils/image-rename-handler.ts
```

Chạy lại: `npm test` -> Xanh toàn bộ 35 tests.

Sau cả ba phép thử, `git status` được xác nhận hoàn toàn sạch sẽ, không có thay đổi nào tồn đọng trong `src/`.

## 6. Tiêu chí CHƯA kiểm được

Mục này giải trình chi tiết về một tiêu chí trong issue #89 chưa thể kiểm thử tự động ở phạm vi nhiệm vụ này:

1. **Yêu cầu của issue #89**:
   Trong acceptance criteria của issue #89 có đề ra ca kiểm thử: "không rename khi `autoRenameImages` tắt".

2. **Thực tế mã nguồn tại `src/utils/image-rename-handler.ts`**:
   Lệnh kiểm tra:
   ```bash
   grep -n "autoRenameImages" src/utils/image-rename-handler.ts
   ```
   Kết quả: Mã thoát 1, không tìm thấy chuỗi `autoRenameImages` trong toàn bộ file. Module này là tập hợp các hàm thuần túy và tiện ích cấp thấp, chỉ có đúng 10 điểm gọi `vscode` (đã thống kê ở mục 2) và hoàn toàn không đọc cấu hình.

3. **Vị trí kiểm tra cấu hình thật**:
   Lệnh kiểm tra:
   ```bash
   grep -n "autoRenameImages" src/markdownEditorProvider.ts
   ```
   Kết quả thật:
   ```
   472:      if (config.get<boolean>("autoRenameImages", true) && !renameInProgress) {
   ```
   Phép kiểm cấu hình thật sự nằm tại dòng 472 của `src/markdownEditorProvider.ts`, tức thuộc tầng caller (extension host provider).

4. **Lý do không thể kiểm được ở tầng module**:
   - Tầng caller nằm ngoài phạm vi của issue #89 (issue chỉ bao phủ `image-rename-handler.ts` và `frontmatter-parser.ts`).
   - Ràng buộc cứng của sóng cấm sửa bất kỳ file nào dưới `src/`, đặc biệt khi worker W1 đang tái cấu trúc `markdownEditorProvider.ts`.
   - Một ca test cố gắng "mô phỏng logic caller" trong file test bằng cách tự đọc cấu hình rồi tự đặt cờ bên trong một câu lệnh `if` do chính test viết sẽ chỉ là một ca test rỗng ruột: nó kiểm tra câu lệnh `if` của JavaScript chứ không kiểm tra bất kỳ dòng mã nào của `image-rename-handler.ts`. Do đó, hai ca mô phỏng này đã được xoá bỏ hoàn toàn.
   - Tiêu chí này cần được kiểm thử ở tầng integration test cho `markdownEditorProvider.ts` (hoặc module bọc caller mới do W1 tạo ra) trong các đợt phát triển tiếp theo khi tầng provider được đưa vào diện kiểm thử.

## 7. Nội dung đề xuất cập nhật cho AGENTS.md và CHANGELOG.md

(Tuân thủ ràng buộc không sửa trực tiếp file markdown ở gốc repo, điều phối viên sẽ áp dụng sau khi merge)

### Đề xuất thêm vào `AGENTS.md` (mục Commands):

```bash
npm test           # Run unit tests via node:test (covers pure utilities with vscode stub)
```

### Đề xuất thêm vào `AGENTS.md` (mục Development Guidelines, phân định test):

```markdown
**Testing Strategy: Unit Tests vs Harness Fixtures vs Seams:**

- **Unit tests (`npm test`)**: Use for pure utility functions and isolated extension-host logic (e.g., `frontmatter-parser.ts`, `image-rename-handler.ts`, `export-docx.ts`). Powered by Node's built-in `node:test` without external test framework dependencies, using `test/vscode-stub.ts` where VS Code APIs are required.
- **Roundtrip fixtures (`npm run roundtrip`)**: Use for markdown fidelity verification (input string -> output string) across the Tiptap editor and its extensions, detecting syntax regressions.
- **Harness seams**: Use for measuring and asserting observable behavior of specific webview/extension slices (e.g., search ranking, text escaping rules, column width preservation) against committed goldens.
```

### Đề xuất thêm vào `CHANGELOG.md`:

```markdown
### Added
- Added built-in `node:test` runner via `npm test` without adding external dependencies (#89).
- Added unit test suite covering `src/utils/frontmatter-parser.ts` across 5 forms (standard, implicit, empty, comment-only, and rawBlock replay).
- Added unit test suite covering `src/utils/image-rename-handler.ts` (rename detection, folder-change rejection, path traversal rejection, deletion detection, workspace reference rewriting with `<path with spaces>` wrapping and code fence protection).
- Added programmable `test/vscode-stub.ts` with real filesystem operations on temporary directories, URI mapping, warning message spy, and file search.
- Excluded `test/**` and `out/test/**` from extension package in `.vscodeignore`.
- Added `Unit tests` step to GitHub Actions CI workflow.
```
