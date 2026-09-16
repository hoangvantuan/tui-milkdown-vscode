/**
 * `openWikiLink`: resolve a `[[name]]` target to a file and open it.
 *
 * Resolution widens in three steps, stopping at the first that finds anything:
 * an exact glob on the typed name, the same on a slug with runs of whitespace
 * turned into hyphens, and finally a scan of every `.md` in the workspace
 * compared on the basename. More than one hit raises a quick pick rather than
 * guessing.
 */
import * as path from "path";
import * as vscode from "vscode";

export async function openWikiLink(wikiFilename: string): Promise<void> {
  if (!wikiFilename) return;

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
    vscode.window.showWarningMessage(`Wiki link: file "${wikiFilename}.md" not found`);
  } else if (results.length === 1) {
    await vscode.commands.executeCommand("vscode.open", results[0]);
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
    }
  }
}
