# Spec: Extension Factory (Candidate 1)

## Problem Statement

Twelve markdown-relevant definitions (EscapeToken, BlankLineHandler, CustomUnderline,
MarkdownManager prototype patch, expandPrefixTabsInText, createCustomMarked, Blockquote
alert extend, Document serializer extend, CodeBlockLowlight fence extend, StarterKit
configure flags, language registration, and Markdown indentation config) exist as
byte-for-byte copies in the main webview module and the harness editor module. AGENTS.md
acknowledges "the two can disagree" and wave 8 ownership markers are scaffolding for
exactly this problem.

When a definition is changed in one editor and not the other, the harness measures
something that does not ship. This violates a core promise of the roundtrip harness.

Evidence: see `docs/plans/w9-architecture/00-verification.md`, Candidate 1.

## Solution

Extract all markdown-relevant extension definitions into a single Node-safe module
(no DOM, no `acquireVsCodeApi`, no browser globals). Both `initEditor()` and the
harness editor import from this module. Each side retains only what touches DOM or
UI (webview) or harness-specific config (harness).

The wave 8 ownership markers are deleted once the factory is in place.

## User Stories

1. As a maintainer, I want roundtrip changes fixed in one place, so that harness
   and production never drift apart
2. As a wave worker, I want to add a markdown extension without touching two files,
   so that I cannot forget the mirror
3. As a reviewer, I want to see that the harness imports the same definitions as the
   product, so that a passing harness means the product roundtrips correctly
4. As a parallel-wave coordinator, I want to delete the wave 8 ownership markers, so
   that future workers need not reason about block boundaries

## Implementation Decisions

- The new module is Node-safe: no `document`, `window`, `navigator`, or
  `acquireVsCodeApi`. The webview esbuild config bundles it into the IIFE webview
  bundle; the harness esbuild config bundles it into the harness; node:test imports
  it. It does NOT go into the CJS extension bundle (the host has no reason to import
  markdown extensions).
- The `MarkdownManager.prototype` patch (#95) is a side effect of import. The factory
  module owns it. The main webview module removes its copy. The patch must run exactly
  once per process; if both editors ever live in the same process (they don't today),
  a guard prevents double patching.
- `IMAGE_IS_INLINE` remains a module-level constant.
- `installMarkdownTextEscape()` stays in its current module and remains the ONE place
  for text escaping. The factory does not duplicate it.
- The factory exports a function (not a list constant) so it can accept config
  parameters: `indentation`, `tabSize`, `lowlight` instance.
- The harness editor module reduces to: import factory, call it, wrap in `new Editor()`.
  Its `buildMarkdownExtensions` function is replaced by the factory.
- The wave 8 `require()` calls inside marker blocks are replaced by normal `import`.
- The expand-then-contract pattern is NOT needed here: the factory is additive (new
  module beside old code), then a single commit switches both callers, then dead code
  is removed.
- Bundle budget: moving code into a shared module should not increase webview bundle
  size (same code, different import path). Verify `<= 1,100,000 B` after change.

## Testing Decisions

- **Roundtrip fixtures**: all 42 existing corpus documents + 16 seams must remain green.
  This is the primary verification: the factory produces the same roundtrip as before.
- **Mirror elimination metric**: after the change, `harness/editor.ts` must not contain
  any definition that mirrors `main.ts`. The following definitions must be gone from
  the harness and imported from the factory instead: EscapeToken, BlankLineHandler,
  CustomUnderline, MarkdownManager prototype patch (#95), expandPrefixTabsInText,
  createCustomMarked, Blockquote alert extend, Document serializer extend,
  CodeBlockLowlight fence extend, Table renderMarkdown extend, lowlight language
  registration, StarterKit.configure flags. Prove with grep: `grep -c 'Mirror of'
  harness/editor.ts` returns 0.
- **Teeth test**: remove ONE extension from the factory (e.g., EscapeToken), then
  run roundtrip. The corresponding fixture must go RED. This proves the harness
  measures the code that ships. Report how many fixtures fail.
- **Floor check**: run `npm run verify:vscode-floor` since this change modifies the
  import path of main.ts and the MarkdownManager prototype patch executes at import
  time. Must pass.
- No new harness seam needed. The roundtrip harness already exercises the factory's output.

## Out of Scope

- Refactoring the `case "update"` handler or any sync-state logic (candidate 2).
- Refactoring the image map (candidate 3).
- Separating the 300-line HTML template from the provider (CANDIDATES.md notes this
  as a pure move, not deepening).
- Adding new markdown extensions.

## Further Notes

- The wave 8 `require()` calls inside marker blocks (for math extension, footnote
  extension) use a static `require` that esbuild inlines. The factory should use a
  normal `import` instead.
- The MarkdownParagraph and MarkdownImage extensions from the markdown-destination
  module are already imported by both editors. They prove the shared-import pattern
  works. The factory can re-export them for convenience.
