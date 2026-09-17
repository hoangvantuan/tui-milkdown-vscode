/**
 * Editor position persistence (cursor position and scroll offset) per document.
 *
 * Persisted in `workspaceState` (rather than `globalState`) because:
 * 1. Document cursor and scroll offsets are workspace-scoped. Files belong to a
 *    specific workspace project, not global editor configuration.
 * 2. `globalState` would accumulate position records for thousands of transient
 *    files across every workspace ever opened, with no cleanup lifecycle.
 * 3. `workspaceState` automatically scopes entries to the workspace folder and
 *    resets when the workspace is cleared or deleted.
 */
import * as vscode from "vscode";
import type { TypedWebview } from "./typedWebview";

export interface EditorPosition {
  cursor?: number;
  scrollTop?: number;
}

/**
 * Derive the storage key for a document URI in workspaceState.
 */
export function getEditorPositionKey(uri: vscode.Uri | string): string {
  const uriStr = typeof uri === "string" ? uri : uri.toString();
  return `editorPosition:${uriStr}`;
}

/**
 * Clamp a cursor position to [0, docLength].
 */
export function clampPosition(cursor: number, docLength: number): number {
  if (typeof cursor !== "number" || Number.isNaN(cursor)) return 0;
  return Math.max(0, Math.min(cursor, Math.max(0, docLength)));
}

/**
 * Clamp a scroll offset to [0, maxScroll].
 */
export function clampScrollTop(scrollTop: number, maxScroll: number): number {
  if (typeof scrollTop !== "number" || Number.isNaN(scrollTop)) return 0;
  return Math.max(0, Math.min(scrollTop, Math.max(0, maxScroll)));
}

/**
 * Save the editor position for a document URI to workspaceState.
 */
export function saveEditorPosition(
  workspaceState: vscode.Memento,
  uri: vscode.Uri,
  position: EditorPosition,
): Thenable<void> {
  const key = getEditorPositionKey(uri);
  return workspaceState.update(key, position);
}

/**
 * Retrieve the saved editor position for a document URI from workspaceState.
 */
export function getSavedEditorPosition(
  workspaceState: vscode.Memento,
  uri: vscode.Uri,
): EditorPosition | undefined {
  const key = getEditorPositionKey(uri);
  return workspaceState.get<EditorPosition>(key);
}

/**
 * Replay the saved editor position to the webview on `ready`.
 */
export function sendSavedEditorPosition(
  webview: TypedWebview,
  workspaceState: vscode.Memento,
  uri: vscode.Uri,
): void {
  const pos = getSavedEditorPosition(workspaceState, uri);
  if (pos && (typeof pos.cursor === "number" || typeof pos.scrollTop === "number")) {
    webview.postMessage({
      type: "savedEditorPosition",
      cursor: pos.cursor,
      scrollTop: pos.scrollTop,
    });
  }
}
