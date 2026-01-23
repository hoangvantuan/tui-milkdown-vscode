import * as vscode from 'vscode';
import { getNonce } from './utils/getNonce';

/**
 * CustomTextEditorProvider for Markdown WYSIWYG editing.
 * Registers for .md files via package.json customEditors.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'tuiMarkdown.editor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const MAX_FILE_SIZE = 500 * 1024;
    const fileSize = Buffer.byteLength(document.getText(), 'utf8');

    if (fileSize > MAX_FILE_SIZE) {
      const proceed = await vscode.window.showWarningMessage(
        `This file is ${(fileSize / 1024).toFixed(0)}KB. Large files may cause performance issues.`,
        'Open Anyway',
        'Open with Default Editor'
      );

      if (proceed !== 'Open Anyway') {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode.commands.executeCommand('vscode.open', document.uri);
        return;
      }
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let pendingEdit = false;
    const disposables: vscode.Disposable[] = [];

    const getThemeKind = (): 'dark' | 'light' => {
      const kind = vscode.window.activeColorTheme.kind;
      return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
        ? 'dark'
        : 'light';
    };

    const updateWebview = () => {
      if (pendingEdit) return;
      webviewPanel.webview.postMessage({
        type: 'update',
        content: document.getText(),
      });
    };

    const sendTheme = () => {
      webviewPanel.webview.postMessage({
        type: 'theme',
        theme: getThemeKind(),
      });
    };

    const getFontSize = (): number => {
      const config = vscode.workspace.getConfiguration('tuiMarkdown');
      return config.get<number>('fontSize', 16);
    };

    const sendConfig = () => {
      webviewPanel.webview.postMessage({
        type: 'config',
        fontSize: getFontSize(),
      });
    };

    const applyEdit = async (newContent: string) => {
      if (newContent === document.getText()) return;

      pendingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, newContent);
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
          updateWebview();
        }
      } finally {
        queueMicrotask(() => { pendingEdit = false; });
      }
    };

    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() &&
            !pendingEdit && e.contentChanges.length > 0) {
          updateWebview();
        }
      }),
      webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const msg = message as { type?: string; content?: string };
        if (typeof msg.type !== 'string') return;

        switch (msg.type) {
          case 'ready': {
            // Send saved global theme FIRST, before VS Code theme
            const savedTheme = this.context.globalState.get<string>('markdownEditorTheme');
            if (savedTheme) {
              webviewPanel.webview.postMessage({ type: 'savedTheme', theme: savedTheme });
            }
            sendTheme();
            sendConfig();
            updateWebview();
            break;
          }
          case 'edit':
            if (typeof msg.content === 'string') {
              await applyEdit(msg.content);
            }
            break;
          case 'viewSource': {
            // Open with default text editor, then close this custom editor
            const uri = document.uri;
            await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
            break;
          }
          case 'themeChange': {
            const theme = (msg as { theme?: string }).theme;
            if (typeof theme === 'string') {
              await this.context.globalState.update('markdownEditorTheme', theme);
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
        if (e.affectsConfiguration('tuiMarkdown.fontSize')) {
          sendConfig();
        }
      })
    );

    webviewPanel.onDidDispose(() => {
      disposables.forEach((d) => d.dispose());
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.css')
    );

    const nonce = getNonce();

    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource};
      connect-src 'none';
    `.replace(/\s+/g, ' ').trim();

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
            --editor-font-size: 16px;
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
          /* Apply font size directly to editor - avoids cursor offset from transform */
          .milkdown {
            font-size: var(--editor-font-size, 16px);
          }

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
