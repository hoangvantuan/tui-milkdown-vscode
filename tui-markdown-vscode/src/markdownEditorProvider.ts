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
        if (e.document.uri.toString() === document.uri.toString()) {
          if (!pendingEdit && e.contentChanges.length > 0) {
            updateWebview();
          }
        }
      })
    );

    disposables.push(
      webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const msg = message as { type?: string; content?: string };
        if (typeof msg.type !== 'string') return;

        switch (msg.type) {
          case 'ready':
            sendTheme();
            updateWebview();
            break;
          case 'edit':
            if (typeof msg.content === 'string') {
              await applyEdit(msg.content);
            }
            break;
        }
      })
    );

    disposables.push(
      webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          updateWebview();
        }
      })
    );

    disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        sendTheme();
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

    const ckeditorCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'ckeditor5.css')
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
        <link rel="stylesheet" href="${ckeditorCssUri}">
        <style>
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          #editor {
            width: 100%;
            height: 100vh;
          }
          .ck.ck-editor {
            height: 100%;
            display: flex;
            flex-direction: column;
          }
          .ck.ck-editor__main {
            flex: 1;
            overflow: auto;
          }
          .ck.ck-content {
            min-height: 100%;
          }
          /* Dark theme */
          .dark-theme .ck.ck-toolbar {
            background: var(--vscode-editor-background) !important;
            border-color: var(--vscode-editorWidget-border) !important;
          }
          .dark-theme .ck.ck-toolbar__items button {
            color: var(--vscode-editor-foreground) !important;
          }
          .dark-theme .ck.ck-editor__main,
          .dark-theme .ck.ck-content {
            background: var(--vscode-editor-background) !important;
            color: var(--vscode-editor-foreground) !important;
          }
          .dark-theme .ck.ck-content h1,
          .dark-theme .ck.ck-content h2,
          .dark-theme .ck.ck-content h3,
          .dark-theme .ck.ck-content h4 {
            color: var(--vscode-textLink-foreground) !important;
          }
          .dark-theme .ck.ck-content code {
            background: var(--vscode-textCodeBlock-background) !important;
            color: var(--vscode-editor-foreground) !important;
          }
          .dark-theme .ck.ck-content pre {
            background: var(--vscode-textCodeBlock-background) !important;
          }
          .dark-theme .ck.ck-content blockquote {
            border-left-color: var(--vscode-textLink-foreground) !important;
            color: var(--vscode-descriptionForeground) !important;
          }
        </style>
      </head>
      <body>
        <div id="editor"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `.trim();
  }
}
