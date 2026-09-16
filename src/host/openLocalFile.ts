/**
 * Opening a link target or an image in an ordinary VS Code tab.
 *
 * The path arrives from the webview, so the resolved target is checked against
 * the workspace folder (or, with no workspace, the document's own folder) and
 * refused when it escapes. An `#anchor` is split off first: it is part of the
 * link, not part of the filename.
 */
import * as path from "path";
import * as vscode from "vscode";

/**
 * Resolve a relative file path against the document's folder and open it in a
 * new VSCode editor tab. Validates the target stays within the workspace or
 * document directory. Shared by the openLink and openImageInTab handlers.
 */
export function openLocalFileInEditor(relativePath: string, document: vscode.TextDocument): void {
  const docDir = path.dirname(document.uri.fsPath);
  // Separate file path and anchor fragment
  const hashIndex = relativePath.indexOf("#");
  const filePart = hashIndex !== -1 ? relativePath.slice(0, hashIndex) : relativePath;
  const targetPath = filePart
    ? path.resolve(docDir, filePart)
    : document.uri.fsPath;

  // Security: Validate target is within workspace or document directory
  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const allowedRoot = wsFolder?.uri.fsPath || docDir;
  if (!targetPath.startsWith(allowedRoot + path.sep) && targetPath !== allowedRoot) {
    vscode.window.showWarningMessage(`Cannot open file outside workspace: ${filePart}`);
    return;
  }

  const targetUri = vscode.Uri.file(targetPath);
  vscode.commands.executeCommand("vscode.open", targetUri).then(
    undefined,
    () => vscode.window.showWarningMessage(`Cannot open file: ${relativePath}`)
  );
}
