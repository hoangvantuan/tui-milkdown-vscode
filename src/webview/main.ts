/**
 * Webview entry point: builds the Tiptap editor, wires the toolbar and the
 * message protocol with the extension host (markdownEditorProvider.ts).
 *
 * Load / save path: `parseContent()` splits frontmatter, the body is parsed
 * with `contentType: "markdown"`, then `transformTableCellsAfterParse()`;
 * on save `editor.getMarkdown()` + `reconstructContent()`. Edits are
 * debounced 300 ms into an `edit` message; pending edits are flushed
 * immediately on `visibilitychange` (hidden) and `pagehide`. However, an edit
 * message dispatched from `pagehide` can still be lost if VS Code disposes
 * the webview host before IPC delivery finishes. The provider's `pendingEdit`
 * flag (markdownEditorProvider.ts) keeps the resulting document change from
 * echoing back as an `update`. Markdown-relevant extensions are provided by
 * the shared extension factory (extension-factory.ts, #143, #145).
 * Module scope calls `acquireVsCodeApi()`, so this file cannot be imported from Node.
 * Persist webview state with `{ ...getState(), key }`.
 */
import { Editor, Extension } from "@tiptap/core";
import { publishTiptapGlobals } from "./tiptap-globals";
import type {
  WebviewToHostMessage,
  HostToWebviewMessage,
} from "../shared/messages";
import { sameResource } from "../utils/vscode-resource";
import { Placeholder } from "@tiptap/extension-placeholder";
import "./editor.css";
import "./themes/index.css";
import {
  parseContent,
  reconstructContent,
  validateYaml,
  type FrontmatterFormat,
} from "./frontmatter";
import { LineHighlight } from "./line-highlight-plugin";
import { HeadingLevel, headingSlug } from "./heading-level-plugin";
import { setupImageEditOverlay, handleUrlEditResponse, handleImageRenameResponse, setOnImageRenamed, promptForImageUrl } from "./image-edit-plugin";
import {
  setImageMap,
  mutateImageMap,
  getImageMap,
  getImageMapVersion,
  transformForDisplay,
  transformForSave,
  updateEditorImageNodeSrc,
  applyImageRenameTranslation,
} from "./image-path-translation";
import { transformTableCellsAfterParse } from "./table-cell-content-parser";
import { MermaidDiagram, updateMermaidTheme, clearMermaidCache } from "./mermaid-plugin";
import { TableContextMenu } from "./table-context-menu";
import { setupTocSidebar, updateTocFromEditor } from "./toc-sidebar";
import { HeadingCollapse, collapsePluginKey, getCollapsedHeadings, setCollapsedHeadings } from "./heading-collapse-plugin";
import { CodeBlockEnhancement } from "./code-block-plugin";
import { SearchPlugin, performSearch, clearSearch, searchNext, searchPrev, getMatchInfo, setCaseSensitivity, replaceCurrent, replaceAllMatches } from "./search-plugin";
import { initFontSelector, type FontSelectorAPI, sanitizeFontName } from "./font-selector";
import { initLightbox } from "./image-lightbox-plugin";
import { svgToPngBlob } from "./svg-to-png";
import { FileMention, setFileMentionFiles } from "./file-mention-plugin";
import { WikiLinkSuggestion, setWikiLinkFiles } from "./wiki-link-plugin";
import { installMarkdownTextEscape } from "./markdown-text-escape";
import { escapeHtml } from "./file-search-utils";
import { createBubbleMenuExtension } from "./bubble-menu";
import { initLinkPopover, type LinkPopoverController } from "./link-popover";
import { SlashCommand, setImageSrcProvider } from "./slash-command-plugin";
import { EmojiSuggestion } from "./emoji-plugin";
import { setupDragHandle } from "./drag-handle-plugin";
import { ContentSync } from "./content-sync";
import { setupBacklinksPanel, updateBacklinks, refreshBacklinksIfVisible } from "./backlinks-panel";
import { setupFocusMode, handleFocusModeTransaction } from "./focus-mode";
import { buildMarkdownExtensions } from "./extension-factory";

// Install unified text escape overrides on MarkdownManager (#97, #99, #100, #101).
installMarkdownTextEscape();

// The slash menu's Image entry asks the host for a path through the same input
// box the image URL editor uses. Wired inside init() so importing this module
// in the test harness does not set the provider and break slash-seam.ts.

// Fix: allow exiting inline `code` marks with ArrowRight anywhere (not just at paragraph end).
// Tiptap's built-in Mark.handleExit only fires when cursor is at $from.end() (parent block end),
// which fails in table cells or mid-text. This extension intercepts ArrowRight when the cursor
// sits at the right edge of a code mark and removes the stored mark so subsequent typing is plain text.
const CodeExitHandler = Extension.create({
  name: "codeExitHandler",

  addKeyboardShortcuts() {
    return {
      ArrowRight: ({ editor: ed }) => {
        const { $from } = ed.state.selection;
        // Only handle collapsed cursor
        if (!ed.state.selection.empty) return false;

        const codeType = ed.schema.marks.code;
        if (!codeType) return false;

        // Check if the cursor currently has the code mark active
        const storedMarks = ed.state.storedMarks;
        const activeMarks = storedMarks ?? $from.marks();
        const hasCode = activeMarks.some((m: any) => m.type === codeType);
        if (!hasCode) return false;

        // Check if we're at the right edge of the code mark range.
        // The character after the cursor should NOT have the code mark, or cursor is at parent end.
        const isAtParentEnd = $from.pos === $from.end();
        const afterPos = $from.pos;
        const nodeAfter = $from.nodeAfter;

        const isAtCodeEdge = isAtParentEnd ||
          (nodeAfter && !codeType.isInSet(nodeAfter.marks));

        if (!isAtCodeEdge) return false;

        // Exit the code mark: remove stored mark and insert a space
        const { tr } = ed.state;
        const codeMark = activeMarks.find((m: any) => m.type === codeType);
        if (codeMark) {
          tr.removeStoredMark(codeMark);
        }

        if (isAtParentEnd) {
          // At end of block: insert a space to create content outside code mark
          tr.insertText(" ", afterPos);
        }

        ed.view.dispatch(tr);
        return true;
      },
    };
  },
});

interface WebviewState {
  theme?: string;
  fontFamily?: string;
  zoomLevel?: number;
  tocVisible?: boolean;
  collapsedHeadings?: string[];
}

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
  getState(): WebviewState | null;
  setState(state: WebviewState): void;
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
  | "catppuccin-mocha"
  | "paper"
  | "midnight";

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
  "paper",
  "midnight",
];
const DEBOUNCE_MS = 300;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// Platform detection: macOS uses Cmd (metaKey) for link-click, Windows/Linux uses Ctrl
const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);

const vscode = acquireVsCodeApi();

document.addEventListener("mermaid-copy-error", (e: Event) => {
  const detail = (e as CustomEvent<{ message?: string }>).detail;
  vscode.postMessage({
    type: "showWarning",
    message: detail?.message || "Failed to copy mermaid diagram",
  });
});

let editor: Editor | null = null;
let linkPopover: LinkPopoverController | null = null;
let globalThemeReceived: ThemeName | null = null;
let highlightCurrentLine = true;

// Document sync state. Declared here, above updateImageNodeSrc, because every
// suppression of a host-driven update now goes through this object: since #150
// the extension-update latch is a private field of ContentSync and
// `guardExtensionUpdate` is the only way to raise it. This module keeps no copy
// of that flag; a second one here is the #142 shape, two places holding one truth.
const contentSync = new ContentSync({
  postMessage: (msg) => vscode.postMessage(msg),
  getEditorBody: () => (editor ? transformForSave(editor.getMarkdown()) : null),
  checkPendingBlobs: (content) => processInlineImages(content),
  getImageMapVersion: () => getImageMapVersion(),
});

// Inline image handling
const INLINE_IMAGE_REGEX = /!\[([^\]]*)\]\(((?:blob:|data:image\/)[^)]+)\)/g;

function updateImageNodeSrc(oldSrc: string, newSrc: string): boolean {
  const ed = editor;
  if (!ed) return false;
  return contentSync.guardExtensionUpdate(() =>
    updateEditorImageNodeSrc(ed, oldSrc, newSrc),
  );
}

const pendingImageSaves = new Map<string, number>();
const PENDING_IMAGE_TIMEOUT = 10000;

async function getBase64FromUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) {
    return url;
  }
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
  const subtype = mimeType.split("/")[1]?.replace(/;.*/, "") || "png";
  const ext = subtype.split("+")[0]; // Handle compound types like svg+xml
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `image-${timestamp}-${random}.${ext}`;
}

/**
 * Extract image file from clipboard data.
 * Checks both DataTransferItemList (items) and FileList (files) for robustness.
 */
function getImageFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null;

  // Primary: check items (DataTransferItemList)
  const items = Array.from(clipboardData.items || []);
  const imageItem = items.find(i => i.type.startsWith("image/"));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (file) return file;
  }

  // Fallback: check files (FileList) — some environments only populate files
  const files = Array.from(clipboardData.files || []);
  return files.find(f => f.type.startsWith("image/")) || null;
}

/**
 * Process an image file from paste/drop: read as base64, send to extension, insert placeholder.
 */
/** Convert a data URL to a File object */
function dataUrlToFile(dataUrl: string, filename: string): File | null {
  try {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return null;
    const byteString = atob(match[2]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new File([ab], filename, { type: match[1] });
  } catch {
    return null;
  }
}

// Dedup guard: prevent double-insert from overlapping clipboard fallback paths
let lastPasteTimestamp = 0;
const PASTE_DEDUP_MS = 500;

function processImagePaste(view: import("@tiptap/pm/view").EditorView, file: File): void {
  const now = Date.now();
  if (now - lastPasteTimestamp < PASTE_DEDUP_MS) return;
  lastPasteTimestamp = now;

  if (file.size > MAX_IMAGE_SIZE) {
    vscode.postMessage({
      type: "showWarning",
      message: `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
    });
    return;
  }

  const reader = new FileReader();
  reader.onloadend = () => {
    const base64 = reader.result as string;
    const filename = generateImageFilename(file.type);

    vscode.postMessage({
      type: "saveImage",
      data: base64,
      filename,
      blobUrl: base64,
    });

    // Insert placeholder image with base64 src (will be replaced by imageSaved)
    const { state, dispatch } = view;
    const imageNode = state.schema.nodes.image;
    if (imageNode) {
      const node = imageNode.create({ src: base64, alt: "" });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr);
    }
  };
  reader.readAsDataURL(file);
}

async function processInlineImages(content: string): Promise<boolean> {
  const matches = [...content.matchAll(INLINE_IMAGE_REGEX)];
  if (matches.length === 0) return false;

  let hasPendingImages = false;
  for (const match of matches) {
    const [, , imageUrl] = match;

    const pendingTimestamp = pendingImageSaves.get(imageUrl);
    if (pendingTimestamp) {
      if (Date.now() - pendingTimestamp < PENDING_IMAGE_TIMEOUT) {
        hasPendingImages = true;
        continue;
      }
      pendingImageSaves.delete(imageUrl);
    }

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
        blobUrl: imageUrl,
      });

      setTimeout(() => {
        if (pendingImageSaves.has(imageUrl)) {
          console.warn("[Image] Save timeout, cleaning up:", imageUrl.slice(0, 50));
          pendingImageSaves.delete(imageUrl);
        }
      }, PENDING_IMAGE_TIMEOUT + 1000);
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

  const searchStart = "](";
  const searchEnd = ")";
  let result = contentSync.getBody();
  let searchPos = 0;

  while (true) {
    const urlStart = result.indexOf(searchStart + imageUrl + searchEnd, searchPos);
    if (urlStart === -1) break;

    const replaceStart = urlStart + searchStart.length;
    const replaceEnd = replaceStart + imageUrl.length;
    result =
      result.substring(0, replaceStart) + savedPath + result.substring(replaceEnd);
    searchPos = replaceStart + savedPath.length;
  }

  contentSync.setBody(result);

  if (webviewUri) {
    mutateImageMap((map) => {
      map[savedPath] = webviewUri;
    });
  }

  postEdit(buildContent(contentSync.getBody()));

  if (editor && webviewUri) {
    updateImageNodeSrc(imageUrl, webviewUri);
  }
}

// Perf (Fix 3): Avoid JSON.stringify + Object.keys().sort() on every edit.
// The image map version tracks mutations to the map: cheaper than key enumeration.
function serializeStateForEcho(content: string, _imageMap?: Record<string, string>): string {
  return contentSync.serializeStateForEcho(content);
}

/** The body as this webview would write it, without touching `currentBody`. */
function serializeEditorBody(): string | null {
  return contentSync.serializeEditorBody();
}

/** The full document (frontmatter + body) as it would be written out. */
function buildContent(body: string): string {
  return contentSync.buildContent(body);
}

/**
 * The ONE place an `edit` leaves the webview (#111).
 * Delegated to ContentSync.
 */
function postEdit(content: string): boolean {
  return contentSync.postEdit(content);
}

/** Re-anchor the baseline to what the editor currently holds. */
export function resetContentBaseline(): void {
  contentSync.resetContentBaseline();
}

// Rename completion: delegates map mutation and editor node updates to the
// image translation module, and the baseline re-anchoring to ContentSync
// (#142, #147). The rewrite runs under the extension-update latch, so the
// transactions it dispatches do not post the rewritten text back as a user
// edit; re-anchoring afterwards is what makes the new paths the baseline.
function handleImageRenamed(
  oldSrc: string,
  oldPath: string,
  newPath: string,
  webviewUri: string,
): void {
  const ed = editor;
  if (!ed) return;
  contentSync.guardExtensionUpdate(() => {
    applyImageRenameTranslation(oldSrc, oldPath, newPath, webviewUri, ed);
  });
  resetContentBaseline();
}

setOnImageRenamed((oldSrc, oldPath, newPath, webviewUri) => {
  handleImageRenamed(oldSrc, oldPath, newPath, webviewUri);
});

// Perf (Fix 1): Serialization (getMarkdown + transformForSave) happens inside the
// debounce callback, not on every keystroke. onUpdate just schedules this.
function debouncedPostEdit(): void {
  contentSync.debouncedPostEdit();
}

function flushPendingEdit(): void {
  const hasPendingDebounce = contentSync.hasPendingDebounce();
  const hasPendingMetadata = metadataDebounceTimer !== null;
  if (!hasPendingDebounce && !hasPendingMetadata) return;

  if (metadataDebounceTimer !== null) {
    clearTimeout(metadataDebounceTimer);
    metadataDebounceTimer = null;
    const textarea = getMetadataTextarea();
    if (textarea) {
      contentSync.setFrontmatter(textarea.value.trim() === "" ? null : textarea.value);
    }
  }

  contentSync.flushPendingEdit(true);
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
    details.classList.add("hidden");
    addBtn.classList.remove("hidden");
    textarea.classList.remove("error");
    errorEl.classList.add("hidden");
  } else {
    details.classList.remove("hidden");
    addBtn.classList.add("hidden");
    textarea.value = frontmatter;
    autoResizeTextarea(textarea);

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
  const hasPendingBlobs = await processInlineImages(contentSync.getBody());
  if (hasPendingBlobs) {
    return;
  }
  postEdit(buildContent(contentSync.getBody()));
}

function debouncedMetadataEdit(): void {
  if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
  metadataDebounceTimer = setTimeout(() => {
    const textarea = getMetadataTextarea();
    if (!textarea) return;

    contentSync.setFrontmatter(textarea.value.trim() === "" ? null : textarea.value);
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

    textarea.addEventListener("blur", () => {
      validateAndShowError();
    });

    textarea.addEventListener("keydown", (e) => {
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

        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        validateAndShowError();
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      contentSync.setFrontmatter("");
      updateMetadataPanel("", true);
      const ta = getMetadataTextarea();
      if (ta) ta.focus();
      sendFullContent();
    });
  }
}

function showError(message: string): void {
  const errorHtml = `
    <div style="padding: 20px; color: var(--vscode-errorForeground, red);">
      <h3>Error</h3>
      <p>${escapeHtml(message)}</p>
      <p>Try reopening the file or reloading the window.</p>
    </div>
  `;
  const editorEl = getEditorEl();
  if (editorEl) {
    editorEl.innerHTML = errorHtml;
  } else {
    // Fallback when #editor element is missing
    console.error("[Tiptap]", message);
    document.body.innerHTML = errorHtml;
  }
}

// Theme management
const DARK_THEMES: ReadonlySet<ThemeName> = new Set([
  "frame-dark", "nord-dark", "crepe-dark",
  "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha",
  "midnight",
]);

function setTheme(themeName: ThemeName, saveGlobal = true): void {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${themeName}`);

  // Sync dark/light class with selected editor theme for hljs colors
  applyTheme(DARK_THEMES.has(themeName) ? "dark" : "light");

  const select = getThemeSelect();
  if (select) select.value = themeName;

  vscode.setState({ ...vscode.getState(), theme: themeName });

  if (saveGlobal) {
    globalThemeReceived = themeName;
    vscode.postMessage({ type: "themeChange", theme: themeName });
  }
}

function initTheme(vsCodeTheme: "dark" | "light"): void {
  if (globalThemeReceived) {
    // Ensure dark/light body class matches the saved theme
    applyTheme(DARK_THEMES.has(globalThemeReceived) ? "dark" : "light");
    return;
  }

  const defaultTheme = vsCodeTheme === "dark" ? "frame-dark" : "frame";

  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${defaultTheme}`);
  applyTheme(vsCodeTheme);

  const select = getThemeSelect();
  if (select) select.value = defaultTheme;
}

function viewSource(): void {
  vscode.postMessage({ type: "viewSource" });
}

// Font selector instance
let fontSelector: FontSelectorAPI | null = null;

/** Apply font family override on editor content (empty = use theme default) */
function applyFontFamily(fontFamily: string): void {
  const tiptapEl = document.querySelector(".tiptap") as HTMLElement | null;
  if (tiptapEl) {
    if (fontFamily) {
      tiptapEl.style.setProperty("--crepe-font-default", `"${sanitizeFontName(fontFamily)}", sans-serif`);
    } else {
      tiptapEl.style.removeProperty("--crepe-font-default");
    }
  }
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;
let currentZoom = ZOOM_DEFAULT;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  // Round to 2 decimals to avoid floating-point drift (e.g. 0.1 + 0.1 + 0.1 !== 0.3)
  const rounded = Math.round(value * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

/**
 * Apply zoom scale to editor content only (the .tiptap element).
 *
 * Toolbar, TOC, metadata panel and popups are untouched. CSS `zoom` is
 * transparent to JS coordinate APIs (getBoundingClientRect, clientX/Y,
 * posAtCoords), so plugins stay correct as long as their overlays attach to
 * `#editor-container` (the non-zoomed parent) rather than `.tiptap`.
 */
function applyZoom(value: number): void {
  const tiptapEl = document.querySelector(".tiptap") as HTMLElement | null;
  if (tiptapEl) {
    if (value === ZOOM_DEFAULT) {
      tiptapEl.style.removeProperty("zoom");
    } else {
      tiptapEl.style.zoom = String(value);
    }
  }
  const display = document.getElementById("btn-zoom-reset");
  if (display) display.textContent = `${Math.round(value * 100)}%`;
  const outBtn = document.getElementById("btn-zoom-out") as HTMLButtonElement | null;
  const inBtn = document.getElementById("btn-zoom-in") as HTMLButtonElement | null;
  if (outBtn) outBtn.disabled = value <= ZOOM_MIN;
  if (inBtn) inBtn.disabled = value >= ZOOM_MAX;
}

/** Set zoom level, persist to state, notify extension. */
function setZoom(value: number, persist = true): void {
  const next = clampZoom(value);
  currentZoom = next;
  applyZoom(next);
  if (persist) {
    vscode.setState({ ...vscode.getState(), zoomLevel: next });
    vscode.postMessage({ type: "zoomChange", zoom: next });
  }
}

function applyFontSize(size: number): void {
  if (!Number.isFinite(size) || size < 8 || size > 32) return;
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

let currentListIndentation: { style: "space" | "tab"; size: number } = { style: "space", size: 2 };
let currentTabSize = 2;

// Editor initialization
function initEditor(initialContent: string = ""): Editor | null {
  // Publish Tiptap and ProseMirror on window BEFORE any lazy artifact can be
  // injected. An artifact that bundled its own ProseMirror would get its own
  // PluginKey identities and its own EditorState class, and the mismatch only
  // shows up at runtime (src/webview/tiptap-globals.ts).
  publishTiptapGlobals();

  const editorEl = getEditorEl();
  if (!editorEl) {
    console.error("[Tiptap] Editor element not found");
    showError("Editor element not found");
    return null;
  }

  try {
    // Build conditional extensions
    const conditionalExtensions = [
      HeadingLevel,
      HeadingCollapse,
      CodeBlockEnhancement,
      ...(highlightCurrentLine ? [LineHighlight] : []),
    ];

    const instance = new Editor({
      element: editorEl,
      extensions: [
        ...buildMarkdownExtensions({
          indentation: currentListIndentation,
          tabSize: currentTabSize,
        }),
        Placeholder.configure({
          placeholder: "Type something...",
        }),
        CodeExitHandler,
        MermaidDiagram,
        TableContextMenu,
        SearchPlugin,
        FileMention,
        WikiLinkSuggestion,
        SlashCommand,
        EmojiSuggestion,
        createBubbleMenuExtension({ onOpenLink: () => linkPopover?.open() }),
        ...conditionalExtensions,
      ],
      content: initialContent,
      contentType: 'markdown',
      // Opening a document used to put no caret anywhere: nothing in this
      // webview focused the editor, and a ProseMirror selection in an unfocused
      // view draws nothing at all. Found while chasing a position-restore
      // report that turned out not to be about positions.
      autofocus: 'start' as const,
      editorProps: {
        handlePaste(view, event) {
          const file = getImageFromClipboard(event.clipboardData);
          if (!file) return false;
          event.preventDefault();
          processImagePaste(view, file);
          return true;
        },
        handleDrop(view, event) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;

          const imageFile = Array.from(files).find(f => f.type.startsWith("image/"));
          if (!imageFile) return false;

          event.preventDefault();

          if (imageFile.size > MAX_IMAGE_SIZE) {
            vscode.postMessage({
              type: "showWarning",
              message: `Image too large (${(imageFile.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
            });
            return true;
          }

          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result as string;
            const filename = imageFile.name || generateImageFilename(imageFile.type);

            vscode.postMessage({
              type: "saveImage",
              data: base64,
              filename,
              blobUrl: base64,
            });

            // Insert at drop position, resolved to block boundary
            const coords = { left: event.clientX, top: event.clientY };
            const dropPos = view.posAtCoords(coords);
            if (dropPos) {
              const { state, dispatch } = view;
              const imageNode = state.schema.nodes.image;
              if (imageNode) {
                const node = imageNode.create({ src: base64, alt: "" });
                // Block-level image: insert after current top-level block
                const $pos = state.doc.resolve(dropPos.pos);
                const insertPos = $pos.depth > 0
                  ? Math.min($pos.after(1), state.doc.content.size)
                  : dropPos.pos;
                try {
                  dispatch(state.tr.insert(insertPos, node));
                } catch {
                  dispatch(state.tr.insert(state.doc.content.size, node));
                }
              }
            }
          };
          reader.readAsDataURL(imageFile);
          return true;
        },
      },
      onUpdate: () => {
        if (contentSync.isUpdating()) return;
        // Perf (Fix 1): Serialization moved inside debouncedPostEdit — runs only once per 300ms window.
        debouncedPostEdit();
      },
      onSelectionUpdate: ({ editor: ed }) => {
        updateToolbarActiveState(ed);
        handleFocusModeTransaction(ed);
      },
      onTransaction: ({ editor: ed, transaction: tr }) => {
        updateToolbarActiveState(ed);
        updateTocFromEditor(ed, tr.docChanged);
        handleFocusModeTransaction(ed);
        if (tr.docChanged) updateWordCount(ed);
        // Persist collapsed heading state on toggle only
        const collapseMeta = tr.getMeta(collapsePluginKey);
        if (collapseMeta?.type === "toggle") {
          const keys = getCollapsedHeadings(ed.state);
          vscode.setState({ ...vscode.getState(), collapsedHeadings: keys });
        }
      },
    });

    hideLoading();

    setupDragHandle(instance);

    return instance;
  } catch (error) {
    console.error("[Tiptap] Failed to create editor:", error);
    showError(
      `Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function updateEditorContent(content: string): void {
  if (!editor) return;

  // Cancel pending debounced edit
  contentSync.cancelDebounce();

  try {
    // Save cursor position and scroll offset
    const { from, to } = editor.state.selection;
    const scroller = document.getElementById("editor-container");
    const savedScrollTop = scroller?.scrollTop ?? 0;
    const savedScrollLeft = scroller?.scrollLeft ?? 0;

    // Use setContent with emitUpdate: false to prevent echo loops
    editor.commands.setContent(content, { emitUpdate: false, contentType: 'markdown' });

    // Restore cursor position (clamp to new document size)
    const newDocSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, newDocSize);
    const safeTo = Math.min(to, newDocSize);
    try {
      editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
    } catch {
      // If position restoration fails, move cursor to start
      editor.commands.focus('start');
    }

    // Restore scroll offset
    if (scroller) {
      scroller.scrollTop = savedScrollTop;
      scroller.scrollLeft = savedScrollLeft;
    }
  } catch (err) {
    console.error("[Tiptap] Failed to update content:", err);
  }
}

function applyTheme(theme: "dark" | "light"): void {
  document.body.classList.remove("dark-theme", "light-theme");
  document.body.classList.add(`${theme}-theme`);
  // Sync mermaid diagram theme
  clearMermaidCache();
  updateMermaidTheme(theme === "dark");
}

// Toolbar command mapping
const TOOLBAR_COMMANDS: Record<string, (ed: Editor) => void> = {
  bold: (ed) => ed.chain().focus().toggleBold().run(),
  italic: (ed) => ed.chain().focus().toggleItalic().run(),
  underline: (ed) => ed.chain().focus().toggleUnderline().run(),
  strike: (ed) => ed.chain().focus().toggleStrike().run(),
  code: (ed) => ed.chain().focus().toggleCode().run(),
  highlight: (ed) => ed.chain().focus().toggleHighlight().run(),
  bulletList: (ed) => ed.chain().focus().toggleBulletList().run(),
  orderedList: (ed) => ed.chain().focus().toggleOrderedList().run(),
  taskList: (ed) => ed.chain().focus().toggleTaskList().run(),
  blockquote: (ed) => ed.chain().focus().toggleBlockquote().run(),
  codeBlock: (ed) => ed.chain().focus().toggleCodeBlock().run(),
  horizontalRule: (ed) => ed.chain().focus().setHorizontalRule().run(),
  insertTable: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  addColumnBefore: (ed) => ed.chain().focus().addColumnBefore().run(),
  addColumnAfter: (ed) => ed.chain().focus().addColumnAfter().run(),
  addRowAfter: (ed) => ed.chain().focus().addRowAfter().run(),
  deleteColumn: (ed) => ed.chain().focus().deleteColumn().run(),
  deleteRow: (ed) => ed.chain().focus().deleteRow().run(),
  deleteTable: (ed) => ed.chain().focus().deleteTable().run(),
  link: () => {
    linkPopover?.open();
  },
};

// Update toolbar button active states based on editor selection
function updateToolbarActiveState(ed: Editor): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar-btn[data-command]'));
  for (const btn of buttons) {
    const cmd = btn.dataset.command;
    if (!cmd) continue;
    const isActive =
      cmd === 'bold' ? ed.isActive('bold') :
        cmd === 'italic' ? ed.isActive('italic') :
          cmd === 'underline' ? ed.isActive('underline') :
            cmd === 'strike' ? ed.isActive('strike') :
              cmd === 'code' ? ed.isActive('code') :
                cmd === 'highlight' ? ed.isActive('highlight') :
                  cmd === 'bulletList' ? ed.isActive('bulletList') :
                    cmd === 'orderedList' ? ed.isActive('orderedList') :
                      cmd === 'taskList' ? ed.isActive('taskList') :
                        cmd === 'blockquote' ? ed.isActive('blockquote') :
                          cmd === 'codeBlock' ? ed.isActive('codeBlock') :
                            cmd === 'link' ? ed.isActive('link') :
                              false;
    btn.classList.toggle('is-active', isActive);
  }

  // Update heading select
  const headingSelect = document.getElementById('heading-select') as HTMLSelectElement | null;
  if (headingSelect) {
    let value = 'paragraph';
    for (let level = 1; level <= 6; level++) {
      if (ed.isActive('heading', { level })) {
        value = String(level);
        break;
      }
    }
    headingSelect.value = value;
  }

  // Show/hide table context buttons based on whether cursor is inside a table
  const tableContext = document.getElementById('table-context');
  if (tableContext) {
    const { $from } = ed.state.selection;
    let inTable = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') {
        inTable = true;
        break;
      }
    }
    tableContext.classList.toggle('hidden', !inTable);
  }
}

// Search bar handlers
function setupSearchBar(): void {
  const searchBar = document.getElementById("search-bar");
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const searchCount = document.getElementById("search-count");
  const searchPrevBtn = document.getElementById("search-prev");
  const searchNextBtn = document.getElementById("search-next");
  const searchCloseBtn = document.getElementById("search-close");
  const searchToggleReplaceBtn = document.getElementById("search-toggle-replace");
  const searchCaseBtn = document.getElementById("search-case");
  const replaceRow = document.getElementById("replace-row");
  const replaceInput = document.getElementById("replace-input") as HTMLInputElement | null;
  const replaceBtn = document.getElementById("replace-btn");
  const replaceAllBtn = document.getElementById("replace-all-btn");
  if (!searchBar || !searchInput) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let caseSensitive = false;

  function updateCount(): void {
    if (!searchCount || !editor) return;
    const info = getMatchInfo(editor);
    if (info.count > 0) {
      searchCount.textContent = `${info.activeIndex}/${info.count}`;
      searchInput?.classList.remove("no-results");
    } else if (searchInput && searchInput.value.length > 0) {
      searchCount.textContent = "0";
      searchInput.classList.add("no-results");
    } else {
      searchCount.textContent = "";
      searchInput?.classList.remove("no-results");
    }
  }

  function setReplaceVisible(visible: boolean): void {
    if (!replaceRow) return;
    if (visible) {
      replaceRow.classList.remove("hidden");
      searchToggleReplaceBtn?.classList.add("expanded");
    } else {
      replaceRow.classList.add("hidden");
      searchToggleReplaceBtn?.classList.remove("expanded");
    }
  }

  function openSearchBar(showReplace = false): void {
    searchBar!.classList.remove("hidden");
    if (showReplace) {
      setReplaceVisible(true);
      if (searchInput!.value.length > 0 && replaceInput) {
        replaceInput.focus();
        replaceInput.select();
      } else {
        searchInput!.focus();
        searchInput!.select();
      }
    } else {
      searchInput!.focus();
      searchInput!.select();
    }
  }

  function closeSearchBar(): void {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    searchBar!.classList.add("hidden");
    searchInput!.value = "";
    if (replaceInput) replaceInput.value = "";
    searchCount!.textContent = "";
    searchInput!.classList.remove("no-results");
    setReplaceVisible(false);
    if (editor) {
      clearSearch(editor);
      editor.commands.focus();
    }
  }

  function toggleSearchBar(e?: Event): void {
    const custom = e as CustomEvent<{ showReplace?: boolean }> | undefined;
    const wantReplace = custom?.detail?.showReplace;
    if (searchBar!.classList.contains("hidden")) {
      openSearchBar(!!wantReplace);
    } else if (wantReplace && replaceRow?.classList.contains("hidden")) {
      setReplaceVisible(true);
      if (searchInput!.value.length > 0 && replaceInput) {
        replaceInput.focus();
        replaceInput.select();
      } else {
        searchInput!.focus();
        searchInput!.select();
      }
    } else {
      closeSearchBar();
    }
  }

  // Listen for Mod-f and Mod-h from search-plugin.ts
  document.addEventListener("toggle-search-bar", toggleSearchBar);

  // Input → debounced search
  searchInput.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!editor) return;
      // performSearch selects and centres the first match at/after the cursor
      performSearch(editor, searchInput.value);
      updateCount();
    }, 150);
  });

  // Case sensitive toggle
  searchCaseBtn?.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    searchCaseBtn.classList.toggle("active", caseSensitive);
    if (editor) {
      setCaseSensitivity(editor, caseSensitive);
      updateCount();
    }
  });

  // Toggle replace row button
  searchToggleReplaceBtn?.addEventListener("click", () => {
    const isHidden = replaceRow?.classList.contains("hidden") ?? true;
    setReplaceVisible(isHidden);
    if (isHidden && replaceInput) {
      replaceInput.focus();
      replaceInput.select();
    }
  });

  function doReplace(): void {
    if (!editor) return;
    const term = replaceInput?.value ?? "";
    replaceCurrent(editor, term);
    updateCount();
  }

  function doReplaceAll(): void {
    if (!editor) return;
    const term = replaceInput?.value ?? "";
    replaceAllMatches(editor, term);
    updateCount();
  }

  replaceBtn?.addEventListener("click", doReplace);
  replaceAllBtn?.addEventListener("click", doReplaceAll);

  // Keyboard shortcuts in search input
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editor) { searchNext(editor); updateCount(); }
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (editor) { searchPrev(editor); updateCount(); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchBar();
    }
  });

  // Keyboard shortcuts in replace input
  replaceInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      doReplace();
    } else if (e.key === "Enter" && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doReplaceAll();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchBar();
    }
  });

  searchNextBtn?.addEventListener("click", () => {
    if (editor) { searchNext(editor); updateCount(); }
  });
  searchPrevBtn?.addEventListener("click", () => {
    if (editor) { searchPrev(editor); updateCount(); }
  });
  searchCloseBtn?.addEventListener("click", closeSearchBar);
}

// Toolbar auto-hide — typing hides after 3s, hover/mousemove reveals
let toolbarAutoHideController: AbortController | null = null;

function setupToolbarAutoHide(autoHide: boolean): void {
  // Cleanup previous listeners to prevent accumulation on config changes
  if (toolbarAutoHideController) {
    toolbarAutoHideController.abort();
    toolbarAutoHideController = null;
  }

  const toolbar = document.getElementById("toolbar");
  const hoverZone = document.getElementById("toolbar-hover-zone");
  if (!toolbar || !hoverZone) return;

  if (!autoHide) {
    toolbar.classList.remove("toolbar-hidden");
    hoverZone.classList.remove("active");
    return;
  }

  toolbarAutoHideController = new AbortController();
  const { signal } = toolbarAutoHideController;

  hoverZone.classList.add("active");
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let isHovering = false;

  const show = () => {
    toolbar.classList.remove("toolbar-hidden");
    if (hideTimeout) clearTimeout(hideTimeout);
  };

  const scheduleHide = () => {
    if (isHovering) return;
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      const popoverOpen = !document.getElementById("appearance-popover")?.classList.contains("hidden");
      if (!isHovering && !popoverOpen) toolbar.classList.add("toolbar-hidden");
    }, 3000);
  };

  document.querySelector(".tiptap")?.addEventListener("input", scheduleHide, { signal });
  hoverZone.addEventListener("mouseenter", () => { isHovering = true; show(); }, { signal });
  toolbar.addEventListener("mouseenter", () => { isHovering = true; show(); }, { signal });
  toolbar.addEventListener("mouseleave", () => { isHovering = false; scheduleHide(); }, { signal });
  hoverZone.addEventListener("mouseleave", () => { isHovering = false; }, { signal });
  toolbar.addEventListener("focusin", show, { signal });
}

// Reading progress bar
function setupReadingProgress(): void {
  const progressBar = document.getElementById("reading-progress");
  const editorContainer = document.getElementById("editor-container");
  if (!progressBar || !editorContainer) return;
  editorContainer.addEventListener("scroll", () => {
    const { scrollTop, scrollHeight, clientHeight } = editorContainer;
    const percent = scrollHeight <= clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * 100;
    progressBar.style.width = `${percent}%`;
  }, { passive: true });
}

// Word count indicator (debounced)
let wordCountTimer: ReturnType<typeof setTimeout> | null = null;
function updateWordCount(ed: Editor): void {
  if (wordCountTimer) clearTimeout(wordCountTimer);
  wordCountTimer = setTimeout(() => {
    const el = document.getElementById("word-count");
    if (!el) return;
    const text = ed.state.doc.textContent;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    // 200 words per minute, the figure most reading-time widgets use, and
    // rounded UP so a short document reads "1 min" rather than "0 min".
    const minutes = Math.max(1, Math.ceil(words / 200));
    el.textContent = words
      ? `${words.toLocaleString()} words · ${minutes} min read`
      : "0 words";
  }, 500);
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

  // Export (DOCX/PDF) from appearance popover
  const exportBtn = document.getElementById("btn-export-go") as HTMLButtonElement | null;
  exportBtn?.addEventListener("click", async () => {
    if (!exportBtn || exportBtn.disabled) return;
    exportBtn.disabled = true;
    // Safety net: re-enable after 60s even if extension never responds.
    // The normal path re-enables via the `exportDone` message listener below.
    const safetyTimer = window.setTimeout(() => {
      if (exportBtn) exportBtn.disabled = false;
    }, 60_000);
    try {
      const formatSelect = document.getElementById("export-format") as HTMLSelectElement | null;
      const format = formatSelect?.value || "docx";

      // Collect all rendered mermaid diagrams as PNG base64.
      // Only previews with data-rendered='true' have a usable SVG; the
      // extension will warn the user about blocks that fall through
      // (race with 500ms render debounce, or mermaid parse errors).
      const mermaidImages: { code: string; base64: string }[] = [];
      let skippedMermaidCount = 0;
      const previews = Array.from(document.querySelectorAll<HTMLElement>(".mermaid-preview[data-rendered='true']"));
      for (const preview of previews) {
        const code = preview.getAttribute("data-mermaid-src");
        const svgEl = preview.querySelector("svg");
        if (!code || !svgEl) continue;
        try {
          const blob = await svgToPngBlob(svgEl.outerHTML, 2);
          const reader = new FileReader();
          const base64: string = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          mermaidImages.push({ code: code.trim(), base64 });
        } catch (err) {
          skippedMermaidCount++;
          console.warn("[Export] Failed to rasterize Mermaid diagram:", err);
        }
      }
      if (skippedMermaidCount > 0) {
        vscode.postMessage({
          type: "showWarning",
          message: `${skippedMermaidCount} Mermaid diagram(s) could not be embedded in the export.`,
        });
      }
      const fontFamily = vscode.getState()?.fontFamily || "";
      vscode.postMessage({ type: "export", format, fontFamily, mermaidImages });
    } catch (err) {
      window.clearTimeout(safetyTimer);
      if (exportBtn) exportBtn.disabled = false;
      throw err;
    }
    // The safety timer is cleared inside the `exportDone` handler.
    (exportBtn as HTMLButtonElement & { _safetyTimer?: number })._safetyTimer = safetyTimer;
  });

  // Font selector
  const fontContainer = document.getElementById("font-selector-container");
  if (fontContainer) {
    fontSelector?.destroy();
    fontSelector = initFontSelector(fontContainer, (fontFamily) => {
      applyFontFamily(fontFamily);
      vscode.setState({ ...vscode.getState(), fontFamily });
      vscode.postMessage({ type: "fontChange", font: fontFamily });
    });
  }

  // Appearance popover (theme / font / source)
  const appearanceBtn = document.getElementById("btn-appearance");
  const appearancePopover = document.getElementById("appearance-popover");
  if (appearanceBtn && appearancePopover) {
    const closePopover = () => {
      appearancePopover.classList.add("hidden");
      appearanceBtn.classList.remove("is-active");
      appearanceBtn.setAttribute("aria-expanded", "false");
    };
    const openPopover = () => {
      appearancePopover.classList.remove("hidden");
      appearanceBtn.classList.add("is-active");
      appearanceBtn.setAttribute("aria-expanded", "true");
    };
    appearanceBtn.addEventListener("click", () => {
      if (appearancePopover.classList.contains("hidden")) {
        openPopover();
      } else {
        closePopover();
      }
    });
    // Close on mousedown outside popover. mousedown fires on the actual pressed
    // element, avoiding false closes from native <select> dropdowns and font
    // selector items that hide on mousedown before click can propagate.
    document.addEventListener("mousedown", (e) => {
      if (
        !appearancePopover.classList.contains("hidden") &&
        !appearancePopover.contains(e.target as Node) &&
        !appearanceBtn.contains(e.target as Node)
      ) {
        closePopover();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !appearancePopover.classList.contains("hidden")) {
        e.preventDefault();
        e.stopPropagation();
        closePopover();
        appearanceBtn.focus();
      }
    });
  }

  // Zoom controls
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
    setZoom(currentZoom - ZOOM_STEP);
  });
  document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
    setZoom(currentZoom + ZOOM_STEP);
  });
  document.getElementById("btn-zoom-reset")?.addEventListener("click", () => {
    setZoom(ZOOM_DEFAULT);
  });
  // Keyboard shortcuts: Cmd/Ctrl + = / - / 0
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (document.getElementById("lightbox-overlay")?.classList.contains("active")) return;
    // "=" and "+" share a physical key; accept both. NumpadAdd / NumpadSubtract too.
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      setZoom(currentZoom + ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setZoom(currentZoom - ZOOM_STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      setZoom(ZOOM_DEFAULT);
    }
  });

  // Formatting buttons
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.toolbar-btn[data-command]');
    if (!btn || !editor) return;
    const cmd = btn.dataset.command;
    if (cmd && TOOLBAR_COMMANDS[cmd]) {
      TOOLBAR_COMMANDS[cmd](editor);
    }
  });

  // Heading select
  const headingSelect = document.getElementById('heading-select') as HTMLSelectElement | null;
  headingSelect?.addEventListener('change', () => {
    if (!editor) return;
    const val = headingSelect.value;
    if (val === 'paragraph') {
      editor.chain().focus().setParagraph().run();
    } else {
      const level = parseInt(val, 10) as 1 | 2 | 3 | 4 | 5 | 6;
      editor.chain().focus().toggleHeading({ level }).run();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      viewSource();
    }
  });

  // Click on wiki link or markdown link opens target directly (no Ctrl/Cmd required)
  document.addEventListener("click", (e) => {
    const wikiLink = (e.target as HTMLElement).closest<HTMLElement>(".wiki-link");
    if (wikiLink) {
      e.preventDefault();
      e.stopPropagation();
      const filename = wikiLink.getAttribute("data-filename");
      if (filename) {
        vscode.postMessage({ type: "openWikiLink", filename });
      }
      return;
    }

    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !editor) return;

    e.preventDefault();
    e.stopPropagation();

    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#")) {
      scrollToHeading(href.slice(1));
    } else {
      vscode.postMessage({ type: "openLink", href });
    }
  });

}

/** Scroll editor to heading matching GitHub-style slug */
function scrollToHeading(slug: string): void {
  if (!editor) return;
  const { doc } = editor.state;
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    // The slug rule lives in heading-level-plugin.ts, next to the anchor button
    // that writes these strings. Two copies of it is how a copied anchor and the
    // heading it points at stop matching.
    if (headingSlug(node.textContent) === slug) {
      editor!.commands.setTextSelection(pos + 1);
      const dom = editor!.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        const scroller = document.getElementById("editor-container");
        if (scroller) {
          const elRect = dom.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          const targetTop = elRect.top - scrollerRect.top + scroller.scrollTop - 60;
          scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        } else {
          dom.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      return false;
    }
  });
}

window.addEventListener("message", async (event) => {
  const message = event.data as HostToWebviewMessage;
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "exportDone": {
      const btn = document.getElementById("btn-export-go") as
        | (HTMLButtonElement & { _safetyTimer?: number })
        | null;
      if (btn) {
        window.clearTimeout(btn._safetyTimer);
        btn._safetyTimer = undefined;
        btn.disabled = false;
      }
      break;
    }
    case "update":
      if (typeof message.content === "string") {
        const newImageMap = message.imageMap || {};

        if (contentSync.consumeEcho(message.content)) {
          // setImageMap replaces the map and bumps the version itself (#147).
          setImageMap(newImageMap);
          break;
        }

        setImageMap(newImageMap);

        contentSync.guardExtensionUpdate(() => {
          try {
            const parsed = contentSync.applyHostUpdate(message.content);

            updateMetadataPanel(parsed.frontmatter, parsed.isValid, parsed.error);

            const displayBody = transformForDisplay(parsed.body);

            let justInitialized = false;
            if (!editor) {
              editor = initEditor(displayBody);
              if (editor) {
                linkPopover = initLinkPopover(editor);
                initTocSidebar();
                setupFocusMode(editor, vscode);
                justInitialized = true;
                // Re-apply font after .tiptap element is created
                const savedFont = vscode.getState()?.fontFamily;
                if (savedFont) applyFontFamily(savedFont);
                // Re-apply zoom after .tiptap element is created
                applyZoom(currentZoom);
              }
            } else {
              updateEditorContent(displayBody);
            }

            if (editor) {
              // Transform table cells: convert text patterns (-, N., [x]) to proper list nodes
              transformTableCellsAfterParse(editor);
              // Anchor the baseline to what the editor now holds, AFTER the
              // table-cell transform, which legitimately changes the document
              // as part of parsing. From here on, an `edit` is only posted when
              // the serialized document differs from this (#111). The guard
              // below drops on a microtask, so anything deferred past it (a
              // timer, a rAF, a node view finishing an async load) arrives
              // unguarded; the baseline is what makes that harmless instead of
              // a silent rewrite of the user's file.
              //
              // One empty transaction first. StarterKit's `trailingNode` keeps a
              // paragraph at the end of the document so there is somewhere to
              // click after a table or an alert, and it does that from
              // `appendTransaction`, which ProseMirror does NOT run while the
              // editor is being constructed, only from the first transaction
              // onwards. `sample.md` ends in an alert, so the document grew that
              // paragraph the moment ANYTHING dispatched, and the paragraph
              // serializes to a trailing newline. That is #111: not a
              // mysterious load-time edit, but a document that is a different
              // document after its first transaction, whenever that happens to
              // arrive. Settling it here means the baseline describes the
              // document the user will actually be editing.
              editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
              resetContentBaseline();
              // Restore collapsed headings from saved state after first init
              if (justInitialized) {
                const saved = vscode.getState();
                if (saved?.collapsedHeadings?.length) {
                  setCollapsedHeadings(editor.view, saved.collapsedHeadings);
                }
              }
              // Update TOC after content change (skip if just initialized — initTocSidebar already did it)
              if (!justInitialized) updateTocFromEditor(editor, true);
              refreshBacklinksIfVisible();
              // Update search result count if search bar is visible
              const searchBar = document.getElementById("search-bar");
              if (searchBar && !searchBar.classList.contains("hidden")) {
                const searchCount = document.getElementById("search-count");
                const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
                if (searchCount) {
                  const info = getMatchInfo(editor);
                  if (info.count > 0) {
                    searchCount.textContent = `${info.activeIndex}/${info.count}`;
                    searchInput?.classList.remove("no-results");
                  } else if (searchInput && searchInput.value.length > 0) {
                    searchCount.textContent = "0";
                    searchInput.classList.add("no-results");
                  } else {
                    searchCount.textContent = "";
                    searchInput?.classList.remove("no-results");
                  }
                }
              }
            }
          } catch (err) {
            console.error("[Tiptap] Update failed:", err);
            showError(
              `Failed to update content: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });
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
      }
      if (typeof message.autoHideToolbar === "boolean") {
        setupToolbarAutoHide(message.autoHideToolbar);
      }
      if (message.listIndentation && typeof message.listIndentation === "object") {
        const style = message.listIndentation.style === "tab" ? "tab" : "space";
        const size = typeof message.listIndentation.size === "number" ? message.listIndentation.size : (style === "tab" ? 1 : 2);
        currentListIndentation = { style, size };
        if ((editor?.storage?.markdown?.manager as any)) {
          (editor!.storage.markdown.manager as any).indentStyle = style;
          (editor!.storage.markdown.manager as any).indentSize = size;
        }
        const mdExt = editor?.extensionManager?.extensions?.find((e: any) => e.name === "markdown");
        if (mdExt) {
          mdExt.options.indentation = currentListIndentation;
        }
      }
      if (typeof message.tabSize === "number") {
        currentTabSize = message.tabSize;
        if (editor) {
          const codeBlockExt = editor.extensionManager.extensions.find(
            (e) => e.name === "codeBlock",
          );
          if (codeBlockExt) {
            codeBlockExt.options.tabSize = message.tabSize;
          }
        }
      }
      break;
    case "savedTheme":
      if (
        typeof message.theme === "string" &&
        THEMES.includes(message.theme as ThemeName)
      ) {
        globalThemeReceived = message.theme as ThemeName;
        setTheme(globalThemeReceived, false);
      }
      break;
    case "savedFont":
      if (typeof message.font === "string" && fontSelector) {
        fontSelector.setSelected(message.font);
        vscode.setState({ ...vscode.getState(), fontFamily: message.font });
        applyFontFamily(message.font);
      }
      break;
    case "savedZoom":
      if (typeof message.zoom === "number") {
        // Persist=false — this came from extension, no need to echo back
        setZoom(message.zoom, false);
        vscode.setState({ ...vscode.getState(), zoomLevel: currentZoom });
      }
      break;
    case "systemFonts":
      if (Array.isArray(message.fonts) && fontSelector) {
        fontSelector.setFonts(message.fonts);
      }
      break;
    case "clipboardImage":
      if (message.error) {
        console.warn("[Clipboard]", message.error);
        break;
      }
      if (typeof message.data === "string" && editor?.view) {
        const file = dataUrlToFile(message.data, "clipboard-image.png");
        if (file) processImagePaste(editor.view, file);
      }
      break;
    case "imageSaved":
      if (
        typeof message.blobUrl === "string" &&
        typeof message.savedPath === "string"
      ) {
        if (typeof message.webviewUri === "string") {
          const { savedPath, webviewUri } = message;
          mutateImageMap((map) => {
            map[savedPath] = webviewUri;
          });
        }

        // Replace blob/base64 in editor with saved path
        replaceInlineImage(message.blobUrl, message.savedPath, message.webviewUri);
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
    case "fileSearchResults":
      if (Array.isArray(message.files)) {
        setFileMentionFiles(message.files, message.currentDocFolder);
      }
      break;
    case "wikiLinkSearchResults":
      if (Array.isArray(message.files)) {
        setWikiLinkFiles(message.files, message.currentDocFolder);
      }
      break;
    case "backlinks":
      if (Array.isArray(message.links)) {
        updateBacklinks(message.links);
      }
      break;
  }
});

// File mention: forward popup's search request to extension
document.addEventListener("file-mention-search", () => {
  vscode.postMessage({ type: "fileSearch" });
});

// Wiki link: forward popup's search request to extension
document.addEventListener("wiki-link-search", () => {
  vscode.postMessage({ type: "wikiLinkSearch" });
});

// TOC sidebar setup — registers toggle button handler
function setupTocHandlers(): void {
  const tocSidebar = document.getElementById("toc-sidebar");
  const tocBtn = document.getElementById("btn-toc");

  tocBtn?.addEventListener("click", () => {
    const isHidden = tocSidebar?.classList.toggle("hidden");
    tocBtn.classList.toggle("is-active", !isHidden);
    vscode.setState({ ...vscode.getState(), tocVisible: !isHidden });
  });
}

// Initialize TOC after editor is created — also restores visibility state
function initTocSidebar(): void {
  if (!editor) return;
  const tocContainer = document.getElementById("toc-entries");
  if (!tocContainer) return;

  setupTocSidebar(editor, tocContainer);

  // Restore visibility AFTER TOC content is populated
  if (vscode.getState()?.tocVisible) {
    const tocSidebar = document.getElementById("toc-sidebar");
    const tocBtn = document.getElementById("btn-toc");
    tocSidebar?.classList.remove("hidden");
    tocBtn?.classList.add("is-active");
  }
}

function init() {


  const savedState = vscode.getState();
  if (savedState?.theme && THEMES.includes(savedState.theme as ThemeName)) {
    setTheme(savedState.theme as ThemeName, false);
  }
  // Restore font from webview state (applies immediately, before extension sends savedFont)
  if (savedState?.fontFamily && typeof savedState.fontFamily === "string") {
    applyFontFamily(savedState.fontFamily);
  }
  // Restore zoom from webview state (applies immediately, before extension sends savedZoom)
  if (typeof savedState?.zoomLevel === "number") {
    setZoom(savedState.zoomLevel, false);
  } else {
    // Still initializes display + disabled states to 100%
    applyZoom(ZOOM_DEFAULT);
  }

  window.addEventListener("beforeunload", () => {
    pendingImageSaves.clear();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingEdit();
    }
  });

  window.addEventListener("pagehide", () => {
    flushPendingEdit();
  });

  setupToolbarHandlers();
  setupSearchBar();
  setupMetadataHandlers();
  setupTocHandlers();
  setupBacklinksPanel(vscode);

  const editorEl = document.getElementById("editor");
  if (editorEl) {
    setupImageEditOverlay(
      editorEl,
      () => editor?.view ?? null,
      (msg: WebviewToHostMessage) => vscode.postMessage(msg)
    );
  }
  setImageSrcProvider(promptForImageUrl);

  initLightbox();
  setupReadingProgress();

  // Image paste: VSCode webview does NOT fire paste events for image clipboard data.
  // The paste event only fires for text content. For images, we must intercept Cmd+V
  // at keydown and request the extension to read the system clipboard natively.
  // Dedup guard in processImagePaste() prevents double-insert.
  document.addEventListener("keydown", (e) => {
    if (!editor?.view) return;
    // Detect Cmd+V (macOS) or Ctrl+V (Windows/Linux), excluding Shift+Cmd+V (paste-as-text)
    const isPaste = (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
      && !e.shiftKey && e.key === "v";
    if (!isPaste) return;
    // Request extension-side clipboard read. Extension checks if clipboard has image,
    // responds with clipboardImage message only if it does. Text paste continues normally.
    vscode.postMessage({ type: "readClipboardImage" });
  }, { capture: true });

  vscode.postMessage({ type: "ready" });
}


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
