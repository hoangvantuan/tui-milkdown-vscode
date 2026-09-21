# Wave 9 Architecture Tickets

Two waves. Wave 1 runs three tickets in parallel. Wave 2 tickets enter as their
blockers merge.

## Wave 1 (parallel)

### Ticket 1: Fix lossy image path after rename (C3 bugfix)

**Title:** Fix lossy image path after double-click rename

**Blocked by:** None (leads the wave as a Lossy bug fix)

**Size:** Fits one context window; worker reads spec-image-map-bugfix.md and this ticket.

**What it delivers:** After double-click renaming an image in the same folder, the
file on disk contains the relative path, never a webview URI. The rename-then-type
sequence produces correct markdown.

**Acceptance criteria:**

- [ ] Floor probe (coordinator-provided in `run.mjs`) for double-click rename is
      RED on develop, GREEN after fix
- [ ] Harness seam `image-path-seam.ts` (coordinator-provided empty shell) filled
      with test cases demonstrating correct path after rename
- [ ] Teeth test: break the fix, floor probe and seam go red; report number of
      cases that fail
- [ ] After rename, the file on disk contains the new relative path and no webview URI
- [ ] No edit is posted when the document matches what the host holds
- [ ] After a host-initiated document change, the baseline reflects reality
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run verify:vscode-floor` runs once near the end and passes

**Fallback:** If the floor probe does NOT go red on develop, the bug does not manifest
in the form described. The ticket then becomes: record why the RPC ordering masks it
(the open fact from phase 0), apply the refactor portion, and no blind fix.

**Ownership (wave 1):** `currentImageMap`, `imageMapVersion`, `cachedReverseImageMap`,
`replaceImagePaths`, `transformForDisplay`, `transformForSave`, `setImageMap` in the
main webview module, and the entirety of image-edit-plugin.

**Parent spec:** spec-image-map-bugfix.md

---

### Ticket 2a: Extension factory, harness first (C1, part 1)

**Title:** Extension factory: build module and switch harness to it

**Blocked by:** None

**Size:** Fits one context window; worker reads spec-extension-factory.md and this ticket.

**What it delivers:** A Node-safe module containing all twelve markdown-relevant
definitions. The harness editor imports from it and deletes its mirror copies.
The main webview module is NOT changed yet (it still has its own copies).

**Acceptance criteria:**

- [ ] New factory module exists, Node-safe (no DOM, no browser globals)
- [ ] Harness editor imports all markdown-relevant definitions from the factory
- [ ] No definition in the harness is a mirror of the main webview module
      (`grep -c 'Mirror of' harness/editor.ts` returns 0)
- [ ] `npm run roundtrip` passes (58/58, proving factory is equivalent to shipped code)
- [ ] `npm test` passes

**Note:** No `verify:vscode-floor` needed for this ticket because the main webview
module is unchanged.

**Ownership (wave 1):** The new factory module and the harness editor module.

**Parent spec:** spec-extension-factory.md

---

### Ticket 3a: Image ledger module (C4, part 1)

**Title:** Image ledger: one module holding per-document image baseline

**Blocked by:** None

**Size:** Fits one context window; worker reads spec-image-ledger.md and this ticket.

**What it delivers:** An Image Ledger module that replaces the outer map + docKey
pattern with a single object per document. The provider, document-save handler,
and rename handler use the ledger instead of threading the raw map.

**Acceptance criteria:**

- [ ] A ledger module exists, holding the per-document inner map
- [ ] The provider holds one ledger per document key
- [ ] Setting a baseline then providing content with a changed path detects exactly
      one rename
- [ ] Setting a baseline after save discards the old map; the next detection uses
      the new baseline
- [ ] Two concurrent rename applications: the second is rejected
- [ ] A save arriving while a rename is in-flight does not lose the rename result
      and does not cause the next save to re-ask about the same image
- [ ] Teeth test: break baseline replacement; rename detection fails. Report how
      many cases fail
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run verify:vscode-floor` runs once near the end and passes

**Ownership (wave 1):** The new ledger module, the provider, document-save handler,
rename handler, and image-rename-handler utility.

**Parent spec:** spec-image-ledger.md

---

## After blockers merge

### Ticket 2b: Extension factory, main.ts switches (C1, part 2)

**Title:** Extension factory: main.ts switches to factory, delete mirrors and wave 8 markers

**Blocked by:** Ticket 2a

**Size:** Fits one context window; worker reads spec-extension-factory.md and this ticket.

**What it delivers:** `initEditor` imports the factory instead of defining its own
copies. The twelve mirror definitions and the wave 8 ownership markers are deleted
from both files.

**Acceptance criteria:**

- [ ] The main webview module no longer contains its own copies of the twelve
      markdown-relevant definitions
- [ ] Wave 8 ownership markers deleted from both files
- [ ] Teeth test: change one rule in the factory; the corresponding roundtrip
      fixture goes red. Report how many fixtures fail
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes, webview bundle <= 1,100,000 B
- [ ] `npm run verify:vscode-floor` runs once near the end and passes (import path
      changed, prototype patch executes at import time)

**Ownership:** The main webview module's markdown-relevant definitions section and
`initEditor`.

**Parent spec:** spec-extension-factory.md

---

### Ticket 3b: EditorSession flags become named behavior (C4, part 2)

**Title:** EditorSession: flags become named behavior methods

**Blocked by:** Ticket 3a

**Size:** Fits one context window; worker reads spec-image-ledger.md and this ticket.

**What it delivers:** Session flags (`pendingEdit`, `inFlightEdit`, `renameInProgress`,
`exportInProgress`) are no longer written from the message handler table via closures.
They become private with behavior methods. Dispose order (#104) is preserved and tested.

**Acceptance criteria:**

- [ ] Session flags are private; the message handler table calls behavior methods
- [ ] Dispose order preserved: in-flight edit is awaited before disposed is set
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run verify:vscode-floor` runs once near the end and passes

**Ownership:** The session module and the message handler table.

**Parent spec:** spec-image-ledger.md

---

## Wave 2 (after C1 part 2 and C3 bugfix merge)

### Ticket 4: Extract content sync module (C2)

**Title:** Extract document synchronization state into a Content Sync module

**Blocked by:** Ticket 2b (Extension Factory part 2)

**Size:** Fits one context window; worker reads spec-content-sync.md and this ticket.

**What it delivers:** A Node-safe module that owns the sync state between webview and
host, with `postMessage` injected as a dependency. Production wires the real poster,
the harness wires a recorder.

**Acceptance criteria:**

- [ ] Sync state variables no longer at module scope in the main webview module;
      owned by the sync module
- [ ] Edit posting and debouncing are methods of the sync module
- [ ] Harness seam `content-sync-seam.ts` (coordinator-provided empty shell) filled
      with test cases:
      1. Type then undo within debounce window: no edit posted
      2. Document ending with alert (trailingNode): load does not post edit
      3. After a real post, baseline re-anchors
      4. Two rapid edits: only one edit posted (the last)
      5. Flush after pending debounce: edit posted immediately
- [ ] Teeth test: break baseline check in edit posting; seam goes red. Report how
      many cases fail
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run verify:vscode-floor` runs once near the end and passes

**Ownership (wave 2):** The sync state variables, edit posting, debouncing, flush,
editor content update, and the update handler in the main webview module.

**Parent spec:** spec-content-sync.md

---

### Ticket 5: Refactor image path translation module (C3 refactor)

**Title:** Consolidate webview image path translation into a single module

**Blocked by:** Ticket 1 (C3 bugfix)

**Size:** Fits one context window; worker reads spec-image-path-translation.md and this ticket.

**What it delivers:** A single Image Path Translation module that owns the image map,
version, cached reverse map, and all path transformation functions. Neither the main
webview module nor the image edit plugin holds map state. When the map changes from the
plugin, the reverse lookup sees the new path.

**Acceptance criteria:**

- [ ] Map state no longer at module scope in the main webview module
- [ ] The image edit plugin has no local map variable
- [ ] The repeated set-map-bump-version-sync-plugin pattern is replaced by single calls
- [ ] Reverse lookup uses resource-aware matching for percent-encoded URLs
- [ ] Harness seam `image-path-seam.ts` extended with module-level cases
- [ ] Teeth test: disable version bump in the module; seam goes red. Report how many
      cases fail
- [ ] `npm run roundtrip` passes
- [ ] `npm test` passes
- [ ] `npm run verify:vscode-floor` runs once near the end and passes

**Ownership (wave 2):** Same functions as Ticket 1 ownership.

**Parent spec:** spec-image-path-translation.md

---

## Dependency Graph

```
Wave 1 (parallel, 3 workers):
  Ticket 1  (C3 bugfix)      ──> Ticket 5  (C3 refactor)
  Ticket 2a (C1 factory/harness) ──> Ticket 2b (C1 factory/main) ──> Ticket 4 (C2 sync)
  Ticket 3a (C4 ledger)      ──> Ticket 3b (C4 session flags)
```

All three wave 1 tickets touch the main webview module (different functions, no logic
overlap). Import-line conflicts are expected and resolved by the coordinator at merge.
A LOGIC conflict means the ownership boundary is wrong.
