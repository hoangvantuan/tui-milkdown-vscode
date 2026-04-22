# Plan Stage 4 — PDF rewrite với `puppeteer-core`

**Status**: done (2026-04-22)
**Estimated effort**: 1-1.5 ngày (8-12 giờ)
**Risk**: Cao (Chromium discovery cross-platform, bundle footprint)
**Dependencies**: **PHẢI làm sau Stage 3** (cần MDAST pipeline sẵn sàng)
**Commit prefix**: `refactor(export):`

## Mục tiêu

Bỏ hoàn toàn:
- `pdfmake@0.3.7` (1.1MB bundle)
- Roboto fonts bundled (768KB)
- `copyFonts()` trong esbuild
- Parser markdown tự viết 339 dòng trong `export-pdf.ts`

Thay bằng pipeline:
```
MDAST (từ Stage 3) → HTML (remark-rehype + rehype-stringify) → wrap CSS theme →
puppeteer-core.setContent → page.pdf() → Buffer → file
```

**Lợi ích**:
- WYSIWYG thực sự: PDF giống hệt preview editor (CSS theme, font, layout).
- Zero parser maintenance: xoá 339 dòng tự bảo trì.
- Syntax highlight code block, mermaid image, GitHub alert đều render đúng.

**Tradeoff**:
- Bundle `puppeteer-core` ~8.8MB (tăng so với pdfmake 1.1MB + font 768KB = 1.9MB).
- Cold start ~1s khi launch browser.
- Phụ thuộc Chromium trên máy user.

## Scope

| File | Thay đổi |
|---|---|
| [package.json](package.json) | Remove `pdfmake`, add `puppeteer-core`, `remark-rehype`, `rehype-stringify` |
| [esbuild.config.js](esbuild.config.js) | Remove `copyFonts()` + `exportPdfConfig` giữ nhưng không cần copy font |
| [src/utils/export-pdf.ts](src/utils/export-pdf.ts) | Rewrite hoàn toàn (339 dòng → ~150 dòng) |
| [src/utils/chromium-discovery.ts](src/utils/chromium-discovery.ts) | **Mới** — logic tìm Chromium executable |
| [src/markdownEditorProvider.ts](src/markdownEditorProvider.ts) | Update call signature: `exportToPdf(mdast, uri)` |

## Tasks

### 1. Chromium Discovery strategy

Phải hỗ trợ cross-platform, có fallback. Đề xuất chuỗi thử:

1. **VS Code Electron executable** (`process.execPath`):
   - Pros: Luôn có, không đòi user cài thêm.
   - Cons: Electron version của VS Code có thể chạy puppeteer không? Cần verify. Một số puppeteer API (như `connect` qua CDP) có thể không hoạt động với Electron renderer vì khác mode.
   - Verify sớm: `process.execPath` trỏ đến `Electron.app/Contents/MacOS/Electron` trên macOS.
2. **System Chrome/Chromium/Edge** common paths:
   - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`
   - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, Edge equivalents
   - Linux: `/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, `/usr/bin/chromium`, `/snap/bin/chromium`
3. **Environment variable** `PUPPETEER_EXECUTABLE_PATH`
4. **Error UX**: Nếu không tìm thấy, hiện dialog: "PDF export cần Chrome/Chromium. Cài đặt rồi thử lại, hoặc set `tuiMarkdown.chromiumPath` trong settings."

### 2. `src/utils/chromium-discovery.ts`
- [ ] Function `findChromiumExecutable(): Promise<string | null>`.
- [ ] Check env var trước, rồi system paths theo OS.
- [ ] Cache kết quả (module-level variable) để tránh check lại mỗi lần export.
- [ ] Optional: thêm setting `tuiMarkdown.chromiumPath` (string, default empty) để user override.

### 3. Cập nhật `package.json`
- [ ] `npm uninstall pdfmake`
- [ ] `npm install puppeteer-core@^24 remark-rehype@^11 rehype-stringify@^10 rehype-highlight@^7` (cho syntax highlight)
- [ ] Optional: `rehype-sanitize` nếu cần sanitize HTML từ user markdown (tránh XSS khi render trong Chromium).

### 4. Cập nhật `esbuild.config.js`
- [x] Xoá hàm `copyFonts()` và call tương ứng.
- [x] `puppeteer-core` được bundle INLINE vào `out/export-pdf.js` (tree-shake qua esbuild). Chỉ `vscode` là external.
  ```js
  const exportPdfConfig = {
    // ...
    external: ['vscode'],
  };
  ```
- [x] Bundle size thực tế `out/export-pdf.js` ~2.5MB (inline puppeteer-core). Quyết định giữ inline để:
  1. `.vscodeignore` có thể giữ `node_modules/**` catch-all → VSIX nhỏ gọn, không lo sót dep.
  2. Extension lazy-load qua `require()` tại runtime chỉ khi user bấm Export PDF, cold path.
  3. Tránh phụ thuộc vào đường dẫn `node_modules` tại runtime cross-platform.
- [x] `.vscodeignore` giữ nguyên pattern `node_modules/**`.

### 5. Rewrite `src/utils/export-pdf.ts`
- [ ] Pipeline:
  ```ts
  import { unified } from "unified";
  import remarkRehype from "remark-rehype";
  import rehypeStringify from "rehype-stringify";
  import rehypeHighlight from "rehype-highlight";
  import type { Root } from "mdast";
  import { findChromiumExecutable } from "./chromium-discovery";

  async function mdastToHtml(mdast: Root): Promise<string> {
    const file = await unified()
      .use(remarkRehype, { allowDangerousHtml: true })  // mermaid SVG/HTML
      .use(rehypeHighlight)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .run(mdast);
    return String(file);
  }

  function buildHtmlDocument(bodyHtml: string, title: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.625; }
  h1, h2, h3, h4, h5, h6 { text-wrap: balance; margin-top: 32px; margin-bottom: 12px; }
  h1 { font-size: 32px; } h2 { font-size: 24px; } h3 { font-size: 20px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: Cascadia Code, Fira Code, monospace; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f0f0f0; font-weight: 600; }
  blockquote { border-left: 4px solid #ccc; margin: 16px 0; padding: 4px 16px; color: #555; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; text-decoration: underline; }
  hr { border: none; border-top: 1.5px dashed #ccc; margin: 24px 0; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  }

  export async function exportToPdf(mdast: Root, documentUri: vscode.Uri) {
    const docName = path.basename(documentUri.fsPath, path.extname(documentUri.fsPath));
    const saveUri = await vscode.window.showSaveDialog({ /* ... */ });
    if (!saveUri) return;

    const chromiumPath = await findChromiumExecutable();
    if (!chromiumPath) {
      vscode.window.showErrorMessage(
        "PDF export cần Chrome/Chromium/Edge đã cài trên máy. Hoặc set tuiMarkdown.chromiumPath trong settings."
      );
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Exporting PDF…" },
      async () => {
        const puppeteer = require("puppeteer-core");
        const browser = await puppeteer.launch({
          executablePath: chromiumPath,
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        try {
          const page = await browser.newPage();
          const html = await mdastToHtml(mdast);
          const fullHtml = buildHtmlDocument(html, docName);
          await page.setContent(fullHtml, { waitUntil: "networkidle0" });
          const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
          });
          await vscode.workspace.fs.writeFile(saveUri, pdfBuffer);
        } finally {
          await browser.close();
        }
      }
    );
    // ... show notification Open File / Open Folder
  }
  ```
- [ ] `escapeHtml` helper nhỏ.
- [ ] Xoá toàn bộ `markdownToPdfContent`, `parseInline`, `parseTable`, font loading code.

### 6. `.vscodeignore` check
- [ ] Verify `node_modules/puppeteer-core` không bị ignore khỏi VSIX.
- [ ] Tuy nhiên `puppeteer-core` KHÔNG bundle Chromium binary, nên VSIX size không quá lớn. Check: `node_modules/puppeteer-core` size sau install (~10MB unpacked).

### 7. CSS theme matching (optional enhancement)
- [ ] Nâng cao: pass theme hiện tại của editor vào `buildHtmlDocument` để PDF match màu sắc.
- [ ] Defer nếu effort lớn.

### 8. Test matrix
- [ ] Heading, list (nested + task list), table (multi-line cell, escape pipe)
- [ ] Code block với nhiều ngôn ngữ (JavaScript, Python, Bash)
- [ ] Syntax highlight có màu
- [ ] Mermaid base64 inline render đúng
- [ ] Frontmatter đã strip (từ Stage 3)
- [ ] File lớn (~500KB markdown + 10 mermaid)
- [ ] Cross-platform: test trên macOS (chắc chắn), nếu có máy Windows/Linux verify luôn

## Verify

```bash
npm run lint
npm run build
ls -lh out/export-pdf.js  # phải < 3MB (puppeteer-core bundled inline)
du -sh node_modules/puppeteer-core  # ghi lại size
npm run package  # tạo VSIX, check size
```

## Rollback

Stage này commit riêng. Nếu sai: `git revert <commit>` và `npm install` restore pdfmake.

## Risks

### High
- **Electron của VS Code có thể không chạy được puppeteer** với `process.execPath`. Phải PoC verify sớm. Nếu fail → rely on system Chrome (user phải cài).
- **VSIX size tăng**: puppeteer-core node_modules ~10MB. Extension hiện tại bao nhiêu? Check `npm run package` output size.

### Medium
- **Security**: `page.setContent` + `allowDangerousHtml` có thể XSS nếu user markdown chứa `<script>`. Chromium headless có `--no-sandbox` sẽ chạy script. Mitigations:
  - `rehype-sanitize` trước khi stringify (loại script, event handler). Nhưng có thể làm mất mermaid SVG foreignObject.
  - Hoặc: whitelist HTML tags cho phép (svg, foreignObject, div, span, br) và loại script.
  - Chạy Chromium với `--disable-javascript` vì không cần JS để render markdown tĩnh.
- **Cold start ~1s**: user cảm giác chậm. Show progress notification đủ.
- **Mermaid SVG với foreignObject HTML**: Chromium render tốt hơn pdfkit, đây là lợi thế.

### Low
- **Font rendering khác nhau giữa user OS**: PDF dùng font system, khác nhau macOS/Windows/Linux. Acceptable.

## Done criteria

- [x] PDF export cross-platform trên ít nhất macOS
- [x] Bundle VSIX size tăng không quá 15MB (từ current size) — inline `out/export-pdf.js` ~2.5MB, VSIX vẫn dưới ngưỡng.
- [x] Test matrix pass (manual verification)
- [x] Parser tự viết 339 dòng đã xoá hết
- [x] pdfmake + Roboto font đã gỡ khỏi package.json và `out/`
- [x] `out/export-pdf.js` size < 3MB (revised từ <200KB do quyết định bundle inline thay vì external — xem Task 4)
- [ ] Commit message: `refactor(export): rewrite PDF với puppeteer-core, bỏ pdfmake`

## Follow-up (out of scope)

- Theme-aware PDF (PDF dùng CSS theme user đang chọn trong editor)
- Page number, header/footer tuỳ chỉnh
- Cover page với frontmatter metadata
- Print preview trong webview trước khi export
