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
