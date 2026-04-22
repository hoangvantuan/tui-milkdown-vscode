# Plan Stage 2 — Migrate `@m2d/md2docx@0.0.1` → `mdast2docx@1.6.1`

**Status**: ready
**Estimated effort**: 2-3 giờ
**Risk**: Trung bình (API khác, cần test đầy đủ)
**Dependencies**: Không phụ thuộc Stage 1. Có thể làm trước hoặc sau.
**Commit prefix**: `refactor(export):`

## Mục tiêu

Bỏ wrapper `@m2d/md2docx@0.0.1` (247 weekly DL, repo 404, solo author, version 0.x alpha).
Dùng trực tiếp `mdast2docx@1.6.1` (14K weekly DL, active, cùng tác giả) với pipeline unified.

**Lý do**:
- Wrapper chỉ ~10 dòng code, không đáng giá tradeoff lock vào version 0.0.1.
- `mdast2docx` là lib lõi thực sự, version 1.x ổn định.
- Chủ động hơn khi cần custom pipeline sau này (Stage 3 reuse AST).

## Scope

| File | Thay đổi |
|---|---|
| [package.json](package.json) | Remove `@m2d/md2docx`, add `mdast2docx`, `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter` |
| [src/utils/export-docx.ts](src/utils/export-docx.ts) | Rewrite pipeline (wrapper → unified pipeline) |
| [esbuild.config.js](esbuild.config.js) | Không thay đổi (bundle vẫn tách) |

## Tasks

### 1. Cập nhật dependencies
- [ ] `npm uninstall @m2d/md2docx`
- [ ] `npm install mdast2docx@^1.6.1 unified@^11 remark-parse@^11 remark-gfm@^4 remark-frontmatter@^5`
- [ ] Verify: `package-lock.json` cập nhật, `node_modules/mdast2docx` tồn tại.

### 2. Rewrite `src/utils/export-docx.ts`
- [ ] Đọc docs: `node_modules/mdast2docx/README.md` hoặc `npm view mdast2docx` để xem API signature.
- [ ] Pipeline mới:
  ```ts
  import { unified } from "unified";
  import remarkParse from "remark-parse";
  import remarkGfm from "remark-gfm";
  import remarkFrontmatter from "remark-frontmatter";
  import { toDocx } from "mdast2docx";  // verify export name sau khi install

  async function markdownToMdast(md: string) {
    const file = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ["yaml"])
      .parse(md);
    return file;
  }

  export async function exportToDocx(markdown: string, documentUri: vscode.Uri) {
    // ... showSaveDialog, progress ...
    const mdast = await markdownToMdast(markdown);
    const blob = await toDocx(mdast, { title: docName }, {});
    const buffer = Buffer.from(await blob.arrayBuffer());
    await vscode.workspace.fs.writeFile(saveUri, buffer);
  }
  ```
- [ ] Verify `toDocx` signature qua `npm view mdast2docx` hoặc đọc `.d.ts` trong `node_modules/mdast2docx/dist/`.

### 3. Test matrix
- [ ] Heading H1-H6
- [ ] Paragraph với **bold**, *italic*, `code`, [link](url), ~~strike~~
- [ ] Unordered list, ordered list, task list (`- [x]`)
- [ ] Nested list (2 level indent)
- [ ] Code block với language tag
- [ ] Blockquote
- [ ] Table GFM 2-3 cột, có align, có `|` escape
- [ ] Image local path và base64 data URL
- [ ] Mermaid base64 inline (simulate bằng `![alt](data:image/png;base64,...)`)
- [ ] Frontmatter strip (đã strip ở extension, mdast không thấy)
- [ ] Horizontal rule
- [ ] GitHub alert (`> [!NOTE]`) — có thể render thành blockquote thường, OK.

### 4. Bundle size check
- [ ] Build production: `npm run build`
- [ ] So sánh `out/export-docx.js` size trước và sau.
- [ ] Nếu tăng >30%, xem xét tree-shaking hoặc chỉ import subset.

## Verify

```bash
npm run lint
npm run build
ls -lh out/export-docx.js  # ghi lại size
```

## Rollback

```bash
git revert <commit>
npm install  # restore @m2d/md2docx from package-lock
```

## Risks

- **mdast2docx API khác wrapper**: signature của `toDocx` có thể là `(mdast, options)` thay vì `(md, title, ...)`. Cần đọc type definition TRƯỚC khi viết.
- **Image handling**: mdast2docx cần xử lý base64 data URL (mermaid PNG inline). Test sớm với 1 diagram.
- **Bundle size**: unified + remark-* có thể thêm ~200-500KB. Chấp nhận được vì lazy-loaded.

## Done criteria

- [ ] DOCX export hoạt động với test matrix trên
- [ ] Bundle size không tăng quá 30%
- [ ] Output DOCX mở được trong Word/LibreOffice, format không vỡ
- [ ] Commit message: `refactor(export): migrate @m2d/md2docx to mdast2docx + unified pipeline`

## Follow-up (không thuộc stage này)

- Stage 3 sẽ reuse hàm `markdownToMdast` này, có thể tách ra `src/utils/markdown-ast.ts`.
