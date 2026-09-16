# Báo Cáo Nghiệm Thu: Wave 3 - Unified Markdown Text Escape Overrides

Báo cáo nghiệm thu kỹ thuật cho wave 3 giải quyết 4 issue liên quan đến text escaping trong `@tiptap/markdown`: #97, #99, #100, #101.

## 1. Kết Quả 4 Lệnh Kiểm Tra

- `npm run lint`: PASS (tsc --noEmit không có lỗi nào, exit code 0).
- `npm run build`: PASS (esbuild biên dịch production bundle thành công, exit code 0).
- `npm run roundtrip`: PASS (32 markdown fixtures + 6 seams: 38 passed, 0 failed, 0 missing, 0 errored, exit code 0).
- `npm run verify:vscode-floor`: PASS (15 checks: 15 passed, 0 failed trên VS Code target 1.85.0, exit code 0).

## 2. Kết Quả Kiểm Tra Ổn Định Vòng Hai (Idempotency)

- Phương pháp kiểm tra:
  1. Ghi đè toàn bộ synthetic fixtures bằng golden baselines: `cp harness/golden/synthetic/*.md harness/fixtures/synthetic/`
  2. Chạy kiểm tra: `npm run roundtrip`
  3. Khôi phục lại synthetic fixtures: `git checkout -- harness/fixtures/synthetic/`
- Kết quả: 37 passed, 1 failed (đúng chính xác 1 fixture thất bại).
- Fixture thất bại duy nhất: `synthetic/list-continuation-underindented.md` (lỗi thụt lề continuation line cũ của Tiptap đã được ghi nhận trước đó trong `harness/README.md`).
- Toàn bộ các fixture khác và 6 seams đều pass, chứng minh tính ổn định tuyệt đối (idempotency) qua nhiều vòng roundtrip.

## 3. Bảng Phân Loại Golden Diff

| File | Dòng | Phân loại | Chi tiết |
| --- | --- | --- | --- |
| `harness/golden/synthetic/nested-task-lists.md` | 14, 16 | SỬA ĐÚNG (Intended Fix) | Sửa `1. \[ \]` thành `1. [ ]` và `2. \[x\]` thành `2. [x]`. Trước đây Tiptap escape sai dấu ngoặc vuông trong ordered task list (#99). Dòng 15 giữ nguyên 2 khoảng trắng thụt lề theo chỉ dẫn của điều phối viên. |
| `harness/golden/synthetic/footnotes-passthrough.md` | Toàn bộ | THÊM MỚI (New Fixture) | Golden cho tính năng unescape footnote reference và definition hợp lệ (#101), giữ nguyên escape cho unclosed brackets. |
| `harness/golden/synthetic/ordered-task-list.md` | Toàn bộ | THÊM MỚI (New Fixture) | Golden cho ordered task lists với cả bullet con lồng nhau (#99). |
| `harness/golden/synthetic/html-entities.md` | Toàn bộ | THÊM MỚI (New Fixture) | Golden cho HTML entities có tên và dạng số (#97). |
| `harness/golden/synthetic/escaped-block-markers.md` | Toàn bộ | THÊM MỚI (New Fixture) | Golden cho escaped block markers ở đầu paragraph và table cell (#100). |

Tổng kết: 1 file golden cập nhật là SỬA ĐÚNG, 4 golden mới là THÊM MỚI, 0 regression.

## 4. Ghi Nhận Mâu Thuẫn Tiêu Chí Nghiệm Thu (#99)

- Trong mô tả ban đầu của issue #99, tiêu chí nghiệm thu vừa yêu cầu không làm đổi golden `nested-task-lists.md`, vừa yêu cầu sửa lỗi `1. \[ \]` thành `1. [ ]`.
- Thực tế trong golden baseline cũ của `nested-task-lists.md`, dòng 14 là `1. \[ \] ordered parent` và dòng 16 là `2. \[x\] second ordered parent`. Do đó, nếu sửa đúng lỗi #99 thì bắt buộc file golden này phải xuất hiện diff tại dòng 14 và 16.
- Vấn đề này đã được trao đổi với điều phối viên qua `orca orchestration ask`. Điều phối viên đã xác nhận và hướng dẫn cập nhật hai dòng này, phân loại diff là SỬA ĐÚNG.

## 5. Đề Xuất Bổ Sung CHANGELOG.md

Đề xuất nội dung bổ sung vào mục `Fixed` trong `CHANGELOG.md` (coordinator sẽ gộp sau):

```markdown
### Fixed
- Markdown text escaping: preserve unescaped footnote references (`[^label]`) and definitions (`[^label]:`) without breaking unclosed bracket escapes (#101).
- Markdown text escaping: preserve ordered task list items (`1. [ ]`, `1. [x]`) without escaping brackets (#99).
- Markdown text escaping: preserve HTML entities (`&copy;`, `&#169;`, `&#xa9;`, `&nbsp;`, `&mdash;`, `&rarr;`) without `&amp;` double-encoding (#97).
- Markdown text escaping: preserve escaped block markers (`\#`, `1\.`, `1\)`, `\-`, `\+`, `\>`, `\---`) at block starts in paragraphs and table cells (#100).
```

## 6. Đề Xuất Bổ Sung AGENTS.md

Đề xuất nội dung bổ sung vào `AGENTS.md` (coordinator sẽ gộp sau):

1. Thêm vào mục **File Structure** dưới `src/webview/`:
```
    ├── markdown-text-escape.ts # Unified text escape overrides on MarkdownManager (#97, #99, #100, #101)
```

2. Thêm vào mục **Conventions & Gotchas**:
```
- Markdown text escape overrides: `installMarkdownTextEscape()` in `src/webview/markdown-text-escape.ts` overrides `MarkdownManager.prototype.escapeMarkdownSyntaxWithContext` and wraps `encodeTextForMarkdown` to handle footnotes passthrough (#101), ordered task lists (#99), escaped block markers at block start (#100), and HTML entity preservation (#97) across both the webview editor and test harness.
```

## 7. Báo Cáo Upstream Đã Tạo

- `docs/upstream/tiptap-core-97.md`: Báo cáo lỗi `@tiptap/core` 3.30.1 encode thừa ký tự `&` trong HTML entities.
- `docs/upstream/tiptap-extension-list-99.md`: Báo cáo lỗi `@tiptap/extension-list` 3.30.1 escape nhầm dấu ngoặc vuông `[` trong ordered task items.
- `docs/upstream/tiptap-markdown-100.md`: Báo cáo lỗi `@tiptap/markdown` 3.30.1 strip nhầm backslash trước các block markers ở đầu block.
