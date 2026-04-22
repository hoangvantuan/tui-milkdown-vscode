# Plan Stage 1 — Quick Patches (bền vững)

**Status**: done (2026-04-22)
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

- [x] Trong `markdownEditorProvider.ts` tìm `const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;`
- [x] Đổi thành `const frontmatterRegex = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;`
- [x] Verify Node snippet: BOM `EF BB BF` + frontmatter strip sạch, content `# Hello` giữ nguyên.

### P5. await doExport, lỗi async không nuốt

- [x] Trong `markdownEditorProvider.ts` case `"export"`, hiện tại gọi `doExport(bodyForExport, document.uri)` không await.
- [x] Bọc trong IIFE async có try/catch:
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
- [ ] Test: force lỗi bằng cách rename `out/export-pdf.js`, click Export, phải thấy dialog error thay vì silence. (Defer sang QA pass sau Stage 2/3.)

### P6. Debounce nút Export tránh double-click

- [x] Trong `src/webview/main.ts` handler `#btn-export-go` click:
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
- [ ] Optional: extension gửi `exportComplete` message để enable sớm hơn. Không bắt buộc cho stage này. (Defer.)
- [ ] Test: click Export 3 lần liên tiếp, chỉ thấy 1 save dialog. (Defer sang QA pass sau Stage 2/3.)

### P7. Mermaid label regex cover nhiều pattern hơn

- [x] Trong `src/webview/mermaid-plugin.ts` tìm:
  ```ts
  const processed = code.replace(
      /(\["[^"]*"\]|\("[^"]*"\)|\{"[^"]*"\})/g,
      (match) => match.replace(/\\n/g, "<br/>"),
  );
  ```
- [x] Thay bằng cách xử lý rộng hơn. Gợi ý: process per-line, chỉ match bên trong bracket `[...]`, `(...)`, `{...}` bất kể quote style:
  ```ts
  const processed = code.replace(
      /(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/g,
      (match) => match.replace(/\\n/g, "<br/>"),
  );
  ```
- [ ] Risk: regex rộng hơn có thể match `[class]` trong class diagram. Verify: test với `sequenceDiagram`, `classDiagram`, `flowchart`, `stateDiagram` sample từ mermaid docs. (Defer sang QA pass.)
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

- [x] 4 patch applied
- [x] `npm run lint` pass (tsc --noEmit)
- [x] `npm run build` pass (esbuild production)
- [x] BOM regex verify bằng Node snippet
- [ ] Smoke test manual (rapid-click, mermaid classDiagram) — defer sang QA pass khi export thật chạy
- [ ] Commit: `fix(export): skip BOM frontmatter, await export, debounce button, mermaid label regex` — chờ user xác nhận

## Kết quả

| Patch | File                                                                                            | Thay đổi                                          |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| P3    | [src/markdownEditorProvider.ts:926](src/markdownEditorProvider.ts#L926)                         | `frontmatterRegex` thêm `﻿?` (U+FEFF) đầu regex |
| P5    | [src/markdownEditorProvider.ts:944-960](src/markdownEditorProvider.ts#L944-L960)                | Async IIFE + try/catch + `showErrorMessage`       |
| P6    | [src/webview/main.ts:1402-1436](src/webview/main.ts#L1402-L1436)                                | `exportBtn.disabled` + `setTimeout` 3s re-enable  |
| P7    | [src/webview/mermaid-plugin.ts:141-145](src/webview/mermaid-plugin.ts#L141-L145)                | Regex match mọi `[...]`, `(...)`, `{...}`         |
