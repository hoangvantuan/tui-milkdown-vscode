# Implicit Frontmatter Support

## Problem

Editor chỉ nhận frontmatter chuẩn (`---\n...\n---`). File dùng implicit format (YAML trực tiếp ở đầu file, kết thúc bằng `---`) bị render thành setext H2 heading thay vì parse vào metadata panel.

## Goal

Hỗ trợ cả hai format frontmatter:

**Standard** (hiện tại đã hoạt động):
```
---
type: concept
title: Example
tags: [a, b]
---

# Content
```

**Implicit** (cần thêm):
```
type: concept
title: Example
tags: [a, b]
---

# Content
```

Giữ format gốc khi save. File mở implicit thì save implicit. File mở standard thì save standard.

## Design

### 1. Shared utility: `src/utils/frontmatter-parser.ts` (file mới)

Chứa logic parse/reconstruct, import được từ cả webview bundle lẫn extension bundle.

**Return type mới**:

```typescript
interface ParseResult {
  frontmatter: string | null;
  body: string;
  isValid: boolean;
  error?: string;
  format: 'standard' | 'implicit' | 'none';
}
```

**Detection flow trong `parseContent()`**:

1. Thử regex chuẩn: `^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)` → `format = 'standard'`
2. Nếu không match → implicit detection:
   - Tìm dòng `---` đầu tiên (regex: `\n---[ \t]*(?:\n|$)`)
   - Lấy nội dung phía trước
   - `yaml.load()` → kiểm tra kết quả
   - Điều kiện accept: plain object, ≥2 keys, ≥1 key thuộc `KNOWN_KEYS`
   - Match → `format = 'implicit'`
3. Không match → `format = 'none'`, `frontmatter = null`

**Known keys** (chống false positive):

```typescript
const KNOWN_KEYS = new Set([
  'title', 'type', 'date', 'created', 'updated',
  'tags', 'categories', 'author', 'draft', 'slug',
  'description', 'related', 'sources', 'aliases',
  'layout', 'permalink', 'published'
]);
```

**`reconstructContent()` thêm tham số format**:

```typescript
function reconstructContent(
  frontmatter: string | null,
  body: unknown,
  format: 'standard' | 'implicit' | 'none'
): string
```

| format | frontmatter có data | Output |
|--------|-------------------|--------|
| `standard` | có | `---\nyaml\n---\n\nbody` |
| `implicit` | có | `yaml\n---\n\nbody` |
| `none` | có | `---\nyaml\n---\n\nbody` |
| bất kỳ | null/rỗng | chỉ `body` |

### 2. `src/webview/frontmatter.ts`

Giữ lại phần UI: `validateYaml()`, `updateMetadataPanel()`. Import logic parse/reconstruct từ shared utility.

### 3. `src/webview/main.ts`

- Thêm biến `currentFormat: 'standard' | 'implicit' | 'none'`
- Khi nhận content → `parseContent()` → lưu `format` vào `currentFormat`
- Khi save → `reconstructContent(frontmatter, body, currentFormat)`

### 4. `src/markdownEditorProvider.ts`

Export DOCX/PDF: import `parseContent()` từ shared utility. Tách frontmatter trước khi đưa vào MDAST pipeline. Giải quyết vấn đề `remark-frontmatter` không hiểu implicit format.

### 5. Nút "Add Metadata"

Giữ nguyên. Metadata mới tạo dùng format `standard`.

## Edge Cases

| Case | Xử lý |
|------|--------|
| `Note: text\n---` (1 key) | Reject, coi là setext heading |
| `First: a\nSecond: b\n---` (2 keys, 0 known) | Reject, coi là content |
| File chỉ có metadata, không body | `body = ""`, giữ format |
| Nested YAML objects | js-yaml hỗ trợ sẵn |
| `---` giữa body (HR) | Chỉ xét `---` đầu tiên |
| File rỗng | `format = 'none'` |
| YAML invalid ở implicit format | Reject, toàn bộ là body |

## Không thay đổi

- Metadata panel UI (textarea raw YAML)
- Nút "Add Metadata" behavior
- Debounce 300ms
- Validation logic
- CSP, nonce, state persistence
