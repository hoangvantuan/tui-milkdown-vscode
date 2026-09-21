# Wave 9 Architecture Planning Report

## Summary

Turned six architecture-review candidates into specs, ADR, and ready-for-agent
tickets via a grilling loop with the coordinator. Four candidates become seven tickets
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
- Q5: two waves; wave 1 has 3 parallel tickets, wave 2 after blockers merge
- Q6: Extension factory, Content sync, Image path translation, Image ledger

## Phase 3: Domain Modeling

### ADR

`docs/adr/0001-defer-message-correlation-and-suggestion-dedup.md`

Defers candidates 5 and 6 with load-bearing reasons and reopening conditions.

### Proposals for CONTEXT.md

Four new terms. To be applied by the coordinator after merge.

**Extension factory**:
The one place that decides which markdown rules the editor knows. Both the rich text
view and the roundtrip harness build their editor from it, so a rule changed in one
place is tested and shipped as the same rule.
_Avoid_: shared extensions, common editor, extension builder

**Content sync**:
What the host holds versus what the rich text view has promised. Owns the baseline,
the debounce, and the gate that prevents an edit from being posted when the document
has not actually changed.
_Avoid_: sync module, state manager, document state

**Image path translation**:
The bridge between the path written in the Markdown file and the address the rich text
view displays. Translates relative paths to webview URIs for display, and back for save.
_Avoid_: image registry, image cache, image map

**Image ledger**:
The host's record of which images a document referenced when it was last saved.
Detects renames and deletes on save, and owns the rule that the record is replaced
synchronously before any async prompt.
_Avoid_: image manager, rename handler, image tracker

Note on "seam": the specs use "harness seam" for files under `harness/*-seam.ts` and
plain "seam" for the design concept (per codebase-design vocabulary), consistent with
CANDIDATES.md.

## Phase 4: Specs and Tickets

### Specs

| File | Candidate | Blocked by |
|------|-----------|------------|--------|
| spec-extension-factory.md | C1 | None | #137 |
| spec-content-sync.md | C2 | C1 | #138 |
| spec-image-map-bugfix.md | C3 bugfix | None | #139 |
| spec-image-path-translation.md | C3 refactor | C3 bugfix | #140 |
| spec-image-ledger.md | C4 | None | #141 |

### Tickets

See `docs/plans/w9-architecture/tickets.md` for full acceptance criteria.

| # | Title | Wave | Blocked by | GitHub |
|---|-------|------|------------|--------|
| 1 | Fix lossy image path after double-click rename | 1 | None | #142 |
| 2a | Extension factory: harness first | 1 | None | #143 |
| 3a | Image ledger module | 1 | None | #144 |
| 2b | Extension factory: main.ts switches | after 2a | 2a | #145 |
| 3b | EditorSession flags become named behavior | after 3a | 3a | #146 |
| 5 | Consolidate image path translation module | 2 | 1 | #147 |
| 4 | Extract content sync module | 2 | 2b | #148 |

### Wave structure

```
Wave 1 (parallel, 3 workers):
  Ticket 1  (C3 bugfix)           ──> Ticket 5  (C3 refactor)
  Ticket 2a (C1 factory/harness)  ──> Ticket 2b (C1 factory/main) ──> Ticket 4 (C2 sync)
  Ticket 3a (C4 ledger)           ──> Ticket 3b (C4 session flags)
```

### Ownership boundaries (wave 1)

- **Ticket 1 (C3 bugfix)**: currentImageMap, imageMapVersion, cachedReverseImageMap,
  replaceImagePaths, transformForDisplay, transformForSave, setImageMap in the main
  webview module; all of image-edit-plugin.
- **Ticket 2a (C1 factory/harness)**: the new factory module and the harness editor
  module.
- **Ticket 3a (C4 ledger)**: the new ledger module, the provider, document-save
  handler, rename handler, image-rename-handler utility.

Import-line conflicts expected, resolved by coordinator at merge. Logic conflict
means boundary is wrong.

## Items not verified by automated test

- C3 lossy bug: floor probe (coordinator's responsibility) will determine if the bug
  manifests on develop. If the probe does not go red, ticket 1 pivots to "record why
  + refactor" (fallback documented in the ticket).

## Blocking edge verification

```
#145 (2b): {"blocked_by":1,"blocking":1,"total_blocked_by":1,"total_blocking":1}
#146 (3b): {"blocked_by":1,"blocking":0,"total_blocked_by":1,"total_blocking":0}
#147 (5):  {"blocked_by":1,"blocking":0,"total_blocked_by":1,"total_blocking":0}
#148 (4):  {"blocked_by":1,"blocking":0,"total_blocked_by":1,"total_blocking":0}
```

## Coordinator actions before execution

1. Add floor probe for double-click rename to `run.mjs`
2. Commit empty shells: `harness/content-sync-seam.ts`, `harness/image-path-seam.ts`
   with golden registration in `harness/roundtrip.ts`
3. Cut worktrees for wave 1 workers (3 worktrees from develop + these commits)
4. Apply CONTEXT.md terms (post-merge)
