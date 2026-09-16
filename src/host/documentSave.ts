/**
 * `onDidSaveTextDocument`: delete images the save dropped, then re-baseline.
 *
 * Save, not edit, is the moment for DELETE detection: while typing, a path can
 * be half-erased for a keystroke, and deleting the file then would destroy it
 * for a typo. RENAME detection deliberately does not live here — it moved into
 * `applyEdit` so a rename takes effect as the user types it.
 *
 * `originalImagePaths` is the whole per-document map plus the key, never the
 * inner map, because the last statement here REPLACES that inner map. Anything
 * holding a reference to the old one would quietly stop detecting.
 *
 * The rebuild at the end runs on both paths, including the early return: images
 * added during this session have to become deletable in the next one.
 */
import * as vscode from "vscode";
import {
  detectImageDeletes,
  executeImageDeletes,
} from "../utils/image-rename-handler";
import { extractImagePaths, isRemoteUrl, buildOriginalImageMap } from "./imagePaths";

export async function handleDocumentSave(
  savedDoc: vscode.TextDocument,
  document: vscode.TextDocument,
  docKey: string,
  originalImagePaths: Map<string, Map<string, string>>,
): Promise<void> {
  if (savedDoc.uri.toString() !== document.uri.toString()) return;

  // Note: Image rename detection moved to applyEdit() for instant rename
  // This handler only handles delete detection and map rebuilding

  const config = vscode.workspace.getConfiguration("tuiMarkdown");
  const originalMap = originalImagePaths.get(docKey);

  // Get current paths (filter remote URLs)
  const currentPaths = extractImagePaths(savedDoc.getText()).filter(
    (p) => !isRemoteUrl(p),
  );

  // Skip detection if no original paths, but still rebuild map at the end
  if (!originalMap || originalMap.size === 0) {
    originalImagePaths.set(
      docKey,
      buildOriginalImageMap(savedDoc.getText(), savedDoc.uri),
    );
    return;
  }

  // === Image Delete Detection ===
  if (config.get<boolean>("autoDeleteImages", true)) {
    const deletes = detectImageDeletes(originalMap, currentPaths);

    if (deletes.length > 0) {
      // Auto-delete without confirmation (moves to Trash)
      const { succeeded, failed } = await executeImageDeletes(deletes);

      if (succeeded.length > 0) {
        // Remove deleted paths from storage
        for (const path of succeeded) {
          originalMap.delete(path);
        }
      }

      if (failed.length > 0) {
        console.warn("[Image Delete] Failed:", failed);
        vscode.window.showWarningMessage(
          `Failed to delete ${failed.length} image(s).`,
        );
      }
    }
  }

  // Always rebuild originalImagePaths after save to capture newly added images
  // This ensures delete detection works for images added during editing session
  originalImagePaths.set(
    docKey,
    buildOriginalImageMap(savedDoc.getText(), savedDoc.uri),
  );
}
