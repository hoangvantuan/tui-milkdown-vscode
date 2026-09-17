/**
 * `openWikiLink`: resolve a `[[name]]` target to a file and open it.
 *
 * Resolution widens in three steps, stopping at the first that finds anything:
 * an exact glob on the typed name, the same on a slug with runs of whitespace
 * turned into hyphens, and finally a scan of every `.md` in the workspace
 * compared on the basename. More than one hit raises a quick pick rather than
 * guessing.
 *
 * When resolution finds nothing and the current document URI is known, the user
 * is offered an action to create the missing `<name>.md` file next to the current
 * document. Creation requires user confirmation rather than happening silently
 * because:
 * 1. Typos in wiki links (e.g. `[[teh-spec]]`) would otherwise silently litter
 *    the workspace with unwanted empty files.
 * 2. Clicking wiki links in preview or reading mode should not have filesystem
 *    side-effects without explicit intent.
 * 3. Paths that attempt traversal or escape the document directory are rejected
 *    to prevent directory escape.
 */
import * as path from "path";
import * as vscode from "vscode";
import { hasPathTraversal } from "../utils/image-rename-handler";

export async function openWikiLink(
  wikiFilename: string,
  currentDocUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (!wikiFilename) return undefined;

  const slugified = wikiFilename.trim().replace(/\s+/g, "-");
  const candidates = [wikiFilename, slugified];
  const patterns = candidates.flatMap((name) =>
    name.includes("/")
      ? [`${name}.md`]
      : [`**/${name}.md`]
  );

  let results: vscode.Uri[] = [];
  for (const pattern of patterns) {
    const found = await vscode.workspace.findFiles(
      pattern,
      "{**/node_modules/**,**/.git/**}",
      10,
    );
    for (const uri of found) {
      if (!results.some((r) => r.fsPath === uri.fsPath)) {
        results.push(uri);
      }
    }
  }

  if (results.length === 0) {
    const mdFiles = await vscode.workspace.findFiles(
      "**/*.md",
      "{**/node_modules/**,**/.git/**}",
      5000,
    );
    const needle = slugified.toLowerCase();
    results = mdFiles.filter((uri) => {
      const stem = path.basename(uri.fsPath, ".md").toLowerCase();
      return stem === needle || stem === wikiFilename.toLowerCase();
    });
  }

  if (results.length === 0) {
    const targetRel = wikiFilename.endsWith(".md") ? wikiFilename : `${wikiFilename}.md`;
    if (!currentDocUri || !currentDocUri.fsPath) {
      vscode.window.showWarningMessage(`Wiki link: file "${targetRel}" not found`);
      return undefined;
    }

    const currentDocFolder = path.dirname(currentDocUri.fsPath);
    const targetPath = path.resolve(currentDocFolder, targetRel);
    const normalizedFolder = path.resolve(currentDocFolder);
    const isWithinFolder = targetPath.startsWith(normalizedFolder + path.sep);

    if (hasPathTraversal(wikiFilename) || !isWithinFolder) {
      vscode.window.showWarningMessage(`Wiki link: file "${targetRel}" not found`);
      return undefined;
    }

    const choice = await vscode.window.showWarningMessage(
      `Wiki link: file "${targetRel}" not found. Create it?`,
      "Create",
    );
    if (choice === "Create") {
      const newUri = vscode.Uri.file(targetPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
      await vscode.workspace.fs.writeFile(newUri, new Uint8Array(0));
      await vscode.commands.executeCommand("vscode.open", newUri);
      return newUri;
    }
    return undefined;
  } else if (results.length === 1) {
    await vscode.commands.executeCommand("vscode.open", results[0]);
    return results[0];
  } else {
    const picks = results.map((uri) => ({
      label: path.basename(uri.fsPath),
      description: vscode.workspace.asRelativePath(uri),
      uri,
    }));
    const chosen = await vscode.window.showQuickPick(picks, {
      placeHolder: `Multiple files match "${wikiFilename}.md"`,
    });
    if (chosen) {
      await vscode.commands.executeCommand("vscode.open", chosen.uri);
      return chosen.uri;
    }
    return undefined;
  }
}
