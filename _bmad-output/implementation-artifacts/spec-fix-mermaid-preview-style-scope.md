---
title: 'Sửa mermaid preview mất style trên develop sau khi uniquify SVG ids'
type: 'bugfix'
created: '2026-04-23T00:25:55Z'
status: 'done'
route: 'one-shot'
---

# Sửa mermaid preview mất style trên develop sau khi uniquify SVG ids

## Intent

**Problem:** Trên branch `develop` (từ commit `6203488`), mermaid preview render node thành hộp đen đè text. Bản `main` không bị. `uniquifySvgIds()` đổi `id` của toàn bộ SVG (kể cả root) nhưng không rewrite CSS selectors bên trong `<style>` nhúng trong SVG. Mermaid scope CSS theo root id (`#mermaid-render-N .nodeLabel {...}`), nên sau khi đổi id, mọi rule orphan → node fallback về default SVG fill (đen).

**Approach:** Mở rộng `uniquifySvgIds()` thêm pass cuối: duyệt mọi `<style>` trong host, rewrite `#oldId` → `#newId` qua regex có negative lookahead `(?![\w-])` để tránh match partial id, kèm rewrite `url(#id)` trong CSS text. Thêm guard skip id rỗng để regex build an toàn.

## Suggested Review Order

1. [Root cause và fix chính](../../src/webview/mermaid-plugin.ts#L103-L200) — Block `uniquifySvgIds` sau diff: pass mới xử lý `<style>` textContent, helper `escapeRegExp`.
2. [Guard id rỗng](../../src/webview/mermaid-plugin.ts#L118-L123) — Patch từ adversarial review, tránh regex `#()` invalid.
3. [Callers](../../src/webview/mermaid-plugin.ts#L165) — Ba chỗ gọi `uniquifySvgIds` (renderToEl, renderMermaid cache hit, renderMermaid fresh). Không đổi signature, không đổi callers.
