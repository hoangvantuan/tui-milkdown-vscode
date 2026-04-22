import * as path from "path";
import { exec } from "child_process";
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

  /** Cached system font list — enumerated once, shared across all editors */
  private static cachedFonts: string[] | null = null;

  constructor(private readonly context: vscode.ExtensionContext) { }

  /** Enumerate system font families (cached after first call) */
  private async getSystemFonts(): Promise<string[]> {
    if (MarkdownEditorProvider.cachedFonts) {
      return MarkdownEditorProvider.cachedFonts;
    }

    const fonts = await new Promise<string[]>((resolve) => {
      const platform = process.platform;
      let cmd: string;

      if (platform === "darwin") {
        // macOS: use NSFontManager via JXA (fast, reliable, no dependencies)
        cmd = `osascript -l JavaScript -e 'ObjC.import("AppKit"); var fm = $.NSFontManager.sharedFontManager; var f = fm.availableFontFamilies; var r = []; for (var i = 0; i < f.count; i++) r.push(f.objectAtIndex(i).js); JSON.stringify(r);'`;
      } else if (platform === "win32") {
        cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"`;
      } else {
        cmd = `fc-list : family`;
      }

      exec(cmd, { timeout: 15000 }, (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        let result: string[];
        if (platform === "darwin") {
          try {
            result = JSON.parse(stdout.trim());
          } catch {
            result = [];
          }
        } else {
          // fc-list may return comma-separated families per line
          result = stdout
            .split(/[\n,]/)
            .map((f) => f.trim())
            .filter((f) => f.length > 0);
        }

        resolve([...new Set(result)].sort((a, b) => a.localeCompare(b)));
      });
    });

    MarkdownEditorProvider.cachedFonts = fonts;
    return fonts;
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

    const getAutoHideToolbar = (): boolean => {
      const config = vscode.workspace.getConfiguration("tuiMarkdown");
      return config.get<boolean>("autoHideToolbar", false);
    };

    const sendConfig = () => {
      webviewPanel.webview.postMessage({
        type: "config",
        fontSize: getFontSize(),
        headingSizes: getHeadingSizes(),
        highlightCurrentLine: getHighlightCurrentLine(),
        autoHideToolbar: getAutoHideToolbar(),
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
            // Send saved font
            const savedFont = this.context.globalState.get<string>(
              "markdownEditorFont",
            );
            if (savedFont) {
              webviewPanel.webview.postMessage({
                type: "savedFont",
                font: savedFont,
              });
            }
            // Send saved zoom
            const savedZoom = this.context.globalState.get<number>(
              "markdownEditorZoom",
            );
            if (typeof savedZoom === "number") {
              webviewPanel.webview.postMessage({
                type: "savedZoom",
                zoom: savedZoom,
              });
            }
            sendTheme();
            sendConfig();
            updateWebview();
            // Send system fonts asynchronously (non-blocking)
            this.getSystemFonts().then((fonts) => {
              try {
                webviewPanel.webview.postMessage({
                  type: "systemFonts",
                  fonts,
                });
              } catch { /* webview disposed */ }
            });
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
          case "fontChange": {
            const font = (msg as { font?: string }).font;
            if (typeof font === "string") {
              await this.context.globalState.update(
                "markdownEditorFont",
                font || undefined, // Remove key when "Default"
              );
            }
            break;
          }
          case "zoomChange": {
            const zoom = (msg as { zoom?: number }).zoom;
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
          case "readClipboardImage": {
            // Read image from system clipboard via native command (fallback for webviews
            // where paste event clipboardData doesn't contain image items).
            try {
              const { execFile } = require("child_process") as typeof import("child_process");
              const os = require("os") as typeof import("os");
              const fs = require("fs") as typeof import("fs");
              const id = `clipboard-${Date.now()}`;
              const tmpPng = path.join(os.tmpdir(), `${id}.png`);
              const tmpTiff = path.join(os.tmpdir(), `${id}.tiff`);
              const cleanup = () => {
                try { fs.unlinkSync(tmpPng); } catch { /* ok */ }
                try { fs.unlinkSync(tmpTiff); } catch { /* ok */ }
              };

              if (process.platform === "darwin") {
                // macOS: try PNG first via osascript, fall back to TIFF + sips convert
                const script = `
                  try
                    set theImage to the clipboard as «class PNGf»
                    set theFile to open for access POSIX file "${tmpPng}" with write permission
                    write theImage to theFile
                    close access theFile
                    return "png"
                  on error
                    try
                      set theImage to the clipboard as «class TIFF»
                      set theFile to open for access POSIX file "${tmpTiff}" with write permission
                      write theImage to theFile
                      close access theFile
                      return "tiff"
                    on error
                      return "none"
                    end try
                  end try
                `;
                execFile("osascript", ["-e", script], { timeout: 5000 }, (err, stdout) => {
                  const fmt = (stdout || "").trim();
                  if (err || fmt === "none") { cleanup(); return; }

                  const finalize = () => {
                    try {
                      const buffer = fs.readFileSync(tmpPng);
                      webviewPanel.webview.postMessage({
                        type: "clipboardImage",
                        data: `data:image/png;base64,${buffer.toString("base64")}`,
                      });
                    } catch { /* read failed */ }
                    cleanup();
                  };

                  if (fmt === "tiff") {
                    // Convert TIFF → PNG via sips
                    execFile("sips", ["-s", "format", "png", tmpTiff, "--out", tmpPng],
                      { timeout: 5000 }, () => finalize());
                  } else {
                    finalize();
                  }
                });
              } else if (process.platform === "win32") {
                const psCmd = `$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${tmpPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' }`;
                execFile("powershell", ["-NoProfile", "-Command", psCmd],
                  { timeout: 5000 }, (err, stdout) => {
                    if (!err && (stdout || "").includes("ok")) {
                      try {
                        const buffer = fs.readFileSync(tmpPng);
                        webviewPanel.webview.postMessage({
                          type: "clipboardImage",
                          data: `data:image/png;base64,${buffer.toString("base64")}`,
                        });
                      } catch { /* read failed */ }
                    }
                    cleanup();
                  });
              } else {
                // Linux: try xclip (X11), fall back to wl-paste (Wayland)
                const tryCmd = (prog: string, args: string[]) => {
                  execFile(prog, args, { timeout: 5000 }, (err) => {
                    if (!err) {
                      try {
                        const buffer = fs.readFileSync(tmpPng);
                        webviewPanel.webview.postMessage({
                          type: "clipboardImage",
                          data: `data:image/png;base64,${buffer.toString("base64")}`,
                        });
                      } catch { /* read failed */ }
                      cleanup();
                    } else if (prog === "xclip") {
                      // Fallback to wl-paste for Wayland
                      tryCmd("sh", ["-c", `wl-paste --type image/png > "${tmpPng}"`]);
                    } else {
                      cleanup();
                    }
                  });
                };
                tryCmd("sh", ["-c", `xclip -selection clipboard -t image/png -o > "${tmpPng}"`]);
              }
            } catch {
              // Native clipboard read not available — ignore
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
          case "openLink": {
            const linkHref = (msg as { href?: string }).href;
            if (!linkHref) break;

            if (/^https?:\/\//.test(linkHref)) {
              // External URL → open in default browser
              vscode.env.openExternal(vscode.Uri.parse(linkHref));
            } else {
              // Relative file path → resolve against document location
              const docDir = path.dirname(document.uri.fsPath);
              // Separate file path and anchor fragment
              const hashIndex = linkHref.indexOf("#");
              const filePart = hashIndex !== -1 ? linkHref.slice(0, hashIndex) : linkHref;
              const targetPath = filePart
                ? path.resolve(docDir, filePart)
                : document.uri.fsPath;

              // Security: Validate target is within workspace or document directory
              const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
              const allowedRoot = wsFolder?.uri.fsPath || docDir;
              if (!targetPath.startsWith(allowedRoot + path.sep) && targetPath !== allowedRoot) {
                vscode.window.showWarningMessage(`Cannot open file outside workspace: ${filePart}`);
                break;
              }

              const targetUri = vscode.Uri.file(targetPath);
              vscode.workspace.openTextDocument(targetUri).then(
                (doc) => vscode.window.showTextDocument(doc),
                () => vscode.window.showWarningMessage(`Cannot open file: ${linkHref}`)
              );
            }
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
          case "export": {
            const exportMsg = msg as {
              format?: string;
              fontFamily?: string;
              mermaidImages?: { code: string; base64: string }[];
            };
            const mermaidImages = exportMsg.mermaidImages || [];
            const exportFormat = exportMsg.format || "docx";
            const fontFamily = exportMsg.fontFamily || "";

            const rawText = document.getText();
            const frontmatterRegex = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;
            const bodyMarkdown = rawText.replace(frontmatterRegex, "");

            (async () => {
              try {
                const markdownAstPath = require("path").join(__dirname, "markdown-ast.js");
                const {
                  parseMarkdownToMdast,
                  replaceMermaidBlocks,
                  hashMermaidCode,
                  mdastToMarkdown,
                } = require(markdownAstPath);

                const mdast = await parseMarkdownToMdast(bodyMarkdown);
                const imageMap = new Map<string, string>(
                  mermaidImages.map(({ code, base64 }) => [hashMermaidCode(code), base64]),
                );
                await replaceMermaidBlocks(mdast, imageMap);

                if (exportFormat === "pdf") {
                  const exportPdfPath = require("path").join(__dirname, "export-pdf.js");
                  const { exportToPdf: doExport } = require(exportPdfPath);
                  const bridgedMarkdown = await mdastToMarkdown(mdast);
                  await doExport(bridgedMarkdown, document.uri, fontFamily);
                } else {
                  const exportDocxPath = require("path").join(__dirname, "export-docx.js");
                  const { exportToDocx: doExport } = require(exportDocxPath);
                  await doExport(mdast, document.uri, fontFamily);
                }
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Export thất bại: ${errMsg}`);
                console.error("[Export]", err);
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
            /* Perfect Fourth scale (1.333 ratio) */
            --heading-h1-size: 32px;
            --heading-h2-size: 24px;
            --heading-h3-size: 20px;
            --heading-h4-size: 16px;
            --heading-h5-size: 14px;
            --heading-h6-size: 13px;
            /* Top margins — generous for section grouping */
            --heading-h1-margin: 48px;
            --heading-h2-margin: 40px;
            --heading-h3-margin: 32px;
            --heading-h4-margin: 24px;
            --heading-h5-margin: 20px;
            --heading-h6-margin: 16px;
            /* Bottom margins — tighter, pull heading toward content */
            --heading-h1-margin-bottom: 16px;
            --heading-h2-margin-bottom: 12px;
            --heading-h3-margin-bottom: 10px;
            --heading-h4-margin-bottom: 8px;
            --heading-h5-margin-bottom: 6px;
            --heading-h6-margin-bottom: 6px;
            --content-max-width: 100%;
          }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            transition: background-color 0.3s ease, color 0.3s ease;
          }
          .tiptap {
            min-height: 100%;
            padding: 32px 48px 40vh 48px;
            caret-color: var(--crepe-color-primary);
            font-optical-sizing: auto;
            transition: background-color 0.3s ease, color 0.3s ease;
          }
          /* Body text: 16px base, 1.6 line-height for readability */
          .tiptap p,
          .tiptap blockquote {
            font-size: calc(16px * var(--editor-font-scale, 1));
            line-height: calc(26px * var(--editor-font-scale, 1));
          }
          /* Paragraph spacing — vertical rhythm */
          .tiptap > p {
            margin-bottom: calc(16px * var(--editor-font-scale, 1));
          }
          /* Modern text wrapping */
          .tiptap p { text-wrap: pretty; }
          /* Ligatures on prose, off for code */
          .tiptap p,
          .tiptap li,
          .tiptap blockquote { font-feature-settings: "liga" 1; }
          /* Override VSCode default blockquote styles — clean border, no bg */
          .tiptap blockquote {
            background: transparent;
            border-color: var(--crepe-color-primary);
            overflow: hidden;
            opacity: 0.85;
            padding: 4px 20px;
            transition: border-left-width 0.15s ease-out, padding-left 0.15s ease-out;
          }
          .tiptap blockquote:hover {
            border-left-width: 4px;
            padding-left: 19px;
          }
          .tiptap li {
            font-size: calc(16px * var(--editor-font-scale, 1));
            line-height: calc(26px * var(--editor-font-scale, 1));
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
          .tiptap ul[data-type="taskList"] > li {
            display: flex;
            align-items: flex-start;
            gap: calc(8px * var(--editor-font-scale, 1));
          }
          .tiptap ul[data-type="taskList"] > li > label {
            flex-shrink: 0;
            margin-top: calc(4px * var(--editor-font-scale, 1));
            user-select: none;
          }
          .tiptap ul[data-type="taskList"] > li > label input[type="checkbox"] {
            cursor: pointer;
            width: calc(16px * var(--editor-font-scale, 1));
            height: calc(16px * var(--editor-font-scale, 1));
            accent-color: var(--crepe-color-primary, var(--vscode-focusBorder));
          }
          .tiptap ul[data-type="taskList"] > li > div {
            flex: 1;
          }
          .tiptap ul[data-type="taskList"] > li[data-checked="true"] > div p {
            text-decoration: line-through;
            opacity: 0.5;
            transition: opacity 0.2s ease-out;
          }
          .tiptap code,
          .tiptap pre {
            font-size: calc(16px * var(--editor-font-scale, 1)) !important;
            line-height: calc(24px * var(--editor-font-scale, 1)) !important;
            font-feature-settings: "liga" 0;
          }
          /* Heading font sizes — Perfect Fourth scale with tight leading */
          .tiptap h1,
          .tiptap h2,
          .tiptap h3,
          .tiptap h4,
          .tiptap h5,
          .tiptap h6 { position: relative; font-feature-settings: "liga" 0; }
          .tiptap h1 { font-size: var(--heading-h1-size, 32px) !important; margin-top: var(--heading-h1-margin, 48px) !important; margin-bottom: var(--heading-h1-margin-bottom, 16px) !important; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
          .tiptap h2 { font-size: var(--heading-h2-size, 24px) !important; margin-top: var(--heading-h2-margin, 40px) !important; margin-bottom: var(--heading-h2-margin-bottom, 12px) !important; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; }
          .tiptap h3 { font-size: var(--heading-h3-size, 20px) !important; margin-top: var(--heading-h3-margin, 32px) !important; margin-bottom: var(--heading-h3-margin-bottom, 10px) !important; font-weight: 600; line-height: 1.4; }
          .tiptap h4 { font-size: var(--heading-h4-size, 16px) !important; margin-top: var(--heading-h4-margin, 24px) !important; margin-bottom: var(--heading-h4-margin-bottom, 8px) !important; font-weight: 600; line-height: 1.4; }
          .tiptap h5 { font-size: var(--heading-h5-size, 14px) !important; margin-top: var(--heading-h5-margin, 20px) !important; margin-bottom: var(--heading-h5-margin-bottom, 6px) !important; font-weight: 600; line-height: 1.5; }
          .tiptap h6 { font-size: var(--heading-h6-size, 13px) !important; margin-top: var(--heading-h6-margin, 16px) !important; margin-bottom: var(--heading-h6-margin-bottom, 6px) !important; font-weight: 600; line-height: 1.5; color: var(--crepe-color-outline); }

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
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.04);
            pointer-events: none;
            z-index: -1;
            transition: background 0.1s ease-out;
          }
          /* Dark themes override (body.dark-theme set by applyTheme) */
          body.dark-theme .tiptap {
            box-shadow:
              0 0 0 1px rgba(var(--border-rgb, 255, 255, 255), 0.05),
              0 1px 2px rgba(0, 0, 0, 0.12),
              0 2px 4px rgba(0, 0, 0, 0.10),
              0 4px 8px rgba(0, 0, 0, 0.08),
              0 8px 16px rgba(0, 0, 0, 0.06);
          }
          body.dark-theme .tiptap .line-highlight::after {
            background: rgba(255, 255, 255, 0.05);
          }

          /* ─── Glassmorphic Toolbar ─── */
          #toolbar {
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 6px 12px;
            background: rgba(var(--toolbar-bg-rgb, 255, 255, 255), 0.8);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.08);
            color: var(--toolbar-fg, var(--vscode-editor-foreground));
            position: sticky;
            top: 0;
            z-index: 100;
            flex-wrap: wrap;
          }
          body.dark-theme #toolbar {
            background: rgba(var(--toolbar-bg-rgb, 30, 30, 30), 0.85);
            border-bottom-color: rgba(255, 255, 255, 0.08);
          }
          @supports not (backdrop-filter: blur(12px)) {
            #toolbar {
              background: var(--vscode-editor-background);
              border-bottom: 1px solid var(--vscode-panel-border);
            }
          }
          .toolbar-group {
            display: flex;
            align-items: center;
            gap: 2px;
          }
          .toolbar-separator {
            width: 1px;
            height: 16px;
            background: currentColor;
            opacity: 0.12;
            margin: 0 4px;
          }
          .toolbar-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            padding: 0;
            background: transparent;
            border: 1px solid transparent;
            color: inherit;
            cursor: pointer;
            border-radius: 6px;
            transition: background 0.15s ease-out, opacity 0.15s ease-out, transform 0.1s ease-out;
            opacity: 0.6;
          }
          .toolbar-btn:hover {
            background: var(--vscode-list-hoverBackground);
            opacity: 1;
          }
          .toolbar-btn:active {
            transform: scale(0.93);
            transition: transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .toolbar-btn.is-active {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.15);
            color: var(--accent-primary, var(--vscode-list-activeSelectionForeground));
            opacity: 1;
          }
          .toolbar-btn svg {
            width: 16px;
            height: 16px;
            stroke: currentColor;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          /* Custom select styling with appearance:none + SVG arrow */
          #heading-select,
          #theme-select {
            -webkit-appearance: none;
            appearance: none;
            background-color: rgba(var(--border-rgb, 0, 0, 0), 0.05);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 8px center;
            padding: 4px 28px 4px 10px;
            border: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.08);
            border-radius: 6px;
            height: 30px;
            color: inherit;
            cursor: pointer;
            transition: background-color 0.15s ease-out, border-color 0.15s ease-out;
          }
          #heading-select {
            font-size: 12px;
            font-weight: 500;
          }
          #theme-select {
            font-size: 11px;
          }
          #heading-select:hover,
          #theme-select:hover {
            background-color: rgba(var(--border-rgb, 0, 0, 0), 0.1);
            border-color: rgba(var(--border-rgb, 0, 0, 0), 0.15);
          }
          /* Font selector combobox */
          .font-selector {
            position: relative;
          }
          .font-selector-input {
            -webkit-appearance: none;
            appearance: none;
            background-color: rgba(var(--border-rgb, 0, 0, 0), 0.05);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 6px center;
            padding: 4px 24px 4px 8px;
            border: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.08);
            border-radius: 6px;
            height: 30px;
            width: 120px;
            color: inherit;
            cursor: pointer;
            font-size: 11px;
            transition: background-color 0.15s ease-out, border-color 0.15s ease-out;
            box-sizing: border-box;
          }
          .font-selector-input::placeholder {
            color: var(--toolbar-fg, inherit);
            opacity: 0.7;
          }
          .font-selector-input:hover {
            background-color: rgba(var(--border-rgb, 0, 0, 0), 0.1);
            border-color: rgba(var(--border-rgb, 0, 0, 0), 0.15);
          }
          .font-selector-input:focus {
            outline: none;
            border-color: rgba(var(--accent-rgb, 100, 100, 255), 0.5);
            background-image: none;
            cursor: text;
            width: 160px;
          }
          .font-selector-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            width: 220px;
            max-height: 256px;
            overflow-y: auto;
            background: var(--vscode-editor-background, #fff);
            color: var(--vscode-editor-foreground, #333);
            border: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.15);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            overscroll-behavior: contain;
          }
          .font-selector-item {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 13px;
            line-height: 20px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--vscode-editor-foreground, #333);
            transition: background-color 0.1s ease;
          }
          .font-selector-item:hover,
          .font-selector-item.highlighted {
            background-color: rgba(var(--accent-rgb, 100, 100, 255), 0.15);
          }
          .font-selector-item.selected {
            color: rgba(var(--accent-rgb, 100, 100, 255), 1);
            font-weight: 600;
          }
          .font-selector-empty {
            padding: 8px 12px;
            font-size: 12px;
            color: var(--vscode-editor-foreground, #333);
            opacity: 0.5;
            font-style: italic;
          }
          .toolbar-spacer { flex: 1; }

          .zoom-controls {
            display: inline-flex;
            align-items: center;
            gap: 0;
            height: 30px;
          }
          .zoom-btn {
            width: 24px;
            height: 24px;
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 4px;
            color: inherit;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.15s ease-out, transform 0.1s ease-out;
          }
          .zoom-btn svg {
            width: 14px;
            height: 14px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
          }
          .zoom-btn:hover {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.12);
          }
          .zoom-btn:active {
            transform: scale(0.92);
          }
          .zoom-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .zoom-display-btn {
            min-width: 36px;
            height: 24px;
            padding: 0 4px;
            background: transparent;
            border: none;
            color: inherit;
            font-size: 11px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.15s ease-out;
          }
          .zoom-display-btn:hover {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.12);
          }

          .appearance-group {
            position: relative;
            display: inline-flex;
            align-items: center;
          }
          .appearance-popover {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            z-index: 1000;
            min-width: 280px;
            max-width: calc(100vw - 16px);
            padding: 14px;
            background: var(--vscode-editorWidget-background, var(--vscode-menu-background, #252526));
            color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, #cccccc));
            border: 1px solid var(--vscode-editorWidget-border, var(--vscode-menu-border, rgba(127, 127, 127, 0.3)));
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .appearance-popover.hidden {
            display: none;
          }
          .appearance-popover .appearance-row {
            display: grid;
            grid-template-columns: 60px 1fr;
            align-items: center;
            gap: 10px;
          }
          .appearance-popover .appearance-label {
            font-size: 11px;
            font-weight: 600;
            opacity: 0.85;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: inherit;
          }
          /* Override input surfaces inside popover — need high contrast against editorWidget bg,
             not the toolbar's glass bg. Uses neutral gray tint that works for both light & dark. */
          .appearance-popover #theme-select,
          .appearance-popover .font-selector-input {
            width: 100%;
            background-color: rgba(127, 127, 127, 0.15);
            border: 1px solid rgba(127, 127, 127, 0.25);
            color: inherit;
          }
          .appearance-popover #theme-select:hover,
          .appearance-popover .font-selector-input:hover {
            background-color: rgba(127, 127, 127, 0.22);
          }
          .appearance-popover #theme-select:focus,
          .appearance-popover .font-selector-input:focus {
            border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.6);
            outline: none;
          }
          .appearance-popover #font-selector-container,
          .appearance-popover #font-selector-container .font-selector {
            width: 100%;
          }
          .appearance-popover .font-selector-input::placeholder {
            color: inherit;
            opacity: 0.7;
          }
          .appearance-popover .font-selector-dropdown {
            background: var(--vscode-editorWidget-background, #252526);
            color: var(--vscode-editorWidget-foreground, #cccccc);
            border-color: var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3));
          }
          /* Zoom row inside popover — compact trio */
          .appearance-popover .zoom-controls {
            justify-content: flex-start;
            gap: 4px;
          }
          .appearance-popover .zoom-btn {
            width: 28px;
            height: 28px;
            background: rgba(127, 127, 127, 0.15);
          }
          .appearance-popover .zoom-btn:hover:not(:disabled) {
            background: rgba(127, 127, 127, 0.28);
          }
          .appearance-popover .zoom-display-btn {
            min-width: 48px;
            height: 28px;
            background: rgba(127, 127, 127, 0.1);
          }
          .appearance-popover .zoom-display-btn:hover {
            background: rgba(127, 127, 127, 0.22);
          }
          /* Export row inside popover */
          .appearance-popover .export-controls {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .appearance-popover #export-format {
            flex: 1;
            -webkit-appearance: none;
            appearance: none;
            background-color: rgba(127, 127, 127, 0.15);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 8px center;
            padding: 4px 28px 4px 10px;
            border: 1px solid rgba(127, 127, 127, 0.25);
            border-radius: 6px;
            height: 30px;
            color: inherit;
            cursor: pointer;
            font-size: 11px;
          }
          .appearance-popover #export-format:hover {
            background-color: rgba(127, 127, 127, 0.22);
          }
          .appearance-popover #export-format:focus {
            border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.6);
            outline: none;
          }
          .appearance-popover #btn-export-go {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            height: 30px;
            padding: 0 12px;
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.15);
            color: var(--accent-primary, var(--vscode-focusBorder, #3b82f6));
            border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.3);
            border-radius: 6px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            transition: background 0.15s ease-out, transform 0.1s ease-out;
          }
          .appearance-popover #btn-export-go:hover {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.25);
          }
          .appearance-popover #btn-export-go:active {
            transform: scale(0.95);
          }
          .appearance-popover #btn-export-go svg {
            width: 13px;
            height: 13px;
            stroke: currentColor;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          #btn-appearance.is-active {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.18);
          }

          #editor-container {
            flex: 1;
            min-width: 0;
            overflow-x: hidden;
            overflow-y: auto;
            position: relative;
            padding: clamp(6px, 1.5vw, 24px);
            background:
              radial-gradient(ellipse 120% 50% at 50% 0%, rgba(var(--accent-rgb, 59, 130, 246), 0.04), transparent),
              var(--canvas-bg, var(--vscode-editor-background, #1e1e1e));
          }
          /* Phase 1: Paper grain texture — pure CSS noise (CSP-safe, fixed overlay) */
          #editor-container::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image:
              repeating-radial-gradient(circle at 17% 32%, rgba(0,0,0,0.06) 0px, transparent 1px),
              repeating-radial-gradient(circle at 62% 15%, rgba(0,0,0,0.05) 0px, transparent 1px),
              repeating-radial-gradient(circle at 83% 67%, rgba(0,0,0,0.06) 0px, transparent 1px),
              repeating-radial-gradient(circle at 41% 88%, rgba(0,0,0,0.05) 0px, transparent 1px),
              repeating-radial-gradient(circle at 9% 71%, rgba(0,0,0,0.06) 0px, transparent 1px),
              repeating-radial-gradient(circle at 53% 44%, rgba(0,0,0,0.04) 0px, transparent 1px),
              repeating-radial-gradient(circle at 28% 76%, rgba(0,0,0,0.05) 0px, transparent 1px);
            background-size: 3px 3px, 4px 4px, 3px 3px, 5px 5px, 4px 4px, 2px 2px, 3px 3px;
            opacity: var(--noise-opacity, 0.6);
            pointer-events: none;
            z-index: 1;
          }
          body.dark-theme #editor-container::before {
            background-image:
              repeating-radial-gradient(circle at 17% 32%, rgba(255,255,255,0.05) 0px, transparent 1px),
              repeating-radial-gradient(circle at 62% 15%, rgba(255,255,255,0.04) 0px, transparent 1px),
              repeating-radial-gradient(circle at 83% 67%, rgba(255,255,255,0.05) 0px, transparent 1px),
              repeating-radial-gradient(circle at 41% 88%, rgba(255,255,255,0.04) 0px, transparent 1px),
              repeating-radial-gradient(circle at 9% 71%, rgba(255,255,255,0.05) 0px, transparent 1px),
              repeating-radial-gradient(circle at 53% 44%, rgba(255,255,255,0.03) 0px, transparent 1px),
              repeating-radial-gradient(circle at 28% 76%, rgba(255,255,255,0.04) 0px, transparent 1px);
          }
          /* Phase 1: Vignette effect */
          #editor-container::after {
            content: '';
            position: fixed;
            inset: 0;
            background: radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, var(--vignette-opacity, 0.06)));
            pointer-events: none;
            z-index: 1;
          }
          /* Ensure editor content sits above noise/vignette overlays */
          /* Phase 1: Reading progress bar */
          #reading-progress {
            position: fixed;
            top: 0;
            left: 0;
            height: 2px;
            background: linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.6), rgba(var(--accent-rgb, 59, 130, 246), 0.9));
            width: 0%;
            z-index: 200;
            transition: width 0.1s linear;
            pointer-events: none;
          }
          #editor { min-height: 100%; position: relative; z-index: 2; }
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

          /* Full-width editor with fluid padding */
          .tiptap {
            max-width: 1280px;
            margin-left: auto;
            margin-right: auto;
            padding-left: clamp(24px, 5vw, 80px);
            padding-right: clamp(24px, 5vw, 80px);
          }
          /* Table wrapper: horizontal scroll for wide tables */
          .tiptap .tableWrapper {
            overflow-x: auto;
            max-width: 100%;
          }
          /* Tables can overflow content width */
          .tiptap table {
            max-width: none;
            min-width: 100%;
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
            transition: opacity 0.15s ease-out;
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

          /* Heading collapse toggle arrow — overlaps badge, shown on hover */
          .heading-collapse-toggle {
            position: absolute;
            left: -15px;
            top: 3px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            opacity: 0;
            user-select: none;
            padding: 0;
            border-radius: 3px;
            transition: opacity 0.15s ease-out;
            line-height: 1;
            z-index: 2;
            color: rgba(0, 0, 0, 0.5);
            font-family: var(--vscode-editor-font-family, monospace);
          }
          /* Hover heading: hide badge, show arrow */
          .tiptap :is(h1,h2,h3,h4,h5,h6):hover .heading-collapse-toggle {
            opacity: 0.6;
          }
          .tiptap :is(h1,h2,h3,h4,h5,h6):hover .heading-level-badge {
            opacity: 0;
          }
          .heading-collapse-toggle:hover {
            opacity: 1 !important;
          }
          /* Collapsed state: always show arrow, always hide badge */
          .heading-collapsed-indicator .heading-collapse-toggle {
            opacity: 0.6;
          }
          .heading-collapsed-indicator .heading-level-badge {
            opacity: 0 !important;
          }
          body.dark-theme .heading-collapse-toggle {
            color: rgba(255, 255, 255, 0.5);
          }
          /* Hidden content under collapsed heading */
          .collapsed-content {
            display: none !important;
          }
          /* Dashed border on collapsed headings — hide gradient underline */
          .heading-collapsed-indicator {
            border-bottom: 1px dashed rgba(0, 0, 0, 0.15);
            padding-bottom: 4px;
            margin-bottom: 8px;
            background-image: none !important;
          }
          body.dark-theme .heading-collapsed-indicator {
            border-bottom-color: rgba(255, 255, 255, 0.15);
          }
          @media (prefers-reduced-motion: reduce) {
            .heading-collapse-toggle {
              transition: none;
            }
          }

          /* Base Tiptap editor styles */
          .tiptap {
            outline: none;
            font-family: var(--crepe-font-default, "Inter", Arial, Helvetica, sans-serif);
            color: var(--crepe-color-on-background, inherit);
            background: var(--crepe-color-background, transparent);
            border-radius: 6px;
            box-shadow:
              0 0 0 1px rgba(var(--border-rgb, 0, 0, 0), 0.03),
              0 1px 2px rgba(0, 0, 0, 0.04),
              0 2px 4px rgba(0, 0, 0, 0.04),
              0 4px 8px rgba(0, 0, 0, 0.03),
              0 8px 16px rgba(0, 0, 0, 0.02);
          }
          .tiptap img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
            transition: box-shadow 0.25s ease-out, transform 0.25s ease-out;
          }
          .tiptap code {
            color: var(--crepe-color-inline-code, #ba1a1a);
            background: var(--crepe-color-surface, #f7f7f7);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: var(--crepe-font-code, monospace);
            font-size: 0.9em;
          }
          .tiptap mark {
            background-color: var(--crepe-color-highlight, #fff3b0);
            color: inherit;
            padding: 1px 2px;
            border-radius: 2px;
          }
          .tiptap pre {
            position: relative;
            background: var(--crepe-color-surface, #f7f7f7);
            border-radius: 8px;
            padding: 16px 20px;
            overflow-x: auto;
            border: 1px solid transparent;
            transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
          }
          /* Gradient accent bar at top via ::after (preserves border-radius) */
          .tiptap pre::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            border-radius: 8px 8px 0 0;
            background: linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.7), rgba(var(--accent-rgb, 59, 130, 246), 0.2) 70%, transparent);
            pointer-events: none;
            transition: opacity 0.2s ease-out;
          }
          .tiptap pre:hover::after {
            background: linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.9), rgba(var(--accent-rgb, 59, 130, 246), 0.4) 70%, transparent);
          }
          .tiptap pre:hover {
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
          }
          body.dark-theme .tiptap pre:hover {
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
          }
          .tiptap pre:focus-within {
            border-color: var(--crepe-color-primary);
            box-shadow: 0 0 0 1px var(--crepe-color-primary);
          }
          .tiptap pre code {
            color: inherit;
            background: none;
            padding: 0;
            font-feature-settings: "calt" 1;
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

          /* ─── Code Block Header (language badge + copy button) ─── */
          .code-block-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.04);
            border-bottom: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.06);
            border-radius: 8px 8px 0 0;
            margin: -16px -20px 12px -20px;
            user-select: none;
          }
          body.dark-theme .code-block-header {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.06);
            border-bottom-color: rgba(255, 255, 255, 0.06);
          }
          .code-lang-badge {
            font-size: 11px;
            font-weight: 500;
            color: var(--crepe-color-on-surface, #666);
            opacity: 0.7;
            text-transform: lowercase;
            font-family: var(--crepe-font-code, monospace);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px 4px;
            border-radius: 3px;
            transition: opacity 0.15s ease-out, background 0.1s ease-out;
          }
          .code-lang-badge:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }
          body.dark-theme .code-lang-badge:hover { background: rgba(255, 255, 255, 0.1); }
          .code-lang-badge svg { opacity: 0.5; flex-shrink: 0; }
          .code-lang-dropdown {
            position: absolute;
            z-index: 1000;
            background: var(--crepe-color-surface, #fff);
            border: 1px solid rgba(0, 0, 0, 0.12);
            border-radius: 6px;
            padding: 4px 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            max-height: 240px;
            overflow-y: auto;
            min-width: 120px;
          }
          body.dark-theme .code-lang-dropdown {
            background: var(--crepe-color-surface, #1e1e2e);
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
          }
          .code-lang-item {
            padding: 5px 12px;
            font-size: 12px;
            font-family: var(--crepe-font-code, monospace);
            cursor: pointer;
            color: var(--crepe-color-on-surface, #333);
          }
          body.dark-theme .code-lang-item { color: rgba(255, 255, 255, 0.85); }
          .code-lang-item:hover { background: rgba(0, 0, 0, 0.06); }
          body.dark-theme .code-lang-item:hover { background: rgba(255, 255, 255, 0.12); }
          .code-lang-item.active { color: var(--crepe-color-primary, #2563eb); font-weight: 600; }
          body.dark-theme .code-lang-item.active { color: var(--crepe-color-primary, #89b4fa); }
          .code-copy-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: var(--crepe-color-on-background, #666);
            opacity: 0;
            transition: opacity 0.15s ease-out, background 0.1s ease-out;
          }
          .tiptap pre:hover .code-copy-btn { opacity: 0.6; }
          .code-copy-btn:hover { opacity: 1 !important; background: rgba(0, 0, 0, 0.06); }
          body.dark-theme .code-copy-btn:hover { background: rgba(255, 255, 255, 0.1); }
          .code-copy-btn.copied { opacity: 1; color: #22c55e; }

          .tiptap blockquote {
            border-left: 3px solid var(--crepe-color-primary, #2563eb);
            margin-left: 0;
            padding: 4px 20px;
            transition: border-left-width 0.15s ease-out, border-color 0.2s ease-out;
          }
          .tiptap blockquote:hover {
            border-left-width: 4px;
          }

          /* ─── Premium Alert Blocks ─── */
          .tiptap .alert {
            position: relative;
            border: 1px solid rgba(var(--alert-rgb, 0, 0, 0), 0.15);
            border-left: 4px solid var(--alert-color, #888);
            border-radius: 8px;
            padding: 14px 16px 12px 16px;
            margin: 16px 0;
            background: rgba(var(--alert-rgb, 0, 0, 0), 0.04);
            transition: border-color 0.2s ease-out, box-shadow 0.2s ease-out;
          }
          .tiptap .alert:hover {
            border-left-width: 5px;
            box-shadow: 0 2px 8px rgba(var(--alert-rgb, 0, 0, 0), 0.08);
          }
          .tiptap .alert p:first-child { margin-top: 0; }
          .tiptap .alert p:last-child { margin-bottom: 0; }
          .tiptap .alert::before {
            display: block;
            font-weight: 600;
            font-size: calc(13px * var(--editor-font-scale, 1));
            letter-spacing: 0.02em;
            line-height: 16px;
            margin-bottom: 8px;
            padding-bottom: 6px;
            padding-left: 22px;
            border-bottom: 1px solid rgba(var(--alert-rgb, 0, 0, 0), 0.1);
            color: var(--alert-color, #888);
            background-repeat: no-repeat;
            background-position: 0 0;
            background-size: 16px 16px;
          }
          .tiptap .alert-note {
            --alert-color: #2f81f7;
            --alert-rgb: 47, 129, 247;
          }
          .tiptap .alert-note::before {
            content: "Note";
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%232f81f7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E");
          }
          .tiptap .alert-tip {
            --alert-color: #3fb950;
            --alert-rgb: 63, 185, 80;
          }
          .tiptap .alert-tip::before {
            content: "Tip";
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%233fb950' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18h6'/%3E%3Cpath d='M10 22h4'/%3E%3Cpath d='M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14'/%3E%3C/svg%3E");
          }
          .tiptap .alert-important {
            --alert-color: #a371f7;
            --alert-rgb: 163, 113, 247;
          }
          .tiptap .alert-important::before {
            content: "Important";
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a371f7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z'/%3E%3Cline x1='12' y1='9' x2='12' y2='13'/%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'/%3E%3C/svg%3E");
          }
          .tiptap .alert-warning {
            --alert-color: #d29922;
            --alert-rgb: 210, 153, 34;
          }
          .tiptap .alert-warning::before {
            content: "Warning";
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23d29922' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/%3E%3Cline x1='12' y1='8' x2='12' y2='12'/%3E%3Cline x1='12' y1='16' x2='12.01' y2='16'/%3E%3C/svg%3E");
          }
          .tiptap .alert-caution {
            --alert-color: #f85149;
            --alert-rgb: 248, 81, 73;
          }
          .tiptap .alert-caution::before {
            content: "Caution";
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23f85149' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86'/%3E%3Cline x1='12' y1='8' x2='12' y2='12'/%3E%3Cline x1='12' y1='16' x2='12.01' y2='16'/%3E%3C/svg%3E");
          }
          body.dark-theme .tiptap .alert {
            background: rgba(var(--alert-rgb, 0, 0, 0), 0.08);
            border-color: rgba(var(--alert-rgb, 0, 0, 0), 0.2);
          }
          body.dark-theme .tiptap .alert::before {
            border-bottom-color: rgba(var(--alert-rgb, 0, 0, 0), 0.15);
          }
          body.dark-theme .tiptap .alert:hover {
            box-shadow: 0 2px 12px rgba(var(--alert-rgb, 0, 0, 0), 0.15);
          }

          .tiptap a {
            color: var(--crepe-color-primary, #37618e);
            text-decoration: none;
            border-bottom: 1px solid transparent;
          }
          /* Ctrl/Cmd held: pointer cursor + underline on links */
          body.ctrl-held .tiptap a {
            cursor: pointer;
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
            padding: 10px 14px;
            transition: background 0.1s ease-out;
          }
          .tiptap table th {
            background: var(--crepe-color-surface, #f7f7f7);
            font-weight: 600;
            font-size: 0.9em;
            letter-spacing: 0.02em;
          }
          /* Table row hover */
          .tiptap table tbody tr:hover td {
            background: var(--crepe-color-surface);
          }
          /* Table zebra striping */
          .tiptap table tbody tr:nth-child(even) td {
            background: color-mix(in srgb, var(--crepe-color-surface) 50%, transparent);
          }
          .tiptap table tbody tr:nth-child(even):hover td {
            background: var(--crepe-color-surface);
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

          /* ─── Mermaid View/Edit Mode ─── */

          /* Code block inside mermaid wrapper: hidden in view mode */
          .mermaid-code-block {
            position: relative;
          }
          .mermaid-code-block:not(.mermaid-editing) {
            /* Collapsed: hide the <pre> code block */
            max-height: 0 !important;
            overflow: hidden !important;
            opacity: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
          }

          /* Edit mode: reveal the code block with smooth animation */
          .mermaid-code-block.mermaid-editing {
            max-height: 2000px;
            opacity: 1;
            transition: max-height 0.3s ease-out, opacity 0.2s ease-out;
          }

          /* Mermaid diagram preview */
          .mermaid-preview {
            margin: 8px 0 16px 0;
            padding: 16px;
            border: 2px solid var(--crepe-color-outline, #ccc);
            border-radius: 8px;
            background: var(--crepe-color-surface, #fafafa);
            text-align: center;
            overflow-x: auto;
            user-select: none;
            cursor: pointer;
            position: relative;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .mermaid-preview:hover {
            border-color: var(--vscode-focusBorder, #007acc);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder, rgba(0,122,204,0.3));
          }
          .mermaid-preview svg {
            height: auto;
          }

          /* Edit hint: shown on hover via CSS pseudo-element (immune to innerHTML changes) */
          .mermaid-preview::after {
            content: 'Double-click to edit';
            position: absolute;
            top: 8px;
            right: 8px;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 4px;
            background: var(--vscode-badge-background, rgba(0,0,0,0.06));
            color: var(--vscode-badge-foreground, #666);
            opacity: 0;
            transition: opacity 0.15s ease;
            pointer-events: none;
          }
          .mermaid-preview:hover::after {
            opacity: 0.8;
          }
          .mermaid-svg-host {
            display: block;
            overflow-x: auto;
            overflow-y: auto;
          }
          .mermaid-svg-host svg {
            height: auto;
            min-width: min-content;
          }
          /* Allow foreignObject labels to render outside their bbox without
             being clipped by SVG's default overflow:hidden. */
          .mermaid-svg-host svg foreignObject,
          .mermaid-svg-host svg text {
            overflow: visible;
          }
          .mermaid-svg-host::-webkit-scrollbar { height: 4px; }
          .mermaid-svg-host::-webkit-scrollbar-track { background: transparent; }
          .mermaid-svg-host::-webkit-scrollbar-thumb {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.12);
            border-radius: 2px;
          }
          .mermaid-expand-btn {
            position: absolute;
            top: 8px;
            left: 8px;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 1px solid var(--crepe-color-outline, rgba(0,0,0,0.15));
            border-radius: 6px;
            background: var(--vscode-badge-background, rgba(255,255,255,0.9));
            color: var(--vscode-badge-foreground, #444);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.15s ease, background 0.15s ease;
            z-index: 2;
          }
          .mermaid-expand-btn svg {
            width: 14px;
            height: 14px;
          }
          .mermaid-preview:hover .mermaid-expand-btn { opacity: 0.85; }
          .mermaid-expand-btn:hover { opacity: 1 !important; }
          .mermaid-preview.mermaid-error .mermaid-expand-btn,
          .mermaid-preview:not([data-rendered="true"]) .mermaid-expand-btn,
          .mermaid-code-block.mermaid-editing + .mermaid-preview .mermaid-expand-btn {
            display: none;
          }
          body.dark-theme .mermaid-expand-btn {
            border-color: rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.12);
            color: rgba(255,255,255,0.9);
          }
          @media (prefers-reduced-motion: reduce) {
            .mermaid-expand-btn { transition: none; }
          }
          .mermaid-copy-btn {
            position: absolute;
            top: 8px;
            left: 44px;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 1px solid var(--crepe-color-outline, rgba(0,0,0,0.15));
            border-radius: 6px;
            background: var(--vscode-badge-background, rgba(255,255,255,0.9));
            color: var(--vscode-badge-foreground, #444);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.15s ease, background 0.15s ease;
            z-index: 2;
          }
          .mermaid-copy-btn svg { width: 14px; height: 14px; }
          .mermaid-copy-btn .icon-check { display: none; }
          .mermaid-copy-btn.is-copied .icon-copy { display: none; }
          .mermaid-copy-btn.is-copied .icon-check {
            display: inline-flex;
            color: #2da44e;
          }
          .mermaid-preview:hover .mermaid-copy-btn { opacity: 0.85; }
          .mermaid-copy-btn:hover { opacity: 1 !important; }
          .mermaid-copy-btn.is-copied { opacity: 1 !important; }
          .mermaid-preview.mermaid-error .mermaid-copy-btn,
          .mermaid-preview:not([data-rendered="true"]) .mermaid-copy-btn,
          .mermaid-code-block.mermaid-editing + .mermaid-preview .mermaid-copy-btn {
            display: none;
          }
          body.dark-theme .mermaid-copy-btn {
            border-color: rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.12);
            color: rgba(255,255,255,0.9);
          }
          body.dark-theme .mermaid-copy-btn.is-copied .icon-check { color: #3fb950; }
          @media (prefers-reduced-motion: reduce) {
            .mermaid-copy-btn { transition: none; }
          }

          /* When editing: highlight the preview border, hide hint */
          .mermaid-code-block.mermaid-editing + .mermaid-preview {
            border-color: var(--vscode-focusBorder, #007acc);
            cursor: default;
          }
          .mermaid-code-block.mermaid-editing + .mermaid-preview::after {
            display: none;
          }

          /* Error state */
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

          /* Dark theme overrides */
          body.dark-theme .mermaid-preview {
            background: rgba(255, 255, 255, 0.03);
          }
          body.dark-theme .mermaid-preview::after {
            background: rgba(255,255,255,0.1);
            color: rgba(255,255,255,0.7);
          }

          /* ─── TOC Sidebar ─── */
          #main-layout {
            display: flex;
            height: calc(100vh - 40px);
          }
          #toc-sidebar {
            width: clamp(180px, 15vw, 300px);
            min-width: 180px;
            border-right: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.08);
            overflow-y: auto;
            background: rgba(var(--toolbar-bg-rgb, 255, 255, 255), 0.6);
            color: var(--toolbar-fg, var(--vscode-editor-foreground));
            font-size: 13px;
            display: flex;
            flex-direction: column;
          }
          body.dark-theme #toc-sidebar {
            background: rgba(var(--toolbar-bg-rgb, 30, 30, 30), 0.6);
            border-right-color: rgba(255, 255, 255, 0.08);
          }
          #toc-sidebar.hidden { display: none; }
          .toc-header {
            padding: 8px 10px 4px;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            border-bottom: 1px solid rgba(var(--border-rgb, 0, 0, 0), 0.08);
          }
          body.dark-theme .toc-header {
            border-bottom-color: rgba(255, 255, 255, 0.08);
          }
          .toc-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--toolbar-fg, var(--vscode-editor-foreground));
            opacity: 0.7;
          }
          #toc-entries {
            flex: 1;
            overflow-y: auto;
            padding: 4px 0;
          }
          .toc-entry {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            cursor: pointer;
            border-radius: 3px;
            margin: 0 4px;
            color: var(--toolbar-fg, var(--vscode-editor-foreground));
            opacity: 0.55;
            transition: background 0.1s ease-out, opacity 0.1s ease-out;
          }
          .toc-entry:hover {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.10);
            opacity: 0.9;
          }
          body.dark-theme .toc-entry:hover {
            background: rgba(255, 255, 255, 0.10);
          }
          .toc-entry.active {
            background: rgba(0, 0, 0, 0.08);
            box-shadow: inset 3px 0 0 var(--accent-primary, var(--vscode-focusBorder));
            font-weight: 600;
            opacity: 1;
          }
          body.dark-theme .toc-entry.active {
            background: rgba(255, 255, 255, 0.12);
          }
          .toc-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
          }
          .toc-arrow {
            font-size: 8px;
            width: 12px;
            flex-shrink: 0;
            text-align: center;
            cursor: pointer;
            user-select: none;
            opacity: 0.6;
          }
          .toc-arrow:hover { opacity: 1; }
          .toc-children.collapsed { display: none; }
          .toc-empty {
            padding: 12px 10px;
            font-size: 12px;
            color: var(--toolbar-fg, var(--vscode-descriptionForeground, #888));
            opacity: 0.5;
            font-style: italic;
          }
          /* Indent by heading level */
          .toc-level-1 { padding-left: 10px; font-weight: 600; }
          .toc-level-2 { padding-left: 22px; }
          .toc-level-3 { padding-left: 34px; }
          .toc-level-4 { padding-left: 46px; }
          .toc-level-5 { padding-left: 54px; font-size: 12px; }
          .toc-level-6 { padding-left: 62px; font-size: 12px; }
          /* TOC toggle button — flex item in main-layout, between sidebar and editor */
          .toc-toggle-btn {
            display: flex;
            align-items: flex-start;
            justify-content: center;
            width: 24px;
            min-width: 24px;
            padding-top: 8px;
            border: none;
            background: transparent;
            color: var(--toolbar-fg, var(--vscode-editor-foreground));
            cursor: pointer;
            opacity: 0.45;
            transition: opacity 0.15s ease-out, background 0.15s ease-out;
          }
          .toc-toggle-btn svg { width: 14px; height: 14px; }
          .toc-toggle-btn:hover {
            opacity: 1;
            background: rgba(var(--border-rgb, 0, 0, 0), 0.05);
          }
          .toc-toggle-btn.is-active {
            opacity: 0.85;
            color: var(--accent-primary, var(--toolbar-fg));
          }
          body.dark-theme .toc-toggle-btn:hover {
            background: rgba(255, 255, 255, 0.05);
          }
          @media (max-width: 600px) {
            #toc-sidebar { width: 160px; min-width: 160px; }
          }

          /* ─── Micro-Interactions Polish ─── */

          /* Selection highlight uses theme accent */
          .tiptap ::selection {
            background: var(--selection-bg, rgba(var(--accent-rgb, 59, 130, 246), 0.2));
          }

          /* Link hover: accent underline slide-in */
          .tiptap a {
            background-image: linear-gradient(rgba(var(--accent-rgb, 59, 130, 246), 0.3), rgba(var(--accent-rgb, 59, 130, 246), 0.3));
            background-position: 0% 100%;
            background-repeat: no-repeat;
            background-size: 0% 1.5px;
            transition: background-size 0.25s ease-out, color 0.15s ease-out;
          }
          .tiptap a:hover {
            background-size: 100% 1.5px;
            border-bottom-color: transparent;
          }

          /* Image hover: enhanced shadow + subtle scale */
          .tiptap img:hover {
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            transform: scale(1.003);
          }
          body.dark-theme .tiptap img:hover {
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
          }

          /* Image selected: accent border for visibility */
          .tiptap img.ProseMirror-selectednode {
            outline: 2.5px solid rgba(var(--accent-rgb, 100, 149, 237), 0.7);
            outline-offset: 2px;
          }

          /* Page Break: modern dashed separator */
          .tiptap hr {
            border: none;
            background: none;
            height: 52px;
            margin: 4px 0;
            position: relative;
          }
          .tiptap hr::before {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: 50%;
            border-top: 1.5px dashed var(--crepe-color-outline, #c8c8c8);
            opacity: 0.5;
          }
          .tiptap hr::after {
            content: '✦  PAGE BREAK  ✦';
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            font-family: var(--crepe-font-code, monospace);
            font-size: 9px;
            font-weight: 600;
            letter-spacing: 0.18em;
            color: var(--crepe-color-outline, #b0b0b0);
            background: var(--vscode-editor-background, #fff);
            padding: 1px 16px;
            white-space: nowrap;
            transition: color 0.15s ease-out, letter-spacing 0.15s ease-out;
          }
          .tiptap hr:hover::after {
            color: #4a9eff;
            letter-spacing: 0.22em;
          }
          body.dark-theme .tiptap hr::after {
            color: rgba(255, 255, 255, 0.35);
          }
          body.dark-theme .tiptap hr:hover::after {
            color: rgba(var(--accent-rgb, 0, 120, 212), 0.7);
          }

          /* Inline code: subtle bg */
          .tiptap :not(pre) > code {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.05);
          }
          body.dark-theme .tiptap :not(pre) > code {
            background: rgba(255, 255, 255, 0.08);
          }

          /* Custom scrollbar */
          #editor-container::-webkit-scrollbar { width: 6px; height: 6px; }
          #editor-container::-webkit-scrollbar-track { background: transparent; }
          #editor-container::-webkit-scrollbar-thumb {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.12);
            border-radius: 3px;
          }
          #editor-container::-webkit-scrollbar-thumb:hover {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.25);
          }
          #toc-sidebar::-webkit-scrollbar { width: 4px; }
          #toc-sidebar::-webkit-scrollbar-track { background: transparent; }
          #toc-sidebar::-webkit-scrollbar-thumb {
            background: rgba(var(--border-rgb, 0, 0, 0), 0.1);
            border-radius: 2px;
          }

          /* Table header subtle accent */
          .tiptap table th {
            background: rgba(var(--accent-rgb, 0, 0, 0), 0.04);
          }
          body.dark-theme .tiptap table th {
            background: rgba(255, 255, 255, 0.06);
          }

          /* ─── Accessibility ─── */
          @media (prefers-contrast: more) {
            .tiptap { border: 1px solid var(--vscode-panel-border); }
            .toolbar-btn { opacity: 0.9; }
            .toolbar-separator { opacity: 0.3; }
            .tiptap a { text-decoration: underline; }
            .tiptap img { border: 1px solid var(--vscode-panel-border); }
          }

          /* Search bar */
          #search-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            background: rgba(var(--toolbar-bg-rgb), 0.85);
            border-bottom: 1px solid rgba(var(--border-rgb), 0.15);
            max-height: 40px;
            overflow: hidden;
            transition: max-height 0.15s ease-out, padding 0.15s ease-out;
          }
          @supports (backdrop-filter: blur(12px)) {
            #search-bar {
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              background: rgba(var(--toolbar-bg-rgb), 0.7);
            }
          }
          #search-bar.hidden {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            border-bottom-color: transparent;
          }
          .search-icon {
            width: 14px;
            height: 14px;
            fill: none;
            stroke: var(--toolbar-fg);
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            opacity: 0.5;
            flex-shrink: 0;
          }
          #search-input {
            flex: 1;
            max-width: 300px;
            background: rgba(var(--border-rgb), 0.1);
            border: 1px solid rgba(var(--border-rgb), 0.2);
            border-radius: 4px;
            padding: 3px 8px;
            font-size: 13px;
            font-family: inherit;
            color: var(--toolbar-fg);
            outline: none;
            transition: border-color 0.15s ease;
          }
          #search-input:focus {
            border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.5);
          }
          #search-input.no-results {
            border-color: rgba(220, 38, 38, 0.6);
          }
          #search-count {
            font-size: 12px;
            color: var(--toolbar-fg);
            opacity: 0.6;
            min-width: 36px;
            text-align: center;
            white-space: nowrap;
          }
          .search-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border: none;
            background: transparent;
            border-radius: 4px;
            cursor: pointer;
            color: var(--toolbar-fg);
            padding: 0;
            transition: background-color 0.1s ease;
          }
          .search-btn:hover {
            background: rgba(var(--border-rgb), 0.15);
          }
          .search-btn:active {
            transform: scale(0.93);
          }
          .search-btn svg {
            width: 14px;
            height: 14px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          /* Search match highlights (prosemirror-search) */
          .ProseMirror-search-match {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.2);
            border-radius: 2px;
          }
          .ProseMirror-active-search-match {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.45);
            border-radius: 2px;
          }
          body.dark-theme .ProseMirror-search-match {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.25);
          }
          body.dark-theme .ProseMirror-active-search-match {
            background: rgba(var(--accent-rgb, 59, 130, 246), 0.5);
          }

          /* ─── Phase 3: Image Lightbox ─── */
          .image-expand-btn {
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
            transition: opacity 0.15s ease-out;
          }
          .image-expand-btn:hover { opacity: 1; }
          .image-expand-btn svg { width: 16px; height: 16px; }
          #lightbox-overlay {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 1000;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 12px;
          }
          #lightbox-overlay.active { display: flex; }
          .lightbox-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(8px);
          }
          .lightbox-content {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
          }
          #lightbox-image {
            max-width: 90vw;
            max-height: 80vh;
            object-fit: contain;
            border-radius: 8px;
            transition: transform 0.15s ease-out;
            user-select: none;
          }
          #lightbox-image.hidden { display: none; }
          .lightbox-svg-wrapper {
            width: 90vw;
            height: 80vh;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.96);
            padding: 24px;
            box-sizing: border-box;
            transition: transform 0.15s ease-out;
            user-select: none;
            transform-origin: center center;
          }
          .lightbox-svg-wrapper.hidden { display: none; }
          .lightbox-svg-wrapper svg {
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            max-height: none !important;
            overflow: visible !important;
            display: block;
            pointer-events: none;
          }
          .lightbox-svg-wrapper svg * { overflow: visible; }
          body.dark-theme .lightbox-svg-wrapper {
            background: rgba(20, 22, 28, 0.96);
          }
          .lightbox-svg-wrapper.grabbable { cursor: grab; }
          .lightbox-svg-wrapper.grabbing { cursor: grabbing; }
          #lightbox-image.grabbable { cursor: grab; }
          #lightbox-image.grabbing { cursor: grabbing; }
          @media (prefers-reduced-motion: reduce) {
            #lightbox-image,
            .lightbox-svg-wrapper { transition: none; }
          }
          #lightbox-caption {
            color: rgba(255, 255, 255, 0.8);
            font-size: 13px;
            font-style: italic;
            text-align: center;
            max-width: 600px;
          }
          #lightbox-caption.hidden { display: none; }
          .lightbox-controls {
            position: relative;
            z-index: 1;
            display: flex;
            gap: 8px;
            align-items: center;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            padding: 6px 12px;
            backdrop-filter: blur(8px);
          }
          .lightbox-btn {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease-out;
          }
          .lightbox-btn:hover { background: rgba(255, 255, 255, 0.2); }
          #lightbox-copy.hidden { display: none; }
          #lightbox-copy svg { width: 16px; height: 16px; }
          #lightbox-copy .icon-check { display: none; }
          #lightbox-copy.is-copied .icon-copy { display: none; }
          #lightbox-copy.is-copied .icon-check {
            display: inline-flex;
            color: #3fb950;
          }
          #lightbox-zoom-level {
            color: rgba(255, 255, 255, 0.7);
            font-size: 12px;
            min-width: 40px;
            text-align: center;
          }

          /* ─── Phase 4: Toolbar Auto-hide ─── */
          #toolbar {
            transition: transform 0.2s ease-out, opacity 0.2s ease-out;
          }
          #toolbar.toolbar-hidden {
            transform: translateY(-100%);
            opacity: 0;
            pointer-events: none;
          }
          #toolbar-hover-zone {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 8px;
            z-index: 99;
            display: none;
          }
          #toolbar-hover-zone.active { display: block; }
          #toolbar.toolbar-hidden ~ #search-bar {
            transform: translateY(-100%);
            opacity: 0;
            pointer-events: none;
          }
          #search-bar {
            transition: transform 0.2s ease-out, opacity 0.2s ease-out;
          }
          @media (hover: none) {
            #toolbar.toolbar-hidden {
              transform: none !important;
              opacity: 1 !important;
              pointer-events: auto !important;
            }
          }

          /* ─── Phase 5: Micro-interactions ─── */
          @keyframes checkmark-draw {
            from { clip-path: inset(0 100% 0 0); }
            to { clip-path: inset(0 0 0 0); }
          }
          @keyframes strikethrough-sweep {
            from { text-decoration-color: transparent; }
            to { text-decoration-color: currentColor; }
          }
          .tiptap ul[data-type="taskList"] > li[data-checked="true"] > label input[type="checkbox"] {
            animation: checkmark-draw 0.25s ease-out;
          }
          .tiptap ul[data-type="taskList"] > li[data-checked="true"] > div p {
            text-decoration: line-through;
            animation: strikethrough-sweep 0.3s ease-out;
          }
          .tiptap h1,
          .tiptap h2 {
            background-image: linear-gradient(90deg, rgba(var(--accent-rgb, 59, 130, 246), 0.15), rgba(var(--accent-rgb, 59, 130, 246), 0.05) 60%, transparent);
            background-position: 0 100%;
            background-size: 100% 2px;
            background-repeat: no-repeat;
            padding-bottom: 8px;
          }
          .tiptap tr {
            transition: background-color 0.15s ease-out;
          }
          .tiptap tr:hover {
            background-color: rgba(var(--accent-rgb, 59, 130, 246), 0.04);
          }
          .tiptap tbody tr:nth-child(even) {
            background-color: rgba(0, 0, 0, 0.015);
          }
          body.dark-theme .tiptap tbody tr:nth-child(even) {
            background-color: rgba(255, 255, 255, 0.02);
          }

          /* ─── Phase 6: New Theme Overlay Vars ─── */
          body.theme-paper { --overlay-bg: #3d3929; --overlay-fg: #faf8f5; }
          body.theme-midnight { --overlay-bg: #c9d1d9; --overlay-fg: #0d1117; }

          /* ─── Phase 7: Accessibility & Polish ─── */
          /* Word count indicator */
          #word-count {
            position: fixed;
            bottom: 8px;
            right: 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888);
            opacity: 0;
            transition: opacity 0.2s ease-out;
            pointer-events: none;
            z-index: 50;
          }
          #editor-container:hover #word-count { opacity: 0.6; }
          /* Focus indicators */
          .toolbar-btn:focus-visible,
          #heading-select:focus-visible,
          #theme-select:focus-visible,
          .toc-toggle-btn:focus-visible,
          .search-btn:focus-visible,
          .lightbox-btn:focus-visible {
            outline: 2px solid var(--accent-primary, var(--vscode-focusBorder));
            outline-offset: 2px;
          }
          /* High contrast mode */
          @media (prefers-contrast: more) {
            #toolbar {
              backdrop-filter: none;
              background: var(--vscode-editor-background);
              border-bottom: 2px solid var(--vscode-panel-border);
            }
            .toolbar-btn { opacity: 1; border: 1px solid var(--vscode-panel-border); }
            .tiptap blockquote { border-left-width: 4px; opacity: 1; }
            .tiptap code { border: 1px solid var(--crepe-color-outline); }
            #editor-container::before { display: none; }
            #editor-container::after { display: none; }
            .tiptap img { outline: 2px solid var(--crepe-color-outline); }
          }
          /* Print stylesheet */
          @media print {
            #toolbar, #toolbar-hover-zone, #search-bar, #metadata-panel,
            #toc-sidebar, .toc-toggle-btn, #reading-progress,
            .heading-collapse-toggle, .heading-level-badge,
            .code-copy-btn, .image-edit-overlay, #lightbox-overlay, #word-count {
              display: none !important;
            }
            #main-layout { display: block !important; height: auto !important; }
            #editor-container {
              overflow: visible !important;
              padding: 0 !important;
            }
            #editor-container::before, #editor-container::after { display: none !important; }
            .tiptap {
              max-width: 100% !important;
              padding: 0 !important;
              box-shadow: none !important;
            }
            .tiptap hr { page-break-after: always; }
            .tiptap h1, .tiptap h2, .tiptap h3 { page-break-after: avoid; }
            .tiptap pre, .tiptap img, .tiptap table { page-break-inside: avoid; }
          }
          /* Comprehensive reduced motion */
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
              scroll-behavior: auto !important;
            }
            #toolbar.toolbar-hidden { transform: none; }
          }

        </style>
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
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `.trim();
  }
}
