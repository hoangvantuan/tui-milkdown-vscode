# Wiki Link (`[[...]]`) Design Spec

## Tổng quan

Thêm cú pháp wiki link kiểu Obsidian vào editor. User gõ `[[` → popup gợi ý file `.md` trong workspace → chọn file → chèn `[[filename]]` hoặc `[[filename|alias]]`. Render dạng link nội bộ với icon, Ctrl/Cmd+Click mở file trong VSCode.

## Phạm vi

- Chỉ link tới file `.md` đã tồn tại (không tự tạo file mới)
- Không thay thế `@` file mention (hai tính năng độc lập, khác mục đích)

## Kiến trúc

### Tiptap Node: `WikiLink`

Inline node mới trong ProseMirror schema.

**Attributes:**
- `filename` (string, required): tên file bỏ extension `.md`. Ví dụ: `nguyễn-duy-cần`
- `alias` (string, optional): tên hiển thị thay thế

**DOM output:**
```html
<span class="wiki-link" data-filename="nguyễn-duy-cần" data-alias="Nguyễn Duy Cần">
  <svg class="wiki-link-icon">...</svg>
  Nguyễn Duy Cần
</span>
```

Hiển thị `alias` nếu có, không thì hiển thị `filename`. Icon SVG document nhỏ trước text.

**Hành vi trong editor:**
- Click thường: select node (node selection)
- Ctrl/Cmd+Click: mở file trong VSCode
- Backspace/Delete khi node selected: xoá node
- Gõ ký tự khi node selected: thay thế node bằng text mới
- Sửa link: xoá node, gõ `[[` lại từ đầu

### File mới: `src/webview/wiki-link-plugin.ts`

Chứa:
1. `WikiLink` Tiptap Node definition (schema, DOM render, markdown hooks)
2. `WikiLinkSuggestion` extension dùng `@tiptap/suggestion` cho popup gợi ý

### Suggestion Plugin (trigger `[[`)

Dùng `@tiptap/suggestion` với custom `findSuggestionMatch`:

```ts
findSuggestionMatch({ $position }) {
  const text = $position.nodeBefore?.isText && $position.nodeBefore.text;
  if (!text) return null;

  const match = text.match(/\[\[([^\]]*?)$/);
  if (!match || match.index === undefined) return null;

  const from = $position.pos - text.length + match.index;
  const to = $position.pos;
  if (from >= $position.pos) return null;

  return {
    range: { from, to },
    query: match[1],
    text: match[0],
  };
}
```

**Vị trí cho phép trigger:**
- Đầu dòng, sau space, sau dấu câu (`.,:;!?()`)
- Chặn: liền sau chữ/số (`\w`), trong `codeBlock`, trong inline code

**Popup:**
- Chỉ gợi ý file `.md`
- Hiển thị: tên file (bỏ `.md`) + folder path nhỏ bên cạnh
- Filter: prefix match ưu tiên, rồi contains match, case-insensitive, max 20 kết quả
- CSS class: `.wiki-link-popup` (style giống `.file-mention-popup`)
- Popup append vào `#editor-container` (tránh CSS zoom issues)

**Cache strategy:** Giống file mention hiện tại.
- `onStart`: dispatch CustomEvent → main.ts forward `wikiLinkSearch` message → extension gọi `findFiles("**/*.md", excludePattern, 1000)` → trả `wikiLinkSearchResults`
- main.ts gọi `setWikiLinkFiles(files)` populate module-level cache
- Gõ tiếp filter local từ cache
- `onExit`: clear cache

### Markdown Roundtrip

**Parse (markdown → node):** MarkedJS custom inline extension.

Thêm vào `markedOptions.extensions` một inline tokenizer:
- Regex: `/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/`
- Match group 1: filename
- Match group 2: alias (optional)
- Output MarkedJS token type: `wikiLink`

WikiLink extension khai báo `markdownTokenName: "wikiLink"` + `parseMarkdown` hook tạo WikiLink node từ token.

**Serialize (node → markdown):** `renderMarkdown` hook.
- Có alias: `[[filename|alias]]`
- Không alias: `[[filename]]`

### Click Navigation

Tái sử dụng luồng Ctrl/Cmd+Click hiện tại trong `main.ts`:

1. Detect click trên `.wiki-link` khi Ctrl/Cmd held
2. Đọc `data-filename` từ DOM element
3. Gửi `openWikiLink` message tới extension (type + filename)
4. Extension resolve filename → file path → mở document

**Resolve logic (extension side):**
1. Nếu filename chứa `/` → tìm chính xác path tương đối từ workspace root, thêm `.md`
2. Nếu không → `findFiles("**/{filename}.md")` trong toàn workspace
3. Đúng 1 kết quả → mở file
4. Nhiều kết quả → show QuickPick cho user chọn
5. Không tìm thấy → show warning "File not found"

### Visual Style

```css
.wiki-link {
  color: var(--accent-color, #4a9eff);
  cursor: default;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.wiki-link:hover {
  text-decoration: underline solid;
}
.wiki-link-icon {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  margin-right: 2px;
  opacity: 0.6;
}
body.ctrl-held .wiki-link {
  cursor: pointer;
}
```

Dark theme: giữ tương phản qua CSS variable `--accent-color`.

### Export DOCX/PDF

WikiLink render thành text thường, bỏ `[[]]`.
- `[[nguyễn-duy-cần]]` → "nguyễn-duy-cần"
- `[[nguyễn-duy-cần|Nguyễn Duy Cần]]` → "Nguyễn Duy Cần"

Trong MDAST pipeline: `remark-parse` không hiểu `[[...]]` nên giữ nguyên dạng text. Thêm một remark plugin nhỏ (hoặc MDAST visitor trong `markdown-ast.ts`) quét text nodes, tìm regex `\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`, thay bằng text thuần (alias nếu có, không thì filename).

### Clipboard

Copy text chứa WikiLink: giữ raw syntax `[[filename]]` hoặc `[[filename|alias]]` trong clipboard. Paste vào editor khác tab sẽ roundtrip đúng nhờ MarkedJS tokenizer.

## Message Types

| Message | Hướng | Payload |
|---------|-------|---------|
| `wikiLinkSearch` | webview → extension | `{}` |
| `wikiLinkSearchResults` | extension → webview | `{ files: [{name, path}] }` |
| `openWikiLink` | webview → extension | `{ filename: string }` |

## File Changes

| File | Thay đổi |
|------|----------|
| `src/webview/wiki-link-plugin.ts` | **Mới.** WikiLink node + suggestion plugin |
| `src/webview/main.ts` | Import WikiLink, thêm vào extensions. Wire CustomEvent + message handlers |
| `src/markdownEditorProvider.ts` | Handle `wikiLinkSearch` (findFiles `**/*.md`), `openWikiLink` (resolve + open). Thêm CSS cho `.wiki-link-*` |
| `CLAUDE.md` | Thêm section Wiki Link |
| `CHANGELOG.md` | Thêm entry |
| `README.md` | Thêm feature |

## Không làm

- Không tự tạo file mới khi link chưa tồn tại
- Không hiện trạng thái "broken link" (link đỏ khi file không tồn tại)
- Không hỗ trợ heading anchor `[[file#heading]]` (scope riêng nếu cần sau)
- Không thay thế hoặc ảnh hưởng `@` file mention
