import type { EditorView } from "@tiptap/pm/view";
import { IMAGE_NODE_TYPES } from "./main";
import { cleanImagePath } from "../utils/clean-image-path";

/**
 * Floating overlay for editing image URLs.
 * Uses a separate overlay element to avoid interfering with editor's DOM.
 */

// Pencil SVG icon
const EDIT_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;

// Callback types
type EditCallback = (newUrl: string, originalPath: string) => void;
const pendingEdits = new Map<string, { callback: EditCallback; originalPath: string }>();

// Pending rename operations (rename file before updating editor)
interface PendingRename {
  nodePos: number;
  nodeAttrs: Record<string, unknown>;
  oldPath: string; // Track old path to remove from imageMap after rename
}
const pendingRenames = new Map<string, PendingRename>();

// Store references
let storedGetView: (() => EditorView | null) | null = null;
let storedPostMessage: ((msg: unknown) => void) | null = null;
let currentImageMap: Record<string, string> = {};

// Overlay elements
let overlayContainer: HTMLDivElement | null = null;
let currentHoveredImg: HTMLImageElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let storedEditorEl: HTMLElement | null = null;

// Track mouse position for detecting hover on newly added images
let lastMouseX = 0;
let lastMouseY = 0;

// Image cache for optimized mousemove performance
let cachedImages: HTMLImageElement[] = [];
let imageCacheValid = false;

/** Refresh image cache from DOM */
function refreshImageCache(editorEl: HTMLElement): void {
  cachedImages = Array.from(editorEl.querySelectorAll("img"));
  imageCacheValid = true;
}

/**
 * Check if a point is inside an element's bounding rect
 */
function isPointInElement(x: number, y: number, el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Create the floating overlay container
 * Appends to parent of editorEl (container) to survive editor recreation
 */
function createOverlay(editorEl: HTMLElement): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "image-edit-overlay";
  overlay.innerHTML = `<button class="image-edit-btn" title="Edit image path">${EDIT_ICON_SVG}</button>`;

  const btn = overlay.querySelector(".image-edit-btn") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentHoveredImg) {
      triggerImageEdit(currentHoveredImg);
    }
  });

  // Append to parent (container) instead of editorEl to survive editor recreation
  const container = editorEl.parentElement;
  if (container) {
    container.appendChild(overlay);
  } else {
    editorEl.appendChild(overlay);
  }
  return overlay;
}

/**
 * Position overlay relative to image (accounts for scroll)
 * Uses left instead of right for consistent positioning across hover states
 */
function positionOverlay(img: HTMLImageElement): void {
  if (!overlayContainer || !storedEditorEl) return;

  // Get container (where overlay is appended) for positioning reference
  const container = overlayContainer.parentElement;
  if (!container) return;

  const imgRect = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  // Position at top-right of image, relative to container
  // Use left positioning (imgRect.right - button width offset) for consistency
  const top = imgRect.top - containerRect.top + container.scrollTop + 12;
  const left = imgRect.right - containerRect.left - 48 - 32; // 36 offset + 32 button width

  // Clear right property and set left for consistent positioning
  overlayContainer.style.right = "";
  overlayContainer.style.top = `${top}px`;
  overlayContainer.style.left = `${left}px`;
  overlayContainer.classList.add("visible");
}

/**
 * Show overlay for image, cancel any pending hide
 */
function showOverlay(img: HTMLImageElement): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  currentHoveredImg = img;
  positionOverlay(img);
}

/**
 * Hide overlay immediately (CSS handles fade animation)
 */
function hideOverlay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (overlayContainer) {
    overlayContainer.classList.remove("visible");
  }
  currentHoveredImg = null;
}

/**
 * Setup hover listeners for images
 */
export function setupImageEditOverlay(
  editorEl: HTMLElement,
  getView: () => EditorView | null,
  postMessage: (msg: unknown) => void
): () => void {
  storedGetView = getView;
  storedPostMessage = postMessage;
  storedEditorEl = editorEl;
  overlayContainer = createOverlay(editorEl);

  // AbortController for centralized listener cleanup
  const ac = new AbortController();
  const signal = ac.signal;

  // Use mousemove with bounding rect check for reliable hover detection
  // Detects hover on image blocks as well as images directly
  // Uses cached image list for performance (refreshed on DOM mutations)
  editorEl.addEventListener("mousemove", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Refresh cache if invalidated
    if (!imageCacheValid) {
      refreshImageCache(editorEl);
    }

    let foundImg: HTMLImageElement | null = null;

    for (const img of cachedImages) {
      if (isPointInElement(e.clientX, e.clientY, img)) {
        foundImg = img;
        break;
      }
    }

    if (foundImg) {
      // Mouse is over an image block - show overlay
      if (currentHoveredImg !== foundImg) {
        showOverlay(foundImg);
      } else if (hideTimer) {
        // Cancel pending hide if still on same image
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    } else if (currentHoveredImg && !overlayContainer?.contains(e.target as Node)) {
      // Mouse left image area (and not on overlay) - schedule hide
      hideOverlay();
    }
  }, { signal });

  editorEl.addEventListener("mouseleave", (e) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    // Don't hide if moving to overlay
    if (relatedTarget && overlayContainer?.contains(relatedTarget)) return;
    hideOverlay();
  }, { signal });

  // Overlay hover: cancel hide timer, schedule hide on leave
  overlayContainer.addEventListener("mouseenter", () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }, { signal });

  overlayContainer.addEventListener("mouseleave", () => {
    hideOverlay();
  }, { signal });

  // Double-click on image or its container triggers edit
  editorEl.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    let img: HTMLImageElement | null = null;

    if (target.tagName === "IMG") {
      img = target as HTMLImageElement;
    } else {
      img = target.querySelector("img");
    }
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      triggerImageEdit(img);
    }
  }, { capture: true, signal });

  // Watch for newly added/removed images and invalidate cache
  // Filters mutations to only image-related changes to avoid excessive querySelectorAll calls
  let mutationDebounce: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((mutations) => {
    const hasImageChange = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeName === "IMG" || (n instanceof Element && n.querySelector("img"))
      ) || Array.from(m.removedNodes).some(n =>
        n.nodeName === "IMG" || (n instanceof Element && n.querySelector("img"))
      )
    );

    if (!hasImageChange) return;

    imageCacheValid = false;

    // Debounce to batch rapid DOM changes (e.g., editor re-render)
    if (mutationDebounce) clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
      mutationDebounce = null;
      refreshImageCache(editorEl);

      for (const img of cachedImages) {
        if (isPointInElement(lastMouseX, lastMouseY, img)) {
          showOverlay(img);
          return;
        }
      }
    }, 150);
  });
  observer.observe(editorEl, { childList: true, subtree: true });

  // Return cleanup function: abort all listeners + disconnect observer
  return () => {
    ac.abort();
    observer.disconnect();
    if (mutationDebounce) clearTimeout(mutationDebounce);
    if (hideTimer) clearTimeout(hideTimer);
    overlayContainer?.remove();
    overlayContainer = null;
    currentHoveredImg = null;
    cachedImages = [];
    imageCacheValid = false;
  };
}

/**
 * Trigger image URL edit
 */
function triggerImageEdit(imgEl: HTMLImageElement): void {
  if (!storedGetView || !storedPostMessage) return;

  const view = storedGetView();
  if (!view) return;

  const nodeInfo = findImageNode(view, imgEl);
  if (!nodeInfo) return;

  const { node, nodePos } = nodeInfo;
  const currentSrc = String(node.attrs.src || "");

  requestUrlEdit(currentSrc, storedPostMessage, (newUrl, originalPath) => {
    const pathToCompare = originalPath || currentSrc;
    if (newUrl && newUrl !== pathToCompare) {
      // Check if this is a local image rename (same folder, different filename)
      const isLocalRename = !newUrl.startsWith("http") && !newUrl.startsWith("data:")
        && originalPath && !originalPath.startsWith("http")
        && getFolder(originalPath) === getFolder(newUrl);

      if (isLocalRename && storedPostMessage) {
        // Request rename FIRST, then update editor after file is renamed
        const renameId = `rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingRenames.set(renameId, { nodePos, nodeAttrs: { ...node.attrs }, oldPath: originalPath });

        storedPostMessage({
          type: "requestImageRename",
          renameId,
          oldPath: originalPath,
          newPath: newUrl,
        });

        // Timeout cleanup: Remove from pending after 60s to prevent memory leak
        setTimeout(() => {
          if (pendingRenames.has(renameId)) {
            console.warn("[ImageEdit] Rename timeout, cleaning up:", renameId);
            pendingRenames.delete(renameId);
          }
        }, 60000);
      } else {
        // Non-local or URL change: update editor immediately
        updateEditorNode(nodePos, node.attrs, newUrl);
      }
    }
  });
}

/** Get folder part of path */
function getFolder(p: string): string {
  const lastSlash = p.lastIndexOf("/");
  return lastSlash > 0 ? p.substring(0, lastSlash) : "";
}

/** Update ProseMirror node with new src */
function updateEditorNode(nodePos: number, attrs: Record<string, unknown>, newSrc: string): void {
  const freshView = storedGetView?.();
  if (!freshView) return;

  const { state, dispatch } = freshView;

  // Guard against stale positions: verify node exists and is an image type
  const nodeAtPos = state.doc.nodeAt(nodePos);
  if (!nodeAtPos || !IMAGE_NODE_TYPES.includes(nodeAtPos.type.name)) {
    console.warn("[ImageEdit] Node moved or missing; skipping update");
    return;
  }

  // Use live node attrs to avoid overwriting user edits made during async rename
  const baseAttrs = (nodeAtPos.attrs ?? attrs) as Record<string, unknown>;

  try {
    const tr = state.tr.setNodeMarkup(nodePos, undefined, {
      ...baseAttrs,
      src: newSrc,
    });
    dispatch(tr);
  } catch (err) {
    console.warn("[ImageEdit] Failed to update node:", err);
  }
}

interface NodeInfo {
  node: { type: { name: string }; attrs: Record<string, unknown> };
  nodePos: number;
}

/**
 * Find image node from DOM element
 */
function findImageNode(view: EditorView, imgEl: Element): NodeInfo | null {
  try {
    const pos = view.posAtDOM(imgEl, 0);
    const { state } = view;

    for (let offset = 0; offset <= 10; offset++) {
      for (const tryPos of [pos - offset, pos + offset]) {
        if (tryPos < 0 || tryPos > state.doc.content.size) continue;

        const $pos = state.doc.resolve(tryPos);
        let node = $pos.nodeAfter;
        let nodePos = tryPos;

        if (!node || !IMAGE_NODE_TYPES.includes(node.type.name)) {
          if (IMAGE_NODE_TYPES.includes($pos.parent.type.name)) {
            node = $pos.parent;
            nodePos = $pos.before();
          }
        }

        if (node && IMAGE_NODE_TYPES.includes(node.type.name)) {
          return { node, nodePos };
        }
      }
    }
  } catch (err) {
    console.error("[ImageEdit] Failed to find node:", err);
  }
  return null;
}

export function setImageMap(imageMap: Record<string, string>): void {
  currentImageMap = imageMap;
}

/**
 * Request URL edit via VSCode extension
 */
function requestUrlEdit(
  currentUrl: string,
  postMessage: (msg: unknown) => void,
  onResult: EditCallback
): void {
  const editId = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const isBase64 = currentUrl.startsWith("data:");
  const isLocalImage = currentUrl.startsWith("vscode-webview://")
    || currentUrl.includes("vscode-resource.vscode-cdn.net");

  let displayUrl = currentUrl;
  if (isBase64) {
    displayUrl = "";
  } else if (isLocalImage) {
    // Reverse lookup from imageMap
    for (const [originalPath, webviewUri] of Object.entries(currentImageMap)) {
      if (webviewUri === currentUrl) {
        displayUrl = originalPath;
        break;
      }
    }
  }

  pendingEdits.set(editId, { callback: onResult, originalPath: displayUrl });

  postMessage({
    type: "requestImageUrlEdit",
    editId,
    currentUrl: displayUrl,
    isLocalImage,
    isBase64,
  });

  setTimeout(() => pendingEdits.delete(editId), 60000);
}

/**
 * Handle URL edit response from extension
 */
export function handleUrlEditResponse(editId: string, newUrl: string | null): void {
  const pending = pendingEdits.get(editId);
  if (pending && newUrl !== null && newUrl.trim() !== "") {
    const cleanedUrl = cleanImagePath(newUrl);
    pending.callback(cleanedUrl, pending.originalPath);
  }
  pendingEdits.delete(editId);
}

/**
 * Handle image rename response from extension
 * Called AFTER file has been renamed on disk
 */
export function handleImageRenameResponse(
  renameId: string,
  success: boolean,
  newPath: string,
  webviewUri?: string
): void {
  const pending = pendingRenames.get(renameId);
  if (!pending) return;
  pendingRenames.delete(renameId);

  if (success && webviewUri) {
    // Remove old imageMap entry to prevent path regression in transformForSave
    if (pending.oldPath) {
      delete currentImageMap[pending.oldPath];
    }
    // Update imageMap BEFORE updating editor so transformForSave works correctly
    // This ensures webviewUri gets converted back to relative path when saving
    currentImageMap[newPath] = webviewUri;

    // Now update editor with webviewUri for display
    updateEditorNode(pending.nodePos, pending.nodeAttrs, webviewUri);
  } else if (success) {
    // Remove old imageMap entry
    if (pending.oldPath) {
      delete currentImageMap[pending.oldPath];
    }
    // No webviewUri - use newPath directly
    updateEditorNode(pending.nodePos, pending.nodeAttrs, newPath);
  }
  // If failed, don't update editor (keep old path)
}

