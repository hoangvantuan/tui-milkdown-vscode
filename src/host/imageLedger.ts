/**
 * Image ledger: one per document (keyed by docKey in the provider).
 *
 * Owns the baseline map of image paths (relative path to absolute fs path)
 * that rename and delete detection compare against. The old design threaded
 * the outer `Map<string, Map<string, string>>` plus `docKey` to every handler,
 * and AGENTS.md documented the trap: "always pass the outer map + docKey,
 * never the inner map", with no automated check. The ledger replaces that
 * with a module whose interface makes the trap impossible.
 *
 * Key invariants:
 *
 * - `setBaseline` rebuilds the inner map from document text. On save, this
 *   MUST be the FIRST thing, synchronous, before any `await` that can block
 *   on the user (#126). The ledger enforces this by making the map private.
 *
 * - `detectRenames` compares new paths against the baseline and returns
 *   rename pairs. It does not mutate the map.
 *
 * - `applyRenames` coordinates optimistic baseline update, disk rename
 *   execution, failure rollback, and rename lock release.
 *
 * - `renameInProgress` prevents two overlapping rename batches from racing.
 *   `acquireRenameLock` / `releaseRenameLock` and `applyRenames` manage this.
 *
 * - Two panels can open the same document. The provider shares one ledger per
 *   docKey, not per session.
 */
import type * as vscode from "vscode";
import {
  extractImagePaths,
  isRemoteUrl,
  buildOriginalImageMap,
} from "./imagePaths";
import {
  detectImageRenames as detectImageRenamesRaw,
  detectImageDeletes as detectImageDeletesRaw,
  executeImageRenames,
  type ImageRename,
  type ImageDelete,
} from "../utils/image-rename-handler";

export class ImageLedger {
  /** The baseline: normalized relative path to absolute fs path. */
  private baseline: Map<string, string>;

  /** Guard against two overlapping rename batches. */
  private _renameInProgress = false;

  /** Active in-flight renames being executed asynchronously. */
  private inFlightRenames = new Map<string, ImageRename>();

  constructor(content: string, documentUri: vscode.Uri) {
    this.baseline = buildOriginalImageMap(content, documentUri);
  }

  // ---------------------------------------------------------------------------
  // Baseline management
  // ---------------------------------------------------------------------------

  /**
   * Replace the baseline from the current document text.
   *
   * On save this MUST be called FIRST, synchronously, before any `await`
   * that can block on the user (#126). The caller holds a local reference
   * to the OLD baseline for detection; the new baseline is already in place
   * so a save that arrives while a prompt is open will diff against the
   * fresh state.
   *
   * Returns the OLD baseline so the caller can detect deletions against it.
   */
  setBaseline(content: string, documentUri: vscode.Uri): Map<string, string> {
    const old = this.baseline;
    this.baseline = buildOriginalImageMap(content, documentUri);
    // If any renames are currently in-flight, ensure they remain reflected in the new baseline
    for (const rename of this.inFlightRenames.values()) {
      this.baseline.delete(rename.oldRelative);
      this.baseline.set(rename.newRelative, rename.newAbsolute);
    }
    return old;
  }

  /**
   * Read-only snapshot of the current baseline for external inspection.
   * The caller MUST NOT mutate the returned map.
   */
  getBaseline(): ReadonlyMap<string, string> {
    return this.baseline;
  }

  // ---------------------------------------------------------------------------
  // Rename detection & execution
  // ---------------------------------------------------------------------------

  /**
   * Compare new content paths against the baseline and return rename pairs.
   * Does not mutate the baseline.
   */
  detectRenames(
    newContent: string,
    documentUri: vscode.Uri,
  ): ImageRename[] {
    const newPaths = extractImagePaths(newContent).filter(
      (p) => !isRemoteUrl(p),
    );
    return detectImageRenamesRaw(this.baseline, newPaths, documentUri);
  }

  /**
   * Execute renames: acquire lock, optimistically update baseline, run executor,
   * rollback failures, and release lock.
   * Returns null if another rename is already in progress.
   */
  async applyRenames(
    renames: ImageRename[],
    executor: (renames: ImageRename[]) => Promise<{
      succeeded: ImageRename[];
      failed: Array<{ rename: ImageRename; error: string }>;
    }> = executeImageRenames,
  ): Promise<{
    succeeded: ImageRename[];
    failed: Array<{ rename: ImageRename; error: string }>;
  } | null> {
    if (!this.acquireRenameLock()) {
      return null;
    }
    try {
      // Optimistic locking: update map BEFORE async rename to prevent race conditions
      const originalValues = new Map<string, string | undefined>();
      for (const rename of renames) {
        this.inFlightRenames.set(rename.newRelative, rename);
        originalValues.set(
          rename.oldRelative,
          this.applyRenameToBaseline(rename),
        );
      }

      const result = await executor(renames);

      // Revert failed renames in baseline
      if (result.failed.length > 0) {
        for (const { rename } of result.failed) {
          this.inFlightRenames.delete(rename.newRelative);
          this.revertRenameInBaseline(
            rename,
            originalValues.get(rename.oldRelative),
          );
        }
      }

      for (const rename of result.succeeded) {
        this.inFlightRenames.delete(rename.newRelative);
      }

      return result;
    } finally {
      this.inFlightRenames.clear();
      this.releaseRenameLock();
    }
  }

  /**
   * After a rename succeeds on disk, update the baseline to reflect it.
   * Returns the old value so the caller can revert on failure.
   */
  applyRenameToBaseline(rename: ImageRename): string | undefined {
    const oldValue = this.baseline.get(rename.oldRelative);
    this.baseline.delete(rename.oldRelative);
    this.baseline.set(rename.newRelative, rename.newAbsolute);
    return oldValue;
  }

  /**
   * Revert a rename in the baseline after a disk failure.
   */
  revertRenameInBaseline(
    rename: ImageRename,
    oldValue: string | undefined,
  ): void {
    this.baseline.delete(rename.newRelative);
    if (oldValue !== undefined) {
      this.baseline.set(rename.oldRelative, oldValue);
    }
  }

  /**
   * Update a single entry after a requestImageRename (double-click rename).
   */
  updateEntry(oldPath: string, newPath: string, newAbsolute: string): void {
    this.baseline.delete(oldPath);
    this.baseline.set(newPath, newAbsolute);
  }

  // ---------------------------------------------------------------------------
  // Delete detection (used by handleDocumentSave)
  // ---------------------------------------------------------------------------

  /**
   * Detect deleted images by comparing an old baseline snapshot against
   * current paths. The caller passes the old baseline returned by
   * `setBaseline` (which has already replaced it).
   */
  detectDeletes(
    oldBaseline: Map<string, string>,
    currentPaths: string[],
  ): ImageDelete[] {
    return detectImageDeletesRaw(oldBaseline, currentPaths);
  }

  // ---------------------------------------------------------------------------
  // Rename lock
  // ---------------------------------------------------------------------------

  get renameInProgress(): boolean {
    return this._renameInProgress;
  }

  /**
   * Try to acquire the rename lock. Returns true if acquired, false if
   * another rename is already in progress.
   */
  acquireRenameLock(): boolean {
    if (this._renameInProgress) return false;
    this._renameInProgress = true;
    return true;
  }

  releaseRenameLock(): void {
    this._renameInProgress = false;
  }

  dispose(): void {
    this.baseline.clear();
    this.inFlightRenames.clear();
    this._renameInProgress = false;
  }
}
