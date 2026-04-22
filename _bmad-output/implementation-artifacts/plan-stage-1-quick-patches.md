# Plan Stage 1 — Quick Patches (bền vững)

**Status**: ready
**Estimated effort**: 30-45 phút
**Risk**: Thấp
**Dependencies**: Không. Làm độc lập.
**Commit prefix**: `fix:`

## Mục tiêu

Áp 4 patch không liên quan kiến trúc PDF/DOCX (sẽ không bị xoá khi làm Stage 2-4).

## Scope

| File                                                           | Patch                     | Impact     |
| -------------------------------------------------------------- | ------------------------- | ---------- |
| [src/markdownEditorProvider.ts](src/markdownEditorProvider.ts) | P3 BOM + P5 await         | Trung bình |
| [src/webview/main.ts](src/webview/main.ts)                     | P6 debounce Export button | Nhỏ        |
| [src/webview/mermaid-plugin.ts](src/webview/mermaid-plugin.ts) | P7 regex label mở rộng    | Trung bình |


## Tasks

### P3. Frontmatter regex skip BOM

- [ ] Trong `markdownEditorProvider.ts` tìm `const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;`
- [ ] Đổi thành `const frontmatterRegex = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;`
- [ ] Test: tạo file `.md` có BOM (dùng `printf '\xEF\xBB\xBF---\ntitle: x\n---\n# Hello\n' > test.md`) rồi export, frontmatter phải bị strip.

### P5. await doExport, lỗi async không nuốt

- [ ] Trong `markdownEditorProvider.ts` case `"export"`, hiện tại gọi `doExport(bodyForExport, document.uri)` không await.
- [ ] Bọc trong IIFE async có try/catch:
  ```ts
  (async () => {
    try {
      if (exportFormat === "pdf") {
        const { exportToPdf } = require(path.join(__dirname, "export-pdf.js"));
        await exportToPdf(bodyForExport, document.uri);
      } else {
        const { exportToDocx } = require(path.join(__dirname, "export-docx.js"));
        await exportToDocx(bodyForExport, document.uri);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Export thất bại: ${msg}`);
      console.error("[Export]", err);
    }
  })();
  ```
- [ ] Test: force lỗi bằng cách rename `out/export-pdf.js`, click Export, phải thấy dialog error thay vì silence.

### P6. Debounce nút Export tránh double-click

- [ ] Trong `src/webview/main.ts` handler `#btn-export-go` click:
  ```ts
  const btn = document.getElementById("btn-export-go") as HTMLButtonElement | null;
  btn?.addEventListener("click", async () => {
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try {
      // ... existing collect mermaidImages + postMessage logic
    } finally {
      // Re-enable sau 3s hoặc khi nhận response từ extension
      setTimeout(() => { if (btn) btn.disabled = false; }, 3000);
    }
  });
  ```
- [ ] Optional: extension gửi `exportComplete` message để enable sớm hơn. Không bắt buộc cho stage này.
- [ ] Test: click Export 3 lần liên tiếp, chỉ thấy 1 save dialog.

### P7. Mermaid label regex cover nhiều pattern hơn

- [ ] Trong `src/webview/mermaid-plugin.ts` tìm:
  ```ts
  const processed = code.replace(
      /(\["[^"]*"\]|\("[^"]*"\)|\{"[^"]*"\})/g,
      (match) => match.replace(/\\n/g, "<br/>"),
  );
  ```
- [ ] Thay bằng cách xử lý rộng hơn. Gợi ý: process per-line, chỉ match bên trong bracket `[...]`, `(...)`, `{...}` bất kể quote style:
  ```ts
  const processed = code.replace(
      /(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/g,
      (match) => match.replace(/\\n/g, "<br/>"),
  );
  ```
- [ ] Risk: regex rộng hơn có thể match `[class]` trong class diagram. Verify: test với `sequenceDiagram`, `classDiagram`, `flowchart`, `stateDiagram` sample từ mermaid docs.
- [ ] Nếu gây regression: narrow lại hoặc chỉ apply trong `flowchart` block (detect qua `code.trim().startsWith("flowchart")`).

## Verify

```bash
npm run lint     # tsc --noEmit phải pass
npm run build    # esbuild phải build thành công
```

Manual smoke test:

1. Tạo file `.md` có BOM + frontmatter + `flowchart TD\nA["Line1\nLine2"] --> B`.
2. Export DOCX hoặc PDF (sau khi Stage 2/3 xong; stage này chỉ test không crash).
3. Click Export 3 lần rapid.

## Rollback

Nếu có regression: `git revert <commit>`. Plan này làm 1 commit duy nhất.

## Out of scope

- Fix parser PDF (sẽ bỏ ở Stage 4)
- Fix regex replace mermaid trong markdown text (sẽ bỏ ở Stage 3)
- Fix race tmpFile PDF (sẽ bỏ ở Stage 4)

## Done criteria

- 4 patch applied
- Build pass
- Smoke test manual pass
- Commit với message: `fix(export): skip BOM frontmatter, await export, debounce button, mermaid label regex`
