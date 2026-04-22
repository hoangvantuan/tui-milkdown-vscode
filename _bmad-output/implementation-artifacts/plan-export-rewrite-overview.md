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

| Stage | File | Effort | Risk |
|---|---|---|---|
| 1 | [plan-stage-1-quick-patches.md](plan-stage-1-quick-patches.md) | 30-45 phút | Thấp |
| 2 | [plan-stage-2-mdast2docx-migration.md](plan-stage-2-mdast2docx-migration.md) | 2-3 giờ | Trung bình |
| 3 | [plan-stage-3-mdast-pipeline.md](plan-stage-3-mdast-pipeline.md) | 4-5 giờ | Trung bình-cao |
| 4 | [plan-stage-4-puppeteer-pdf.md](plan-stage-4-puppeteer-pdf.md) | 8-12 giờ | Cao |

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
