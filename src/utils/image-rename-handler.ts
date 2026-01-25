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
 */
export function hasPathTraversal(p: string): boolean {
  // Block: parent traversal, absolute paths (Unix and Windows)
  return p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p);
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

    console.log("[Image Rename] Detecting renames...");
    console.log("[Image Rename] Original paths:", [...originalPaths.entries()]);
    console.log("[Image Rename] Current paths:", currentPaths);

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

    console.log("[Image Rename] Removed originals:", [...removedOriginals.entries()]);

    // No removed paths = no renames possible
    if (removedOriginals.size === 0) {
      console.log("[Image Rename] No removed paths, skipping rename detection");
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
        console.log("[Image Rename] Path unchanged:", currentPath);
        continue;
      }

      // Security: Skip paths with traversal patterns
      if (hasPathTraversal(currentPath)) {
        console.log("[Image Rename] Skipping path with traversal:", currentPath);
        continue;
      }

      const currentDir = normalizePath(path.dirname(currentPath));
      const currentFilename = path.basename(currentPath);
      console.log("[Image Rename] New path - dir:", currentDir, "filename:", currentFilename);

      // Only match with REMOVED original paths (not all originals)
      for (const [origRelative, origAbsolute] of removedOriginals) {
        // Skip already processed
        if (seenOldPaths.has(origAbsolute)) continue;

        const origDir = normalizePath(path.dirname(origRelative));
        const origFilename = path.basename(origRelative);
        console.log("[Image Rename] Comparing with removed - dir:", origDir, "filename:", origFilename);

        // Same folder, different filename = rename
        if (currentDir === origDir && currentFilename !== origFilename) {
          console.log("[Image Rename] Folder match! Checking if source exists:", origAbsolute);
          // Verify source file exists
          if (fs.existsSync(origAbsolute)) {
            console.log("[Image Rename] Source file exists, adding rename");
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
          // Escape regex special chars for safe replacement
          const escapedOld = oldRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          text = text.replace(new RegExp(escapedOld, "g"), newRef);
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

    console.log("[Image Delete] Detecting deletes...");
    console.log("[Image Delete] Original paths:", [...originalPaths.entries()]);
    console.log("[Image Delete] Current paths:", currentPaths);
    console.log("[Image Delete] Normalized current paths:", [...normalizedCurrentPaths]);

    for (const [origRelative, origAbsolute] of originalPaths) {
      const normalizedOrig = normalizePath(origRelative);
      console.log("[Image Delete] Checking:", origRelative, "→ normalized:", normalizedOrig);

      // If original path not in current paths → potentially deleted
      if (!normalizedCurrentPaths.has(normalizedOrig)) {
        const origFilename = path.basename(origRelative).toLowerCase();

        // Check if same filename exists in different folder (move operation)
        if (currentFilenames.has(origFilename)) {
          console.log("[Image Delete] Same filename found in different folder, skipping (move):", origRelative);
          continue;
        }

        console.log("[Image Delete] Path not in current, checking file exists:", origAbsolute);
        // Verify file exists before suggesting delete
        if (fs.existsSync(origAbsolute)) {
          console.log("[Image Delete] File exists, adding to deletes:", origRelative);
          deletes.push({
            relativePath: origRelative,
            absolutePath: origAbsolute,
            usedInFiles: [], // Will be populated by caller
          });
        } else {
          console.log("[Image Delete] File not found on disk:", origAbsolute);
        }
      } else {
        console.log("[Image Delete] Path still in current (no delete):", origRelative);
      }
    }

    console.log("[Image Delete] Detected deletes:", deletes.length);
    return deletes;
  } catch (err) {
    console.error("[Image Delete] Detection failed:", err);
    return [];
  }
}

/**
 * Find all markdown files in workspace that reference the given image path.
 */
export async function findFilesUsingImage(
  imagePath: string,
  excludeUri: vscode.Uri,
): Promise<string[]> {
  const mdFiles = await vscode.workspace.findFiles(
    "**/*.md",
    "**/node_modules/**",
  );
  const filesUsingImage: string[] = [];
  const imageFilename = path.basename(imagePath);

  for (const fileUri of mdFiles) {
    // Skip current document
    if (fileUri.toString() === excludeUri.toString()) continue;

    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(content).toString("utf8");

      // Check if file contains reference to this image (by filename)
      if (text.includes(imageFilename)) {
        filesUsingImage.push(
          vscode.workspace.asRelativePath(fileUri, false),
        );
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return filesUsingImage;
}

/**
 * Show confirmation dialog for image deletes.
 * Shows warning for images used in other files.
 */
export async function showDeleteConfirmation(
  deletes: ImageDelete[],
): Promise<ImageDelete[] | undefined> {
  const items = deletes.map((d) => {
    const hasWarning = d.usedInFiles.length > 0;
    const icon = hasWarning ? "$(warning)" : "$(trash)";
    const detail = hasWarning
      ? `⚠️ Also used in: ${d.usedInFiles.join(", ")}`
      : path.dirname(d.relativePath) || ".";

    return {
      label: `${icon} ${path.basename(d.relativePath)}`,
      description: hasWarning ? "(used elsewhere)" : "",
      detail,
      delete: d,
      picked: true,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "Delete Image Files?",
    placeHolder: "Select files to delete - will be moved to Trash (ESC to cancel)",
  });

  if (!selected || selected.length === 0) return undefined;
  return selected.map((s) => s.delete);
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
