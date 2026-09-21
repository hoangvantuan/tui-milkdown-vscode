/**
 * `requestImageRename`: rename an image file on disk, rewrite the one reference
 * in this document, and fix the references in the rest of the workspace.
 *
 * Two details are load-bearing and were preserved verbatim from the switch this
 * came out of:
 *
 * - The function is synchronous up to the point it fires an async IIFE, and it
 *   does not await it. The webview gets its `imageRenameResponse` from inside
 *   that IIFE, not from the message handler returning.
 * - Writing the document sets `pendingEdit` and clears it in a `queueMicrotask`
 *   WITHOUT calling `updateWebview()`. That differs from `applyEdit`, which does
 *   push a fresh imageMap; here the webview already knows the new path, since it
 *   is the side that asked for the rename.
 *
 * The ledger receives `updateEntry` after a successful rename, replacing the
 * old "get inner map, delete, set" pattern.
 */
import * as vscode from "vscode";
import type { RequestImageRenameMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";
import {
  updateWorkspaceReferences,
  hasPathTraversal,
} from "../utils/image-rename-handler";
import type { ImageLedger } from "./imageLedger";

export function handleRequestImageRename(
  msg: RequestImageRenameMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  ledger: ImageLedger,
  withPendingEdit: <T>(action: () => Promise<T>) => Promise<T>,
): void {
  const renameMsg = msg;
  if (!renameMsg.renameId || !renameMsg.oldPath || !renameMsg.newPath) return;

  const { renameId, oldPath, newPath } = renameMsg;

  // Security: Validate paths to prevent path traversal attacks
  if (hasPathTraversal(oldPath) || hasPathTraversal(newPath)) {
    console.error("[Image Rename] Path traversal detected:", { oldPath, newPath });
    webview.postMessage({
      type: "imageRenameResponse",
      renameId,
      success: false,
      newPath,
    });
    vscode.window.showErrorMessage("Invalid path: path traversal detected");
    return;
  }

  (async () => {
    try {
      // Resolve paths
      const documentFolder = vscode.Uri.joinPath(document.uri, "..");
      const oldUri = vscode.Uri.joinPath(documentFolder, oldPath);
      const newUri = vscode.Uri.joinPath(documentFolder, newPath);

      // Create parent directory if not exists
      const newDir = vscode.Uri.joinPath(documentFolder, newPath, "..");
      try {
        await vscode.workspace.fs.createDirectory(newDir);
      } catch {
        // Directory may already exist
      }

      // Execute rename
      await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });

      // Update document content with new path
      const currentText = document.getText();
      // Escape regex special chars and use context-aware replacement
      const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match in markdown image/link contexts: ![...](...) or <img src="...">
      const updatedText = currentText.replace(
        new RegExp(`(\\]\\(|src=["'])${escapedOld}([)"'])`, "g"),
        `$1${newPath}$2`
      );
      if (updatedText !== currentText) {
        await withPendingEdit(async () => {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(currentText.length),
          );
          edit.replace(document.uri, fullRange, updatedText);
          await vscode.workspace.applyEdit(edit);
        });
      }

      // Update ledger baseline
      ledger.updateEntry(oldPath, newPath, newUri.fsPath);

      // Build webviewUri for new path
      const webviewUri = webview.asWebviewUri(newUri).toString();

      // Send success response
      webview.postMessage({
        type: "imageRenameResponse",
        renameId,
        success: true,
        newPath,
        webviewUri,
      });

      // Update workspace references
      await updateWorkspaceReferences([{
        oldRelative: oldPath,
        newRelative: newPath,
        oldAbsolute: oldUri.fsPath,
        newAbsolute: newUri.fsPath,
      }], document.uri);

    } catch (err) {
      console.error("[Image Rename] Failed:", err);
      webview.postMessage({
        type: "imageRenameResponse",
        renameId,
        success: false,
        newPath,
      });
      vscode.window.showWarningMessage(
        `Failed to rename image: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}
