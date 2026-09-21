# Spec: Image Path Translation Bug Fix (Candidate 3, prerequisite)

## Problem Statement

When a user renames an image via double-click in the rich text view, the webview URI
of the renamed image leaks into the Markdown file on disk. This is a Lossy defect:
the file contains a `https://file+.vscode-resource.vscode-cdn.net/...` URL instead
of the relative path the user intended.

Root cause: `handleImageRenameResponse` in the image edit plugin mutates the shared
`currentImageMap` object (adding the new webviewUri mapping) but cannot increment
`imageMapVersion` because it is a local variable in the main webview module. When
`debouncedPostEdit` fires (triggered by the `updateEditorNode` transaction, which does
NOT set `isUpdatingFromExtension`), `transformForSave` checks the version counter,
finds it unchanged, and reuses the stale cached reverse map. The new webviewUri is not
in the cache, so `replaceImagePaths` does not convert it back to the relative path.

Evidence: see `docs/plans/w9-architecture/00-verification.md`, Candidate 3.

## Solution

Fix the code so that the following invariants hold after a double-click rename:

1. **The file on disk contains the relative path, not a webview URI.** After rename,
   the document must contain the new relative path, never a webview resource URL.
2. **No `edit` is posted if the document matches what the host holds.** `postEdit`
   remains the sole exit for `edit`, gated on `contentBaseline`. If the host already
   wrote the new path, the webview must not post a redundant or stale edit.
3. **Baseline must be re-anchored after any host-initiated document change.** If the
   host changes the document (rename writes new path) without sending `update`, the
   webview's `contentBaseline` must still reflect reality, otherwise the next user
   edit will carry stale state.

The ticket does NOT prescribe the mechanism. The worker chooses how to fix it.

**Floor probe**: the coordinator will add a floor check probe to `run.mjs` that
exercises double-click rename (same folder) and reads back the document text. This
probe must be RED on `develop` (before fix) and GREEN after. The worker's ticket
references the probe but does not create it.

## User Stories

1. As a user who renames an image via double-click edit, I want the file on disk to
   contain the relative path, not a webview URL
2. As a user who renames then immediately types, I want my edit to carry the correct
   image path, not one from a stale cache

## Implementation Decisions

- The fix must NOT change the overall architecture of the Image Path Translation
  module. Candidate 3 (refactor) comes after this fix.
- The fix must work with the CURRENT structure: `imageMapVersion` as a module-local,
  `currentImageMap` shared by reference between the main webview module and the
  image edit plugin.
- `postEdit` remains the sole exit for `edit`, gated on `contentBaseline`.
- The mechanism is for the worker to decide; the ticket specifies invariants only.

## Testing Decisions

- **Floor probe** (coordinator-provided): a probe in `run.mjs` exercises double-click
  rename on a same-folder image and reads back document text. Must be RED on develop
  before fix, GREEN after. This is acceptance criterion #1.
- **Harness seam**: `image-path-seam.ts` (coordinator will commit the empty shell and
  golden registration before worktree cut). Worker fills in test cases and golden.
  This is acceptance criterion #2 (seam cannot see RPC ordering, so it complements
  the floor probe but does not replace it).
- **Teeth test**: break the fix, the floor probe and the seam must go red. Report
  how many cases fail.

## Out of Scope

- Consolidating the image map into a single module (candidate 3 refactor).
- Changing the host-side rename flow.

## Further Notes

- One fact in the code trace remains open: whether VS Code delivers the
  `onDidChangeTextDocument` event before or after the microtask that clears
  `pendingEdit`. If the event arrives AFTER the microtask, the host sends `update`,
  `imageMapVersion` gets bumped, the cache is rebuilt, and the bug is masked. Manual
  testing passed at commit cbf5b5e (2026-09-19) with the cache present, which is
  consistent with either timing. The floor probe is what closes this fact: if it is
  RED on develop, the bug is real in the form described; if GREEN, the RPC ordering
  masks it and the ticket becomes "record why it doesn't happen + refactor anyway".
