# Plan Stage 3 — MDAST Pipeline (webview ↔ extension)

**Status**: ready
**Estimated effort**: 0.5 ngày (4-5 giờ)
**Risk**: Trung bình-cao (contract giữa webview và extension thay đổi)
**Dependencies**: Khuyến nghị làm SAU Stage 2 (có sẵn `markdownToMdast` helper)
**Commit prefix**: `refactor(export):`

## Mục tiêu

Bỏ pipeline fragile hiện tại:
```
webview text → regex escape code mermaid → extension.replace(regex, base64 data URL)
```

Thay bằng pipeline AST:
```
extension parse markdown → MDAST → visitor replace code[lang=mermaid] → image node → pass MDAST cho cả exportToDocx và exportToPdf
```

**Lợi ích**:
- Hết lỗi CRLF line ending mismatch
- Hết O(N*M) khi document lớn + nhiều mermaid
- DOCX và PDF dùng chung AST → output nhất quán
- Base64 không nhét vào regex replacement string khổng lồ

## Scope

| File | Thay đổi |
|---|---|
| [src/webview/main.ts](src/webview/main.ts) | Gửi `{mermaidImages: [{codeHash, base64}]}` thay vì `{code, base64}` |
| [src/markdownEditorProvider.ts](src/markdownEditorProvider.ts) | Case `"export"`: parse MDAST, visit replace nodes, pass MDAST xuống export funcs |
| [src/utils/export-docx.ts](src/utils/export-docx.ts) | Accept MDAST hoặc markdown string (giữ 2 signature) |
| [src/utils/export-pdf.ts](src/utils/export-pdf.ts) | Tạm thời nhận markdown string (Stage 4 sẽ thay bằng MDAST) |
| [src/utils/markdown-ast.ts](src/utils/markdown-ast.ts) | **Mới**: shared helpers parse + visit MDAST |

## Tasks

### 1. Tạo `src/utils/markdown-ast.ts`
- [ ] Export 2 hàm:
  ```ts
  export function parseMarkdownToMdast(md: string): Root;
  export function replaceMermaidBlocks(
    mdast: Root,
    imageMap: Map<string, string>  // codeHash → base64 data URL
  ): void;  // mutate in place
  ```
- [ ] `parseMarkdownToMdast` dùng `unified + remark-parse + remark-gfm + remark-frontmatter` (đã cài ở Stage 2).
- [ ] `replaceMermaidBlocks` dùng `unist-util-visit` để duyệt, khi gặp `node.type === 'code' && node.lang === 'mermaid'`:
  - Hash code (sha1 hoặc simple hash 32-bit) để match với imageMap.
  - Nếu match: thay node thành `{type: 'image', url: dataUrl, alt: 'Mermaid Diagram'}`.
  - Nếu không match: giữ nguyên code block (graceful degradation).

### 2. Thay đổi contract webview → extension
- [ ] Trong `src/webview/main.ts`:
  - Hash code trước khi gửi:
    ```ts
    function hashString(s: string): string {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
      return (h >>> 0).toString(16);
    }
    // Hoặc dùng crypto.subtle.digest('SHA-1', ...) nếu preferred
    ```
  - Đổi payload postMessage:
    ```ts
    mermaidImages.push({ codeHash: hashString(code.trim()), base64 });
    ```
  - Hoặc giữ raw code (để extension hash lại, đồng bộ logic). Chọn raw code cho đơn giản, hash chỉ ở extension side.

### 3. Extension handler case `"export"`
- [ ] Trong `markdownEditorProvider.ts`:
  ```ts
  case "export": {
    const rawText = document.getText();
    const frontmatterRegex = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    const markdown = rawText.replace(frontmatterRegex, "");

    const mdast = parseMarkdownToMdast(markdown);
    const imageMap = new Map(
      (exportMsg.mermaidImages ?? []).map(({ code, base64 }) =>
        [hashString(code.trim()), base64]
      )
    );
    replaceMermaidBlocks(mdast, imageMap);

    if (exportFormat === "pdf") {
      await exportToPdf(mdast, document.uri);  // Stage 4 sẽ accept MDAST
    } else {
      await exportToDocx(mdast, document.uri);
    }
    break;
  }
  ```
- [ ] Giữ hash function đồng bộ với webview.

### 4. Update `exportToDocx`
- [ ] Accept MDAST thay vì string:
  ```ts
  export async function exportToDocx(
    mdast: Root,
    documentUri: vscode.Uri
  ): Promise<void> {
    // ... showSaveDialog ...
    const blob = await toDocx(mdast, { title: docName }, {});
    // ...
  }
  ```
- [ ] Bỏ bước parse markdown → mdast trong file này (đã làm ở extension side).

### 5. Stage-4 bridge cho `exportToPdf`
- [ ] Tạm thời: convert MDAST → markdown string bằng `remark-stringify` để giữ signature cũ.
  ```ts
  import { unified } from "unified";
  import remarkStringify from "remark-stringify";
  const md = unified().use(remarkStringify).stringify(mdast) as string;
  await exportToPdf(md, document.uri);
  ```
- [ ] Stage 4 sẽ bỏ bridge này, accept MDAST trực tiếp.

## Verify

```bash
npm run lint
npm run build
```

Manual test matrix:
- [ ] File CRLF line ending (dùng `unix2dos test.md` hoặc Notepad trên Windows).
- [ ] File có 2 mermaid block identical (duplicate code) → cả 2 đều được thay ảnh.
- [ ] File có 5+ mermaid block lớn → không lag.
- [ ] Mermaid render fail (syntax sai) → code block giữ nguyên trong DOCX/PDF, không crash.
- [ ] Export DOCX và PDF từ cùng file → output structure giống nhau.

## Rollback

`git revert <commit>`. Plan làm 1 commit duy nhất.

## Risks

- **Hash collision**: probability cực thấp với djb2 32-bit cho diagram thông thường (< 1000 mermaid blocks per file). Nếu lo, dùng SHA-1 8 ký tự đầu.
- **Webview-extension contract đổi**: nếu rollback nửa chừng, phải revert cả 2 bên. Làm 1 commit atomic.
- **remark-stringify roundtrip**: markdown → MDAST → markdown có thể khác format gốc (khoảng cách, indent). Chấp nhận được vì chỉ dùng tạm cho Stage 4 bridge, Stage 4 sẽ bỏ.
- **Mermaid code sau `code.trim()`**: webview trim, extension cần hash cùng `trim()`. Đồng bộ.

## Done criteria

- [ ] Unit hoặc manual test: CRLF file export đúng, duplicate mermaid thay đúng cả 2 lần
- [ ] Bundle size extension.js không tăng >100KB
- [ ] DOCX output giống Stage 2
- [ ] Commit message: `refactor(export): MDAST pipeline, webview gửi image map thay regex replace`

## Out of scope (Stage 4)

- Rewrite PDF bằng puppeteer-core
- Bỏ parser tự viết 339 dòng
