import * as vscode from "vscode";
import { MAX_FILE_SIZE } from "./constants";
import { getNonce } from "./utils/getNonce";

/**
 * CustomTextEditorProvider for Markdown WYSIWYG editing.
 * Registers for .md files via package.json customEditors.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "tuiMarkdown.editor";

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const fileSize = Buffer.byteLength(document.getText(), "utf8");

    if (fileSize > MAX_FILE_SIZE) {
      const proceed = await vscode.window.showWarningMessage(
        `This file is ${(fileSize / 1024).toFixed(0)}KB. Large files may cause performance issues.`,
        "Open Anyway",
        "Open with Default Editor",
      );

      if (proceed !== "Open Anyway") {
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor",
        );
        await vscode.commands.executeCommand("vscode.open", document.uri);
        return;
      }
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
        vscode.Uri.joinPath(this.context.extensionUri, "node_modules"),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let pendingEdit = false;
    const disposables: vscode.Disposable[] = [];

    const getThemeKind = (): "dark" | "light" => {
      const kind = vscode.window.activeColorTheme.kind;
      return kind === vscode.ColorThemeKind.Dark ||
        kind === vscode.ColorThemeKind.HighContrast
        ? "dark"
        : "light";
    };

    const updateWebview = () => {
      if (pendingEdit) return;
      webviewPanel.webview.postMessage({
        type: "update",
        content: document.getText(),
      });
    };

    const sendTheme = () => {
      webviewPanel.webview.postMessage({
        type: "theme",
        theme: getThemeKind(),
      });
    };

    const getFontSize = (): number => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      return config.get<number>("fontSize", 16);
    };

    const getHeadingSizes = (): Record<string, number> => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown.headingSizes");
      return {
        h1: config.get<number>("h1", 32),
        h2: config.get<number>("h2", 28),
        h3: config.get<number>("h3", 24),
        h4: config.get<number>("h4", 20),
        h5: config.get<number>("h5", 18),
        h6: config.get<number>("h6", 16),
      };
    };

    const sendConfig = () => {
      webviewPanel.webview.postMessage({
        type: "config",
        fontSize: getFontSize(),
        headingSizes: getHeadingSizes(),
      });
    };

    const applyEdit = async (newContent: string) => {
      if (newContent === document.getText()) return;

      pendingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        );
        edit.replace(document.uri, fullRange, newContent);
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
          updateWebview();
        }
      } finally {
        queueMicrotask(() => {
          pendingEdit = false;
        });
      }
    };

    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          e.document.uri.toString() === document.uri.toString() &&
          !pendingEdit &&
          e.contentChanges.length > 0
        ) {
          updateWebview();
        }
      }),
      webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const msg = message as { type?: string; content?: string };
        if (typeof msg.type !== "string") return;

        switch (msg.type) {
          case "ready": {
            // Send saved global theme FIRST, before VS Code theme
            const savedTheme = this.context.globalState.get<string>(
              "markdownEditorTheme",
            );
            if (savedTheme) {
              webviewPanel.webview.postMessage({
                type: "savedTheme",
                theme: savedTheme,
              });
            }
            sendTheme();
            sendConfig();
            updateWebview();
            break;
          }
          case "edit":
            if (typeof msg.content === "string") {
              await applyEdit(msg.content);
            }
            break;
          case "viewSource": {
            // Open with default text editor, then close this custom editor
            const uri = document.uri;
            await vscode.commands.executeCommand(
              "vscode.openWith",
              uri,
              "default",
            );
            break;
          }
          case "themeChange": {
            const theme = (msg as { theme?: string }).theme;
            if (typeof theme === "string") {
              await this.context.globalState.update(
                "markdownEditorTheme",
                theme,
              );
            }
            break;
          }
        }
      }),
      webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) updateWebview();
      }),
      vscode.window.onDidChangeActiveColorTheme(sendTheme),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("tuiMarkdown.fontSize") ||
          e.affectsConfiguration("tuiMarkdown.headingSizes")
        ) {
          sendConfig();
        }
      }),
    );

    webviewPanel.onDidDispose(() => {
      disposables.forEach((d) => d.dispose());
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "webview",
        "main.js",
      ),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "webview",
        "main.css",
      ),
    );

    const nonce = getNonce();

    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource};
      connect-src 'none';
    `
      .replace(/\s+/g, " ")
      .trim();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <title>Markdown Editor</title>
        <link rel="stylesheet" href="${cssUri}">
        <style>
          :root {
            --editor-font-scale: 1;
            --heading-h1-size: 32px;
            --heading-h2-size: 28px;
            --heading-h3-size: 24px;
            --heading-h4-size: 20px;
            --heading-h5-size: 18px;
            --heading-h6-size: 16px;
            --heading-h1-margin: 24px;
            --heading-h2-margin: 20px;
            --heading-h3-margin: 16px;
            --heading-h4-margin: 12px;
            --heading-h5-margin: 8px;
            --heading-h6-margin: 8px;
            /* Default Milkdown theme variables (dark) - prevents flash */
            --crepe-color-background: var(--vscode-editor-background, #1e1e1e);
            --crepe-color-on-background: var(--vscode-editor-foreground, #d4d4d4);
            --crepe-color-surface: #262626;
            --crepe-color-surface-low: #303030;
            --crepe-color-on-surface: #e0e0e0;
            --crepe-color-on-surface-variant: #b0b0b0;
            --crepe-color-outline: #6b6b6b;
            --crepe-color-primary: #e0e0e0;
            --crepe-color-secondary: #404040;
            --crepe-color-on-secondary: #ffffff;
            --crepe-color-selected: #4a4a4a;
          }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
          }
          .milkdown .ProseMirror {
            padding: 10px 40px;
          }
          /* Override body text font size only (headings unchanged) */
          .milkdown .ProseMirror p,
          .milkdown .ProseMirror blockquote {
            font-size: calc(16px * var(--editor-font-scale, 1));
            line-height: calc(24px * var(--editor-font-scale, 1));
          }
          .milkdown .ProseMirror li {
            font-size: calc(16px * var(--editor-font-scale, 1));
            gap: calc(10px * var(--editor-font-scale, 1)) !important;
          }
          .milkdown .label-wrapper {
            height: calc(32px * var(--editor-font-scale, 1)) !important;
            transform: scale(var(--editor-font-scale, 1));
            transform-origin: left center;
            margin-right: calc(4px * var(--editor-font-scale, 1));
          }
          .milkdown .ProseMirror code,
          .milkdown .ProseMirror pre,
          .milkdown .cm-editor,
          .milkdown .cm-content {
            font-size: calc(16px * var(--editor-font-scale, 1)) !important;
            line-height: calc(24px * var(--editor-font-scale, 1)) !important;
          }
          /* Heading font sizes */
          .milkdown .ProseMirror h1 { font-size: var(--heading-h1-size, 32px) !important; margin-top: var(--heading-h1-margin, 24px) !important; }
          .milkdown .ProseMirror h2 { font-size: var(--heading-h2-size, 28px) !important; margin-top: var(--heading-h2-margin, 20px) !important; }
          .milkdown .ProseMirror h3 { font-size: var(--heading-h3-size, 24px) !important; margin-top: var(--heading-h3-margin, 16px) !important; }
          .milkdown .ProseMirror h4 { font-size: var(--heading-h4-size, 20px) !important; margin-top: var(--heading-h4-margin, 12px) !important; }
          .milkdown .ProseMirror h5 { font-size: var(--heading-h5-size, 18px) !important; margin-top: var(--heading-h5-margin, 8px) !important; }
          .milkdown .ProseMirror h6 { font-size: var(--heading-h6-size, 16px) !important; margin-top: var(--heading-h6-margin, 8px) !important; }

          #toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 12px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 100;
          }
          #theme-select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
          }
          .view-source-btn {
            padding: 4px 12px;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            color: var(--vscode-button-secondaryForeground);
            font-size: 12px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.15s ease;
          }
          .view-source-btn:hover {
            background: var(--vscode-list-hoverBackground);
          }

          #editor-container {
            height: calc(100vh - 40px);
            overflow: auto;
            position: relative;
          }
          #editor { width: 100%; min-height: 100%; }
          #editor.hidden { display: none; }

          /* Loading state */
          #loading-indicator {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: var(--vscode-editor-background, #1e1e1e);
            z-index: 10;
          }
          #loading-indicator.hidden { display: none; }
          .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--vscode-editor-foreground, #888);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          .loading-text {
            color: var(--vscode-descriptionForeground, #888);
            font-size: 13px;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          /* Metadata Panel */
          #metadata-panel {
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
          }
          #metadata-details { margin: 0; }
          #metadata-summary {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            font-weight: 500;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
          }
          #metadata-summary:hover {
            background: var(--vscode-list-hoverBackground);
          }
          #metadata-summary:focus {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: -2px;
          }
          .toggle-icon::before {
            content: '▼';
            display: inline-block;
            font-size: 10px;
            transition: transform 0.15s ease;
          }
          #metadata-details:not([open]) .toggle-icon::before {
            transform: rotate(-90deg);
          }
          .error-indicator {
            color: var(--vscode-errorForeground);
            font-size: 11px;
          }
          .error-indicator.hidden { display: none; }
          .metadata-content { padding: 0 12px 12px; }
          #metadata-textarea {
            width: 100%;
            min-height: 80px;
            max-height: 300px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 13px;
            line-height: 1.4;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
            overflow-y: auto;
          }
          #metadata-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
          }
          #metadata-textarea.error {
            border-color: var(--vscode-inputValidation-errorBorder, #be1100);
          }
          #add-metadata-btn {
            display: block;
            width: calc(100% - 24px);
            margin: 8px 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--vscode-button-secondaryForeground);
            background: var(--vscode-button-secondaryBackground);
            border: 1px dashed var(--vscode-input-border);
            border-radius: 4px;
            cursor: pointer;
            text-align: center;
          }
          #add-metadata-btn:hover {
            background: var(--vscode-list-hoverBackground);
          }
          #add-metadata-btn.hidden { display: none; }
          #metadata-details.hidden { display: none; }

        </style>
      </head>
      <body style="background: var(--vscode-editor-background, #1e1e1e);">
        <div id="toolbar">
          <select id="theme-select" aria-label="Editor theme">
            <option value="frame">Frame</option>
            <option value="frame-dark">Frame Dark</option>
            <option value="nord">Nord</option>
            <option value="nord-dark">Nord Dark</option>
          </select>
          <button id="btn-source" class="view-source-btn" aria-label="View source in text editor">View Source</button>
        </div>
        <div id="metadata-panel">
          <details id="metadata-details" class="hidden" open>
            <summary id="metadata-summary">
              <span class="toggle-icon"></span>
              <span class="panel-label">Metadata</span>
              <span id="metadata-error" class="error-indicator hidden" role="status" aria-live="polite"></span>
            </summary>
            <div class="metadata-content">
              <textarea
                id="metadata-textarea"
                spellcheck="false"
                placeholder="key: value"
                aria-label="YAML frontmatter"></textarea>
            </div>
          </details>
          <button id="add-metadata-btn" class="hidden" aria-label="Add metadata">
            + Add Metadata
          </button>
        </div>
        <div id="editor-container">
          <div id="loading-indicator">
            <div class="loading-spinner"></div>
            <span class="loading-text">Loading editor...</span>
          </div>
          <div id="editor"></div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `.trim();
  }
}
