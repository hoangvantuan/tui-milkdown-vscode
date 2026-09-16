import * as path from "path";
import * as vscode from "vscode";
import type { WebviewToHostMessage } from "./shared/messages";
import { MAX_FILE_SIZE } from "./constants";
import { getNonce } from "./utils/getNonce";
import {
  detectImageRenames,
  executeImageRenames,
  updateWorkspaceReferences,
  detectImageDeletes,
  executeImageDeletes,
  normalizePath,
} from "./utils/image-rename-handler";
import { cleanImagePath } from "./utils/clean-image-path";
import type { TypedWebview } from "./host/typedWebview";
import { getSystemFonts } from "./host/systemFonts";
import { sendSavedPreferences } from "./host/savedPreferences";
import { handleSaveImage } from "./host/saveImage";
import { handleReadClipboardImage } from "./host/readClipboardImage";
import { handleRequestImageRename } from "./host/requestImageRename";
import { openWikiLink } from "./host/openWikiLink";
import { handleExport } from "./host/exportDocument";

// Image URL helpers
function isRemoteUrl(url: string): boolean {
  return /^(https?:\/\/|data:)/i.test(url);
}

function extractImagePaths(content: string): string[] {
  // Size guard to prevent regex performance issues on malicious input
  if (!content || content.length > MAX_FILE_SIZE) {
    return [];
  }

  const paths: string[] = [];

  // Markdown: ![alt](path) or ![alt](path "title") or ![alt](<path> "title")
  // Supports angle-bracket paths and paths with parentheses like path(1).png
  const mdRegex = /!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+(?:\([^)]*\)[^)\s]*)*))\s*(?:["'][^"']*["'])?\)/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    const rawPath = match[1] ?? match[2]; // match[1] = angle-bracket path, match[2] = normal path
    const cleanPath = cleanImagePath(rawPath);
    if (cleanPath) {
      paths.push(cleanPath);
    }
  }

  // HTML: <img src="path">
  const htmlRegex = /<img\s[^>]*?src=["']([^"']+)["']/gi;
  while ((match = htmlRegex.exec(content)) !== null) {
    const cleanPath = cleanImagePath(match[1]);
    if (cleanPath) {
      paths.push(cleanPath);
    }
  }

  return [...new Set(paths)]; // Dedupe
}

function resolveImagePath(
  imagePath: string,
  documentUri: vscode.Uri,
): vscode.Uri | null {
  if (isRemoteUrl(imagePath)) return null;

  // Handle file:// URIs
  if (imagePath.startsWith("file://")) {
    return vscode.Uri.parse(imagePath);
  }

  // Handle Windows absolute paths (e.g., C:\ or C:/)
  if (/^[a-zA-Z]:[\\/]/.test(imagePath)) {
    return vscode.Uri.file(imagePath);
  }

  const documentFolder = vscode.Uri.joinPath(documentUri, "..");

  if (imagePath.startsWith("/")) {
    // Unix absolute path - resolve from workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder) {
      return vscode.Uri.joinPath(workspaceFolder.uri, imagePath);
    }
    // Fallback: treat as file system absolute path
    return vscode.Uri.file(imagePath);
  }

  // Relative path - resolve from document folder
  return vscode.Uri.joinPath(documentFolder, imagePath);
}

function buildImageMap(
  content: string,
  documentUri: vscode.Uri,
  webview: vscode.Webview,
): Record<string, string> {
  const imageMap: Record<string, string> = {};
  const paths = extractImagePaths(content);

  for (const path of paths) {
    if (isRemoteUrl(path)) continue;

    const resolvedUri = resolveImagePath(path, documentUri);
    if (resolvedUri) {
      imageMap[path] = webview.asWebviewUri(resolvedUri).toString();
    }
  }

  return imageMap;
}

/**
 * Build mapping of relative image paths to absolute paths for rename detection.
 * Filters out remote URLs (http/https/data).
 */
function buildOriginalImageMap(
  content: string,
  documentUri: vscode.Uri,
): Map<string, string> {
  const map = new Map<string, string>();
  const paths = extractImagePaths(content);

  for (const imgPath of paths) {
    if (isRemoteUrl(imgPath)) continue;
    const resolved = resolveImagePath(imgPath, documentUri);
    if (resolved) {
      const normalizedPath = normalizePath(imgPath);
      map.set(normalizedPath, resolved.fsPath);
    }
  }
  return map;
}

/**
 * Resolve a relative file path against the document's folder and open it in a
 * new VSCode editor tab. Validates the target stays within the workspace or
 * document directory. Shared by the openLink and openImageInTab handlers.
 */
function openLocalFileInEditor(relativePath: string, document: vscode.TextDocument): void {
  const docDir = path.dirname(document.uri.fsPath);
  // Separate file path and anchor fragment
  const hashIndex = relativePath.indexOf("#");
  const filePart = hashIndex !== -1 ? relativePath.slice(0, hashIndex) : relativePath;
  const targetPath = filePart
    ? path.resolve(docDir, filePart)
    : document.uri.fsPath;

  // Security: Validate target is within workspace or document directory
  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const allowedRoot = wsFolder?.uri.fsPath || docDir;
  if (!targetPath.startsWith(allowedRoot + path.sep) && targetPath !== allowedRoot) {
    vscode.window.showWarningMessage(`Cannot open file outside workspace: ${filePart}`);
    return;
  }

  const targetUri = vscode.Uri.file(targetPath);
  vscode.commands.executeCommand("vscode.open", targetUri).then(
    undefined,
    () => vscode.window.showWarningMessage(`Cannot open file: ${relativePath}`)
  );
}

/**
 * Normalize line endings in markdown content to match the document's EOL sequence.
 * Converts CRLF, lone CR, and LF to the target EOL string (CRLF or LF).
 */
export function normalizeLineEndings(
  content: string,
  eol: vscode.EndOfLine | "\n" | "\r\n",
): string {
  const targetEol =
    eol === vscode.EndOfLine.CRLF || eol === "\r\n" ? "\r\n" : "\n";
  return content.replace(/\r\n|\r|\n/g, targetEol);
}

/**
 * CustomTextEditorProvider for Markdown WYSIWYG editing.
 * Registers for .md files via package.json customEditors.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "tuiMarkdown.editor";

  /**
   * Stores original image paths per document for rename detection.
   * Key: document.uri.toString()
   * Value: Map<relativePath, absolutePathString>
   */
  private originalImagePaths: Map<string, Map<string, string>> = new Map();

  /** Tracks clipboard error reasons shown during this session to avoid warning spam */
  private clipboardWarningsShown = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) { }

  private notifyClipboardError(
    webview: TypedWebview,
    reason: string,
    warningMessage?: string,
  ): void {
    try {
      webview.postMessage({
        type: "clipboardImage",
        error: reason,
      });
    } catch {
      /* webview may have been disposed */
    }
    if (warningMessage && !this.clipboardWarningsShown.has(reason)) {
      this.clipboardWarningsShown.add(reason);
      vscode.window.showWarningMessage(warningMessage);
    }
  }

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

    // Store original image paths for rename detection
    const docKey = document.uri.toString();
    this.originalImagePaths.set(
      docKey,
      buildOriginalImageMap(document.getText(), document.uri),
    );

    // Build localResourceRoots with document folder and workspace
    const documentFolder = vscode.Uri.joinPath(document.uri, "..");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;

    const localResourceRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, "out"),
      vscode.Uri.joinPath(this.context.extensionUri, "node_modules"),
      documentFolder,
    ];
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder);
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const webview = webviewPanel.webview as TypedWebview;
    let isDisposed = false;
    let inFlightEdit: Promise<void> | null = null;
    let pendingEdit = false;
    let renameInProgress = false;
    let exportInProgress = false;
    let updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposables: vscode.Disposable[] = [];

    const getThemeKind = (): "dark" | "light" => {
      const kind = vscode.window.activeColorTheme.kind;
      return kind === vscode.ColorThemeKind.Dark ||
        kind === vscode.ColorThemeKind.HighContrast
        ? "dark"
        : "light";
    };

    const updateWebview = () => {
      if (pendingEdit || isDisposed) return;

      // Debounce rapid calls (e.g., from applyEdit + onDidChangeTextDocument)
      if (updateDebounceTimer) clearTimeout(updateDebounceTimer);

      updateDebounceTimer = setTimeout(() => {
        if (isDisposed) return;
        const content = document.getText();
        const imageMap = buildImageMap(content, document.uri, webviewPanel.webview);
        webview.postMessage({
          type: "update",
          content,
          imageMap,
        });
        updateDebounceTimer = null;
      }, 50); // 50ms debounce - balance between responsiveness and loop prevention
    };

    const sendTheme = () => {
      if (isDisposed) return;
      webview.postMessage({
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

    const getHighlightCurrentLine = (): boolean => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      return config.get<boolean>("highlightCurrentLine", true);
    };

    const getAutoHideToolbar = (): boolean => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      return config.get<boolean>("autoHideToolbar", false);
    };

    const getListIndentation = (): {
      indentation: { style: "space" | "tab"; size: number };
      tabSize: number;
    } => {
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
    };

    const sendConfig = () => {
      if (isDisposed) return;
      const { indentation, tabSize } = getListIndentation();
      webview.postMessage({
        type: "config",
        fontSize: getFontSize(),
        headingSizes: getHeadingSizes(),
        highlightCurrentLine: getHighlightCurrentLine(),
        autoHideToolbar: getAutoHideToolbar(),
        listIndentation: indentation,
        tabSize,
      });
    };

    const applyEdit = async (newContent: string) => {
      if (document.isClosed) return;
      const normalizedContent = normalizeLineEndings(newContent, document.eol);
      if (normalizedContent === document.getText()) return;

      // === Image Rename Detection (BEFORE applying edit) ===
      // Rename files first so webviewUri resolves correctly after edit
      // Skip if another rename is already in progress to prevent race conditions
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      if (config.get<boolean>("autoRenameImages", true) && !renameInProgress) {
        const originalMap = this.originalImagePaths.get(docKey);
        if (originalMap && originalMap.size > 0) {
          const newPaths = extractImagePaths(normalizedContent).filter(
            (p) => !isRemoteUrl(p),
          );
          const renames = detectImageRenames(
            originalMap,
            newPaths,
            document.uri,
          );

          if (renames.length > 0) {
            renameInProgress = true;
            try {
              // Optimistic locking: Update map BEFORE async rename to prevent race conditions
              // Store original values to revert on failure
              const originalValues = new Map<string, string>();
              for (const rename of renames) {
                const origValue = originalMap.get(rename.oldRelative);
                if (origValue) originalValues.set(rename.oldRelative, origValue);
                originalMap.delete(rename.oldRelative);
                originalMap.set(rename.newRelative, rename.newAbsolute);
              }

              const { succeeded, failed } = await executeImageRenames(renames);

              // Revert failed renames in the map
              if (failed.length > 0) {
                for (const { rename } of failed) {
                  originalMap.delete(rename.newRelative);
                  const origValue = originalValues.get(rename.oldRelative);
                  if (origValue) {
                    originalMap.set(rename.oldRelative, origValue);
                  }
                }
                console.warn("[Image Rename] Failed:", failed);
                vscode.window.showWarningMessage(
                  `Failed to rename ${failed.length} image(s).`,
                );
              }

              if (succeeded.length > 0) {
                // Update workspace references (other .md files)
                const updatedFiles = await updateWorkspaceReferences(
                  succeeded,
                  document.uri,
                );

                vscode.window.showInformationMessage(
                  `Renamed ${succeeded.length} image(s). Updated ${updatedFiles} file(s).`,
                );
              }
            } finally {
              renameInProgress = false;
            }
          }
        }
      }

      pendingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        );
        edit.replace(document.uri, fullRange, normalizedContent);
        await vscode.workspace.applyEdit(edit);
      } finally {
        queueMicrotask(() => {
          pendingEdit = false;
          // Send updated imageMap AFTER pendingEdit is reset
          // This ensures new image paths get resolved to webviewUris
          // Loop prevented by lastSentContent check in webview
          if (!isDisposed) {
            updateWebview();
          }
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
        if (!message || typeof message !== "object" || !("type" in message)) return;
        const msg = message as WebviewToHostMessage;

        switch (msg.type) {
          case "ready": {
            sendSavedPreferences(webview, this.context.globalState);
            sendTheme();
            sendConfig();
            updateWebview();
            // Send system fonts asynchronously (non-blocking)
            getSystemFonts().then((fonts) => {
              try {
                webview.postMessage({
                  type: "systemFonts",
                  fonts,
                });
              } catch { /* webview disposed */ }
            });
            break;
          }
          case "edit":
            if (typeof msg.content === "string" && !document.isClosed) {
              inFlightEdit = applyEdit(msg.content);
              await inFlightEdit;
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
            const theme = msg.theme;
            if (typeof theme === "string") {
              await this.context.globalState.update(
                "markdownEditorTheme",
                theme,
              );
            }
            break;
          }
          case "fontChange": {
            const font = msg.font;
            if (typeof font === "string") {
              await this.context.globalState.update(
                "markdownEditorFont",
                font || undefined, // Remove key when "Default"
              );
            }
            break;
          }
          case "zoomChange": {
            const zoom = msg.zoom;
            if (
              typeof zoom === "number" &&
              Number.isFinite(zoom) &&
              zoom >= 0.5 &&
              zoom <= 2.0
            ) {
              await this.context.globalState.update(
                "markdownEditorZoom",
                zoom === 1 ? undefined : zoom, // Remove key when back to 100%
              );
            }
            break;
          }
          case "saveImage": {
            await handleSaveImage(msg, document, webview);
            break;
          }
          case "showWarning": {
            const warnMsg = msg.message;
            if (typeof warnMsg === "string") {
              vscode.window.showWarningMessage(warnMsg);
            }
            break;
          }
          case "readClipboardImage": {
            handleReadClipboardImage(
              webview,
              (target, reason, warningMessage) =>
                this.notifyClipboardError(target, reason, warningMessage),
            );
            break;
          }
          case "requestImageUrlEdit": {
            const editMsg = msg;
            if (!editMsg.editId) break;

            let prompt: string;
            if (editMsg.isBase64) {
              prompt = "Enter image path to replace embedded base64 image";
            } else if (editMsg.isLocalImage) {
              prompt = "Enter new image path (auto-rename only works within same folder)";
            } else {
              prompt = "Enter image URL";
            }

            vscode.window
              .showInputBox({
                prompt,
                value: editMsg.currentUrl || "",
                placeHolder: "images/photo.png or https://example.com/image.png",
              })
              .then((newUrl) => {
                webview.postMessage({
                  type: "imageUrlEditResponse",
                  editId: editMsg.editId,
                  newUrl: newUrl ?? null,
                });
              });
            break;
          }
          case "openLink": {
            const linkHref = msg.href;
            if (!linkHref) break;

            if (/^https?:\/\//.test(linkHref)) {
              // External URL → open in default browser
              vscode.env.openExternal(vscode.Uri.parse(linkHref));
            } else {
              // Relative file path → resolve against document location
              openLocalFileInEditor(linkHref, document);
            }
            break;
          }
          case "openImageInTab": {
            const imgPath = msg.path;
            if (!imgPath) break;
            openLocalFileInEditor(imgPath, document);
            break;
          }
          case "requestLinkEdit": {
            const linkMsg = msg;
            if (!linkMsg.editId) break;
            vscode.window
              .showInputBox({
                prompt: "Enter URL",
                value: linkMsg.currentUrl || "",
                placeHolder: "https://example.com",
              })
              .then((newUrl) => {
                webview.postMessage({
                  type: "linkEditResponse",
                  editId: linkMsg.editId,
                  newUrl: newUrl ?? null,
                });
              });
            break;
          }
          case "requestImageRename": {
            handleRequestImageRename(
              msg,
              document,
              webview,
              this.originalImagePaths,
              docKey,
              (value) => {
                pendingEdit = value;
              },
            );
            break;
          }
          case "fileSearch": {
            const excludePattern = this.buildExcludePattern();
            const currentDocFolder = this.getDocFolder(document.uri);

            const files = await vscode.workspace.findFiles(
              "**/*",
              excludePattern,
              5000,
            );

            const fileList = files.map((uri) => ({
              name: path.basename(uri.fsPath),
              path: vscode.workspace.asRelativePath(uri),
            }));
            webview.postMessage({
              type: "fileSearchResults",
              files: fileList,
              currentDocFolder,
            });
            break;
          }
          case "wikiLinkSearch": {
            const excludePattern = this.buildExcludePattern();
            const currentDocFolder = this.getDocFolder(document.uri);

            const mdFiles = await vscode.workspace.findFiles(
              "**/*.md",
              excludePattern,
              5000,
            );

            const fileList = mdFiles.map((uri) => ({
              name: path.basename(uri.fsPath),
              path: vscode.workspace.asRelativePath(uri),
            }));
            webview.postMessage({
              type: "wikiLinkSearchResults",
              files: fileList,
              currentDocFolder,
            });
            break;
          }
          case "openWikiLink": {
            await openWikiLink(msg.filename);
            break;
          }
          case "export": {
            handleExport(
              msg,
              document,
              webview,
              () => exportInProgress,
              (value) => {
                exportInProgress = value;
              },
            );
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
      }),
      vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
        if (savedDoc.uri.toString() !== document.uri.toString()) return;

        // Note: Image rename detection moved to applyEdit() for instant rename
        // This handler only handles delete detection and map rebuilding

        const config = vscode.workspace.getConfiguration("tuiMarkdown");
        const originalMap = this.originalImagePaths.get(docKey);

        // Get current paths (filter remote URLs)
        const currentPaths = extractImagePaths(savedDoc.getText()).filter(
          (p) => !isRemoteUrl(p),
        );

        // Skip detection if no original paths, but still rebuild map at the end
        if (!originalMap || originalMap.size === 0) {
          this.originalImagePaths.set(
            docKey,
            buildOriginalImageMap(savedDoc.getText(), savedDoc.uri),
          );
          return;
        }

        // === Image Delete Detection ===
        if (config.get<boolean>("autoDeleteImages", true)) {
          const deletes = detectImageDeletes(originalMap, currentPaths);

          if (deletes.length > 0) {
            // Auto-delete without confirmation (moves to Trash)
            const { succeeded, failed } = await executeImageDeletes(deletes);

            if (succeeded.length > 0) {
              // Remove deleted paths from storage
              for (const path of succeeded) {
                originalMap.delete(path);
              }
            }

            if (failed.length > 0) {
              console.warn("[Image Delete] Failed:", failed);
              vscode.window.showWarningMessage(
                `Failed to delete ${failed.length} image(s).`,
              );
            }
          }
        }

        // Always rebuild originalImagePaths after save to capture newly added images
        // This ensures delete detection works for images added during editing session
        this.originalImagePaths.set(
          docKey,
          buildOriginalImageMap(savedDoc.getText(), savedDoc.uri),
        );
      }),
    );

    webviewPanel.onDidDispose(() => {
      if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
      // Allow any edit in-flight during teardown (e.g. flushed on pagehide) to be applied if document is still open
      setImmediate(async () => {
        if (inFlightEdit) {
          try {
            await inFlightEdit;
          } catch {
            /* ignore */
          }
        }
        isDisposed = true;
        this.originalImagePaths.delete(docKey);
        disposables.forEach((d) => d.dispose());
      });
    });
  }

  private buildExcludePattern(): string {
    const filesExclude = vscode.workspace
      .getConfiguration("files")
      .get<Record<string, unknown>>("exclude", {});
    const userExcludes = Object.entries(filesExclude)
      .filter(([, v]) => v === true)
      .map(([glob]) => glob);
    const defaultExcludes = ["**/node_modules/**", "**/.git/**"];
    const allExcludes = [...new Set([...defaultExcludes, ...userExcludes])];
    return `{${allExcludes.join(",")}}`;
  }

  private getDocFolder(docUri: vscode.Uri): string {
    const docPath = vscode.workspace.asRelativePath(docUri);
    const lastSlash = docPath.lastIndexOf("/");
    return lastSlash > 0 ? docPath.substring(0, lastSlash) : "";
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
    // Lazy mermaid artifact URI (injected on demand by the webview, see
    // src/webview/mermaid-bridge.ts). Computed here because only the
    // extension host can mint webview resource URIs.
    const mermaidScriptUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "out",
          "webview",
          "mermaid-loader.js",
        ),
      )
      .toString();

    const nonce = getNonce();

    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource} data:;
      connect-src blob:;
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
      </head>
      <body style="background: var(--vscode-editor-background, #1e1e1e);">
        <div id="toolbar">
          <!-- Text formatting -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="bold" title="Bold (Ctrl+B)" aria-label="Bold">
              <svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="italic" title="Italic (Ctrl+I)" aria-label="Italic">
              <svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
            </button>
            <button class="toolbar-btn" data-command="underline" title="Underline (Ctrl+U)" aria-label="Underline">
              <svg viewBox="0 0 24 24"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
            </button>
            <button class="toolbar-btn" data-command="strike" title="Strikethrough" aria-label="Strikethrough">
              <svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
            </button>
            <button class="toolbar-btn" data-command="code" title="Inline Code (Ctrl+E)" aria-label="Inline Code">
              <svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </button>
            <button class="toolbar-btn" data-command="highlight" title="Highlight" aria-label="Highlight">
              <svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Heading -->
          <div class="toolbar-group">
            <select id="heading-select" aria-label="Heading level">
              <option value="paragraph">Paragraph</option>
              <option value="1">H1</option>
              <option value="2">H2</option>
              <option value="3">H3</option>
              <option value="4">H4</option>
              <option value="5">H5</option>
              <option value="6">H6</option>
            </select>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Lists -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="bulletList" title="Bullet List" aria-label="Bullet List">
              <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button class="toolbar-btn" data-command="orderedList" title="Ordered List" aria-label="Ordered List">
              <svg viewBox="0 0 24 24"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
            </button>
            <button class="toolbar-btn" data-command="taskList" title="Task List" aria-label="Task List">
              <svg viewBox="0 0 24 24"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" y1="6" x2="21" y2="6"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Block elements -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="blockquote" title="Blockquote" aria-label="Blockquote">
              <svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="codeBlock" title="Code Block" aria-label="Code Block">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 10-2 2 2 2"/><path d="m14 14 2-2-2-2"/></svg>
            </button>
            <button class="toolbar-btn" data-command="horizontalRule" title="Page Break" aria-label="Page Break">
              <svg viewBox="0 0 24 24"><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/><line x1="4" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="20" y2="12"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Table & Link -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="insertTable" title="Insert Table" aria-label="Insert Table">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
            </button>
            <button class="toolbar-btn" data-command="link" title="Insert Link (Ctrl+K)" aria-label="Insert Link">
              <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
          </div>

          <!-- Table context actions (visible only when cursor is inside a table) -->
          <div id="table-context" class="toolbar-group hidden">
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" data-command="addColumnBefore" title="Add Column Before" aria-label="Add Column Before">
              <svg viewBox="0 0 24 24"><path d="M16 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><line x1="8" y1="12" x2="2" y2="12"/><line x1="5" y1="9" x2="5" y2="15"/></svg>
            </button>
            <button class="toolbar-btn" data-command="addColumnAfter" title="Add Column After" aria-label="Add Column After">
              <svg viewBox="0 0 24 24"><path d="M8 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="19" y1="9" x2="19" y2="15"/></svg>
            </button>
            <button class="toolbar-btn" data-command="addRowAfter" title="Add Row Below" aria-label="Add Row Below">
              <svg viewBox="0 0 24 24"><path d="M3 8V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteColumn" title="Delete Column" aria-label="Delete Column">
              <svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteRow" title="Delete Row" aria-label="Delete Row">
              <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteTable" title="Delete Table" aria-label="Delete Table">
              <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>

          <div class="toolbar-spacer"></div>

          <!-- Appearance popover + Source (right side) -->
          <div class="toolbar-group" style="gap: 4px;">
            <button id="btn-source" class="toolbar-btn" title="View Source (open raw .md in text editor)" aria-label="View source">
              <svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14.5" y1="4" x2="9.5" y2="20"/></svg>
            </button>
            <div class="appearance-group">
              <button id="btn-appearance" class="toolbar-btn" title="Appearance (zoom, theme, font)" aria-label="Appearance" aria-haspopup="true" aria-expanded="false">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <div id="appearance-popover" class="appearance-popover hidden" role="menu" aria-label="Appearance settings">
                <div class="appearance-row">
                  <label class="appearance-label">Zoom</label>
                  <div id="zoom-controls" class="zoom-controls" role="group" aria-label="Zoom">
                    <button id="btn-zoom-out" class="zoom-btn" title="Zoom Out (Ctrl/Cmd -)" aria-label="Zoom out">
                      <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button id="btn-zoom-reset" class="zoom-display-btn" title="Reset Zoom (Ctrl/Cmd 0)" aria-label="Reset zoom">100%</button>
                    <button id="btn-zoom-in" class="zoom-btn" title="Zoom In (Ctrl/Cmd +)" aria-label="Zoom in">
                      <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                  </div>
                </div>
                <div class="appearance-row">
                  <label class="appearance-label" for="theme-select">Theme</label>
                  <select id="theme-select" aria-label="Editor theme">
                    <option value="frame">Frame</option>
                    <option value="frame-dark">Frame Dark</option>
                    <option value="nord">Nord</option>
                    <option value="nord-dark">Nord Dark</option>
                    <option value="crepe">Crepe</option>
                    <option value="crepe-dark">Crepe Dark</option>
                    <option value="catppuccin-latte">Catppuccin Latte</option>
                    <option value="catppuccin-frappe">Catppuccin Frappé</option>
                    <option value="catppuccin-macchiato">Catppuccin Macchiato</option>
                    <option value="catppuccin-mocha">Catppuccin Mocha</option>
                    <option value="paper">Paper</option>
                    <option value="midnight">Midnight</option>
                  </select>
                </div>
                <div class="appearance-row">
                  <label class="appearance-label">Font</label>
                  <div id="font-selector-container"></div>
                </div>
                <div class="appearance-row">
                  <label class="appearance-label">Export</label>
                  <div class="export-controls">
                    <select id="export-format" aria-label="Export format">
                      <option value="docx">DOCX</option>
                      <option value="pdf">PDF</option>
                    </select>
                    <button id="btn-export-go" title="Export file" aria-label="Export">
                      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Export
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div id="search-bar" class="hidden">
          <svg class="search-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search-input" type="text" placeholder="Search..." spellcheck="false" autocomplete="off" maxlength="500" />
          <span id="search-count"></span>
          <button id="search-prev" class="search-btn" title="Previous (Shift+Enter)" aria-label="Previous match">
            <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button id="search-next" class="search-btn" title="Next (Enter)" aria-label="Next match">
            <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button id="search-close" class="search-btn" title="Close (Escape)" aria-label="Close search">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="metadata-panel">
          <details id="metadata-details" class="hidden">
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
        <div id="main-layout">
          <button id="btn-toc" class="toc-toggle-btn" title="Table of Contents" aria-label="Toggle Table of Contents">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="14" y1="9" x2="18" y2="9"/><line x1="14" y1="13" x2="18" y2="13"/><line x1="14" y1="17" x2="18" y2="17"/></svg>
          </button>
          <aside id="toc-sidebar" class="hidden">
            <div class="toc-header">
              <span class="toc-title">Contents</span>
            </div>
            <div id="toc-entries"></div>
          </aside>
          <div id="editor-container">
            <div id="loading-indicator">
              <div class="loading-spinner"></div>
              <span class="loading-text">Loading editor...</span>
            </div>
            <div id="editor"></div>
            <div id="word-count"></div>
          </div>
        </div>
        <div id="lightbox-overlay">
          <div class="lightbox-backdrop"></div>
          <div class="lightbox-content">
            <img id="lightbox-image" src="" alt="" />
            <div id="lightbox-svg" class="lightbox-svg-wrapper hidden"></div>
            <span id="lightbox-caption" class="hidden"></span>
          </div>
          <div class="lightbox-controls">
            <button id="lightbox-zoom-out" class="lightbox-btn" aria-label="Zoom out">&minus;</button>
            <span id="lightbox-zoom-level">100%</span>
            <button id="lightbox-zoom-in" class="lightbox-btn" aria-label="Zoom in">+</button>
            <button id="lightbox-copy" class="lightbox-btn lightbox-copy-btn hidden" aria-label="Copy as PNG" title="Copy as PNG">
              <span class="icon icon-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
              <span class="icon icon-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
            </button>
            <button id="lightbox-close" class="lightbox-btn" aria-label="Close">&times;</button>
          </div>
        </div>
        <div id="reading-progress"></div>
        <div id="toolbar-hover-zone"></div>
        <script nonce="${nonce}">
          // Bootstrap for the lazy mermaid artifact: the webview CSP is
          // nonce-only for scripts and browsers hide the nonce attribute
          // from the DOM, so the page cannot recover it by itself. Expose
          // the artifact URI + nonce to the webview BEFORE main.js runs;
          // mermaid-bridge.ts injects the artifact with this nonce when a
          // diagram is first rendered. No CSP relaxation involved.
          window.__tuiMermaidBootstrap = {
            scriptUri: "${mermaidScriptUri}",
            nonce: "${nonce}",
          };
          // Page CSP nonce for any nonce-gated style injection (see
          // search-plugin.ts: find-and-replace injectNonce option).
          window.__tuiCspNonce = "${nonce}";
        </script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `.trim();
  }
}
