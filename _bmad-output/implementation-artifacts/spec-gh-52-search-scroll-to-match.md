---
title: 'Fix search next/prev not scrolling to match'
type: 'bugfix'
created: '2026-05-05'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Clicking "Search Down/Up" buttons (or pressing Enter in search bar) finds the next match but doesn't scroll the page to its position. Root cause: ProseMirror's `scrollToSelection()` bails when DOM focus is outside the editor (focus stays on search bar button/input).

**Approach:** After `findNext`/`findPrev` succeeds, manually compute match coordinates via `coordsAtPos()` and scroll `#editor-container` so the match lands at vertical center of the viewport.

## Suggested Review Order

1. [search-plugin.ts:48-78](src/webview/search-plugin.ts) — `searchNext`/`searchPrev` now check return value + call `scrollSearchMatchIntoView`; new helper scrolls container to center match vertically
