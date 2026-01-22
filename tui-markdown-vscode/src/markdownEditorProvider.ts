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
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const disposables: vscode.Disposable[] = [];

    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        content: document.getText(),
      });
    };

    // Listen for document changes (external edits)
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          updateWebview();
        }
      })
    );

    // Listen for messages from webview with validation
    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const msg = message as { type?: string };
        if (typeof msg.type !== 'string') return;

        switch (msg.type) {
          case 'ready':
            updateWebview();
            break;
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
        <title>TUI Markdown Editor</title>
        <style>
          body {
            padding: 0;
            margin: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          #editor {
            width: 100%;
            height: 100vh;
          }
          .placeholder {
            padding: 20px;
            font-family: var(--vscode-font-family);
          }
        </style>
      </head>
      <body>
        <div id="editor">
          <div class="placeholder">Loading TUI Editor...</div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `.trim();
  }
}
