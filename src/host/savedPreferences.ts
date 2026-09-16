/**
 * Replay of the globally remembered UI preferences (theme, font, zoom) on
 * `ready`.
 *
 * Order matters and is preserved from the switch this came out of: the saved
 * global theme goes first, before the VS Code theme, so a user choice is not
 * overwritten by the window theme on every open.
 */
import * as vscode from "vscode";
import type { TypedWebview } from "./typedWebview";

export function sendSavedPreferences(
  webview: TypedWebview,
  globalState: vscode.Memento,
): void {
  // Send saved global theme FIRST, before VS Code theme
  const savedTheme = globalState.get<string>(
    "markdownEditorTheme",
  );
  if (savedTheme) {
    webview.postMessage({
      type: "savedTheme",
      theme: savedTheme,
    });
  }
  // Send saved font
  const savedFont = globalState.get<string>(
    "markdownEditorFont",
  );
  if (savedFont) {
    webview.postMessage({
      type: "savedFont",
      font: savedFont,
    });
  }
  // Send saved zoom
  const savedZoom = globalState.get<number>(
    "markdownEditorZoom",
  );
  if (typeof savedZoom === "number") {
    webview.postMessage({
      type: "savedZoom",
      zoom: savedZoom,
    });
  }
}
