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

// Image URL helpers
function isRemoteUrl(url: string): boolean {
  return /^(https?:\/\/|data:)/i.test(url);
}

/**
 * Clean image path by removing title/caption and angle brackets.
 * Handles: `path "title"`, `path 'title'`, `<path>`, `<path> "title"`
 */
function cleanImagePath(rawPath: string): string {
  let p = rawPath.trim();

  // Handle angle brackets: <path> or <path with spaces>
  if (p.startsWith("<")) {
    const endBracket = p.indexOf(">");
    if (endBracket !== -1) {
      p = p.slice(1, endBracket);
    }
    return p.trim();
  }

  // Remove title: `path "title"` or `path 'title'`
  // Space + quote indicates title separator
  const titleSeparator = p.search(/\s+["']/);
  if (titleSeparator !== -1) {
    p = p.slice(0, titleSeparator);
  }

  return p.trim();
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

  console.log("[Image Rename] buildOriginalImageMap - extracted paths:", paths);

  for (const imgPath of paths) {
    if (isRemoteUrl(imgPath)) {
      console.log("[Image Rename] Skipping remote URL:", imgPath);
      continue;
    }
    const resolved = resolveImagePath(imgPath, documentUri);
    if (resolved) {
      // Use normalized path as key for consistent comparison
      const normalizedPath = normalizePath(imgPath);
      map.set(normalizedPath, resolved.fsPath);
      console.log("[Image Rename] Added to map:", normalizedPath, "→", resolved.fsPath);
    }
  }
  console.log("[Image Rename] buildOriginalImageMap - result size:", map.size);
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
              const docFolderPrefix = documentFolder.fsPath.endsWith('/') || documentFolder.fsPath.endsWith('\\')
                ? documentFolder.fsPath
                : documentFolder.fsPath + '/';
              if (!imageFolder.fsPath.startsWith(docFolderPrefix)) {
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
                    pendingEdit = false;
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
          .tiptap h1 { font-size: var(--heading-h1-size, 32px) !important; margin-top: var(--heading-h1-margin, 24px) !important; }
          .tiptap h2 { font-size: var(--heading-h2-size, 28px) !important; margin-top: var(--heading-h2-margin, 20px) !important; }
          .tiptap h3 { font-size: var(--heading-h3-size, 24px) !important; margin-top: var(--heading-h3-margin, 16px) !important; }
          .tiptap h4 { font-size: var(--heading-h4-size, 20px) !important; margin-top: var(--heading-h4-margin, 12px) !important; }
          .tiptap h5 { font-size: var(--heading-h5-size, 18px) !important; margin-top: var(--heading-h5-margin, 8px) !important; }
          .tiptap h6 { font-size: var(--heading-h6-size, 16px) !important; margin-top: var(--heading-h6-margin, 8px) !important; }

          /* Line highlight for current cursor position */
          .tiptap .line-highlight {
            position: relative;
            z-index: 0; /* Create stacking context so ::after z-index:-1 stays above parent bg */
          }
          .tiptap .line-highlight::after {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            right: 0;
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
            font-family: var(--crepe-font-default, "Noto Sans", Arial, Helvetica, sans-serif);
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
            padding-left: 16px;
          }
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
            padding: 8px 12px;
          }
          .tiptap table th {
            background: var(--crepe-color-surface, #f7f7f7);
            font-weight: 600;
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
            <option value="crepe">Crepe</option>
            <option value="crepe-dark">Crepe Dark</option>
            <option value="catppuccin-latte">Catppuccin Latte</option>
            <option value="catppuccin-frappe">Catppuccin Frappé</option>
            <option value="catppuccin-macchiato">Catppuccin Macchiato</option>
            <option value="catppuccin-mocha">Catppuccin Mocha</option>
          </select>
          <button id="btn-source" class="view-source-btn" aria-label="View source in text editor">View Source</button>
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
