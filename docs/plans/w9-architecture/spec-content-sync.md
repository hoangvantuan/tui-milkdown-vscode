# Spec: Content Sync Module (Candidate 2)

_Blocked by: Candidate 1 (Extension Factory) must merge first._

## Problem Statement

The webview's document synchronization state, the set of variables that track "what
the host is holding" and "what the webview has promised", lives as nine flat `let`
declarations at module scope in `main.ts` (lines 328-374). These variables
(`currentBody`, `currentFrontmatter`, `currentFormat`, `currentRawBlock`,
`contentBaseline`, `lastSentState`, `isUpdatingFromExtension`, `debounceTimer`,
`blobRetryCount`) are read and written together, but their invariants are maintained
by convention. The invariant "baseline equals what the host holds" has no enforcing
code: the `#111` bug class (edit ghost dirtying file) was only caught by floor check,
and floor check has no probe for the sync state machine.

`isUpdatingFromExtension` has two microtask latches (main.ts lines 465/474 and
2101/2194) in separate code paths that must behave identically. `currentBody` has
three conditional writes and one unconditional write (line 657 in
`replaceImageUrlWithSavedPath`).

## Solution

Extract the sync state and its mutation functions into a module that accepts a
`postMessage` function as a dependency. Production wires `vscode.postMessage`, the
harness wires a recorder. The module owns: `currentBody`, `currentFrontmatter`,
`currentFormat`, `currentRawBlock`, `contentBaseline`, `lastSentState`,
`isUpdatingFromExtension`, `debounceTimer`, `blobRetryCount`, and the functions
`postEdit`, `resetContentBaseline`, `debouncedPostEdit`, `flushPendingEdit`,
`serializeEditorBody`, `buildContent`, `serializeStateForEcho`.

The module's interface is small: `applyHostUpdate(content, imageMap)`,
`scheduleEdit()`, `flushEdit()`, `guardExtensionUpdate(fn)`, and a way to
read/write `currentBody` for callers that need it (image save, metadata edit).

## User Stories

1. As a maintainer, I want the "baseline equals host" invariant enforced by one
   module, so that a new code path cannot violate it by omitting a variable update
2. As a harness author, I want to test "type then undo within a debounce window does
   not post an edit" without launching VS Code, so that the sync contract is covered
3. As a parallel-wave worker, I want the sync state to have a clear interface, so that
   touching `postEdit` does not require understanding nine interlocked variables

## Implementation Decisions

- The module is Node-safe (after C1 removes `acquireVsCodeApi` from the import path).
- `postMessage` is injected, not imported. Production: `vscode.postMessage`. Harness:
  a recorder that captures messages for assertion.
- The module does NOT own the editor instance or ProseMirror state. It receives
  serialized content from callers.
- `isUpdatingFromExtension` becomes an internal detail: the module exposes
  `guardExtensionUpdate(fn)` which sets the flag, runs `fn` (dispatches a
  transaction), and clears it in a microtask.
- The module does NOT own the image map (candidate 3's territory). It accepts the
  map as a parameter to `transformForSave`.

## Testing Decisions

- **Harness seam**: `content-sync-seam.ts` (coordinator will commit the empty shell
  and golden registration before worktree cut). Worker fills in test cases and golden.
  Mandatory cases:
  1. Type then undo within a debounce window: no `edit` posted
  2. Document ending with an alert (trailingNode appends paragraph): load does not
     post an `edit`
  3. After a real post, `contentBaseline` re-anchors to the posted content
  4. Two rapid edits: only one `edit` posted (the last)
  5. `flushEdit` after a pending debounce: `edit` posted immediately
- **Teeth test**: break `postEdit` (e.g., remove the baseline check). Seam must go
  red. Report how many cases fail.
- Existing roundtrip fixtures must remain green.

## Out of Scope

- The image map state (candidate 3).
- The metadata panel editing (it calls into `currentFrontmatter` but its own state
  is separate).
- The `case "update"` handler logic (it becomes a caller of the sync module, but
  its 120 lines of DOM/editor wiring stay in main.ts).

## Further Notes

- This candidate is explicitly BLOCKED by candidate 1. The sync module must be
  importable by the harness, which requires `acquireVsCodeApi` to be out of the
  import path. Candidate 1 achieves this by moving markdown definitions out of
  main.ts.
- The microtask pattern for `isUpdatingFromExtension` is load-bearing: ProseMirror's
  `dispatchTransaction` is synchronous, but the `onUpdate` callback fires within the
  same microtask. The guard must be cleared on the NEXT microtask, not synchronously.
