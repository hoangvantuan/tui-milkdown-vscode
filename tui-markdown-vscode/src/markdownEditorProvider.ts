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

    const editorCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'toastui-editor.css')
    );
    const darkCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'toastui-editor-dark.css')
    );
    const pluginCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'toastui-editor-plugin-code-syntax-highlight.css')
    );
    const prismCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'prism.css')
    );
    const prismDarkCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'prism-tomorrow.css')
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
        <link rel="stylesheet" href="${editorCssUri}">
        <link id="dark-theme" rel="stylesheet" href="${darkCssUri}" disabled>
        <link rel="stylesheet" href="${pluginCssUri}">
        <link id="prism-light" rel="stylesheet" href="${prismCssUri}">
        <link id="prism-dark" rel="stylesheet" href="${prismDarkCssUri}" disabled>
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
          #editor { width: 100%; height: 100vh; }
          .toastui-editor-defaultUI { border: none; }
          .toastui-editor-main,
          .toastui-editor-ww-container,
          .toastui-editor-md-container {
            background: var(--vscode-editor-background) !important;
          }
          .toastui-editor-contents,
          .toastui-editor-contents p,
          .toastui-editor-contents li,
          .toastui-editor-contents td,
          .toastui-editor-contents th,
          .toastui-editor-md-preview,
          .ProseMirror,
          .ProseMirror p,
          .ProseMirror li,
          .ProseMirror td,
          .ProseMirror th {
            color: var(--vscode-editor-foreground) !important;
          }
          .toastui-editor-contents h1,
          .toastui-editor-contents h2,
          .toastui-editor-contents h3,
          .toastui-editor-contents h4,
          .toastui-editor-contents h5,
          .toastui-editor-contents h6 {
            color: var(--vscode-textLink-foreground) !important;
          }
          .toastui-editor-toolbar {
            background: var(--vscode-editor-background) !important;
            border-bottom: 1px solid var(--vscode-editorWidget-border) !important;
          }
          .toastui-editor-toolbar button {
            color: var(--vscode-editor-foreground) !important;
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
