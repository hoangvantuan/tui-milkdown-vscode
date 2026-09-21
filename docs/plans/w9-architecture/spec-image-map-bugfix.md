# Spec: Image Path Translation Bug Fix (Candidate 3, prerequisite)

## Problem Statement

When a user renames an image via double-click in the rich text view, the webview URI
of the renamed image leaks into the Markdown file on disk. This is a Lossy defect:
the file contains a `https://file+.vscode-resource.vscode-cdn.net/...` URL instead
of the relative path the user intended.

Root cause: `handleImageRenameResponse` in `image-edit-plugin.ts` mutates the shared
`currentImageMap` object (adding the new webviewUri mapping) but cannot increment
`imageMapVersion` because it is a local variable in `main.ts`. When `debouncedPostEdit`
fires (triggered by the `updateEditorNode` transaction, which does NOT set
`isUpdatingFromExtension`), `transformForSave` checks the version counter, finds it
unchanged, and reuses the stale cached reverse map. The new webviewUri is not in the
cache, so `replaceImagePaths` does not convert it back to the relative path.

## Solution

Fix the code so that the following invariants hold after a double-click rename:

1. **The file on disk contains the relative path, not a webview URI.** After rename,
   the document must contain `images/new-name.png` (the new relative path), never
   `https://file+.vscode-resource...`.
2. **No `edit` is posted if the document matches what the host holds.** `postEdit`
   remains the sole exit for `edit`, gated on `contentBaseline`. If the host already
   wrote the new path (via `requestImageRename.ts`), the webview must not post a
   redundant or stale edit.
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
   contain the relative path `images/new-name.png`, not a webview URL
2. As a user who renames then immediately types, I want my edit to carry the correct
   image path, not one from a stale cache

## Implementation Decisions

- The fix must NOT change the overall architecture of the image map. Candidate 3
  (refactor) comes after this fix.
- The fix must work with the CURRENT structure: `imageMapVersion` as a module-local
  in main.ts, `currentImageMap` shared by reference.
- `postEdit` remains the sole exit for `edit`, gated on `contentBaseline`.
- The mechanism is for the worker to decide; the ticket specifies invariants only.

## Testing Decisions

- **Floor probe** (coordinator-provided): a probe in `run.mjs` exercises double-click
  rename on a same-folder image and reads back document text. Must be RED on develop
  before fix, GREEN after.
- **Harness seam**: `image-path-seam.ts` (coordinator will commit the empty shell and
  golden registration before worktree cut). Worker fills in test cases and golden.
- **Teeth test**: break the fix, the floor probe and the seam must go red. Report
  how many cases fail.

## Out of Scope

- Consolidating the image map into a single module (candidate 3 refactor).
- Changing the host-side rename flow (`requestImageRename.ts`).
- Adding a floor check probe for rename (valuable but separate scope).

## Further Notes

- The counterevidence noted in CANDIDATES.md ("manual rename testing passed on
  c97c9a3") is explained by the narrow race window: if a subsequent `update` from
  the host arrives before the debounced edit fires, it rebuilds the map with the
  correct version. The bug manifests when the user types immediately after rename,
  before any host update.
