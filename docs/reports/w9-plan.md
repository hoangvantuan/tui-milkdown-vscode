# Wave 9 Architecture Planning Report

## Summary

Turned six architecture-review candidates into specs, ADR, and ready-for-agent
tickets via a grilling loop with the coordinator. Four candidates become five tickets
in two execution waves. Two speculative candidates are deferred with ADR-0001.

## Phase 0: Verification

All six candidates verified TRUE by reading source code. Key finding: candidate 3
lossy suspicion CONFIRMED by code tracing (imageMapVersion not bumped by the plugin
after rename response). One fact remains open: VS Code RPC ordering determines
whether the bug manifests as described or is masked. The floor probe (coordinator's
responsibility) will close this fact.

Evidence: `docs/plans/w9-architecture/00-verification.md`

## Phase 1-2: Grilling

One round of six questions. All settled in round 1:
- Q1: each candidate gets its own spec
- Q2: defer C5 + C6, one shared ADR
- Q3: skip verification ticket, bug fix leads wave
- Q4: two coordinator-provided seams (content-sync-seam.ts, image-path-seam.ts)
- Q5: two waves; wave 1 has 3 parallel tickets, wave 2 has 2 after C1 merge
- Q6: Extension factory, Content sync, Image path translation, Image ledger

## Phase 3: Domain Modeling

### ADR

`docs/adr/0001-defer-message-correlation-and-suggestion-dedup.md`

Defers candidates 5 and 6 with load-bearing reasons and reopening conditions.

### CONTEXT.md proposals

Four new terms proposed for CONTEXT.md (coordinator will apply after merge):

**Extension factory**:
Module that creates the array of markdown-relevant extensions shared by both the
production editor and the roundtrip harness. Separated from the main webview module
so that `acquireVsCodeApi` does not block harness import.
_Avoid_: shared extensions, common editor, extension builder

**Content sync**:
Module that owns the synchronization state between webview and host: body, frontmatter,
baseline, debounce, edit gate. Accepts `postMessage` as a dependency so the harness
can test through a recorder.
_Avoid_: sync module, state manager, document state

**Image path translation**:
Webview-side module that owns the image map, version counter, cached reverse map, and
the two transform functions (`transformForDisplay`, `transformForSave`). Translates
relative paths to webview URIs for display and back for save.
_Avoid_: image registry, image cache, image map

**Image ledger**:
Host-side module that owns the per-document record of original image paths, detects
renames and deletes on save, and enforces the rule "replace the map synchronously
before any async prompt".
_Avoid_: image manager, rename handler, image tracker

Note on "seam": the specs use "harness seam" for files under `harness/*-seam.ts` and
plain "seam" for the design concept (per codebase-design vocabulary), consistent with
CANDIDATES.md.

## Phase 4: Specs and Tickets

### Specs

| File | Candidate | Blocked by |
|------|-----------|------------|
| spec-extension-factory.md | C1 | None |
| spec-content-sync.md | C2 | C1 |
| spec-image-map-bugfix.md | C3 bugfix | None |
| spec-image-path-translation.md | C3 refactor | C3 bugfix |
| spec-image-ledger.md | C4 | None |

### Tickets

See `docs/plans/w9-architecture/tickets.md` for full acceptance criteria.

| # | Title | Wave | Blocked by | GitHub |
|---|-------|------|------------|--------|
| 1 | Fix lossy image path after double-click rename | 1 | None | TBD |
| 2 | Extract extension factory | 1 | None | TBD |
| 3 | Extract image ledger on host side | 1 | None | TBD |
| 4 | Extract content sync module | 2 | #2 | TBD |
| 5 | Consolidate image path translation module | 2 | #1 | TBD |

### Wave structure

```
Wave 1 (parallel, 3 workers):
  Ticket 1 (C3 bugfix)  ──> Ticket 5 (C3 refactor, wave 2)
  Ticket 2 (C1 factory)  ──> Ticket 4 (C2 sync, wave 2)
  Ticket 3 (C4 ledger)      (independent)
```

### Ownership boundaries (wave 1)

- **Ticket 1 (C3 bugfix)**: currentImageMap, imageMapVersion, cachedReverseImageMap,
  replaceImagePaths, transformForDisplay, transformForSave, setImageMap in main webview
  module; all of image-edit-plugin.
- **Ticket 2 (C1 factory)**: all markdown-relevant definitions (12 items listed in
  spec), initEditor, harness editor module.
- **Ticket 3 (C4 ledger)**: all host modules, provider, image-rename-handler utility.

Import-line conflicts expected, resolved by coordinator at merge. Logic conflict
means boundary is wrong.

## Items not verified by automated test

- C3 lossy bug: floor probe (coordinator's responsibility) will determine if the bug
  manifests on develop. If the probe does not go red, the ticket pivots to
  "record why + refactor".

## Coordinator actions before execution

1. Add floor probe for double-click rename to `run.mjs`
2. Commit empty shells: `harness/content-sync-seam.ts`, `harness/image-path-seam.ts`
   with golden registration in `harness/roundtrip.ts`
3. Cut worktrees for wave 1 workers (3 worktrees from develop + these commits)
4. Apply CONTEXT.md terms (post-merge)
