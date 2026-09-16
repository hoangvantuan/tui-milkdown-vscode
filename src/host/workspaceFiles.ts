/**
 * Workspace-wide file lookup shared by the `@`-mention and `[[wiki]]` pickers.
 *
 * The exclude pattern honours the user's own `files.exclude` on top of
 * `node_modules` and `.git`, so the picker shows the same files the explorer
 * does; only entries set to literal `true` count, since a glob mapped to an
 * object is a conditional exclusion VS Code evaluates itself.
 */
import * as vscode from "vscode";

export function buildExcludePattern(): string {
  const filesExclude = vscode.workspace
    .getConfiguration("files")
    .get<Record<string, unknown>>("exclude", {});
  const userExcludes = Object.entries(filesExclude)
    .filter(([, v]) => v === true)
    .map(([glob]) => glob);
  const defaultExcludes = ["**/node_modules/**", "**/.git/**"];
  const allExcludes = [...new Set([...defaultExcludes, ...userExcludes])];
  return `{${allExcludes.join(",")}}`;
}

/** The document's folder, workspace-relative, for proximity ranking in the picker. */
export function getDocFolder(docUri: vscode.Uri): string {
  const docPath = vscode.workspace.asRelativePath(docUri);
  const lastSlash = docPath.lastIndexOf("/");
  return lastSlash > 0 ? docPath.substring(0, lastSlash) : "";
}
