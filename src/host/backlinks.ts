/**
 * Backlinks discovery across workspace markdown files.
 *
 * Finds all markdown files that reference the current document through:
 * 1. Wiki links: `[[target]]` or `[[target|alias]]`
 * 2. Markdown links / file mentions: `[label](target)` or `[label](<target>)`
 * 3. Plain `@-mentions`: `@filename` or `@path/to/file`
 *
 * Skips code blocks, external links, and references within the same document.
 */
import * as path from "path";
import * as vscode from "vscode";
import { buildExcludePattern } from "./workspaceFiles";
import type { BacklinkItem } from "../shared/messages";

/**
 * Check if a reference target matches the current document.
 */
export function matchesDocument(
  target: string,
  sourceDir: string,
  wsRoot: string | undefined,
  currentFsPath: string,
  currentBasename: string,
  currentStem: string,
  currentWsRel: string,
): boolean {
  if (!target) return false;

  // Ignore external URLs and protocol schemes
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target) || target.startsWith("mailto:")) {
    return false;
  }

  const normTarget = target.split("\\").join("/");
  const targetStem = path.basename(normTarget, path.extname(normTarget));
  const targetBasename = path.basename(normTarget);

  // If target has no directory components, bare stem/basename matches (e.g. wiki links `[[note]]`)
  if (!normTarget.includes("/")) {
    if (
      normTarget.toLowerCase() === currentBasename.toLowerCase() ||
      normTarget.toLowerCase() === currentStem.toLowerCase() ||
      targetBasename.toLowerCase() === currentBasename.toLowerCase() ||
      targetStem.toLowerCase() === currentStem.toLowerCase()
    ) {
      return true;
    }

    // Slugified comparison for wiki links with spaces
    const slug = normTarget.trim().replace(/\s+/g, "-").toLowerCase();
    if (slug === currentStem.toLowerCase() || slug === currentBasename.toLowerCase()) {
      return true;
    }
  }

  // Path resolution relative to source document directory
  const resolvedFromSource = path.resolve(sourceDir, normTarget);
  if (resolvedFromSource === currentFsPath || resolvedFromSource + ".md" === currentFsPath) {
    return true;
  }

  // Path resolution relative to workspace root (for file mentions with workspace-relative paths)
  if (wsRoot) {
    const resolvedFromWs = path.resolve(wsRoot, normTarget);
    if (resolvedFromWs === currentFsPath || resolvedFromWs + ".md" === currentFsPath) {
      return true;
    }
  }

  // Compare against workspace-relative path of current document
  const normWsRel = currentWsRel.split("\\").join("/");
  if (
    normTarget === normWsRel ||
    normTarget + ".md" === normWsRel ||
    normTarget.toLowerCase() === normWsRel.toLowerCase() ||
    normTarget.toLowerCase() + ".md" === normWsRel.toLowerCase()
  ) {
    return true;
  }

  return false;
}

/**
 * Scan workspace markdown files for backlinks pointing to `document`.
 */
export async function findBacklinks(
  document: vscode.TextDocument,
): Promise<BacklinkItem[]> {
  const currentUri = document.uri;
  const currentFsPath = path.resolve(currentUri.fsPath);
  const currentBasename = path.basename(currentFsPath);
  const currentStem = path.basename(currentFsPath, path.extname(currentFsPath));
  const currentDir = path.dirname(currentFsPath);
  const currentWsRel = vscode.workspace.asRelativePath(currentUri);

  const excludePattern = buildExcludePattern();
  const mdFiles = await vscode.workspace.findFiles("**/*.md", excludePattern, 5000);

  const wsFolder = vscode.workspace.getWorkspaceFolder(currentUri);
  const wsRoot = wsFolder?.uri.fsPath;

  const results: BacklinkItem[] = [];

  for (const fileUri of mdFiles) {
    if (path.resolve(fileUri.fsPath) === currentFsPath) continue;

    try {
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(contentBytes).toString("utf8");

      // Strip fenced code blocks so code examples do not trigger false backlinks
      const textWithoutFences = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/gm, "");

      const sourceDir = path.dirname(fileUri.fsPath);
      let matchCount = 0;
      let firstMatchingLine: string | undefined;

      const lines = textWithoutFences.split(/\r?\n/);
      for (const line of lines) {
        let lineMatched = false;

        // 1. Check Wiki Links: [[target]] or [[target|alias]]
        const wikiRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
        let wikiMatch: RegExpExecArray | null;
        while ((wikiMatch = wikiRegex.exec(line)) !== null) {
          const rawTarget = wikiMatch[1].trim();
          if (matchesDocument(rawTarget, sourceDir, wsRoot, currentFsPath, currentBasename, currentStem, currentWsRel)) {
            matchCount++;
            lineMatched = true;
          }
        }

        // 2. Check Markdown links / file mentions: [label](target) or [label](<target>)
        const linkRegex = /\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
        let linkMatch: RegExpExecArray | null;
        while ((linkMatch = linkRegex.exec(line)) !== null) {
          let href = linkMatch[2].trim();
          if (href.startsWith("<") && href.endsWith(">")) {
            href = href.slice(1, -1).trim();
          }
          // Strip anchor fragment and query string
          const cleanHref = href.split("#")[0].split("?")[0].trim();
          if (cleanHref && matchesDocument(cleanHref, sourceDir, wsRoot, currentFsPath, currentBasename, currentStem, currentWsRel)) {
            matchCount++;
            lineMatched = true;
          }
        }

        // 3. Plain text @-mention if present (e.g. @filename.md or @path/filename.md)
        const mentionRegex = /(?:^|\s)@([a-zA-Z0-9_\-./]+(?:\.md)?)/g;
        let mentionMatch: RegExpExecArray | null;
        while ((mentionMatch = mentionRegex.exec(line)) !== null) {
          const mentionTarget = mentionMatch[1].trim();
          if (mentionTarget && matchesDocument(mentionTarget, sourceDir, wsRoot, currentFsPath, currentBasename, currentStem, currentWsRel)) {
            matchCount++;
            lineMatched = true;
          }
        }

        if (lineMatched && !firstMatchingLine) {
          firstMatchingLine = line.trim();
        }
      }

      if (matchCount > 0) {
        results.push({
          label: path.basename(fileUri.fsPath),
          path: vscode.workspace.asRelativePath(fileUri),
          relativePath: path.relative(currentDir, fileUri.fsPath).split(path.sep).join("/"),
          count: matchCount,
          preview: firstMatchingLine,
        });
      }
    } catch {
      // Ignore unreadable files
    }
  }

  // Sort deterministically by workspace-relative path
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}
