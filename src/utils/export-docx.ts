import * as vscode from "vscode";
import * as path from "path";

/**
 * Export markdown content to DOCX file.
 * Uses @m2d/md2docx for conversion (remark-based pipeline).
 *
 * This module is bundled as a separate file (out/export-docx.js) and
 * lazy-loaded on demand to keep the main extension.js small.
 */
export async function exportToDocx(
  markdown: string,
  documentUri: vscode.Uri,
  fontFamily?: string,
): Promise<void> {
  const docName = path.basename(documentUri.fsPath, path.extname(documentUri.fsPath));
  const defaultUri = vscode.Uri.joinPath(
    vscode.Uri.joinPath(documentUri, ".."),
    `${docName}.docx`,
  );

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Word Document": ["docx"] },
    title: "Export as DOCX",
  });

  if (!saveUri) return; // User cancelled

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting DOCX…",
        cancellable: false,
      },
      async () => {
        const { md2docx } = await import("@m2d/md2docx");

        const docxProps: Record<string, unknown> = { title: docName };

        // Apply user's font preference as default document font
        if (fontFamily) {
          docxProps.styles = {
            default: {
              document: {
                run: { font: fontFamily },
              },
            },
          };
        }

        const result = await md2docx(
          markdown,
          docxProps,
          {},
          "uint8array",
        );

        const buffer = Buffer.from(result as Uint8Array);
        await vscode.workspace.fs.writeFile(saveUri, buffer);
      },
    );

    const openAction = await vscode.window.showInformationMessage(
      `Exported: ${path.basename(saveUri.fsPath)}`,
      "Open File",
      "Open Folder",
    );

    if (openAction === "Open File") {
      vscode.env.openExternal(saveUri);
    } else if (openAction === "Open Folder") {
      const folder = vscode.Uri.joinPath(saveUri, "..");
      vscode.env.openExternal(folder);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
    console.error("[Export DOCX]", err);
  }
}
