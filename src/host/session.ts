/**
 * Everything that is per-open-editor, in one object.
 *
 * `resolveCustomTextEditor` used to keep these nine as closure variables, which
 * is why nothing outside that one method could reach them. They are fields
 * here, which is what lets the message handlers live in their own files.
 *
 * The four flags are NOT interchangeable and none of them is redundant:
 *
 * - `pendingEdit` is the host's own WorkspaceEdit in progress. It is checked in
 *   three places (the document-change listener, the top of `updateWebview`, and
 *   again inside the debounce) and the webview has a fourth guard of its own
 *   (`lastSentState` in main.ts). That is layered defence against the edit loop,
 *   not duplication: each layer alone still holds when another is removed.
 * - `inFlightEdit` is the promise of the edit being applied, kept so teardown
 *   can wait for it.
 * - `renameInProgress` stops two overlapping rename batches racing on the map.
 *   Now owned by the ImageLedger, not the session.
 * - `exportInProgress` stops two save dialogs racing to one output path.
 *
 * The image baseline (original paths for rename/delete detection) is owned by
 * the ImageLedger. The session holds a reference to the ledger so `applyEdit`
 * can call into it for rename detection.
 */
import * as vscode from "vscode";
import type { TypedWebview } from "./typedWebview";
import { buildImageMap } from "./imagePaths";
import { buildConfigMessage } from "./config";
import { normalizeLineEndings } from "./lineEndings";
import {
  updateWorkspaceReferences,
} from "../utils/image-rename-handler";
import type { ImageLedger } from "./imageLedger";

function getThemeKind(): "dark" | "light" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

export class EditorSession {
  readonly docKey: string;
  readonly webview: TypedWebview;
  isDisposed = false;
  inFlightEdit: Promise<void> | null = null;
  pendingEdit = false;
  exportInProgress = false;
  get renameInProgress(): boolean {
    return this.ledger.renameInProgress;
  }
  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    readonly ledger: ImageLedger,
  ) {
    this.docKey = document.uri.toString();
    this.webview = webviewPanel.webview as TypedWebview;
  }

  updateWebview(): void {
    if (this.pendingEdit || this.isDisposed) return;

    // Debounce rapid calls (e.g., from applyEdit + onDidChangeTextDocument)
    if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);

    this.updateDebounceTimer = setTimeout(() => {
      if (this.isDisposed) return;
      const content = this.document.getText();
      const imageMap = buildImageMap(content, this.document.uri, this.webview);
      this.webview.postMessage({
        type: "update",
        content,
        imageMap,
      });
      this.updateDebounceTimer = null;
    }, 50); // 50ms debounce - balance between responsiveness and loop prevention
  }

  sendTheme(): void {
    if (this.isDisposed) return;
    this.webview.postMessage({
      type: "theme",
      theme: getThemeKind(),
    });
  }

  sendConfig(): void {
    if (this.isDisposed) return;
    this.webview.postMessage(buildConfigMessage(this.document));
  }

  async applyEdit(newContent: string): Promise<void> {
    if (this.document.isClosed) return;
    const normalizedContent = normalizeLineEndings(newContent, this.document.eol);
    if (normalizedContent === this.document.getText()) return;

    // === Image Rename Detection (BEFORE applying edit) ===
    // Rename files first so webviewUri resolves correctly after edit
    // Skip if another rename is already in progress to prevent race conditions
    const config = vscode.workspace.getConfiguration("tuiMarkdown");
    if (config.get<boolean>("autoRenameImages", true) && !this.ledger.renameInProgress) {
      const renames = this.ledger.detectRenames(
        normalizedContent,
        this.document.uri,
      );

      if (renames.length > 0) {
        const result = await this.ledger.applyRenames(renames);
        if (result) {
          const { succeeded, failed } = result;

          if (failed.length > 0) {
            console.warn("[Image Rename] Failed:", failed);
            vscode.window.showWarningMessage(
              `Failed to rename ${failed.length} image(s).`,
            );
          }

          if (succeeded.length > 0) {
            // Update workspace references (other .md files)
            const updatedFiles = await updateWorkspaceReferences(
              succeeded,
              this.document.uri,
            );

            vscode.window.showInformationMessage(
              `Renamed ${succeeded.length} image(s). Updated ${updatedFiles} file(s).`,
            );
          }
        }
      }
    }

    this.pendingEdit = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        this.document.positionAt(0),
        this.document.positionAt(this.document.getText().length),
      );
      edit.replace(this.document.uri, fullRange, normalizedContent);
      await vscode.workspace.applyEdit(edit);
    } finally {
      queueMicrotask(() => {
        this.pendingEdit = false;
        // Send updated imageMap AFTER pendingEdit is reset
        // This ensures new image paths get resolved to webviewUris
        // Loop prevented by lastSentContent check in webview
        if (!this.isDisposed) {
          this.updateWebview();
        }
      });
    }
  }

  /**
   * The panel's own teardown. The order is the fix from #104 and is load-bearing:
   * an edit flushed on `pagehide` is still in flight here, and setting
   * `isDisposed` before awaiting it would drop the last characters the user
   * typed. `setImmediate` is what gives that edit a turn to land.
   */
  dispose(): void {
    if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);
    // Allow any edit in-flight during teardown (e.g. flushed on pagehide) to be applied if the document is still open
    setImmediate(async () => {
      if (this.inFlightEdit) {
        try {
          await this.inFlightEdit;
        } catch {
          /* ignore */
        }
      }
      this.isDisposed = true;
      this.disposables.forEach((d) => d.dispose());
    });
  }
}
