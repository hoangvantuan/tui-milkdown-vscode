/**
 * Extension host entry point. Registers the `.md` custom editor
 * (MarkdownEditorProvider) and workspace/title-bar commands:
 * - viewSource / viewRichText: switch a tab between rich and raw editors.
 * - useAsDefaultEditor: configure default editor for markdown in this workspace.
 * Everything else lives in markdownEditorProvider.ts and host modules.
 */
import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { useAsDefaultEditor } from './host/defaultEditor';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MarkdownEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    ),
    vscode.commands.registerCommand("tuiMarkdown.viewSource", () => {
      const uri = vscode.window.tabGroups.activeTabGroup.activeTab
        ?.input as { uri?: vscode.Uri } | undefined;
      if (uri?.uri) {
        vscode.commands.executeCommand("vscode.openWith", uri.uri, "default");
      }
    }),
    vscode.commands.registerCommand("tuiMarkdown.viewRichText", () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (uri) {
        vscode.commands.executeCommand("vscode.openWith", uri, "tuiMarkdown.editor");
      }
    }),
    vscode.commands.registerCommand("tuiMarkdown.useAsDefaultEditor", () => {
      return useAsDefaultEditor();
    })
  );
}

export function deactivate() {}
