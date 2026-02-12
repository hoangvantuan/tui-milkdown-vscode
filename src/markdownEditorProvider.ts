import * as path from "path";
import * as vscode from "vscode";
import { MAX_FILE_SIZE } from "./constants";
import { getNonce } from "./utils/getNonce";
import {
  detectImageRenames,
  executeImageRenames,
  updateWorkspaceReferences,
  detectImageDeletes,
  executeImageDeletes,
  hasPathTraversal,
  normalizePath,
} from "./utils/image-rename-handler";
import { cleanImagePath } from "./utils/clean-image-path";

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
  const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    const cleanPath = cleanImagePath(match[1]);
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

  constructor(private readonly context: vscode.ExtensionContext) { }

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

    let pendingEdit = false;
    let renameInProgress = false;
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
      if (pendingEdit) return;

      // Debounce rapid calls (e.g., from applyEdit + onDidChangeTextDocument)
      if (updateDebounceTimer) clearTimeout(updateDebounceTimer);

      updateDebounceTimer = setTimeout(() => {
        const content = document.getText();
        const imageMap = buildImageMap(content, document.uri, webviewPanel.webview);
        webviewPanel.webview.postMessage({
          type: "update",
          content,
          imageMap,
        });
        updateDebounceTimer = null;
      }, 50); // 50ms debounce - balance between responsiveness and loop prevention
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

    const getHighlightCurrentLine = (): boolean => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      return config.get<boolean>("highlightCurrentLine", true);
    };

    const sendConfig = () => {
      webviewPanel.webview.postMessage({
        type: "config",
        fontSize: getFontSize(),
        headingSizes: getHeadingSizes(),
        highlightCurrentLine: getHighlightCurrentLine(),
      });
    };

    const applyEdit = async (newContent: string) => {
      if (newContent === document.getText()) return;

      // === Image Rename Detection (BEFORE applying edit) ===
      // Rename files first so webviewUri resolves correctly after edit
      // Skip if another rename is already in progress to prevent race conditions
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      if (config.get<boolean>("autoRenameImages", true) && !renameInProgress) {
        const originalMap = this.originalImagePaths.get(docKey);
        if (originalMap && originalMap.size > 0) {
          const newPaths = extractImagePaths(newContent).filter(
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
        edit.replace(document.uri, fullRange, newContent);
        await vscode.workspace.applyEdit(edit);
      } finally {
        queueMicrotask(() => {
          pendingEdit = false;
          // Send updated imageMap AFTER pendingEdit is reset
          // This ensures new image paths get resolved to webviewUris
          // Loop prevented by lastSentContent check in webview
          updateWebview();
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
          case "saveImage": {
            const imgMsg = msg as {
              data?: string;
              filename?: string;
              blobUrl?: string;
            };
            if (!imgMsg.data || !imgMsg.filename || !imgMsg.blobUrl) break;

            // Security: Strong filename validation
            const filename = imgMsg.filename;
            // Block: path traversal, separators, null bytes, control chars, Windows reserved chars
            const INVALID_FILENAME_CHARS = /[<>:"|?*\x00-\x1F\u202E]/;
            // Windows reserved device names (case-insensitive)
            const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i;

            if (
              !filename ||
              filename.includes("..") ||
              filename.includes("/") ||
              filename.includes("\\") ||
              INVALID_FILENAME_CHARS.test(filename) ||
              RESERVED_NAMES.test(filename)
            ) {
              console.error("[Image Save] Invalid filename:", filename);
              vscode.window.showErrorMessage("Invalid filename");
              break;
            }

            try {
              // Get configured folder
              const config = vscode.workspace.getConfiguration("tuiMarkdown");
              let saveFolder = config.get<string>("imageSaveFolder", "images")?.trim() || "images";

              // Security: Validate saveFolder to prevent path traversal
              const isAbsolute = saveFolder.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(saveFolder);
              const hasTraversal = saveFolder.split(/[\\/]/).includes("..");
              if (saveFolder !== "." && (isAbsolute || hasTraversal)) {
                vscode.window.showErrorMessage(
                  "imageSaveFolder must be a relative path (or '.') within the document folder."
                );
                break;
              }

              // Resolve folder path relative to document
              const documentFolder = vscode.Uri.joinPath(document.uri, "..");
              const imageFolder = vscode.Uri.joinPath(documentFolder, saveFolder);

              // Security: Verify resolved path is within document directory
              const rel = path.relative(documentFolder.fsPath, imageFolder.fsPath);
              if (rel.startsWith('..') || path.isAbsolute(rel)) {
                vscode.window.showErrorMessage(
                  "imageSaveFolder resolves outside document folder."
                );
                break;
              }

              // Create folder if not exists
              try {
                await vscode.workspace.fs.createDirectory(imageFolder);
              } catch {
                // Folder may already exist
              }

              // Decode base64 and save file
              // Note: Use [^;]+ to match MIME types like image/svg+xml
              const base64Data = imgMsg.data.replace(
                /^data:image\/[^;]+;base64,/i,
                "",
              );
              const buffer = Buffer.from(base64Data, "base64");
              const fileUri = vscode.Uri.joinPath(imageFolder, filename);
              await vscode.workspace.fs.writeFile(fileUri, buffer);

              // Build relative path for markdown
              const relativePath =
                saveFolder === "." ? filename : `${saveFolder}/${filename}`;

              // Create webview URI for immediate display
              const webviewUri =
                webviewPanel.webview.asWebviewUri(fileUri).toString();

              // Send back the saved path and webviewUri
              webviewPanel.webview.postMessage({
                type: "imageSaved",
                blobUrl: imgMsg.blobUrl,
                savedPath: relativePath,
                webviewUri,
              });
            } catch (err) {
              console.error("[Image Save] Failed:", err);
              vscode.window.showErrorMessage(
                `Failed to save image: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            break;
          }
          case "showWarning": {
            const warnMsg = (msg as { message?: string }).message;
            if (typeof warnMsg === "string") {
              vscode.window.showWarningMessage(warnMsg);
            }
            break;
          }
          case "requestImageUrlEdit": {
            const editMsg = msg as {
              editId?: string;
              currentUrl?: string;
              isLocalImage?: boolean;
              isBase64?: boolean;
            };
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
                webviewPanel.webview.postMessage({
                  type: "imageUrlEditResponse",
                  editId: editMsg.editId,
                  newUrl: newUrl ?? null,
                });
              });
            break;
          }
          case "requestLinkEdit": {
            const linkMsg = msg as { editId?: string; currentUrl?: string };
            if (!linkMsg.editId) break;
            vscode.window
              .showInputBox({
                prompt: "Enter URL",
                value: linkMsg.currentUrl || "",
                placeHolder: "https://example.com",
              })
              .then((newUrl) => {
                webviewPanel.webview.postMessage({
                  type: "linkEditResponse",
                  editId: linkMsg.editId,
                  newUrl: newUrl ?? null,
                });
              });
            break;
          }
          case "requestImageRename": {
            const renameMsg = msg as {
              renameId?: string;
              oldPath?: string;
              newPath?: string;
            };
            if (!renameMsg.renameId || !renameMsg.oldPath || !renameMsg.newPath) break;

            const { renameId, oldPath, newPath } = renameMsg;

            // Security: Validate paths to prevent path traversal attacks
            if (hasPathTraversal(oldPath) || hasPathTraversal(newPath)) {
              console.error("[Image Rename] Path traversal detected:", { oldPath, newPath });
              webviewPanel.webview.postMessage({
                type: "imageRenameResponse",
                renameId,
                success: false,
                newPath,
              });
              vscode.window.showErrorMessage("Invalid path: path traversal detected");
              break;
            }

            (async () => {
              try {
                // Resolve paths
                const documentFolder = vscode.Uri.joinPath(document.uri, "..");
                const oldUri = vscode.Uri.joinPath(documentFolder, oldPath);
                const newUri = vscode.Uri.joinPath(documentFolder, newPath);

                // Create parent directory if not exists
                const newDir = vscode.Uri.joinPath(documentFolder, newPath, "..");
                try {
                  await vscode.workspace.fs.createDirectory(newDir);
                } catch {
                  // Directory may already exist
                }

                // Execute rename
                await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });

                // Update document content with new path
                const currentText = document.getText();
                // Escape regex special chars and use context-aware replacement
                const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                // Match in markdown image/link contexts: ![...](...) or <img src="...">
                const updatedText = currentText.replace(
                  new RegExp(`(\\]\\(|src=["'])${escapedOld}([)"'])`, "g"),
                  `$1${newPath}$2`
                );
                if (updatedText !== currentText) {
                  pendingEdit = true;
                  try {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                      document.positionAt(0),
                      document.positionAt(currentText.length),
                    );
                    edit.replace(document.uri, fullRange, updatedText);
                    await vscode.workspace.applyEdit(edit);
                  } finally {
                    queueMicrotask(() => { pendingEdit = false; });
                  }
                }

                // Update originalImagePaths
                const originalMap = this.originalImagePaths.get(docKey);
                if (originalMap) {
                  originalMap.delete(oldPath);
                  originalMap.set(newPath, newUri.fsPath);
                }

                // Build webviewUri for new path
                const webviewUri = webviewPanel.webview.asWebviewUri(newUri).toString();

                // Send success response
                webviewPanel.webview.postMessage({
                  type: "imageRenameResponse",
                  renameId,
                  success: true,
                  newPath,
                  webviewUri,
                });

                // Update workspace references
                await updateWorkspaceReferences([{
                  oldRelative: oldPath,
                  newRelative: newPath,
                  oldAbsolute: oldUri.fsPath,
                  newAbsolute: newUri.fsPath,
                }], document.uri);

              } catch (err) {
                console.error("[Image Rename] Failed:", err);
                webviewPanel.webview.postMessage({
                  type: "imageRenameResponse",
                  renameId,
                  success: false,
                  newPath,
                });
                vscode.window.showWarningMessage(
                  `Failed to rename image: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            })();
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
          e.affectsConfiguration("tuiMarkdown.highlightCurrentLine")
        ) {
          sendConfig();
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
      this.originalImagePaths.delete(docKey);
      if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
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
        <style>
          :root {
            --editor-font-scale: 1;
            --heading-h1-size: 32px;
            --heading-h2-size: 28px;
            --heading-h3-size: 24px;
            --heading-h4-size: 20px;
            --heading-h5-size: 18px;
            --heading-h6-size: 16px;
            --heading-h1-margin: 32px;
            --heading-h2-margin: 28px;
            --heading-h3-margin: 24px;
            --heading-h4-margin: 20px;
            --heading-h5-margin: 16px;
            --heading-h6-margin: 16px;
            --heading-h1-margin-bottom: 12px;
            --heading-h2-margin-bottom: 10px;
            --heading-h3-margin-bottom: 8px;
            --heading-h4-margin-bottom: 8px;
            --heading-h5-margin-bottom: 6px;
            --heading-h6-margin-bottom: 6px;
            --content-max-width: 1200px;
          }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
          }
          .tiptap {
            padding: 10px 40px 100px 40px;
            caret-color: var(--crepe-color-primary);
          }
          /* Override body text font size only (headings unchanged) */
          .tiptap p,
          .tiptap blockquote {
            font-size: calc(16px * var(--editor-font-scale, 1));
            line-height: calc(24px * var(--editor-font-scale, 1));
          }
          /* Override VSCode default blockquote styles to match theme */
          .tiptap blockquote {
            background: var(--crepe-color-surface);
            border-color: var(--crepe-color-outline);
            overflow: hidden;
          }
          .tiptap li {
            font-size: calc(16px * var(--editor-font-scale, 1));
            gap: calc(10px * var(--editor-font-scale, 1)) !important;
          }
          .tiptap li p {
            margin-block: 4px !important;
          }
          /* Task list (checkbox) styles */
          .tiptap ul[data-type="taskList"] {
            list-style: none;
            padding-left: 0;
          }
          .tiptap ul[data-type="taskList"] li {
            display: flex;
            align-items: flex-start;
            gap: calc(8px * var(--editor-font-scale, 1));
          }
          .tiptap ul[data-type="taskList"] li > label {
            flex-shrink: 0;
            margin-top: calc(4px * var(--editor-font-scale, 1));
            user-select: none;
          }
          .tiptap ul[data-type="taskList"] li > label input[type="checkbox"] {
            cursor: pointer;
            width: calc(16px * var(--editor-font-scale, 1));
            height: calc(16px * var(--editor-font-scale, 1));
            accent-color: var(--crepe-color-primary, var(--vscode-focusBorder));
          }
          .tiptap ul[data-type="taskList"] li > div {
            flex: 1;
          }
          .tiptap ul[data-type="taskList"] li[data-checked="true"] > div p {
            text-decoration: line-through;
            opacity: 0.6;
          }
          .tiptap code,
          .tiptap pre {
            font-size: calc(16px * var(--editor-font-scale, 1)) !important;
            line-height: calc(24px * var(--editor-font-scale, 1)) !important;
          }
          /* Heading font sizes */
          .tiptap h1,
          .tiptap h2,
          .tiptap h3,
          .tiptap h4,
          .tiptap h5,
          .tiptap h6 { position: relative; }
          .tiptap h1 { font-size: var(--heading-h1-size, 32px) !important; margin-top: var(--heading-h1-margin, 32px) !important; margin-bottom: var(--heading-h1-margin-bottom, 12px) !important; }
          .tiptap h2 { font-size: var(--heading-h2-size, 28px) !important; margin-top: var(--heading-h2-margin, 28px) !important; margin-bottom: var(--heading-h2-margin-bottom, 10px) !important; }
          .tiptap h3 { font-size: var(--heading-h3-size, 24px) !important; margin-top: var(--heading-h3-margin, 24px) !important; margin-bottom: var(--heading-h3-margin-bottom, 8px) !important; }
          .tiptap h4 { font-size: var(--heading-h4-size, 20px) !important; margin-top: var(--heading-h4-margin, 20px) !important; margin-bottom: var(--heading-h4-margin-bottom, 8px) !important; }
          .tiptap h5 { font-size: var(--heading-h5-size, 18px) !important; margin-top: var(--heading-h5-margin, 16px) !important; margin-bottom: var(--heading-h5-margin-bottom, 6px) !important; }
          .tiptap h6 { font-size: var(--heading-h6-size, 16px) !important; margin-top: var(--heading-h6-margin, 16px) !important; margin-bottom: var(--heading-h6-margin-bottom, 6px) !important; }

          /* Line highlight for current cursor position */
          .tiptap .line-highlight {
            position: relative;
            z-index: 0; /* Create stacking context so ::after z-index:-1 stays above parent bg */
          }
          .tiptap .line-highlight::after {
            content: '';
            position: absolute;
            top: -4px;
            bottom: -4px;
            left: -4px;
            right: -4px;
            border-radius: 3px;
            background: rgba(0, 0, 0, 0.08);
            pointer-events: none;
            z-index: -1;
          }
          /* Dark themes override (body.dark-theme set by applyTheme) */
          body.dark-theme .tiptap .line-highlight::after {
            background: rgba(255, 255, 255, 0.08);
          }

          #toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 100;
            flex-wrap: wrap;
          }
          .toolbar-group {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .toolbar-separator {
            width: 1px;
            height: 20px;
            background: var(--vscode-panel-border);
            margin: 0 4px;
          }
          .toolbar-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-editor-foreground);
            font-size: 13px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.1s ease;
            opacity: 0.8;
          }
          .toolbar-btn:hover {
            background: var(--vscode-list-hoverBackground);
            opacity: 1;
          }
          .toolbar-btn.is-active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
            opacity: 1;
          }
          .toolbar-btn svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
          }
          #heading-select {
            padding: 2px 4px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            height: 28px;
          }
          .toolbar-spacer { flex: 1; }
          #theme-select {
            padding: 2px 4px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            height: 28px;
          }
          .view-source-btn {
            padding: 4px 10px;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            color: var(--vscode-button-secondaryForeground);
            font-size: 12px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.15s ease;
            height: 28px;
          }
          .view-source-btn:hover {
            background: var(--vscode-list-hoverBackground);
          }

          #editor-container {
            height: calc(100vh - 40px);
            overflow-x: hidden;
            overflow-y: auto;
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
          #table-context.hidden { display: none; }

          /* Responsive editor content for large screens */
          .tiptap {
            max-width: var(--content-max-width, 1200px);
            margin-left: auto;
            margin-right: auto;
          }
          @media (max-width: 1200px) {
            .tiptap { max-width: 100%; }
          }

          /* Table auto-width: columns size proportionally to content */
          .tiptap table {
            table-layout: auto;
            width: 100%;
            border-collapse: collapse;
          }
          .tiptap th,
          .tiptap td {
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          /* Theme inverse colors at body level (for elements outside .tiptap) */
          body.theme-frame { --overlay-bg: #f0f0f0; --overlay-fg: #1a1a1a; }
          body.theme-frame-dark { --overlay-bg: #2a2a2a; --overlay-fg: #e0e0e0; }
          body.theme-nord { --overlay-bg: #2e3135; --overlay-fg: #eff0f7; }
          body.theme-nord-dark { --overlay-bg: #e1e2e8; --overlay-fg: #2e3135; }
          body.theme-crepe { --overlay-bg: #362f27; --overlay-fg: #fcefe2; }
          body.theme-crepe-dark { --overlay-bg: #ede0d4; --overlay-fg: #362f27; }
          body.theme-catppuccin-latte { --overlay-bg: #dce0e8; --overlay-fg: #4c4f69; }
          body.theme-catppuccin-frappe { --overlay-bg: #232634; --overlay-fg: #c6d0f5; }
          body.theme-catppuccin-macchiato { --overlay-bg: #181926; --overlay-fg: #cad3f5; }
          body.theme-catppuccin-mocha { --overlay-bg: #11111b; --overlay-fg: #cdd6f4; }

          /* Floating image edit overlay - positioned outside editor DOM */
          .image-edit-overlay {
            position: absolute;
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            transition: opacity 80ms ease-out, visibility 80ms ease-out;
          }
          .image-edit-overlay.visible {
            pointer-events: auto;
            opacity: 1;
            visibility: visible;
          }
          .image-edit-overlay .image-edit-btn {
            width: 32px;
            height: 32px;
            padding: 6px;
            border: none;
            border-radius: 50%;
            background: var(--overlay-bg);
            color: var(--overlay-fg);
            opacity: 0.6;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .image-edit-overlay .image-edit-btn:hover {
            opacity: 1;
          }
          .image-edit-overlay .image-edit-btn svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
          }

          /* Heading level badges (H1, H2, etc.) */
          .heading-level-badge {
            position: absolute;
            left: -15px;
            top: 3px;
            font-size: 11px;
            font-weight: 500;
            opacity: 0.5;
            user-select: none;
            pointer-events: none;
            font-family: var(--vscode-editor-font-family, monospace);
          }
          /* Light themes */
          body.theme-frame .heading-level-badge,
          body.theme-nord .heading-level-badge,
          body.theme-crepe .heading-level-badge,
          body.theme-catppuccin-latte .heading-level-badge {
            color: rgba(0, 0, 0, 0.6);
          }
          /* Dark themes (body.dark-theme set by applyTheme) */
          body.dark-theme .heading-level-badge {
            color: rgba(255, 255, 255, 0.5);
          }

          /* Base Tiptap editor styles */
          .tiptap {
            outline: none;
            font-family: var(--crepe-font-default, "Inter", Arial, Helvetica, sans-serif);
            color: var(--crepe-color-on-background, inherit);
            background: var(--crepe-color-background, transparent);
          }
          .tiptap img {
            max-width: 100%;
            height: auto;
          }
          .tiptap code {
            color: var(--crepe-color-inline-code, #ba1a1a);
            background: var(--crepe-color-surface, #f7f7f7);
            padding: 2px 4px;
            border-radius: 4px;
            font-family: var(--crepe-font-code, monospace);
          }
          .tiptap mark {
            background-color: var(--crepe-color-highlight, #fff3b0);
            color: inherit;
            padding: 1px 2px;
            border-radius: 2px;
          }
          .tiptap pre {
            background: var(--crepe-color-surface, #f7f7f7);
            border-radius: 8px;
            padding: 12px 16px;
            overflow-x: auto;
          }
          .tiptap pre code {
            color: inherit;
            background: none;
            padding: 0;
          }
          /* Syntax highlighting (lowlight/highlight.js) - Light themes */
          .tiptap pre code .hljs-comment,
          .tiptap pre code .hljs-quote { color: #6a737d; font-style: italic; }
          .tiptap pre code .hljs-keyword,
          .tiptap pre code .hljs-selector-tag,
          .tiptap pre code .hljs-addition { color: #d73a49; }
          .tiptap pre code .hljs-string,
          .tiptap pre code .hljs-meta .hljs-string,
          .tiptap pre code .hljs-regexp,
          .tiptap pre code .hljs-addition { color: #032f62; }
          .tiptap pre code .hljs-number,
          .tiptap pre code .hljs-literal,
          .tiptap pre code .hljs-variable,
          .tiptap pre code .hljs-template-variable,
          .tiptap pre code .hljs-tag .hljs-attr { color: #005cc5; }
          .tiptap pre code .hljs-type,
          .tiptap pre code .hljs-title,
          .tiptap pre code .hljs-section,
          .tiptap pre code .hljs-name,
          .tiptap pre code .hljs-selector-id,
          .tiptap pre code .hljs-selector-class { color: #6f42c1; }
          .tiptap pre code .hljs-attribute { color: #005cc5; }
          .tiptap pre code .hljs-built_in,
          .tiptap pre code .hljs-builtin-name { color: #e36209; }
          .tiptap pre code .hljs-deletion { color: #b31d28; background: #ffeef0; }
          .tiptap pre code .hljs-meta { color: #735c0f; }
          .tiptap pre code .hljs-emphasis { font-style: italic; }
          .tiptap pre code .hljs-strong { font-weight: bold; }
          .tiptap pre code .hljs-link { text-decoration: underline; }
          /* Syntax highlighting - Dark themes (body.dark-theme set by applyTheme) */
          body.dark-theme .tiptap pre code .hljs-comment,
          body.dark-theme .tiptap pre code .hljs-quote { color: #8b949e; font-style: italic; }
          body.dark-theme .tiptap pre code .hljs-keyword,
          body.dark-theme .tiptap pre code .hljs-selector-tag { color: #ff7b72; }
          body.dark-theme .tiptap pre code .hljs-string,
          body.dark-theme .tiptap pre code .hljs-regexp { color: #a5d6ff; }
          body.dark-theme .tiptap pre code .hljs-number,
          body.dark-theme .tiptap pre code .hljs-literal,
          body.dark-theme .tiptap pre code .hljs-variable,
          body.dark-theme .tiptap pre code .hljs-template-variable,
          body.dark-theme .tiptap pre code .hljs-tag .hljs-attr { color: #79c0ff; }
          body.dark-theme .tiptap pre code .hljs-type,
          body.dark-theme .tiptap pre code .hljs-title,
          body.dark-theme .tiptap pre code .hljs-section,
          body.dark-theme .tiptap pre code .hljs-name,
          body.dark-theme .tiptap pre code .hljs-selector-id,
          body.dark-theme .tiptap pre code .hljs-selector-class { color: #d2a8ff; }
          body.dark-theme .tiptap pre code .hljs-attribute { color: #79c0ff; }
          body.dark-theme .tiptap pre code .hljs-built_in,
          body.dark-theme .tiptap pre code .hljs-builtin-name { color: #ffa657; }
          body.dark-theme .tiptap pre code .hljs-deletion { color: #ffa198; background: rgba(248,81,73,0.15); }
          body.dark-theme .tiptap pre code .hljs-addition { color: #7ee787; background: rgba(63,185,80,0.15); }
          body.dark-theme .tiptap pre code .hljs-meta { color: #d29922; }
          .tiptap blockquote {
            border-left: 3px solid var(--crepe-color-outline, #a8a8a8);
            margin-left: 0;
            padding: 0px 16px;
          }

          /* GitHub-style Alerts / Admonitions */
          .tiptap .alert {
            border-left: 4px solid;
            border-radius: 6px;
            padding: 12px 16px;
            margin: 12px 0;
          }
          .tiptap .alert p:first-child { margin-top: 0; }
          .tiptap .alert p:last-child { margin-bottom: 0; }
          .tiptap .alert::before {
            display: block;
            font-weight: 600;
            font-size: calc(14px * var(--editor-font-scale, 1));
            margin-bottom: 6px;
          }

          /* NOTE - Blue */
          .tiptap .alert-note {
            border-color: #2f81f7;
            background: rgba(47, 129, 247, 0.08);
          }
          .tiptap .alert-note::before { content: "📝 Note"; color: #2f81f7; }

          /* TIP - Green */
          .tiptap .alert-tip {
            border-color: #3fb950;
            background: rgba(63, 185, 80, 0.08);
          }
          .tiptap .alert-tip::before { content: "💡 Tip"; color: #3fb950; }

          /* IMPORTANT - Purple */
          .tiptap .alert-important {
            border-color: #a371f7;
            background: rgba(163, 113, 247, 0.08);
          }
          .tiptap .alert-important::before { content: "❗ Important"; color: #a371f7; }

          /* WARNING - Yellow/Orange */
          .tiptap .alert-warning {
            border-color: #d29922;
            background: rgba(210, 153, 34, 0.08);
          }
          .tiptap .alert-warning::before { content: "⚠️ Warning"; color: #d29922; }

          /* CAUTION - Red */
          .tiptap .alert-caution {
            border-color: #f85149;
            background: rgba(248, 81, 73, 0.08);
          }
          .tiptap .alert-caution::before { content: "🔴 Caution"; color: #f85149; }

          /* Dark theme overrides for alerts */
          body.dark-theme .tiptap .alert-note { background: rgba(47, 129, 247, 0.12); }
          body.dark-theme .tiptap .alert-tip { background: rgba(63, 185, 80, 0.12); }
          body.dark-theme .tiptap .alert-important { background: rgba(163, 113, 247, 0.12); }
          body.dark-theme .tiptap .alert-warning { background: rgba(210, 153, 34, 0.12); }
          body.dark-theme .tiptap .alert-caution { background: rgba(248, 81, 73, 0.12); }

          .tiptap hr {
            border: none;
            border-top: 1px solid var(--crepe-color-outline, #a8a8a8);
            margin: 16px 0;
          }
          .tiptap a {
            color: var(--crepe-color-primary, #37618e);
            text-decoration: underline;
          }
          /* Placeholder styling */
          .tiptap p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: var(--crepe-color-outline, #a8a8a8);
            pointer-events: none;
            height: 0;
          }
          /* Table styles */
          .tiptap table th,
          .tiptap table td {
            border: 1px solid var(--crepe-color-outline, #a8a8a8);
            padding: 6px 10px;
          }
          .tiptap table th {
            background: var(--crepe-color-surface, #f7f7f7);
            font-weight: 600;
          }
          /* Compact spacing for elements inside table cells */
          .tiptap table p {
            margin: 2px 0;
          }
          .tiptap table ul,
          .tiptap table ol {
            margin: 2px 0;
            padding-left: 20px;
          }
          .tiptap table pre {
            margin: 2px 0;
            padding: 6px 10px;
          }
          /* Cell selection highlight (ProseMirror adds .selectedCell automatically) */
          .tiptap table td,
          .tiptap table th {
            position: relative;
          }
          .tiptap table .selectedCell::after {
            content: '';
            position: absolute;
            left: 0; right: 0; top: 0; bottom: 0;
            background: rgba(200, 200, 255, 0.4);
            pointer-events: none;
            z-index: 2;
          }
          body.dark-theme .tiptap table .selectedCell::after {
            background: rgba(100, 100, 200, 0.3);
          }
          /* Table right-click context menu */
          .table-context-menu {
            position: absolute;
            z-index: 1000;
            min-width: 180px;
            background: var(--vscode-menu-background, var(--vscode-editor-background, #fff));
            border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border, #ccc));
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 4px 0;
            font-size: 13px;
            color: var(--vscode-menu-foreground, var(--vscode-editor-foreground, #333));
          }
          .table-ctx-item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 6px 12px;
            border: none;
            background: transparent;
            color: inherit;
            font-size: 13px;
            cursor: pointer;
            text-align: left;
          }
          .table-ctx-item:hover {
            background: var(--vscode-list-hoverBackground, rgba(0,0,0,0.06));
          }
          .table-ctx-icon {
            width: 20px;
            text-align: center;
            flex-shrink: 0;
            font-size: 12px;
          }
          .table-ctx-label {
            flex: 1;
          }
          .table-ctx-divider {
            height: 1px;
            background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border, #ddd));
            margin: 4px 0;
          }

          /* Mermaid diagram preview */
          .mermaid-preview {
            margin: 8px 0 16px 0;
            padding: 16px;
            border: 1px solid var(--crepe-color-outline, #ccc);
            border-radius: 8px;
            background: var(--crepe-color-surface, #fafafa);
            text-align: center;
            overflow-x: auto;
            user-select: none;
          }
          .mermaid-preview svg {
            max-width: 100%;
            height: auto;
          }
          .mermaid-preview.mermaid-error {
            border-color: var(--vscode-inputValidation-errorBorder, #be1100);
            background: var(--vscode-inputValidation-errorBackground, rgba(190,17,0,0.05));
            text-align: left;
          }
          .mermaid-preview .mermaid-err-msg {
            color: var(--vscode-errorForeground, #be1100);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .mermaid-preview .mermaid-loading {
            color: var(--vscode-descriptionForeground, #888);
            font-size: 12px;
            font-style: italic;
          }
          body.dark-theme .mermaid-preview {
            background: rgba(255, 255, 255, 0.03);
          }

        </style>
      </head>
      <body style="background: var(--vscode-editor-background, #1e1e1e);">
        <div id="toolbar">
          <!-- Text formatting -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="bold" title="Bold (Ctrl+B)" aria-label="Bold">
              <svg viewBox="0 0 24 24"><path d="M13.5 15.5H10V12.5H13.5A1.5 1.5 0 0 1 15 14A1.5 1.5 0 0 1 13.5 15.5M10 6.5H13A1.5 1.5 0 0 1 14.5 8A1.5 1.5 0 0 1 13 9.5H10M15.6 10.79C16.57 10.11 17.25 9 17.25 8A4 4 0 0 0 13 4H7V18H14.04A3.96 3.96 0 0 0 17.5 14C17.5 12.31 16.73 11.41 15.6 10.79Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="italic" title="Italic (Ctrl+I)" aria-label="Italic">
              <svg viewBox="0 0 24 24"><path d="M10 4V7H12.21L8.79 15H6V18H14V15H11.79L15.21 7H18V4H10Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="strike" title="Strikethrough" aria-label="Strikethrough">
              <svg viewBox="0 0 24 24"><path d="M3 14H21V12H3M5 4V7H10V10H14V7H19V4M10 19H14V16H10V19Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="code" title="Inline Code (Ctrl+E)" aria-label="Inline Code">
              <svg viewBox="0 0 24 24"><path d="M14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="highlight" title="Highlight" aria-label="Highlight">
              <svg viewBox="0 0 24 24"><path d="M15.24 2.86l5.9 5.78-8.22 8.56-1.4-.06-4.5 4.7-.84-5.3 8.22-8.56.84-5.12m-1-2.86L12.5 7.56 3.56 16.84 5 24l7.28-7.56L21.22 8l2.78-8h-9.76z"/></svg>
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
              <svg viewBox="0 0 24 24"><path d="M7 5H21V7H7V5M7 13V11H21V13H7M4 4.5A1.5 1.5 0 0 1 5.5 6A1.5 1.5 0 0 1 4 7.5A1.5 1.5 0 0 1 2.5 6A1.5 1.5 0 0 1 4 4.5M4 10.5A1.5 1.5 0 0 1 5.5 12A1.5 1.5 0 0 1 4 13.5A1.5 1.5 0 0 1 2.5 12A1.5 1.5 0 0 1 4 10.5M7 19V17H21V19H7M4 16.5A1.5 1.5 0 0 1 5.5 18A1.5 1.5 0 0 1 4 19.5A1.5 1.5 0 0 1 2.5 18A1.5 1.5 0 0 1 4 16.5Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="orderedList" title="Ordered List" aria-label="Ordered List">
              <svg viewBox="0 0 24 24"><path d="M7 13V11H21V13H7M7 19V17H21V19H7M7 7V5H21V7H7M3 8V5H2V4H4V8H3M2 17V16H5V20H2V19H4V18.5H3V17.5H4V17H2M4.25 10C4.44 9.81 4.55 9.55 4.5 9.27C4.45 9 4.22 8.79 3.95 8.76C3.67 8.72 3.42 8.88 3.31 9.13L2.31 8.87C2.56 8.21 3.22 7.76 3.96 7.8C4.71 7.84 5.34 8.38 5.45 9.12C5.56 9.86 5.13 10.55 4.45 10.78L2 11.5V12.5H5V11.5L4.25 10Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="taskList" title="Task List" aria-label="Task List">
              <svg viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M19 19H5V5H19V19M17.99 9L16.58 7.58L9.99 14.17L7.41 11.6L5.99 13.01L9.99 17L17.99 9Z"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Block elements -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="blockquote" title="Blockquote" aria-label="Blockquote">
              <svg viewBox="0 0 24 24"><path d="M14 17H17L19 13V7H13V13H16L14 17M6 17H9L11 13V7H5V13H8L6 17Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="codeBlock" title="Code Block" aria-label="Code Block">
              <svg viewBox="0 0 24 24"><path d="M19 3H5C3.89 3 3 3.89 3 5V19C3 20.11 3.89 21 5 21H19C20.11 21 21 20.11 21 19V5C21 3.89 20.11 3 19 3M19 19H5V5H19V19M11.5 16.5L6.5 12L11.5 7.5L12.91 8.91L9.33 12L12.91 15.09L11.5 16.5M17.5 12L12.5 16.5L11.09 15.09L14.67 12L11.09 8.91L12.5 7.5L17.5 12Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="horizontalRule" title="Horizontal Rule" aria-label="Horizontal Rule">
              <svg viewBox="0 0 24 24"><path d="M19 13H5V11H19V13Z"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <!-- Table & Image -->
          <div class="toolbar-group">
            <button class="toolbar-btn" data-command="insertTable" title="Insert Table" aria-label="Insert Table">
              <svg viewBox="0 0 24 24"><path d="M5 4H19A2 2 0 0 1 21 6V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18V6A2 2 0 0 1 5 4M5 8V12H11V8H5M13 8V12H19V8H13M5 14V18H11V14H5M13 14V18H19V14H13Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="link" title="Insert Link (Ctrl+K)" aria-label="Insert Link">
              <svg viewBox="0 0 24 24"><path d="M3.9 12C3.9 10.29 5.29 8.9 7 8.9H11V7H7A5 5 0 0 0 2 12A5 5 0 0 0 7 17H11V15.1H7C5.29 15.1 3.9 13.71 3.9 12M8 13H16V11H8V13M17 7H13V8.9H17C18.71 8.9 20.1 10.29 20.1 12C20.1 13.71 18.71 15.1 17 15.1H13V17H17A5 5 0 0 0 22 12A5 5 0 0 0 17 7Z"/></svg>
            </button>
          </div>

          <!-- Table context actions (visible only when cursor is inside a table) -->
          <div id="table-context" class="toolbar-group hidden">
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" data-command="addColumnBefore" title="Add Column Before" aria-label="Add Column Before">
              <svg viewBox="0 0 24 24"><path d="M13 2H21V22H13V20H19V4H13V2M11 8H9V11H6V13H9V16H11V13H14V11H11V8Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="addColumnAfter" title="Add Column After" aria-label="Add Column After">
              <svg viewBox="0 0 24 24"><path d="M11 2H3V22H11V20H5V4H11V2M15 8H13V11H10V13H13V16H15V13H18V11H15V8Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="addRowAfter" title="Add Row Below" aria-label="Add Row Below">
              <svg viewBox="0 0 24 24"><path d="M22 3H2V13H22V3M20 11H4V5H20V11M13 15H11V18H8V20H11V23H13V20H16V18H13V15Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteColumn" title="Delete Column" aria-label="Delete Column">
              <svg viewBox="0 0 24 24"><path d="M4 2H10V4H4V20H10V22H4A2 2 0 0 1 2 20V4A2 2 0 0 1 4 2M20 2H14V4H20V20H14V22H20A2 2 0 0 0 22 20V4A2 2 0 0 0 20 2M14.59 8L12 10.59L9.41 8L8 9.41L10.59 12L8 14.59L9.41 16L12 13.41L14.59 16L16 14.59L13.41 12L16 9.41L14.59 8Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteRow" title="Delete Row" aria-label="Delete Row">
              <svg viewBox="0 0 24 24"><path d="M2 4H22V10H20V6H4V10H2V4M2 20H22V14H20V18H4V14H2V20M14.59 8L12 10.59L9.41 8L8 9.41L10.59 12L8 14.59L9.41 16L12 13.41L14.59 16L16 14.59L13.41 12L16 9.41L14.59 8Z"/></svg>
            </button>
            <button class="toolbar-btn" data-command="deleteTable" title="Delete Table" aria-label="Delete Table">
              <svg viewBox="0 0 24 24"><path d="M15.46 15.12L16.88 16.54L19 14.41L21.12 16.54L22.54 15.12L20.41 13L22.54 10.88L21.12 9.46L19 11.59L16.88 9.46L15.46 10.88L17.59 13L15.46 15.12M4 3H18A2 2 0 0 1 20 5V8.17C19.5 8.06 19 8 18.5 8H14V5H10V8H4V12H10V14H4V18H13.08C13.2 18.72 13.45 19.39 13.82 20H4A2 2 0 0 1 2 18V5A2 2 0 0 1 4 3Z"/></svg>
            </button>
          </div>

          <div class="toolbar-spacer"></div>

          <!-- Theme & View Source (right side) -->
          <div class="toolbar-group">
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
            </select>
            <button id="btn-source" class="view-source-btn" aria-label="View source in text editor">Source</button>
          </div>
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
