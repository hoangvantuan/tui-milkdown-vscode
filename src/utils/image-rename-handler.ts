import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Represents an image rename operation detected from path changes.
 */
export interface ImageRename {
  oldRelative: string; // Original relative path in markdown
  newRelative: string; // New relative path in markdown
  oldAbsolute: string; // Source file absolute path
  newAbsolute: string; // Target file absolute path
}

/**
 * Normalize path separators for cross-platform comparison.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Check if resolved path is within allowed directory (prevents path traversal).
 */
function isPathWithinDir(resolvedPath: string, allowedDir: string): boolean {
  const normalized = path.resolve(resolvedPath);
  const normalizedDir = path.resolve(allowedDir);
  return normalized.startsWith(normalizedDir + path.sep) || normalized === normalizedDir;
}

/**
 * Check if path contains traversal patterns.
 */
function hasPathTraversal(p: string): boolean {
  return p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p);
}

/**
 * Detect image renames by comparing original paths with current paths.
 * Only detects renames within the same folder (different filename, same directory).
 */
export function detectImageRenames(
  originalPaths: Map<string, string>,
  currentPaths: string[],
  documentUri: vscode.Uri,
): ImageRename[] {
  try {
    const renames: ImageRename[] = [];
    const docDir = path.dirname(documentUri.fsPath);
    const seenOldPaths = new Set<string>(); // Dedupe by source path
    const seenNewPaths = new Set<string>(); // Dedupe by target path

    for (const currentPath of currentPaths) {
      // Normalize for comparison
      const normalizedCurrent = normalizePath(currentPath);

      // Skip if current path exists in original (no rename)
      const hasOriginal = [...originalPaths.keys()].some(
        (k) => normalizePath(k) === normalizedCurrent,
      );
      if (hasOriginal) continue;

      // Security: Skip paths with traversal patterns
      if (hasPathTraversal(currentPath)) continue;

      const currentDir = normalizePath(path.dirname(currentPath));
      const currentFilename = path.basename(currentPath);

      for (const [origRelative, origAbsolute] of originalPaths) {
        // Skip already processed
        if (seenOldPaths.has(origAbsolute)) continue;

        const origDir = normalizePath(path.dirname(origRelative));
        const origFilename = path.basename(origRelative);

        // Same folder, different filename = rename
        if (currentDir === origDir && currentFilename !== origFilename) {
          // Verify source file exists
          if (fs.existsSync(origAbsolute)) {
            const newAbsolute = path.resolve(docDir, currentPath);

            // Security: Verify target is within document directory
            if (!isPathWithinDir(newAbsolute, docDir)) continue;

            // Skip if target already used (prevent multiple → one overwrite)
            if (seenNewPaths.has(newAbsolute)) continue;

            renames.push({
              oldRelative: origRelative,
              newRelative: currentPath,
              oldAbsolute: origAbsolute,
              newAbsolute: newAbsolute,
            });
            seenOldPaths.add(origAbsolute);
            seenNewPaths.add(newAbsolute);
            break; // One source maps to one target
          }
        }
      }
    }

    return renames;
  } catch (err) {
    console.error("[Image Rename] Detection failed:", err);
    return [];
  }
}

/**
 * Show confirmation dialog for image renames.
 * Returns selected renames or undefined if cancelled.
 */
export async function showRenameConfirmation(
  renames: ImageRename[],
): Promise<ImageRename[] | undefined> {
  const items = renames.map((r) => ({
    label: `$(file) ${path.basename(r.oldRelative)}`,
    description: `→ ${path.basename(r.newRelative)}`,
    detail: path.dirname(r.oldRelative) || ".",
    rename: r,
    picked: true,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "Rename Image Files?",
    placeHolder: "Select files to rename (ESC to cancel)",
  });

  if (!selected || selected.length === 0) return undefined;
  return selected.map((s) => s.rename);
}

/**
 * Execute image renames on disk with conflict handling.
 */
export async function executeImageRenames(renames: ImageRename[]): Promise<{
  succeeded: ImageRename[];
  failed: Array<{ rename: ImageRename; error: string }>;
}> {
  const succeeded: ImageRename[] = [];
  const failed: Array<{ rename: ImageRename; error: string }> = [];

  for (const rename of renames) {
    try {
      const sourceUri = vscode.Uri.file(rename.oldAbsolute);
      const targetUri = vscode.Uri.file(rename.newAbsolute);

      // Check if target exists
      try {
        await vscode.workspace.fs.stat(targetUri);
        // Target exists - ask user
        const action = await vscode.window.showWarningMessage(
          `File "${path.basename(rename.newAbsolute)}" already exists.`,
          "Overwrite",
          "Skip",
        );
        if (action !== "Overwrite") {
          failed.push({ rename, error: "Skipped - target exists" });
          continue;
        }
      } catch {
        // Target doesn't exist - OK to proceed
      }

      // Execute rename
      await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: true });
      succeeded.push(rename);
    } catch (err) {
      failed.push({
        rename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { succeeded, failed };
}

/**
 * Update image references in all markdown files within workspace.
 */
export async function updateWorkspaceReferences(
  renames: ImageRename[],
  excludeUri?: vscode.Uri,
): Promise<number> {
  const mdFiles = await vscode.workspace.findFiles(
    "**/*.md",
    "**/node_modules/**",
  );
  let updatedCount = 0;

  for (const fileUri of mdFiles) {
    // Skip current document (already has new paths)
    if (excludeUri && fileUri.toString() === excludeUri.toString()) continue;

    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      let text = Buffer.from(content).toString("utf8");
      let modified = false;

      for (const rename of renames) {
        const oldRef = rename.oldRelative;
        const newRef = rename.newRelative;

        if (text.includes(oldRef)) {
          text = text.split(oldRef).join(newRef);
          modified = true;
        }
      }

      if (modified) {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, "utf8"));
        updatedCount++;
      }
    } catch (err) {
      console.error(`[Image Rename] Failed to update ${fileUri.fsPath}:`, err);
    }
  }

  return updatedCount;
}
