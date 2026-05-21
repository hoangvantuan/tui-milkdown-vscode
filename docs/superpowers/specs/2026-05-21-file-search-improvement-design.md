# File Search Improvement: @ Mention & Wiki Link

## Mục tiêu

Cải tiến toàn diện tính năng tìm kiếm file trong @ mention và [[ wiki link autocomplete. Giải quyết 7 điểm yếu hiện tại: giới hạn file, thiếu fuzzy matching, wiki link không filter theo path, exclude pattern cố định, không ưu tiên file gần, không phân biệt loại file.

## Quyết định

| # | Vấn đề | Giải pháp |
|---|---|---|
| 1 | Giới hạn 1000 file | Nâng lên 5000 |
| 2 | Thiếu fuzzy matching | Dùng thư viện `fuzzysort` |
| 3 | Wiki link chỉ filter name | Filter trên cả name + path |
| 4 | Cache xoá mỗi lần đóng | Giữ nguyên (fetch mỗi lần mở popup) |
| 5 | Exclude pattern cố định | Dùng `files.exclude` của VSCode |
| 6 | Không ưu tiên file gần | Proximity bonus scoring |
| 7 | Không phân biệt loại file | Icon SVG theo đuôi file (10 nhóm) |

## Thư viện: fuzzysort

- npm: `fuzzysort`
- Bundle: 5KB, 0 dependency
- Tối ưu cho file path search, 13K file trong <1ms
- Trả về vị trí matched characters cho highlight
- Nguồn: https://github.com/farzher/fuzzysort

## Thiết kế chi tiết

### 1. Fuzzy filter + scoring (Webview side)

Tạo module chung `src/webview/file-search-utils.ts`:

**Fuzzy search**: Dùng `fuzzysort.go()` match trên cả `name` + `path`. Gõ `mep` tìm được `markdownEditorProvider`. Gõ `docs/` lọc được file trong thư mục docs.

**Proximity scoring**: Cộng bonus điểm cho file gần tài liệu đang mở:
- Cùng thư mục: +50
- Cùng parent folder: +25
- Khi query rỗng: sắp xếp theo proximity trước, alphabetical sau

**Highlight matched characters**: fuzzysort trả `indexes` array. Wrap matched chars trong `<mark>` tag trong popup item.

**Max kết quả hiển thị**: 20 (giữ nguyên).

**API**:
```typescript
interface FileSearchOptions {
  query: string;
  files: FileItem[];
  currentDocFolder?: string;
  maxResults?: number; // default 20
}

interface FileSearchResult {
  file: FileItem;
  score: number;
  highlightedName: string;   // HTML string with <mark> tags
  highlightedPath: string;   // HTML string with <mark> tags
}

function searchFiles(options: FileSearchOptions): FileSearchResult[];
```

### 2. Extension side: files.exclude + limit + currentDocFolder

**Đọc files.exclude**:
```typescript
const filesExclude = vscode.workspace.getConfiguration("files").get<Record<string, boolean>>("exclude", {});
// Chuyển sang glob pattern: chỉ lấy key có value = true
const excludeGlobs = Object.entries(filesExclude)
  .filter(([, enabled]) => enabled)
  .map(([glob]) => glob);
// Merge với exclude mặc định (node_modules, .git)
// Format cho findFiles: "{pattern1,pattern2,...}"
```

**Nâng limit**: `findFiles("**/*", excludePattern, 5000)` cho @ mention, `findFiles("**/*.md", excludePattern, 5000)` cho wiki link.

**Gửi currentDocFolder**: Extension biết document URI, tính relative folder path, gửi kèm response.

**Message format mới**:
```typescript
// fileSearch response
{
  type: "fileSearchResults",
  files: Array<{name: string, path: string}>,
  currentDocFolder: string  // relative folder path, e.g. "docs/internals"
}

// wikiLinkSearch response
{
  type: "wikiLinkSearchResults",
  files: Array<{name: string, path: string}>,
  currentDocFolder: string
}
```

### 3. File type icons (10 nhóm)

Map đuôi file sang SVG icon. Hàm `getFileIcon(filename: string): string` trả SVG string.

| Nhóm | Đuôi file | Mô tả icon |
|---|---|---|
| Markdown | `.md`, `.mdx` | Document + lines |
| TypeScript/JS | `.ts`, `.tsx`, `.js`, `.jsx` | Code brackets `</>` |
| JSON/YAML | `.json`, `.yaml`, `.yml`, `.toml` | Braces `{}` |
| CSS/Style | `.css`, `.scss`, `.less` | Palette |
| HTML | `.html`, `.htm`, `.vue`, `.svelte` | Globe |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` | Image/mountain |
| Config | `.env`, `.gitignore`, `.editorconfig` | Gear |
| Data | `.csv`, `.xlsx`, `.sql` | Table grid |
| PDF/Doc | `.pdf`, `.docx` | File text |
| Default | Còn lại | Generic file (icon hiện tại) |

Icon dùng chung cho cả @ mention và [[ wiki link popup.

### 4. Thay đổi trong file-mention-plugin.ts

- Import `searchFiles`, `getFileIcon` từ `file-search-utils.ts`
- Xoá `filterFiles()` function
- Nhận `currentDocFolder` từ message, lưu module-level
- `items()` callback: gọi `searchFiles()` thay vì `filterFiles()`
- `renderItems()`: dùng `result.highlightedName` (innerHTML) thay vì textContent, dùng `getFileIcon()` cho icon

### 5. Thay đổi trong wiki-link-plugin.ts

- Import `searchFiles`, `getFileIcon` từ `file-search-utils.ts`
- Xoá `filterMdFiles()` function
- Nhận `currentDocFolder` từ message
- `items()` callback: gọi `searchFiles()` (filter trên name + path, không chỉ name)
- `renderItems()`: highlight + file type icon

### 6. Thay đổi trong markdownEditorProvider.ts

- Case `"fileSearch"`: đọc `files.exclude`, merge exclude, nâng limit 5000, gửi kèm `currentDocFolder`
- Case `"wikiLinkSearch"`: tương tự

### 7. File mới: src/webview/file-search-utils.ts

Module chứa:
- `searchFiles()`: fuzzy filter + proximity scoring
- `getFileIcon()`: file extension → SVG icon map
- Type definitions: `FileSearchOptions`, `FileSearchResult`
- Internal: proximity calculation, highlight builder

## File thay đổi

| File | Loại thay đổi |
|---|---|
| `src/webview/file-search-utils.ts` | **Mới**: shared fuzzy search + icons |
| `src/webview/file-mention-plugin.ts` | Sửa: dùng shared module |
| `src/webview/wiki-link-plugin.ts` | Sửa: dùng shared module, filter path |
| `src/markdownEditorProvider.ts` | Sửa: files.exclude, limit, currentDocFolder |
| `src/webview/main.ts` | Sửa: truyền currentDocFolder vào plugin |
| `package.json` | Sửa: thêm `fuzzysort` dependency |
| `docs/internals/autocomplete-plugins.md` | Sửa: cập nhật doc |

### 8. Thay đổi trong main.ts

- Khi nhận `fileSearchResults` / `wikiLinkSearchResults`: lưu `currentDocFolder` từ message
- Truyền vào `setFileMentionFiles()` / `setWikiLinkFiles()` (thêm parameter `currentDocFolder`)
- Các setter function lưu vào module-level variable trong plugin file

## Không thay đổi

- Cache strategy (vẫn fetch mỗi lần mở popup)
- Message flow (CustomEvent → postMessage → response)
- Popup DOM structure (chỉ thay nội dung render)
- Keyboard navigation (ArrowUp/Down/Enter/Escape)
- Link insert behavior (@ → markdown link, [[ → wikiLink node)
