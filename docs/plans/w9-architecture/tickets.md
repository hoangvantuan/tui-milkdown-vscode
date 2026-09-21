# Wave 9 Architecture Tickets

Two waves. Wave 1 runs three tickets in parallel. Wave 2 runs two tickets after
C1 merges.

## Wave 1 (parallel)

### Ticket 1: Fix image path translation after rename (C3 bugfix)

**Title:** Fix lossy image path after double-click rename

**Blocked by:** None (can start immediately, leads the wave as a Lossy bug fix)

**What it delivers:** After double-click renaming an image in the same folder, the
file on disk contains the relative path (`images/new-name.png`), never a webview URI.
The rename-then-type sequence produces correct markdown.

**Acceptance criteria:**

- [ ] Floor probe (coordinator-provided in `run.mjs`) for double-click rename is
      RED on develop, GREEN after fix
- [ ] Harness seam `image-path-seam.ts` (coordinator-provided empty shell) filled
      with test cases: rename sequence produces correct relative path in serialized
      output
- [ ] Teeth test: break the fix, floor probe and seam go red; report number of
      cases that fail
- [ ] Invariant: `postEdit` remains the sole exit for `edit`, gated on
      `contentBaseline`; no `edit` is posted if the document matches what the host
      holds
- [ ] Invariant: after rename, `contentBaseline` reflects the document the host holds
- [ ] `npm run roundtrip` passes (42 corpus + 16 seams)
- [ ] `npm test` passes

**Ownership (wave 1):** `currentImageMap`, `imageMapVersion`, `cachedReverseImageMap`,
`replaceImagePaths`, `transformForDisplay`, `transformForSave`, `setImageMap` in
main.ts, and the entirety of `image-edit-plugin.ts`.

**Parent spec:** spec-image-map-bugfix.md

---

### Ticket 2: Extract extension factory (C1)

**Title:** Extract markdown-relevant extensions into a shared factory module

**Blocked by:** None (can start immediately)

**What it delivers:** A single Node-safe module that both `initEditor()` in main.ts
and `createHarnessEditor()` in harness/editor.ts import from. The twelve definitions
that existed as byte-for-byte copies are gone from the harness. The wave 8 ownership
markers are deleted.

**Acceptance criteria:**

- [ ] `harness/editor.ts` does NOT contain any of the following definitions as local
      code: EscapeToken, BlankLineHandler, CustomUnderline, MarkdownManager prototype
      patch (#95), expandPrefixTabsInText, createCustomMarked, Blockquote alert extend,
      Document serializer extend, CodeBlockLowlight fence extend, Table renderMarkdown
      extend, lowlight language registration, StarterKit.configure flags
- [ ] `grep -c 'Mirror of' harness/editor.ts` returns 0
- [ ] Wave 8 ownership markers deleted from both main.ts and harness/editor.ts
- [ ] Teeth test: remove ONE extension from the factory (e.g., EscapeToken), run
      `npm run roundtrip`; the corresponding fixture goes RED. Report how many fail.
- [ ] `npm run roundtrip` passes (42 corpus + 16 seams)
- [ ] `npm test` passes
- [ ] `npm run verify:vscode-floor` passes (import path changed, prototype patch at
      import time)
- [ ] `npm run build` passes, webview bundle <= 1,100,000 B

**Ownership (wave 1):** All markdown-relevant definitions in main.ts (listed above),
`initEditor` function, and `harness/editor.ts`.

**Parent spec:** spec-extension-factory.md

---

### Ticket 3: Extract image ledger on host side (C4)

**Title:** Extract host-side image path management into an Image Ledger module

**Blocked by:** None (can start immediately)

**What it delivers:** An `ImageLedger` module under `src/host/` that owns the per-document
image map, enforces the "outer map + docKey" rule through its interface, and internalizes
session flags. The "replace map synchronously before prompt" rule is enforced by code,
not by a comment.

**Acceptance criteria:**

- [ ] `originalImagePaths` map replaced by `Map<string, ImageLedger>` in provider
- [ ] Session flags (`pendingEdit`, `inFlightEdit`, `renameInProgress`,
      `exportInProgress`) are private to `EditorSession` with behaviour methods
- [ ] `requestImageRename.ts` receives the ledger, not raw map + docKey + closure
- [ ] `documentSave.ts` calls `ledger.setBaseline()`, not `originalImagePaths.set()`
- [ ] Unit test: `setBaseline` then `detectRenames` with a path change returns the rename
- [ ] Unit test: `setBaseline` after save discards old inner map
- [ ] Unit test: two concurrent `applyRenames`, second is rejected
- [ ] Unit test: **save replaces map while rename is awaiting** (race test, currently
      only in a comment)
- [ ] Teeth test: break `setBaseline`; rename detection fails. Report how many cases fail.
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes

**Ownership (wave 1):** `src/host/**`, `src/markdownEditorProvider.ts`,
`src/utils/image-rename-handler.ts`.

**Parent spec:** spec-image-ledger.md

---

## Wave 2 (after C1 merges)

### Ticket 4: Extract content sync module (C2)

**Title:** Extract document synchronization state into a Content Sync module

**Blocked by:** Ticket 2 (Extension Factory, C1) must merge first.
_Reason: the sync module must be importable by the harness, which requires
`acquireVsCodeApi` to be out of the import path._

**What it delivers:** A Node-safe module that owns the sync state between webview and
host (`currentBody`, `currentFrontmatter`, `currentFormat`, `currentRawBlock`,
`contentBaseline`, `lastSentState`, `isUpdatingFromExtension`, `debounceTimer`,
`blobRetryCount`), with `postMessage` injected as a dependency. Production wires
`vscode.postMessage`, the harness wires a recorder.

**Acceptance criteria:**

- [ ] Nine sync state variables no longer at module scope in main.ts; owned by the
      sync module
- [ ] `postEdit` and `debouncedPostEdit` are methods of the sync module, not loose
      functions in main.ts
- [ ] Harness seam `content-sync-seam.ts` (coordinator-provided empty shell) filled
      with test cases:
      1. Type then undo within debounce window: no `edit` posted
      2. Document ending with alert (trailingNode): load does not post `edit`
      3. After a real post, `contentBaseline` re-anchors
      4. Two rapid edits: only one `edit` posted (the last)
      5. `flushEdit` after pending debounce: `edit` posted immediately
- [ ] Teeth test: break `postEdit` (remove baseline check); seam goes red. Report
      how many cases fail.
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes

**Ownership (wave 2):** `currentBody`, `currentFrontmatter`, `currentFormat`,
`currentRawBlock`, `contentBaseline`, `lastSentState`, `isUpdatingFromExtension`,
`debounceTimer`, `blobRetryCount`, `postEdit`, `debouncedPostEdit`,
`flushPendingEdit`, `updateEditorContent`, `case "update"` handler in main.ts.

**Parent spec:** spec-content-sync.md

---

### Ticket 5: Refactor image path translation module (C3 refactor)

**Title:** Consolidate webview image path translation into a single module

**Blocked by:** Ticket 1 (C3 bugfix) must merge first.

**What it delivers:** A single Image Path Translation module under `src/webview/` that
owns the image map, version counter, cached reverse map, and all path transformation
functions. Neither `main.ts` nor `image-edit-plugin.ts` holds map state. The "triple
pattern" (`currentImageMap = ...; imageMapVersion++; setImageMap(...)`) is eliminated.

**Acceptance criteria:**

- [ ] `currentImageMap`, `imageMapVersion`, `cachedReverseImageMap` no longer at module
      scope in main.ts
- [ ] `image-edit-plugin.ts` has no `currentImageMap` local variable
- [ ] The "triple pattern" (set map + bump version + sync plugin) replaced by single
      calls to the module
- [ ] `transformForSave` uses `sameResource` for reverse lookup matching
- [ ] Harness seam `image-path-seam.ts` extended with cases for `setMap` and `mutateMap`
- [ ] Teeth test: remove version bump from the module's `setMap`; seam goes red.
      Report how many cases fail.
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes

**Ownership (wave 2):** Same functions as Ticket 1 ownership.

**Parent spec:** spec-image-path-translation.md

---

## Dependency Graph

```
Wave 1 (parallel):
  Ticket 1 (C3 bugfix)  ───────────────────> Ticket 5 (C3 refactor, wave 2)
  Ticket 2 (C1 factory) ───────────────────> Ticket 4 (C2 sync, wave 2)
  Ticket 3 (C4 ledger)       (independent)

Wave 2 (after C1 merge):
  Ticket 4 (C2 sync)
  Ticket 5 (C3 refactor)
```

All three import blocks in wave 1 will touch main.ts (different functions, no logic
overlap). Import-line conflicts are expected and resolved by the coordinator at merge.
A LOGIC conflict means the ownership boundary is wrong.
