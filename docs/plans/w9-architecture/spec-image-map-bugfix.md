# Spec: Image Map Cache Invalidation Bug Fix (Candidate 3, prerequisite)

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

Two minimal fixes, both in existing files:

1. **Bump `imageMapVersion` after plugin map mutation.** Either export a
   `bumpImageMapVersion()` function from main.ts for the plugin to call, or have
   `setImageMap` in main.ts (the existing sync point) also bump the version by
   accepting a callback or making `setImageMap` the sole mutator.

2. **Set `isUpdatingFromExtension` in `updateEditorNode`.** The function dispatches a
   ProseMirror transaction that is not a user edit, but it does not guard against
   `onUpdate` triggering `debouncedPostEdit`. Either the plugin sets the flag (requires
   importing it from main.ts), or `updateEditorNode` uses `tr.setMeta` to signal that
   the transaction should be ignored by the `onUpdate` handler.

## User Stories

1. As a user who renames an image via double-click edit, I want the file on disk to
   contain the relative path `images/new-name.png`, not a webview URL
2. As a user who renames then immediately types, I want my edit to carry the correct
   image path, not one from a stale cache

## Implementation Decisions

- Fix (1) is the primary fix. Fix (2) is defense in depth: even without it, the
  correct cache would produce the right reverse mapping. But without (2), an
  unnecessary `edit` message is still sent after rename.
- The fix must NOT change the overall architecture of the image map. Candidate 3
  (refactor) comes after this fix.
- The fix must work with the CURRENT structure: `imageMapVersion` as a module-local
  in main.ts, `currentImageMap` shared by reference.
- Preferred approach for (1): add a `notifyImageMapChanged()` export from main.ts
  that does `imageMapVersion++; cachedReverseImageMap = null;`. The plugin calls it
  after mutating the map. This is intentionally narrow: the refactor (C3) will
  subsume it.

## Testing Decisions

- **New harness seam**: `image-map-seam.ts`. Test case: construct an editor with a
  document containing `![alt](images/photo.png)`, provide an image map, simulate
  the sequence (mutate map as rename response would, serialize). Assert the serialized
  output contains `images/new-name.png`, not a webview URI.
- **Teeth test**: remove the `notifyImageMapChanged()` call from the plugin. The seam
  must go red. Report how many cases fail.
- No floor check probe needed for this fix alone. The seam exercises the code path.

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
