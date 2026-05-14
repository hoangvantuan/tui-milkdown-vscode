# File Mention (@) Design Spec

## Overview

Tính năng cho phép user gõ `@` trong editor để mở popup autocomplete danh sách file trong workspace. Chọn file sẽ chèn markdown link `[filename](workspace-path)` tại vị trí cursor.

## Approach

Dùng `@tiptap/suggestion` API. Phù hợp kiến trúc hiện tại (Tiptap Extension pattern). Xử lý sẵn trigger, keyboard nav, positioning, dismiss logic.

## Luồng hoạt động

```
User gõ "@"
  → Suggestion onStart
  → Webview gửi fileSearch {query: ""}
  → Extension gọi vscode.workspace.findFiles()
  → Trả fileSearchResults {files: [{name, path}]}
  → Popup hiện danh sách

User gõ tiếp (vd: "main")
  → Suggestion onUpdate
  → Webview filter local trên cache (không round-trip)
  → Popup cập nhật kết quả

User chọn file (Enter/click)
  → Suggestion onExit
  → Xoá "@query" text
  → Chèn [filename](workspace-path) vào editor
  → Popup đóng
```

## Component: file-mention-plugin.ts

File mới: `src/webview/file-mention-plugin.ts`

Tiptap Extension dùng `@tiptap/suggestion` addon:

- `char: "@"` trigger character
- `onStart`: render popup, gửi `fileSearch` message đến extension
- `onUpdate`: filter popup dựa trên query (local cache)
- `onKeyDown`: keyboard navigation (Arrow Up/Down, Enter, Escape)
- `onExit`: destroy popup DOM

### Insert logic

Không tạo custom ProseMirror node. Chèn text thuần `[filename](path)`. Tiptap Markdown parser tự convert thành link node. Không cần thay đổi schema.

## Extension side (markdownEditorProvider.ts)

Thêm 2 case message:

### fileSearch (webview -> extension)

- Nhận `{ query: string }`
- Gọi `vscode.workspace.findFiles(includePattern, excludePattern, maxResults)`
- `includePattern`: `**/*`
- `excludePattern`: `{**/node_modules/**,**/.git/**,**/.vscode/**,**/out/**,**/dist/**,**/.DS_Store}`
- `maxResults`: 1000
- Map kết quả: `{ name: path.basename(uri), path: vscode.workspace.asRelativePath(uri) }`

### fileSearchResults (extension -> webview)

- Payload: `{ files: Array<{name: string, path: string}> }`

## Chiến lược filter

- Lần đầu (query rỗng): Extension gửi toàn bộ file list (tối đa 1000). Webview cache lại.
- Lần sau (user gõ tiếp): Webview filter local, không gọi lại extension. Tránh round-trip lag.
- Cache invalidate khi popup đóng. Lần mở tiếp sẽ fetch lại (đảm bảo file mới được cập nhật).

### Fuzzy match (webview side)

- So sánh query với cả `name` và `path`
- Prefix match ưu tiên, rồi contains match
- Case-insensitive
- Hiển thị tối đa 20 kết quả đã sort

## UI Popup

### Styling

- Glassmorphic style giống toolbar: `backdrop-filter: blur(12px)`, CSS variables `--toolbar-bg-rgb`, `--border-rgb`
- Border-radius `8px`, shadow `0 4px 12px rgba(0,0,0,0.15)`
- Max-height `280px`, overflow-y auto
- Width `320px`
- Append vào `#editor-container` (không bị CSS zoom ảnh hưởng)

### Item layout

- Icon file (SVG stroke-based, Lucide style)
- Tên file (bold) + đường dẫn folder (mờ, font nhỏ hơn)
- Hover: `rgba(--accent-rgb, 0.1)`
- Active/selected: `rgba(--accent-rgb, 0.15)`

### Keyboard

- `Arrow Up/Down`: di chuyển selection, auto-scroll vào view
- `Enter`: chọn file, chèn link, đóng popup
- `Escape`: đóng popup, giữ nguyên text đã gõ

### Dismiss

- Escape
- Click ngoài popup
- Gõ space
- Cursor rời vị trí mention

### Theme

- Dark/light tự động theo CSS variables. Không cần override riêng.

## Dependency mới

- `@tiptap/suggestion` (addon chính thức cho autocomplete)

## File changes

| File | Thay đổi |
|------|----------|
| `src/webview/file-mention-plugin.ts` | Mới. Tiptap Extension + popup DOM. |
| `src/webview/main.ts` | Import và register FileMention extension. Xử lý `fileSearchResults` message. |
| `src/markdownEditorProvider.ts` | Thêm case `fileSearch` message handler. Thêm CSS cho popup. |
| `package.json` | Thêm `@tiptap/suggestion` dependency. |

## Link click

Không cần xử lý đặc biệt. Link chèn vào là markdown link bình thường. Ctrl+Click mở file đã được hỗ trợ sẵn bởi link navigation hiện tại.

## Edge cases

- Workspace không có file: popup hiện "Không tìm thấy file"
- File bị xoá sau khi cache: link vẫn chèn đúng, user tự quản lý broken link
- Gõ `@` trong code block: Dùng `allow` option của Suggestion API, kiểm tra `$from.parent.type.name !== 'codeBlock'` để không trigger trong code block
- Workspace rất lớn (>1000 file): giới hạn 1000 file từ findFiles, filter phía webview đủ nhanh
