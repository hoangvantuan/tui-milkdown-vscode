import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Highlight } from "@tiptap/extension-highlight";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import diff from "highlight.js/lib/languages/diff";
import shell from "highlight.js/lib/languages/shell";
import plaintext from "highlight.js/lib/languages/plaintext";
import "./themes/index.css";
import {
  parseContent,
  reconstructContent,
  validateYaml,
} from "./frontmatter";
import { LineHighlight } from "./line-highlight-plugin";
import { HeadingLevel } from "./heading-level-plugin";
import { setupImageEditOverlay, handleUrlEditResponse, handleImageRenameResponse, setImageMap } from "./image-edit-plugin";
import { renderTableToMarkdown } from "./table-markdown-serializer";
import { transformTableCellsAfterParse } from "./table-cell-content-parser";

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

const lowlight = createLowlight();
lowlight.register({
  javascript, typescript, python, xml, css, json,
  bash, yaml, markdown, sql, java, cpp, go, rust,
  php, ruby, diff, shell, plaintext,
});

let editor: Editor | null = null;
let isUpdatingFromExtension = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let globalThemeReceived: ThemeName | null = null;
let currentFrontmatter: string | null = null;
let currentBody: string = "";
let lastSentState: string | null = null;
let highlightCurrentLine = true;
let currentImageMap: Record<string, string> = {};

// Node types that represent images in Tiptap
export const IMAGE_NODE_TYPES = ["image"];

// Image URL transform helpers
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Single-pass replacement: build one combined regex for all entries
function singlePassReplace(
  content: string,
  entries: [string, string][],
  reverseMap: Map<string, string>,
): string {
  if (entries.length === 0) return content;
  // Sort by key length descending to match longest first
  const sorted = entries.sort(([a], [b]) => b.length - a.length);
  const pattern = sorted.map(([key]) => escapeRegex(key)).join("|");
  const regex = new RegExp(pattern, "g");
  return content.replace(regex, (match) => reverseMap.get(match) ?? match);
}

function transformForDisplay(
  content: string,
  imageMap: Record<string, string>,
): string {
  const entries = Object.entries(imageMap);
  if (entries.length === 0) return content;
  const reverseMap = new Map(entries.map(([orig, uri]) => [orig, uri]));
  return singlePassReplace(content, entries, reverseMap);
}

function transformForSave(
  content: string,
  imageMap: Record<string, string>,
): string {
  const entries = Object.entries(imageMap);
  if (entries.length === 0) return content;
  // Reverse: webviewUri → originalPath
  const reversed = entries.map(([orig, uri]) => [uri, orig] as [string, string]);
  const reverseMap = new Map(reversed.map(([uri, orig]) => [uri, orig]));
  return singlePassReplace(content, reversed, reverseMap);
}

// Inline image handling
const INLINE_IMAGE_REGEX = /!\[([^\]]*)\]\(((?:blob:|data:image\/)[^)]+)\)/g;

function updateImageNodeSrc(oldSrc: string, newSrc: string): boolean {
  if (!editor) return false;

  try {
    const view = editor.view;
    if (!view) return false;

    const { state, dispatch } = view;

    const nodesToUpdate: Array<{ pos: number; node: typeof state.doc.firstChild; nodeSize: number }> = [];
    state.doc.descendants((node, pos) => {
      if (!IMAGE_NODE_TYPES.includes(node.type.name)) return;
      const src = node.attrs.src as string;
      if (src !== oldSrc) return;
      nodesToUpdate.push({ pos, node, nodeSize: node.nodeSize });
    });

    if (nodesToUpdate.length === 0) return false;

    nodesToUpdate.sort((a, b) => b.pos - a.pos);

    let tr = state.tr;
    for (const { pos, node, nodeSize } of nodesToUpdate) {
      const newNode = node!.type.create(
        { ...node!.attrs, src: newSrc },
        node!.content,
        node!.marks
      );
      tr = tr.replaceWith(pos, pos + nodeSize, newNode);
    }

    isUpdatingFromExtension = true;
    dispatch(tr);

    return true;
  } catch (err) {
    console.warn("[ImageSave] Failed to update node:", err);
    return false;
  } finally {
    queueMicrotask(() => {
      isUpdatingFromExtension = false;
    });
  }
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
  const ext = mimeType.split("/")[1]?.replace(/;.*/, "") || "png";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `image-${timestamp}-${random}.${ext}`;
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
  let result = currentBody;
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

  currentBody = result;

  if (webviewUri) {
    currentImageMap[savedPath] = webviewUri;
    setImageMap(currentImageMap);
  }

  const fullContent = reconstructContent(currentFrontmatter, currentBody);
  vscode.postMessage({ type: "edit", content: fullContent });

  if (editor && webviewUri) {
    updateImageNodeSrc(imageUrl, webviewUri);
  }
}

function serializeStateForEcho(content: string, imageMap: Record<string, string>): string {
  const sortedKeys = Object.keys(imageMap).sort();
  return JSON.stringify({ content, imageMapKeys: sortedKeys });
}

const MAX_BLOB_RETRIES = 5;
let blobRetryCount = 0;

function debouncedPostEdit(content: string): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const hasPendingBlobs = await processInlineImages(content);
    if (hasPendingBlobs) {
      if (blobRetryCount < MAX_BLOB_RETRIES) {
        // Exponential backoff: 300, 600, 1200, 2400, 4800ms
        const backoff = DEBOUNCE_MS * Math.pow(2, blobRetryCount);
        blobRetryCount++;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          debouncedPostEdit(content);
        }, backoff);
      } else {
        // Max retries reached - send edit anyway to avoid stuck state
        blobRetryCount = 0;
        lastSentState = serializeStateForEcho(content, currentImageMap);
        vscode.postMessage({ type: "edit", content });
        debounceTimer = null;
      }
      return;
    }

    blobRetryCount = 0;
    lastSentState = serializeStateForEcho(content, currentImageMap);
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
  const hasPendingBlobs = await processInlineImages(currentBody);
  if (hasPendingBlobs) {
    return;
  }
  const fullContent = reconstructContent(currentFrontmatter, currentBody);
  lastSentState = serializeStateForEcho(fullContent, currentImageMap);
  vscode.postMessage({ type: "edit", content: fullContent });
}

function debouncedMetadataEdit(): void {
  if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
  metadataDebounceTimer = setTimeout(() => {
    const textarea = getMetadataTextarea();
    if (!textarea) return;

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
]);

function setTheme(themeName: ThemeName, saveGlobal = true): void {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${themeName}`);

  // Sync dark/light class with selected editor theme for hljs colors
  applyTheme(DARK_THEMES.has(themeName) ? "dark" : "light");

  const select = getThemeSelect();
  if (select) select.value = themeName;

  vscode.setState({ theme: themeName });

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

// Editor initialization
function initEditor(initialContent: string = ""): Editor | null {
  console.log("[Tiptap] Starting initialization...");
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
      ...(highlightCurrentLine ? [LineHighlight] : []),
    ];

    const instance = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({
          codeBlock: false, // Replaced by CodeBlockLowlight
          paragraph: false, // Replaced by custom Paragraph below
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
          },
        }),
        Paragraph.extend({
          renderMarkdown(node: any, h: any) {
            if (!node) return '';
            const content = Array.isArray(node.content) ? node.content : [];
            if (content.length === 0) return '<br>';
            return h.renderChildren(content);
          },
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
        }),
        Highlight,
        Table.extend({
          renderMarkdown(node: any, h: any) {
            return renderTableToMarkdown(node, h);
          },
        }).configure({
          resizable: true,
        }),
        TableRow,
        TableCell,
        TableHeader,
        CodeBlockLowlight.configure({
          lowlight,
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Placeholder.configure({
          placeholder: "Type something...",
        }),
        Markdown.configure({
          indentation: { style: 'space', size: 2 },
          markedOptions: {
            gfm: true,
            breaks: false,
          },
        }),
        ...conditionalExtensions,
      ],
      content: initialContent,
      contentType: 'markdown',
      editorProps: {
        handlePaste(view, event) {
          const items = Array.from(event.clipboardData?.items || []);
          const imageItem = items.find(i => i.type.startsWith("image/"));
          if (imageItem) {
            event.preventDefault();
            const file = imageItem.getAsFile();
            if (!file) return true;

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
            return true;
          }
          return false;
        },
        handleDrop(view, event) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;

          const imageFile = Array.from(files).find(f => f.type.startsWith("image/"));
          if (!imageFile) return false;

          event.preventDefault();
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

            // Insert at drop position
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (pos) {
              const { state, dispatch } = view;
              const imageNode = state.schema.nodes.image;
              if (imageNode) {
                const node = imageNode.create({ src: base64, alt: "" });
                const tr = state.tr.insert(pos.pos, node);
                dispatch(tr);
              }
            }
          };
          reader.readAsDataURL(imageFile);
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (isUpdatingFromExtension) return;
        // Get markdown from @tiptap/markdown
        const markdown = ed.getMarkdown();
        currentBody = transformForSave(markdown, currentImageMap);
        debouncedPostEdit(reconstructContent(currentFrontmatter, currentBody));
      },
    });

    hideLoading();
    console.log("[Tiptap] Editor created successfully!");
    return instance;
  } catch (error) {
    console.error("[Tiptap] Failed to create editor:", error);
    showError(
      `Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// Convert paragraphs containing only a hardBreak (from <br> parsing) to empty paragraphs.
// This ensures roundtrip: empty paragraph → <br> → parse → paragraph(hardBreak) → empty paragraph.
function convertBrOnlyParagraphsToEmpty(ed: Editor): void {
  const { doc, schema } = ed.state;
  const positions: { pos: number; nodeSize: number }[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' &&
        node.childCount === 1 &&
        node.firstChild?.type.name === 'hardBreak') {
      positions.push({ pos, nodeSize: node.nodeSize });
    }
  });

  if (positions.length === 0) return;

  // Process in reverse to maintain position validity
  positions.sort((a, b) => b.pos - a.pos);
  let tr = ed.state.tr;
  for (const { pos, nodeSize } of positions) {
    tr = tr.replaceWith(pos, pos + nodeSize, schema.nodes.paragraph.create());
  }
  ed.view.dispatch(tr);
}

function updateEditorContent(content: string): void {
  if (!editor) return;

  // Cancel pending debounced edit
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  try {
    // Save cursor position
    const { from, to } = editor.state.selection;

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
  } catch (err) {
    console.error("[Tiptap] Failed to update content:", err);
  }
}

function applyTheme(theme: "dark" | "light"): void {
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

        const incomingState = serializeStateForEcho(message.content, newImageMap);

        if (incomingState === lastSentState) {
          lastSentState = null;
          currentImageMap = newImageMap;
          setImageMap(newImageMap);
          break;
        }
        lastSentState = null;

        currentImageMap = newImageMap;
        setImageMap(newImageMap);

        try {
          isUpdatingFromExtension = true;

          const parsed = parseContent(message.content);
          currentFrontmatter = parsed.frontmatter;
          currentBody = parsed.body;

          updateMetadataPanel(parsed.frontmatter, parsed.isValid, parsed.error);

          const displayBody = transformForDisplay(parsed.body, currentImageMap);

          if (!editor) {
            editor = initEditor(displayBody);
          } else {
            updateEditorContent(displayBody);
          }

          if (editor) {
            // Transform table cells: convert text patterns (-, N., [x]) to proper list nodes
            transformTableCellsAfterParse(editor);
            // Convert <br>-only paragraphs (from parsing) to empty paragraphs
            convertBrOnlyParagraphsToEmpty(editor);
          }
        } catch (err) {
          console.error("[Tiptap] Update failed:", err);
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
    case "imageSaved":
      if (
        typeof message.blobUrl === "string" &&
        typeof message.savedPath === "string"
      ) {
        if (typeof message.webviewUri === "string") {
          currentImageMap[message.savedPath] = message.webviewUri;
          setImageMap(currentImageMap);
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
  }
});

function init() {
  console.log("[Tiptap] init() called");

  const savedState = vscode.getState();
  if (savedState?.theme && THEMES.includes(savedState.theme as ThemeName)) {
    setTheme(savedState.theme as ThemeName, false);
  }

  window.addEventListener("beforeunload", () => {
    pendingImageSaves.clear();
  });

  setupToolbarHandlers();
  setupMetadataHandlers();

  const editorEl = document.getElementById("editor");
  if (editorEl) {
    setupImageEditOverlay(
      editorEl,
      () => editor?.view ?? null,
      (msg) => vscode.postMessage(msg)
    );
  }

  console.log("[Tiptap] init() complete, sending ready signal");
  vscode.postMessage({ type: "ready" });
}

console.log("[Tiptap] Script loaded, readyState:", document.readyState);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
