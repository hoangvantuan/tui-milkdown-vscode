# Deferred Work

Findings surfaced incidentally by review but not caused by the triggering story. Pick up later.

## Mermaid plugin — pre-existing issues

1. **Stale lightbox snapshot on doc edit** — If user edits mermaid code while fullscreen lightbox is open, the lightbox keeps showing the snapshot captured at click time. Nice-to-have: close lightbox on `docChanged` when the underlying mermaid block changes, or re-render from the current block.
2. **Theme switch while lightbox open** — Same root cause as #1: SVG in lightbox is a static `outerHTML` snapshot. When user switches theme while lightbox is open, preview in editor re-renders but lightbox does not. Acceptable: Esc + reopen.
3. **`data-mermaid-src` not cleared on error** — `updateMermaidTheme` iterates `.mermaid-preview` and re-renders, but if an errored block's code is invalid, re-render fails silently. Root cause: per-preview render state not tracked. Not caused by this story.
4. **Debounce timer not cancelled on widget destroy** — `pendingTimers` in `MermaidDiagram` view is only cleared in plugin `destroy()`, not when individual widgets are recreated by decoration rebuild. Timers still fire into detached elements (harmless, but leaks handles). Pre-existing.
5. **Duplicate SVG element IDs across cached previews** — `renderCache` stores rendered SVG string keyed by code. When the same diagram appears twice in a doc, both previews have SVG nodes with identical auto-generated IDs (mermaid's internal refs). `document.getElementById` can return the wrong one. Adding the lightbox copy increases duplication. Fix: strip/rewrite IDs before writing host innerHTML.
