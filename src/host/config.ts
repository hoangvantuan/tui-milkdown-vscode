/**
 * The `tuiMarkdown.*` settings the webview needs, read on demand.
 *
 * Nothing is cached. VS Code resolves a setting against a document's folder and
 * language, so the same key can answer differently per document, and the
 * watcher at the bottom of this file re-sends whenever one of them changes.
 *
 * `listIndent` is the one with real logic. `"editor"` means "follow whatever
 * the user's editor does for markdown", which is `editor.insertSpaces` and
 * `editor.tabSize` — and a visible text editor on the same document can
 * override those live, because VS Code's own indentation picker writes there
 * rather than into settings. That is why the visible editor wins when present.
 */
import * as vscode from "vscode";
import type { ConfigMessage } from "../shared/messages";

function getFontSize(): number {
  const config = vscode.workspace.getConfiguration("tuiMarkdown");
  return config.get<number>("fontSize", 16);
}

function getHeadingSizes(): Record<string, number> {
  const config = vscode.workspace.getConfiguration("tuiMarkdown.headingSizes");
  return {
    h1: config.get<number>("h1", 32),
    h2: config.get<number>("h2", 28),
    h3: config.get<number>("h3", 24),
    h4: config.get<number>("h4", 20),
    h5: config.get<number>("h5", 18),
    h6: config.get<number>("h6", 16),
  };
}

function getHighlightCurrentLine(): boolean {
  const config = vscode.workspace.getConfiguration("tuiMarkdown");
  return config.get<boolean>("highlightCurrentLine", true);
}

function getAutoHideToolbar(): boolean {
  const config = vscode.workspace.getConfiguration("tuiMarkdown");
  return config.get<boolean>("autoHideToolbar", false);
}

function getListIndentation(document: vscode.TextDocument): {
  indentation: { style: "space" | "tab"; size: number };
  tabSize: number;
} {
  const tuiConfig = vscode.workspace.getConfiguration("tuiMarkdown", document.uri);
  const listIndent = tuiConfig.get<string | number>("listIndent", "editor");

  const editorConfig = vscode.workspace.getConfiguration("editor", {
    uri: document.uri,
    languageId: document.languageId || "markdown",
  });
  let insertSpaces = editorConfig.get<boolean>("insertSpaces", true);
  let tabSize = editorConfig.get<number>("tabSize", 2);

  const visibleEditor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === document.uri.toString(),
  );
  if (visibleEditor) {
    if (typeof visibleEditor.options.insertSpaces === "boolean") {
      insertSpaces = visibleEditor.options.insertSpaces;
    }
    if (typeof visibleEditor.options.tabSize === "number") {
      tabSize = visibleEditor.options.tabSize;
    }
  }

  const resolvedTabSize = typeof tabSize === "number" && tabSize > 0 ? tabSize : 2;

  if (listIndent === 2 || listIndent === "2") {
    return {
      indentation: { style: "space", size: 2 },
      tabSize: 2,
    };
  }
  if (listIndent === 4 || listIndent === "4") {
    return {
      indentation: { style: "space", size: 4 },
      tabSize: 4,
    };
  }
  if (listIndent === "tab") {
    return {
      indentation: { style: "tab", size: 1 },
      tabSize: resolvedTabSize,
    };
  }

  // Default: "editor"
  if (!insertSpaces) {
    return {
      indentation: { style: "tab", size: 1 },
      tabSize: resolvedTabSize,
    };
  }
  return {
    indentation: { style: "space", size: resolvedTabSize },
    tabSize: resolvedTabSize,
  };
}

/** The `config` message, built in the order the settings were read before. */
export function buildConfigMessage(document: vscode.TextDocument): ConfigMessage {
  const { indentation, tabSize } = getListIndentation(document);
  return {
    type: "config",
    fontSize: getFontSize(),
    headingSizes: getHeadingSizes(),
    highlightCurrentLine: getHighlightCurrentLine(),
    autoHideToolbar: getAutoHideToolbar(),
    listIndentation: indentation,
    tabSize,
  };
}

/**
 * The `onDidChangeConfiguration` body. Two unrelated reactions share the one
 * listener, exactly as they did inline: re-send the webview config when a key
 * it renders from moves, and drop the discovered-Chromium cache when the user
 * points `chromiumPath` somewhere else.
 */
export function handleConfigurationChange(
  e: vscode.ConfigurationChangeEvent,
  document: vscode.TextDocument,
  sendConfig: () => void,
): void {
  if (
    e.affectsConfiguration("tuiMarkdown.fontSize") ||
    e.affectsConfiguration("tuiMarkdown.headingSizes") ||
    e.affectsConfiguration("tuiMarkdown.highlightCurrentLine") ||
    e.affectsConfiguration("tuiMarkdown.autoHideToolbar") ||
    e.affectsConfiguration("tuiMarkdown.listIndent", document.uri) ||
    e.affectsConfiguration("editor.tabSize", {
      uri: document.uri,
      languageId: document.languageId || "markdown",
    }) ||
    e.affectsConfiguration("editor.insertSpaces", {
      uri: document.uri,
      languageId: document.languageId || "markdown",
    })
  ) {
    sendConfig();
  }
  if (e.affectsConfiguration("tuiMarkdown.chromiumPath")) {
    try {
      const exportPdfPath = require("path").join(__dirname, "export-pdf.js");
      const { clearChromiumCache } = require(exportPdfPath);
      clearChromiumCache?.();
    } catch {
      /* module may not be loaded yet — cache will be empty anyway */
    }
  }
}
