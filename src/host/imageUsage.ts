/**
 * Who ELSE points at an image the current document just dropped (#126).
 *
 * `ImageDelete.usedInFiles` shipped with a `// Will be populated by caller`
 * note and no caller, so `autoDeleteImages` trashed a file that another
 * document still rendered, silently, across a boundary the user never touched.
 * This is that caller.
 *
 * Two decisions worth keeping:
 *
 * - Matching is by RESOLVED ABSOLUTE PATH, not by the literal string in the
 *   markdown. `a.md` at the root writes `images/shared.png` and `notes/c.md`
 *   writes `../images/shared.png` for the same file; a string compare — which
 *   is what `updateWorkspaceReferences` does — would miss the second one and
 *   delete the file out from under it.
 * - Fenced code blocks are NOT stripped, unlike `findBacklinks` and
 *   `updateWorkspaceReferences`. Those two rewrite or list; this one guards.
 *   A false "still used" costs one dismissable prompt, a false "unused" costs
 *   the file, so the cheap error is the one that keeps the file.
 * - The scan is deliberately WIDER than `findBacklinks`, which is the closest
 *   sibling and uses `buildExcludePattern()` with a 5000-result cap. Neither
 *   belongs here for the same reason as the fences: `buildExcludePattern()`
 *   honours the user's `files.exclude`, and a document hidden from the file
 *   picker still renders its images, so skipping it would answer "unused"
 *   about a file that is used. A cap would truncate the scan into the same
 *   wrong answer, silently. `updateWorkspaceReferences` uses this same bare
 *   `**\/node_modules\/**`, and for the same reason.
 *
 * It lives in `src/host/` rather than next to `ImageDelete` in
 * `src/utils/image-rename-handler.ts` because `src/host/imagePaths.ts` already
 * imports `normalizePath` from there; importing `extractImagePaths` back would
 * close the cycle.
 */
import * as path from "path";
import * as vscode from "vscode";
import type { ImageDelete } from "../utils/image-rename-handler";
import { extractImagePaths, isRemoteUrl, resolveImagePath } from "./imagePaths";

/**
 * Fill `usedInFiles` on each delete with the workspace-relative paths of the
 * other markdown documents that reference the same file on disk.
 *
 * Mutates in place, and costs one `findFiles` plus a read per markdown file —
 * which is why the caller runs it only once a delete has actually been
 * detected, not on every save.
 */
export async function populateImageUsage(
  deletes: ImageDelete[],
  excludeUri: vscode.Uri,
): Promise<void> {
  if (deletes.length === 0) return;

  // Several deletes can point at the same file on disk (two markdown spellings
  // of one path), so the index is path -> every delete wanting that path.
  const wanted = new Map<string, ImageDelete[]>();
  for (const del of deletes) {
    const key = path.resolve(del.absolutePath);
    const bucket = wanted.get(key);
    if (bucket) bucket.push(del);
    else wanted.set(key, [del]);
  }

  const mdFiles = await vscode.workspace.findFiles(
    "**/*.md",
    "**/node_modules/**",
  );

  for (const fileUri of mdFiles) {
    // The saved document is the one that just removed the reference.
    if (fileUri.toString() === excludeUri.toString()) continue;

    try {
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(contentBytes).toString("utf8");
      const label = vscode.workspace.asRelativePath(fileUri);

      for (const imgPath of extractImagePaths(text)) {
        if (isRemoteUrl(imgPath)) continue;
        const resolved = resolveImagePath(imgPath, fileUri);
        if (!resolved) continue;

        const bucket = wanted.get(path.resolve(resolved.fsPath));
        if (!bucket) continue;
        for (const del of bucket) {
          if (!del.usedInFiles.includes(label)) del.usedInFiles.push(label);
        }
      }
    } catch (err) {
      // An unreadable file cannot be shown to reference anything. Skipping it
      // matches `updateWorkspaceReferences`, and the console line is the only
      // trace there would otherwise be.
      console.error(`[Image Delete] Failed to scan ${fileUri.fsPath}:`, err);
    }
  }
}
