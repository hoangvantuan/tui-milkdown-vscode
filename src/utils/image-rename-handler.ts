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
 * Normalize path for comparison.
 * - Replaces backslashes with forward slashes
 * - Removes leading ./ prefix
 * - Handles multiple consecutive slashes
 */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
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
 * Check if path contains traversal or absolute patterns.
 * Only allow relative paths for rename detection.
 * Note: Uses segment-aware ".." check to avoid false positives like "image..png"
 */
export function hasPathTraversal(p: string): boolean {
  // Block absolute paths (Unix and Windows)
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return true;
  // Block ".." only as standalone path segment (not in filenames like "image..png")
  const segments = p.split(/[\\/]/);
  return segments.some(seg => seg === "..");
}

/**
 * Detect image renames by comparing original paths with current paths.
 * Only detects renames within the same folder (different filename, same directory).
 *
 * IMPORTANT: Only considers original paths that have been REMOVED from document
 * as potential rename sources. This prevents false positives when pasting
 * multiple new images into the same folder.
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

    // Build set of normalized current paths for quick lookup
    const normalizedCurrentSet = new Set(
      currentPaths.map((p) => normalizePath(p)),
    );

    // Find original paths that have been REMOVED from document
    // Only these can be sources of rename operations
    const removedOriginals = new Map<string, string>();
    for (const [origRelative, origAbsolute] of originalPaths) {
      if (!normalizedCurrentSet.has(normalizePath(origRelative))) {
        removedOriginals.set(origRelative, origAbsolute);
      }
    }

    // No removed paths = no renames possible
    if (removedOriginals.size === 0) {
      return [];
    }

    for (const currentPath of currentPaths) {
      // Normalize for comparison
      const normalizedCurrent = normalizePath(currentPath);

      // Skip if current path exists in original (no rename)
      const hasOriginal = [...originalPaths.keys()].some(
        (k) => normalizePath(k) === normalizedCurrent,
      );
      if (hasOriginal) {
        continue;
      }

      // Security: Skip paths with traversal patterns
      if (hasPathTraversal(currentPath)) {
        continue;
      }

      const currentDir = normalizePath(path.dirname(currentPath));
      const currentFilename = path.basename(currentPath);

      // Only match with REMOVED original paths (not all originals)
      for (const [origRelative, origAbsolute] of removedOriginals) {
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

      // Create parent directory if not exists
      const targetDir = vscode.Uri.file(path.dirname(rename.newAbsolute));
      try {
        await vscode.workspace.fs.createDirectory(targetDir);
      } catch {
        // Directory may already exist
      }

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
          // Context-aware replacement: only in image/link references
          const escapedOld = oldRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const contextRegex = new RegExp(
            `(\\]\\(|src=["'])${escapedOld}([)"'])`,
            "g"
          );
          const newText = text.replace(contextRegex, `$1${newRef}$2`);
          if (newText !== text) {
            text = newText;
            modified = true;
          }
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

// ============================================================================
// Image Delete Detection & Execution
// ============================================================================

/**
 * Represents an image delete operation detected from path removal.
 */
export interface ImageDelete {
  relativePath: string; // Relative path in markdown
  absolutePath: string; // Absolute file path on disk
  usedInFiles: string[]; // Other files using this image (for warning)
}

/**
 * Detect deleted images by comparing original paths with current paths.
 * An image is considered deleted if it was in original but not in current.
 *
 * NOTE: If an image with the same filename exists in current paths but in a
 * different folder, it's considered a "move" operation and NOT deleted.
 * This prevents accidental deletion when user moves images to different folders.
 */
export function detectImageDeletes(
  originalPaths: Map<string, string>,
  currentPaths: string[],
): ImageDelete[] {
  try {
    const deletes: ImageDelete[] = [];
    const normalizedCurrentPaths = new Set(
      currentPaths.map((p) => normalizePath(p)),
    );
    // Build set of current filenames for "move" detection
    const currentFilenames = new Set(
      currentPaths.map((p) => path.basename(p).toLowerCase()),
    );

    for (const [origRelative, origAbsolute] of originalPaths) {
      const normalizedOrig = normalizePath(origRelative);

      // If original path not in current paths → potentially deleted
      if (!normalizedCurrentPaths.has(normalizedOrig)) {
        const origFilename = path.basename(origRelative).toLowerCase();

        // Check if same filename exists in different folder (move operation)
        if (currentFilenames.has(origFilename)) {
          continue;
        }

        // Verify file exists before suggesting delete
        if (fs.existsSync(origAbsolute)) {
          deletes.push({
            relativePath: origRelative,
            absolutePath: origAbsolute,
            usedInFiles: [], // Will be populated by caller
          });
        }
      }
    }

    return deletes;
  } catch (err) {
    console.error("[Image Delete] Detection failed:", err);
    return [];
  }
}

/**
 * Execute image deletes by moving files to trash.
 */
export async function executeImageDeletes(deletes: ImageDelete[]): Promise<{
  succeeded: string[];
  failed: Array<{ path: string; error: string }>;
}> {
  const succeeded: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const del of deletes) {
    try {
      const fileUri = vscode.Uri.file(del.absolutePath);

      // Move to trash (useTrash: true)
      await vscode.workspace.fs.delete(fileUri, { useTrash: true });
      succeeded.push(del.relativePath);
    } catch (err) {
      failed.push({
        path: del.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { succeeded, failed };
}
