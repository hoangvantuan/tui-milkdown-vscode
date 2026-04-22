# Overview — Export Rewrite (4 Stages)

**Context**: Code review phát hiện nợ kỹ thuật và cơ hội tối ưu trong feature Export DOCX/PDF mới thêm.
**Review date**: 2026-04-22
**Branch**: develop

## Quyết định kiến trúc

| Decision | Chọn | Lý do |
|---|---|---|
| D1: Mermaid `securityLevel: "loose"` | **Giữ nguyên** | Chấp nhận risk để ELK + foreignObject render đẹp. Document risk này trong CLAUDE.md. |
| D2: `@m2d/md2docx@0.0.1` | **Migrate `mdast2docx@1.6.1`** | Bỏ wrapper solo author, dùng lib lõi stable hơn. |
| D3: PDF engine | **Rewrite với `puppeteer-core`** | WYSIWYG thật, bỏ parser tự viết 339 dòng. |
| D4: Mermaid pipeline | **MDAST-based** | Thay regex replace fragile bằng AST visitor. |

## Thứ tự thực hiện khuyến nghị

```
Stage 1 (độc lập)          Stage 2 (độc lập)
      ↓                          ↓
       ───────────┬──────────────
                  ↓
             Stage 3 (cần Stage 2)
                  ↓
             Stage 4 (cần Stage 3)
```

**Khuyến nghị**: Làm theo thứ tự 1 → 2 → 3 → 4. Mỗi stage commit riêng để rollback dễ.

## Danh sách file plan

| Stage | File | Effort | Risk | Status |
|---|---|---|---|---|
| 1 | [plan-stage-1-quick-patches.md](plan-stage-1-quick-patches.md) | 30-45 phút | Thấp | Done |
| 2 | [plan-stage-2-mdast2docx-migration.md](plan-stage-2-mdast2docx-migration.md) | 2-3 giờ | Trung bình | Done |
| 3 | [plan-stage-3-mdast-pipeline.md](plan-stage-3-mdast-pipeline.md) | 4-5 giờ | Trung bình-cao | Done |
| 4 | [plan-stage-4-puppeteer-pdf.md](plan-stage-4-puppeteer-pdf.md) | 8-12 giờ | Cao | Done |

**Tổng**: ~2 ngày làm liên tục, hoặc 1 tuần part-time.

## Tổng kết findings được giải quyết

### Fix trực tiếp
- Stage 1: BOM frontmatter, await doExport, debounce Export, mermaid label regex
- Stage 2: Bỏ risk version 0.0.1
- Stage 3: CRLF mismatch, duplicate mermaid, O(N*M) base64 regex, DOCX/PDF cùng AST
- Stage 4: Parser limitations (nested list, link `)`, table `<br>`/`\|`, inline image, escape `\*`, code block chưa đóng, heading >6 #), WYSIWYG

### Defer sang sau
Xem [deferred-work.md](deferred-work.md) → section "Deferred from: code review (2026-04-22)".

## Gotchas quan trọng

1. **Stage 4 PoC sớm**: Verify `puppeteer-core` có chạy được với `process.execPath` (VS Code Electron) hay phải rely system Chrome. Test 30 phút trước khi commit toàn bộ rewrite.
2. **Bundle VSIX**: Stage 4 thêm `node_modules/puppeteer-core` ~10MB. Check `.vscodeignore` không ignore nhầm. Stage 2 bỏ Roboto font (~768KB). Net tăng ~9MB.
3. **Security trong Stage 4**: `setContent` + `allowDangerousHtml` có thể XSS. Disable JS trong Chromium headless hoặc dùng `rehype-sanitize` whitelist.
4. **Stage 3 hash mermaid code**: Webview và extension PHẢI hash giống nhau. Recommend gửi raw code, hash chỉ ở extension side để tránh drift.

## Verify cuối cùng sau cả 4 stage

```bash
npm run lint
npm run build
npm run package  # tạo VSIX
# Manual test: Export DOCX và PDF với file phức tạp (heading, table, code, mermaid, image)
```

## Rollback plan

Mỗi stage commit riêng. Nếu stage N fail:
- `git revert <commit-N>` → giữ nguyên stage 1..N-1
- Điều tra, fix plan, thử lại

Không force-push, không rebase commit đã push.

## Review Findings (2026-04-22)

Code review pass 2 (adversarial 3 layers: Blind Hunter + Edge Case Hunter + Acceptance Auditor) trên diff `origin/main...develop + uncommitted`, Group A+B (core code + build config), 9 files, +855/-17.

### Decision resolved

- **M4 → Patch**: Giữ `"loose"`, update CLAUDE.md Lightbox section + thêm security risk note trong Mermaid section.
- **M5 → Patch**: Conditional `--no-sandbox` chỉ khi Linux + root (`process.platform === 'linux' && process.getuid?.() === 0`).
- **M33 → Dismiss**: Accepted risk (trusted content model, user open file tự tin tưởng).
- **M43 → Patch (docs only)**: Giữ bundle inline, update `plan-stage-4-puppeteer-pdf.md` Done criteria hợp thức hoá 2.5MB + update task 4 bundle strategy.

### Patch — High

- [x] [Review][Patch] **M1 — Frontmatter regex nuốt `---` nội dung** [src/markdownEditorProvider.ts:155-156]. Regex `/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/` match cả pair `---` đầu document dù không phải frontmatter. Fix: dùng `remark-frontmatter` parse trên raw markdown (đã có trong pipeline), bỏ regex strip.
- [x] [Review][Patch] **M3 — hashMermaidCode drift webview/extension** [src/webview/mermaid-plugin.ts:294,305 + src/utils/markdown-ast.ts:32-39]. Webview hash `node.textContent.trim()` (ProseMirror); extension hash `node.value` từ remark-parse. Line-ending (CRLF/LF) và indent (indented fence) có thể khác. Fix: normalize cả 2 bên về LF + strip leading indent, thêm test CRLF + indented fence.
- [x] [Review][Patch] **M9 — Export button 3s debounce không track completion** [src/webview/main.ts:1433-1436]. Export PDF/DOCX lớn > 3s → click lần 2 mở 2 save dialog + 2 Chromium instance. Fix: extension gửi `exportDone` message back, hoặc extension reject duplicate request khi `exportInProgress`.
- [x] [Review][Patch] **M13 — DOCX fetch remote không timeout, không max size** [src/utils/export-docx.ts:463-469]. `![](http://slow.host/huge.bin)` treo vô hạn + OOM. Fix: AbortController timeout 30s + kiểm `content-length` < 10MB.
- [x] [Review][Patch] **M14 — PDF không resolve relative image** [src/utils/export-pdf.ts:59-92]. `baseDir` được compute rồi `void baseDir`. Chromium load `<img src="./img.png">` từ `about:blank` → 404 silent. Fix: inject `<base href="file://${baseDir}/">` hoặc thay resolver inline base64 như DOCX path.

### Patch — Medium

- [x] [Review][Patch] **M6 — `allowDangerousHtml` + script/iframe/meta-refresh passthrough** [src/utils/export-pdf.ts:645,650]. `setJavaScriptEnabled(false)` chặn JS execution, nhưng `<iframe src="file://...">`, `<link rel="stylesheet" href="file://...">`, `<meta http-equiv="refresh">` vẫn có thể fetch local resource. Fix: thêm `rehype-sanitize` với whitelist tags safe (svg, foreignObject, div, span, br, img, a, h1-6, p, pre, code, table…).
- [x] [Review][Patch] **M7 — `userFont` escape HTML trong CSS context phá font** [src/utils/export-pdf.ts:661-665]. `escapeHtml` đổi `"` → `&quot;`, nhưng `<style>` là raw text, CSS không decode → `font-family` invalid, fallback mặc định. Fix: strip hoặc whitelist ký tự `[A-Za-z0-9 _-]`, không dùng `escapeHtml`.
- [x] [Review][Patch] **M11 — `imageSize` catch silent → ảnh 600×400 méo tỉ lệ** [src/utils/export-docx.ts:486-494]. Fix: console.warn khi fail, log URL ảnh.
- [x] [Review][Patch] **M12 — `decodeURIComponent` throw URIError với `%` literal** [src/utils/export-docx.ts:475]. `50%_off.png` → URIError → toàn bộ export fail. Fix: try/catch, fallback raw path.
- [x] [Review][Patch] **M15 — `waitUntil: "load"` có thể fire trước khi img xong** [src/utils/export-pdf.ts:591]. Fix: `networkidle0` hoặc await `Promise.all(imgs.map(img => img.complete ? null : new Promise(res => img.onload = img.onerror = res)))`.
- [x] [Review][Patch] **M17 — Async IIFE export không dispose khi webview đóng** [src/markdownEditorProvider.ts:928-957]. Fix: track `CancellationTokenSource`, listen `webviewPanel.onDidDispose`, abort puppeteer/mdast2docx.
- [x] [Review][Patch] **M24 — Chromium cache không invalidate khi user đổi `chromiumPath`** [src/utils/chromium-discovery.ts:19-52]. Fix: thêm `vscode.workspace.onDidChangeConfiguration(e => if (e.affectsConfiguration("tuiMarkdown.chromiumPath")) clearChromiumCache())`.
- [x] [Review][Patch] **M25 — Document trống/chỉ có frontmatter → export file trắng silent** [src/markdownEditorProvider.ts:924-956]. Fix: nếu `bodyMarkdown.trim()` rỗng → `showWarningMessage("Document trống, không có nội dung để export")` + return.
- [x] [Review][Patch] **M28 — Puppeteer launch fail error cryptic** [src/utils/export-pdf.ts:581-585]. Fix: try/catch quanh `puppeteer.launch`, wrap error thành "Không launch được Chromium tại `<path>`: <original error>. Kiểm tra quyền execute hoặc set `tuiMarkdown.chromiumPath`".
- [x] [Review][Patch] **M31 — `svgToPngBlob` zero dimensions throw → mermaid thiếu trong export silent** [src/webview/svg-to-png.ts:34-37]. Fix: nếu viewBox + attribute đều thiếu, fallback `{width: 800, height: 600}` và log warning.
- [x] [Review][Patch] **M34 — DOCX ảnh local không tồn tại → toàn bộ export fail** [src/utils/export-docx.ts:476]. Fix: try/catch quanh `fs.readFile`, trả về placeholder image (empty buffer hoặc 1x1 png) và log warning thay vì throw.
- [x] [Review][Patch] **M36 — DOCX gặp image SVG (không phải mermaid) → toàn bộ export fail** [src/utils/export-docx.ts:481-483]. Fix: return placeholder + warn, không throw.

### Patch — Low

- [x] [Review][Patch] **M2 — Double-strip frontmatter (regex + remark-frontmatter)** [src/markdownEditorProvider.ts:155 + src/utils/markdown-ast.ts:14]. Redundant. Fix gộp cùng M1: bỏ regex, để remark-frontmatter handle.
- [x] [Review][Patch] **M16 — `rehype-highlight` `detect: true` chậm với document lớn** [src/utils/export-pdf.ts:646]. Fix: `detect: false` (chỉ highlight khi có language), hoặc subset languages.
- [x] [Review][Patch] **M22 — `chromiumPath` chỉ check `isFile()`, không check execute bit** [src/utils/chromium-discovery.ts:54-61]. Fix: `fs.promises.access(path, fs.constants.X_OK)`.
- [x] [Review][Patch] **M29 — `chromiumPath.trim()` không strip quote** [src/utils/chromium-discovery.ts:30-35]. User paste `"C:\path\chrome.exe"` → `statSync` fail. Fix: `.replace(/^["']|["']$/g, "")` trước stat.
- [x] [Review][Patch] **M40 — "Open Folder" dùng `openExternal(folder)` behavior varies cross-platform** [src/utils/export-*.ts]. Fix: `vscode.commands.executeCommand("revealFileInOS", saveUri)`.

### Deferred

- [x] [Review][Defer] **M21 — Chromium process orphan nếu `launch` throw sau fork** [src/utils/export-pdf.ts:581-604] — deferred, puppeteer thường tự cleanup, rất hiếm.
- [x] [Review][Defer] **M26 — Document > 500KB có thể OOM Chromium** [src/utils/export-pdf.ts:590-599] — deferred, đã có MAX_FILE_SIZE warning tại bước open, pre-existing.
- [x] [Review][Defer] **M32 — `mermaidImages` postMessage không chunk, 50 diagrams × 2MB → 100MB IPC** [src/webview/main.ts:1411-1431] — deferred, edge case hiếm, optimization tương lai.
- [x] [Review][Defer] **M38 — Save dialog chọn file đang mở bởi Word/Acrobat** [src/utils/export-docx.ts:415] — deferred, VS Code error `EBUSY` đã đủ rõ.

### Dismissed (12)

M8 (ELK silent try/catch — đã có console.warn), M10 (`SKIP` no-op harmless), M18 (Mermaid alt cứng — accessibility acceptable), M19 (require dynamic — build responsibility), M20 (dagre cfg warning — harmless), M27 (UTF-16 BOM — VSCode normalize), M30 (`\n`→`<br/>` trong bracket — intentional feature), M35 (DOCX font state trusted), M37 (filename no ext — minor UX), M39 (disk full — VSCode handle), M41 (getState type — internal trusted), M42 (font control char — sanitizeFontName), M44 (Stage 4 commit timing — pre-commit review OK).
