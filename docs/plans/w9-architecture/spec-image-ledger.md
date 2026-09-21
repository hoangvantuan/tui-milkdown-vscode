# Spec: Image Ledger (Candidate 4)

## Problem Statement

The host-side image path management is spread across five files with a structural
rule repeated at every call site:

1. `markdownEditorProvider.ts` (lines 78-82, 106, 112, 141): holds
   `originalImagePaths` as a `Map<string, Map<string, string>>`, passes it with
   `docKey` to every handler.
2. `session.ts` (lines 95-162): `applyEdit` reads the inner map, detects renames,
   mutates the map during an `await`, reverts on failure.
3. `documentSave.ts` (lines 66-69): REPLACES the inner map synchronously on every
   save, before the delete prompt's `await`.
4. `requestImageRename.ts`: receives the outer map + docKey + closure for
   `setPendingEdit`, manipulates the inner map after async rename.
5. `messageHandlers.ts` (lines 88, 200-210, 259-268): writes `session.inFlightEdit`,
   `session.pendingEdit`, `session.exportInProgress` from outside the class via
   closures.

AGENTS.md documents the trap: "always pass the outer map + docKey, never the inner
map" and says "no automated check catches this". Three session flags are written from
outside the class, contradicting the header comment that argues about their
interdependence.

## Solution

An Image Ledger module for each document, held by the provider keyed by docKey. The
ledger owns the inner map and exposes behaviour:
- `setBaseline(text, uri)`: (re)builds the inner map from document text. Called on
  open and on every save (synchronously, before any async work).
- `detectRenames(newContent)`: returns rename pairs by comparing new paths against
  the baseline.
- `applyRenames(renames)`: executes renames, updates the map, reverts on failure.
- `dispose()`: removes this document's entry.

Session flags (`pendingEdit`, `inFlightEdit`, `renameInProgress`, `exportInProgress`)
become private to the session with behaviour methods:
- `withPendingEdit(fn)`: sets flag, runs fn, clears on microtask.
- `withExportLock(fn)`: guards against concurrent exports.

## User Stories

1. As a maintainer, I want the "outer map + docKey" rule enforced by the module
   interface, so that a new handler cannot accidentally capture the inner map
2. As a maintainer, I want session flags to be private, so that a handler cannot
   set them without going through the session's contract
3. As a maintainer, I want the "replace map synchronously before prompt" rule
   enforced by the ledger's `setBaseline`, not by a comment

## Implementation Decisions

- The ledger lives under `src/host/` (Node-side only).
- `originalImagePaths` map is replaced by a `Map<string, ImageLedger>` held by the
  provider.
- The provider creates a ledger on `resolveCustomTextEditor` and disposes it on
  panel close.
- `requestImageRename.ts` receives the ledger, not the raw map + docKey + closure.
- `messageHandlers.ts` calls session methods instead of writing flags directly.
- `documentSave.ts` calls `ledger.setBaseline()` instead of `originalImagePaths.set()`.

## Testing Decisions

- **Unit tests** (in `test/`): the ledger is pure Node code, no VS Code API needed.
  Test cases:
  1. `setBaseline` then `detectRenames` with a path change: returns the rename
  2. `setBaseline` after save: old inner map is discarded
  3. Two concurrent `applyRenames` calls: second is rejected (renameInProgress)
- **Teeth test**: break `setBaseline` (e.g., skip the map replacement). Rename
  detection must fail. Report how many cases fail.
- Existing roundtrip and seam tests must remain green (host-side changes do not
  affect roundtrip; CRLF seam tests host-side normalization and must stay green).
- No new harness seam needed: the ledger is unit-testable directly.

## Out of Scope

- The webview-side image map (candidate 3).
- The HTML template extraction from the provider (a pure move, not deepening).
- The message protocol (candidate 5).

## Further Notes

- The `dispose` order in `EditorSession` (#104) is load-bearing: `inFlightEdit`
  must be awaited before `isDisposed` is set. The ledger's `dispose` is called from
  the session's dispose, after the in-flight edit settles.
- Two panels can open the same document. The provider must share one ledger per docKey,
  not per session. This is the current behaviour and must be preserved.
