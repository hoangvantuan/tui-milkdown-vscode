/**
 * `defaultEditor`: configure the default editor for markdown in this workspace.
 *
 * Background and intent:
 * In package.json, `contributes.customEditors` registers `tuiMarkdown.editor` with
 * priority "default". Consequently, `.md` files already open in TUI Markdown by
 * default in all workspaces without any explicit workspace configuration.
 *
 * The real need reported by users in #48 is the opposite direction: opting OUT
 * of TUI Markdown for a specific workspace so markdown files open in VS Code's
 * built-in text editor instead (preventing interception of git diffs and allowing
 * raw editing).
 *
 * To serve both directions safely and avoid one-way traps, this command presents
 * a QuickPick with three explicit outcomes:
 * 1. "TUI Markdown (WYSIWYG)": writes "*.md": "tuiMarkdown.editor" to workspace.
 * 2. "Text editor (raw markdown)": writes "*.md": "default" to workspace.
 * 3. "Reset to the extension default": clears workspace associations for markdown.
 *
 * The setting is written to `workbench.editorAssociations` under
 * ConfigurationTarget.Workspace.
 */
import * as vscode from "vscode";

export type EditorMode = "wysiwyg" | "text" | "reset";

export interface EditorModeOption {
  label: string;
  description?: string;
  detail: string;
  mode: EditorMode;
}

/**
 * Compute the updated editorAssociations dictionary for the given mode.
 * Returns undefined when resetting and no other associations remain,
 * which instructs VS Code to remove the key from settings.json.
 */
export function computeUpdatedAssociations(
  current: Record<string, string> = {},
  mode: EditorMode,
): Record<string, string> | undefined {
  if (mode === "wysiwyg") {
    return {
      ...current,
      "*.md": "tuiMarkdown.editor",
      "*.markdown": "tuiMarkdown.editor",
    };
  }
  if (mode === "text") {
    return {
      ...current,
      "*.md": "default",
      "*.markdown": "default",
    };
  }
  if (mode === "reset") {
    const updated = { ...current };
    delete updated["*.md"];
    delete updated["*.markdown"];
    return Object.keys(updated).length > 0 ? updated : undefined;
  }
  return undefined;
}

/**
 * Detect the current markdown editor mode configured for this workspace.
 */
export function getCurrentWorkspaceMode(
  assoc?: Record<string, string>,
): "wysiwyg" | "text" | "default" {
  if (!assoc) return "default";
  const mdVal = assoc["*.md"];
  if (mdVal === "tuiMarkdown.editor") return "wysiwyg";
  if (mdVal === "default") return "text";
  return "default";
}

/**
 * Build QuickPick options reflecting the current workspace configuration.
 */
export function buildQuickPickOptions(
  currentMode: "wysiwyg" | "text" | "default",
): EditorModeOption[] {
  return [
    {
      label: "TUI Markdown (WYSIWYG)",
      description: currentMode === "wysiwyg" ? "(current)" : undefined,
      detail: "Always open markdown files with TUI Markdown in this workspace",
      mode: "wysiwyg",
    },
    {
      label: "Text editor (raw markdown)",
      description: currentMode === "text" ? "(current)" : undefined,
      detail: "Always open markdown files with the built-in text editor in this workspace",
      mode: "text",
    },
    {
      label: "Reset to the extension default",
      description: currentMode === "default" ? "(current)" : undefined,
      detail: "Remove workspace associations for markdown and inherit default behavior",
      mode: "reset",
    },
  ];
}

/**
 * Execute the command: prompt via QuickPick and apply the chosen association.
 */
export async function useAsDefaultEditor(): Promise<EditorMode | undefined> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showWarningMessage("No workspace folder is open.");
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("workbench");
  const inspect = config.inspect<Record<string, string>>("editorAssociations");
  const currentAssoc = { ...(inspect?.workspaceValue || {}) };

  const currentMode = getCurrentWorkspaceMode(currentAssoc);
  const options = buildQuickPickOptions(currentMode);

  const chosen = await vscode.window.showQuickPick(options, {
    placeHolder: "Select default editor for Markdown in this workspace",
  });

  if (!chosen) return undefined;

  const nextAssoc = computeUpdatedAssociations(currentAssoc, chosen.mode);
  await config.update(
    "editorAssociations",
    nextAssoc,
    vscode.ConfigurationTarget.Workspace,
  );

  return chosen.mode;
}
