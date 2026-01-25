import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "./themes/index.css";
import { prosePluginsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  parseContent,
  reconstructContent,
  validateYaml,
} from "./frontmatter";
import { createLineHighlightPlugin } from "./line-highlight-plugin";
import { setupImageEditOverlay, handleUrlEditResponse, handleImageRenameResponse, setImageMap } from "./image-edit-plugin";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { theme?: string } | null;
  setState(state: unknown): void;
};

type ThemeName =
  | "frame"
  | "frame-dark"
  | "nord"
  | "nord-dark"
  | "crepe"
  | "crepe-dark"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha";

const THEMES: ThemeName[] = [
  "frame",
  "frame-dark",
  "nord",
  "nord-dark",
  "crepe",
  "crepe-dark",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
];
const DEBOUNCE_MS = 300;

const vscode = acquireVsCodeApi();

let crepe: Crepe | null = null;
let isUpdatingFromExtension = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentTheme: ThemeName = "frame";
let globalThemeReceived: ThemeName | null = null; // Theme from extension globalState
let currentFrontmatter: string | null = null; // Current frontmatter YAML content
let currentBody: string = ""; // Current body content (without frontmatter)
let lastSentContent: string | null = null; // Track last sent content to prevent echo loops
let highlightCurrentLine = true; // Line highlight feature toggle (default enabled)
let currentImageMap: Record<string, string> = {}; // Image path → webviewUri mapping

// Image URL transform helpers
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function transformForDisplay(
  content: string,
  imageMap: Record<string, string>,
): string {
  let result = content;
  for (const [originalPath, webviewUri] of Object.entries(imageMap)) {
    const escaped = escapeRegex(originalPath);
    result = result.replace(new RegExp(escaped, "g"), webviewUri);
  }
  return result;
}

function transformForSave(
  content: string,
  imageMap: Record<string, string>,
): string {
  let result = content;
  for (const [originalPath, webviewUri] of Object.entries(imageMap)) {
    const escaped = escapeRegex(webviewUri);
    result = result.replace(new RegExp(escaped, "g"), originalPath);
  }
  return result;
}

// Inline image handling - save pasted images to file
// Matches both blob: URLs and data: URIs
const INLINE_IMAGE_REGEX = /!\[([^\]]*)\]\(((?:blob:|data:image\/)[^)]+)\)/g;

// Node types that represent images in Milkdown
const IMAGE_NODE_TYPES = ["image-block", "image", "image-inline"];

/**
 * Update image node src using ProseMirror transaction
 * Returns true if update was successful
 */
function updateImageNodeSrc(webviewUri: string): boolean {
  if (!crepe) return false;

  try {
    const view = crepe.editor?.ctx?.get(editorViewCtx);
    if (!view) return false;

    const { state, dispatch } = view;

    // Collect nodes to update
    const nodesToUpdate: Array<{ pos: number; node: typeof state.doc.firstChild; nodeSize: number }> = [];
    state.doc.descendants((node, pos) => {
      if (!IMAGE_NODE_TYPES.includes(node.type.name)) return;
      const src = node.attrs.src as string;
      if (!src || (!src.startsWith("data:") && !src.startsWith("blob:"))) return;
      nodesToUpdate.push({ pos, node, nodeSize: node.nodeSize });
    });

    if (nodesToUpdate.length === 0) return false;

    // Sort by position descending
    nodesToUpdate.sort((a, b) => b.pos - a.pos);

    let tr = state.tr;
    for (const { pos, node, nodeSize } of nodesToUpdate) {
      const newNode = node!.type.create(
        { ...node!.attrs, src: webviewUri },
        node!.content,
        node!.marks
      );
      tr = tr.replaceWith(pos, pos + nodeSize, newNode);
    }

    isUpdatingFromExtension = true;
    dispatch(tr);

    // Force synchronous DOM update
    view.updateState(view.state);

    queueMicrotask(() => {
      isUpdatingFromExtension = false;
    });

    return true;
  } catch (err) {
    console.warn("[ImageSave] Failed to update node:", err);
    return false;
  }
}

const pendingImageSaves = new Map<string, number>(); // Track images being saved with timestamp
const PENDING_IMAGE_TIMEOUT = 10000; // 10 seconds timeout for pending images

// Promise-based upload tracking for Crepe onUpload handler
interface UploadPromiseHandlers {
  resolve: (path: string) => void;
  reject: (err: Error) => void;
}
const pendingUploads = new Map<string, UploadPromiseHandlers>();
const UPLOAD_TIMEOUT = 30000; // 30 seconds timeout for uploads

async function getBase64FromUrl(url: string): Promise<string | null> {
  // If already base64 data URI, return as-is
  if (url.startsWith("data:")) {
    return url;
  }
  // Fetch blob URL and convert to base64
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => {
        console.error("[Image] FileReader failed to read blob");
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("[Image] Failed to fetch blob URL:", err);
    return null;
  }
}

function generateImageFilename(mimeType: string): string {
  const ext = mimeType.split("/")[1]?.replace(/;.*/, "") || "png";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `image-${timestamp}-${random}.${ext}`;
}

/**
 * Handle image upload from Crepe file picker
 * Returns Promise that resolves with saved file path
 */
async function handleCrepeImageUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Use original filename from file picker
      const filename = file.name;
      const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // Store promise handlers
      pendingUploads.set(uploadId, { resolve, reject });

      // Send to extension
      vscode.postMessage({
        type: "saveImage",
        data: base64,
        filename,
        uploadId,
        blobUrl: uploadId, // Use uploadId as blobUrl for compatibility
      });

      // Timeout
      setTimeout(() => {
        if (pendingUploads.has(uploadId)) {
          pendingUploads.delete(uploadId);
          reject(new Error("Image upload timed out"));
        }
      }, UPLOAD_TIMEOUT);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Process inline images (blob URLs and data URIs) - send to extension for saving
 * Returns true if there are images being processed (don't save content yet)
 */
async function processInlineImages(content: string): Promise<boolean> {
  const matches = [...content.matchAll(INLINE_IMAGE_REGEX)];
  if (matches.length === 0) return false;

  let hasPendingImages = false;
  for (const match of matches) {
    const [, , imageUrl] = match;

    // Skip if already being processed (with timeout cleanup)
    const pendingTimestamp = pendingImageSaves.get(imageUrl);
    if (pendingTimestamp) {
      if (Date.now() - pendingTimestamp < PENDING_IMAGE_TIMEOUT) {
        hasPendingImages = true;
        continue;
      }
      // Timeout expired, allow retry
      pendingImageSaves.delete(imageUrl);
    }

    // Get base64 data (convert blob if needed)
    const base64 = await getBase64FromUrl(imageUrl);
    if (base64) {
      pendingImageSaves.set(imageUrl, Date.now());
      hasPendingImages = true;
      const mimeMatch = base64.match(/^data:(image\/[^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      const filename = generateImageFilename(mimeType);

      vscode.postMessage({
        type: "saveImage",
        data: base64,
        filename,
        blobUrl: imageUrl, // Keep field name for compatibility
      });

      // Timeout cleanup: Remove from pending after PENDING_IMAGE_TIMEOUT
      // This prevents editor lock if extension fails to respond
      setTimeout(() => {
        if (pendingImageSaves.has(imageUrl)) {
          console.warn("[Image] Save timeout, cleaning up:", imageUrl.slice(0, 50));
          pendingImageSaves.delete(imageUrl);
        }
      }, PENDING_IMAGE_TIMEOUT + 1000); // Extra 1s buffer
    }
  }
  return hasPendingImages;
}

function replaceInlineImage(
  imageUrl: string,
  savedPath: string,
  webviewUri?: string
): void {
  pendingImageSaves.delete(imageUrl);

  // Replace in currentBody using string replacement (regex fails on long data URIs)
  // Find pattern: ![...](imageUrl) and replace with ![...](savedPath)
  const searchStart = "](";
  const searchEnd = ")";
  let result = currentBody;
  let searchPos = 0;

  while (true) {
    const urlStart = result.indexOf(searchStart + imageUrl + searchEnd, searchPos);
    if (urlStart === -1) break;

    // Found the URL, replace it
    const replaceStart = urlStart + searchStart.length;
    const replaceEnd = replaceStart + imageUrl.length;
    result =
      result.substring(0, replaceStart) + savedPath + result.substring(replaceEnd);
    searchPos = replaceStart + savedPath.length;
  }

  currentBody = result;

  // Update imageMap with new path
  if (webviewUri) {
    currentImageMap[savedPath] = webviewUri;
    setImageMap(currentImageMap);
  }

  // Send updated content to extension
  const fullContent = reconstructContent(currentFrontmatter, currentBody);
  // Don't set lastSentContent - let extension update flow handle recreate
  // This ensures imageMapChanged is true when update comes back
  vscode.postMessage({ type: "edit", content: fullContent });

  // Try ProseMirror transaction for immediate visual update (fast, may not enable resize)
  if (crepe && webviewUri) {
    updateImageNodeSrc(webviewUri);
  }
}

function debouncedPostEdit(content: string): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    // Process blob URLs - send to extension for saving
    // If blobs are pending, don't save yet - wait for imageSaved callback
    const hasPendingBlobs = await processInlineImages(content);
    if (hasPendingBlobs) {
      debounceTimer = null;
      return; // Don't save content with blob URLs - wait for imageSaved
    }

    lastSentContent = content;
    vscode.postMessage({ type: "edit", content });
    debounceTimer = null;
  }, DEBOUNCE_MS);
}

// DOM elements
const getEditorEl = () => document.getElementById("editor");
const getThemeSelect = () =>
  document.getElementById("theme-select") as HTMLSelectElement | null;
const getSourceBtn = () => document.getElementById("btn-source");
const getLoadingIndicator = () => document.getElementById("loading-indicator");

// Metadata panel DOM elements
const getMetadataDetails = () => document.getElementById("metadata-details");
const getMetadataTextarea = () =>
  document.getElementById("metadata-textarea") as HTMLTextAreaElement | null;
const getAddMetadataBtn = () => document.getElementById("add-metadata-btn");
const getMetadataError = () => document.getElementById("metadata-error");

function hideLoading(): void {
  const loading = getLoadingIndicator();
  if (loading) {
    loading.classList.add("hidden");
  }
}

function showLoading(): void {
  const loading = getLoadingIndicator();
  if (loading) {
    loading.classList.remove("hidden");
  }
}

// Metadata panel functions
function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const newHeight = Math.min(Math.max(textarea.scrollHeight, 80), 300);
  textarea.style.height = `${newHeight}px`;
}

function updateMetadataPanel(
  frontmatter: string | null,
  isValid: boolean,
  error?: string
): void {
  const details = getMetadataDetails();
  const textarea = getMetadataTextarea();
  const addBtn = getAddMetadataBtn();
  const errorEl = getMetadataError();

  if (!details || !textarea || !addBtn || !errorEl) return;

  if (frontmatter === null) {
    // No frontmatter - show Add button
    details.classList.add("hidden");
    addBtn.classList.remove("hidden");
    textarea.classList.remove("error");
    errorEl.classList.add("hidden");
  } else {
    // Has frontmatter - show panel
    details.classList.remove("hidden");
    addBtn.classList.add("hidden");
    textarea.value = frontmatter;
    autoResizeTextarea(textarea);

    // Show/hide error with styling sync
    if (!isValid && error) {
      errorEl.textContent = `(${error})`;
      errorEl.classList.remove("hidden");
      textarea.classList.add("error");
    } else {
      errorEl.classList.add("hidden");
      textarea.classList.remove("error");
    }
  }
}

let metadataDebounceTimer: ReturnType<typeof setTimeout> | null = null;

async function sendFullContent(): Promise<void> {
  const fullContent = reconstructContent(currentFrontmatter, currentBody);
  const hasPendingBlobs = await processInlineImages(fullContent);
  if (hasPendingBlobs) {
    return; // Don't save content with blob URLs - wait for imageSaved
  }
  lastSentContent = fullContent;
  vscode.postMessage({ type: "edit", content: fullContent });
}

function debouncedMetadataEdit(): void {
  if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
  metadataDebounceTimer = setTimeout(() => {
    const textarea = getMetadataTextarea();
    if (!textarea) return;

    // If textarea is empty, remove frontmatter entirely
    currentFrontmatter = textarea.value.trim() === "" ? null : textarea.value;
    sendFullContent();
  }, DEBOUNCE_MS);
}

function validateAndShowError(): void {
  const textarea = getMetadataTextarea();
  const errorEl = getMetadataError();

  if (!textarea || !errorEl) return;

  const result = validateYaml(textarea.value);

  if (result.isValid) {
    errorEl.classList.add("hidden");
    textarea.classList.remove("error");
  } else {
    const errorMsg =
      result.line !== undefined
        ? `Line ${result.line + 1}: ${result.error}`
        : result.error;
    errorEl.textContent = `(${errorMsg})`;
    errorEl.classList.remove("hidden");
    textarea.classList.add("error");
  }
}

function setupMetadataHandlers(): void {
  const textarea = getMetadataTextarea();
  const addBtn = getAddMetadataBtn();

  if (textarea) {
    textarea.addEventListener("input", () => {
      autoResizeTextarea(textarea);
      debouncedMetadataEdit();
    });

    // Validate on blur
    textarea.addEventListener("blur", () => {
      validateAndShowError();
    });

    textarea.addEventListener("keydown", (e) => {
      // Tab inserts 2 spaces (YAML standard)
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const indent = "  ";

        textarea.value =
          textarea.value.substring(0, start) +
          indent +
          textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;

        // Trigger input for auto-resize and debounced save
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      // Ctrl/Cmd+S triggers validation
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        validateAndShowError();
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      currentFrontmatter = "";
      updateMetadataPanel("", true);
      const ta = getMetadataTextarea();
      if (ta) ta.focus();
      sendFullContent();
    });
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showError(message: string): void {
  const editorEl = getEditorEl();
  if (editorEl) {
    editorEl.innerHTML = `
      <div style="padding: 20px; color: var(--vscode-errorForeground);">
        <h3>Error</h3>
        <p>${escapeHtml(message)}</p>
        <p>Try reopening the file or reloading the window.</p>
      </div>
    `;
  }
}

// Theme management
function setTheme(themeName: ThemeName, saveGlobal = true): void {
  currentTheme = themeName;

  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${themeName}`);

  const select = getThemeSelect();
  if (select) select.value = themeName;

  // Save theme globally via extension (only source of truth)
  if (saveGlobal) {
    globalThemeReceived = themeName; // Update local cache
    vscode.postMessage({ type: "themeChange", theme: themeName });
  }
}

function initTheme(vsCodeTheme: "dark" | "light"): void {
  // Priority: globalThemeReceived > default based on VS Code theme
  if (globalThemeReceived) {
    // Global theme already applied via CSS class
    return;
  }

  // No global theme yet, use default based on VS Code theme
  const defaultTheme = vsCodeTheme === "dark" ? "frame-dark" : "frame";
  currentTheme = defaultTheme;

  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${defaultTheme}`);

  const select = getThemeSelect();
  if (select) select.value = defaultTheme;
}

function viewSource(): void {
  // Request extension to close this editor and open with default text editor
  vscode.postMessage({ type: "viewSource" });
}

function applyFontSize(size: number): void {
  if (!Number.isFinite(size) || size < 8 || size > 32) return;
  // Scale factor relative to base 16px
  const scaleFactor = size / 16;
  document.documentElement.style.setProperty(
    "--editor-font-scale",
    String(scaleFactor),
  );
}

function applyHeadingSizes(sizes: Record<string, number>): void {
  const root = document.documentElement;
  const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
  for (const h of headings) {
    const size = sizes[h];
    if (Number.isFinite(size) && size >= 12 && size <= 72) {
      root.style.setProperty(`--heading-${h}-size`, `${size}px`);
    }
  }
}

// Editor initialization
async function initEditor(initialContent: string = ""): Promise<Crepe | null> {
  console.log("[Crepe] Starting initialization...");
  const editorEl = getEditorEl();
  if (!editorEl) {
    console.error("[Crepe] Editor element not found");
    showError("Editor element not found");
    return null;
  }

  try {
    const instance = new Crepe({
      root: editorEl,
      defaultValue: initialContent,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "Type something...",
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: handleCrepeImageUpload,
        },
      },
    });

    // Inject ProseMirror plugins
    if (highlightCurrentLine) {
      try {
        instance.editor.config((ctx) => {
          ctx.update(prosePluginsCtx, (plugins) => [
            ...plugins,
            createLineHighlightPlugin(),
          ]);
        });
      } catch (err) {
        console.warn("[Crepe] Failed to inject line highlight plugin:", err);
      }
    }

    instance.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        if (isUpdatingFromExtension) return;
        // Reverse transform: webviewUris back to original paths
        currentBody = transformForSave(markdown, currentImageMap);
        debouncedPostEdit(reconstructContent(currentFrontmatter, currentBody));
      });
    });

    await instance.create();
    hideLoading();

    console.log("[Crepe] Editor created successfully!");
    return instance;
  } catch (error) {
    console.error("[Crepe] Failed to create editor:", error);
    showError(
      `Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function updateEditorContent(content: string): Promise<void> {
  if (!crepe) return;

  // Note: isUpdatingFromExtension managed by caller (case "update")
  showLoading();
  try {
    crepe.destroy();
    crepe = null;

    const editorEl = getEditorEl();
    if (editorEl) {
      editorEl.innerHTML = "";
      crepe = await initEditor(content);
    }
  } catch (err) {
    console.error("[Crepe] Failed to update content:", err);
    crepe = null;
    hideLoading();
  }
}

function applyTheme(theme: "dark" | "light"): void {
  // Only apply VS Code theme class - DO NOT save to global
  document.body.classList.remove("dark-theme", "light-theme");
  document.body.classList.add(`${theme}-theme`);
}

// Toolbar event handlers
function setupToolbarHandlers(): void {
  const themeSelect = getThemeSelect();
  themeSelect?.addEventListener("change", (e) => {
    const theme = (e.target as HTMLSelectElement).value as ThemeName;
    if (THEMES.includes(theme)) {
      setTheme(theme);
    }
  });

  getSourceBtn()?.addEventListener("click", viewSource);

  // Keyboard shortcut: Ctrl/Cmd + Shift + M to view source
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      viewSource();
    }
  });
}

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "update":
      if (typeof message.content === "string") {
        const newImageMap = message.imageMap || {};
        currentImageMap = newImageMap;
        setImageMap(newImageMap);

        // Skip content update if this is echo from our edit
        // Editor already has correct content, just update imageMap
        // (imageMap changes on delete don't require recreate)
        if (message.content === lastSentContent) {
          lastSentContent = null;
          break;
        }
        lastSentContent = null;

        try {
          isUpdatingFromExtension = true;

          // Parse incoming content
          const parsed = parseContent(message.content);
          currentFrontmatter = parsed.frontmatter;
          currentBody = parsed.body; // Keep original for saving

          // Update metadata panel
          updateMetadataPanel(parsed.frontmatter, parsed.isValid, parsed.error);

          // Transform body for display (apply imageMap)
          const displayBody = transformForDisplay(parsed.body, currentImageMap);

          // Update Milkdown with transformed body
          if (!crepe) {
            crepe = await initEditor(displayBody);
          } else {
            await updateEditorContent(displayBody);
          }
        } catch (err) {
          console.error("[Crepe] Update failed:", err);
          showError(
            `Failed to update content: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          queueMicrotask(() => {
            isUpdatingFromExtension = false;
          });
        }
      }
      break;
    case "theme":
      if (message.theme === "dark" || message.theme === "light") {
        applyTheme(message.theme);
        initTheme(message.theme);
      }
      break;
    case "config":
      if (typeof message.fontSize === "number") {
        applyFontSize(message.fontSize);
      }
      if (message.headingSizes && typeof message.headingSizes === "object") {
        applyHeadingSizes(message.headingSizes as Record<string, number>);
      }
      if (typeof message.highlightCurrentLine === "boolean") {
        highlightCurrentLine = message.highlightCurrentLine;
        // Effect applied on next editor init (recreate)
      }
      break;
    case "savedTheme":
      if (
        typeof message.theme === "string" &&
        THEMES.includes(message.theme as ThemeName)
      ) {
        globalThemeReceived = message.theme as ThemeName;
        setTheme(globalThemeReceived, false); // Apply but don't save back
      }
      break;
    case "imageSaved":
      if (
        typeof message.blobUrl === "string" &&
        typeof message.savedPath === "string"
      ) {
        // Update imageMap if webviewUri provided
        if (typeof message.webviewUri === "string") {
          currentImageMap[message.savedPath] = message.webviewUri;
        }

        // Check if this is a Promise-based upload (from Crepe onUpload)
        const uploadHandlers = pendingUploads.get(message.blobUrl);
        if (uploadHandlers) {
          pendingUploads.delete(message.blobUrl);
          // Return webviewUri for immediate display, fallback to savedPath
          uploadHandlers.resolve(message.webviewUri || message.savedPath);
        } else {
          // Legacy: blob URL replacement for pasted images
          replaceInlineImage(message.blobUrl, message.savedPath, message.webviewUri);
        }
      }
      break;
    case "imageUrlEditResponse":
      if (typeof message.editId === "string") {
        handleUrlEditResponse(message.editId, message.newUrl ?? null);
      }
      break;
    case "imageRenameResponse":
      if (typeof message.renameId === "string") {
        handleImageRenameResponse(
          message.renameId,
          message.success === true,
          message.newPath || "",
          message.webviewUri
        );
      }
      break;
  }
});

function init() {
  console.log("[Crepe] init() called");

  // Cleanup pending operations on webview close to prevent memory leaks
  window.addEventListener("beforeunload", () => {
    pendingImageSaves.clear();
    pendingUploads.clear();
  });

  setupToolbarHandlers();
  setupMetadataHandlers();

  // Setup floating image edit overlay
  const editorEl = document.getElementById("editor");
  if (editorEl) {
    setupImageEditOverlay(
      editorEl,
      () => {
        try {
          return crepe?.editor?.ctx?.get(editorViewCtx) ?? null;
        } catch {
          return null;
        }
      },
      (msg) => vscode.postMessage(msg)
    );
  }

  // Don't create editor yet - wait for content from extension
  // This prevents showing empty placeholder "Please enter..."
  console.log("[Crepe] init() complete, sending ready signal");
  vscode.postMessage({ type: "ready" });
}

console.log("[Crepe] Script loaded, readyState:", document.readyState);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
