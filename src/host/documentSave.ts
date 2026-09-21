/**
 * `onDidSaveTextDocument`: delete images the save dropped, then re-baseline.
 *
 * Save, not edit, is the moment for DELETE detection: while typing, a path can
 * be half-erased for a keystroke, and deleting the file then would destroy it
 * for a typo. RENAME detection deliberately does not live here, it moved into
 * `applyEdit` so a rename takes effect as the user types it.
 *
 * The ledger's `setBaseline` replaces the inner map synchronously, FIRST,
 * before anything that can await a human (#126). The old baseline is returned
 * so detection below diffs against the pre-save state. Because the new
 * baseline is already in place, a save that arrives while the delete prompt is
 * open will diff against the fresh state and detect nothing for that image.
 *
 * Two more consequences of that unbounded await, both measured in
 * `test/image-usage.test.ts`. Images nothing else references are trashed
 * BEFORE the prompt, so the common case keeps its old timing instead of
 * queueing behind a question about some other file. And the answer is
 * re-validated against a fresh `savedDoc.getText()`: the user can put the
 * image back and save again while the prompt is open, and that save detects
 * nothing, because the baseline was cleared on the way in.
 */
import * as vscode from "vscode";
import {
  executeImageDeletes,
  normalizePath,
  type ImageDelete,
} from "../utils/image-rename-handler";
import { populateImageUsage } from "./imageUsage";
import { extractImagePaths, isRemoteUrl } from "./imagePaths";
import type { ImageLedger } from "./imageLedger";

const DELETE_ANYWAY = "Delete Anyway";
const KEEP = "Keep";

export async function handleDocumentSave(
  savedDoc: vscode.TextDocument,
  document: vscode.TextDocument,
  ledger: ImageLedger,
): Promise<void> {
  if (savedDoc.uri.toString() !== document.uri.toString()) return;

  // Note: Image rename detection moved to applyEdit() for instant rename
  // This handler only handles delete detection and map rebuilding

  const config = vscode.workspace.getConfiguration("tuiMarkdown");

  // Get current paths (filter remote URLs)
  const currentPaths = extractImagePaths(savedDoc.getText()).filter(
    (p) => !isRemoteUrl(p),
  );

  // Re-baseline before any await that can block on the user. The OLD baseline
  // is returned so detection below diffs against the pre-save state.
  const oldBaseline = ledger.setBaseline(savedDoc.getText(), savedDoc.uri);

  if (oldBaseline.size === 0) return;
  if (!config.get<boolean>("autoDeleteImages", true)) return;

  // === Image Delete Detection ===
  const deletes = ledger.detectDeletes(oldBaseline, currentPaths);
  if (deletes.length === 0) return;

  // Only now is the workspace scan worth its cost: a findFiles plus a read per
  // markdown file, on the rare save that actually removed an image.
  await populateImageUsage(deletes, savedDoc.uri);

  const unreferenced = deletes.filter((d) => d.usedInFiles.length === 0);
  const stillUsed = deletes.filter((d) => d.usedInFiles.length > 0);

  // Unreferenced images keep the old behaviour exactly, INCLUDING the timing:
  // straight to the Trash, no confirmation, and not queued behind a prompt
  // about some other image that could sit open for minutes.
  const failed = await trash(unreferenced);

  if (stillUsed.length > 0 && (await confirmSharedDeletes(stillUsed))) {
    // Re-read the document AFTER the answer. The prompt has no deadline, and
    // `savedDoc` is live: the user can put the image back and save again while
    // it is open, and that save detects nothing because the baseline was
    // cleared on the way in. Without this the stale Yes would trash a file the
    // document references again.
    const current = new Set(
      extractImagePaths(savedDoc.getText()).map((p) => normalizePath(p)),
    );
    failed.push(
      ...(await trash(
        stillUsed.filter((d) => !current.has(normalizePath(d.relativePath))),
      )),
    );
  }

  if (failed.length > 0) {
    console.warn("[Image Delete] Failed:", failed);
    vscode.window.showWarningMessage(
      `Failed to delete ${failed.length} image(s).`,
    );
  }
}

async function trash(
  deletes: ImageDelete[],
): Promise<Array<{ path: string; error: string }>> {
  if (deletes.length === 0) return [];
  const { failed } = await executeImageDeletes(deletes);
  return failed;
}

/**
 * Ask before trashing images another document still renders.
 *
 * The only affirmative answer is the button. Dismissing the notification, or
 * an extension host that never answers one, resolves `undefined`, and that
 * has to mean KEEP: the whole point of #126 is that silence must not destroy
 * a file the user never touched.
 */
async function confirmSharedDeletes(stillUsed: ImageDelete[]): Promise<boolean> {
  const users = [...new Set(stillUsed.flatMap((d) => d.usedInFiles))];
  const [subject, object] =
    stillUsed.length === 1
      ? [`"${stillUsed[0].relativePath}" is`, "it"]
      : [`${stillUsed.length} images are`, "them"];
  // "Move to the Trash", not "delete": `executeImageDeletes` passes
  // `useTrash: true`, and the setting description makes the same promise.
  const choice = await vscode.window.showWarningMessage(
    `${subject} still used by ${formatFileList(users)}. Move ${object} to the Trash anyway?`,
    DELETE_ANYWAY,
    KEEP,
  );
  return choice === DELETE_ANYWAY;
}

function formatFileList(files: string[]): string {
  if (files.length <= 3) return files.join(", ");
  return `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`;
}
