import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * Floating overlay for editing image URLs.
 * Uses a separate overlay element to avoid interfering with Milkdown's DOM.
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

/**
 * Check if a point is inside an element's bounding rect
 */
function isPointInElement(x: number, y: number, el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Create the floating overlay container
 * Appends to parent of editorEl (container) to survive Crepe recreation
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

  // Append to parent (container) instead of editorEl to survive Crepe recreation
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
): void {
  storedGetView = getView;
  storedPostMessage = postMessage;
  storedEditorEl = editorEl;
  overlayContainer = createOverlay(editorEl);

  // Use mousemove with bounding rect check for reliable hover detection
  // Detects hover on image blocks (.milkdown-image-block) as well as images directly
  editorEl.addEventListener("mousemove", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    let foundImg: HTMLImageElement | null = null;

    // Check Milkdown image blocks first
    const imageBlocks = Array.from(editorEl.querySelectorAll(".milkdown-image-block"));
    for (const block of imageBlocks) {
      if (isPointInElement(e.clientX, e.clientY, block)) {
        const img = block.querySelector("img");
        if (img) {
          foundImg = img;
          break;
        }
      }
    }

    // Fallback: check direct img elements
    if (!foundImg) {
      const images = Array.from(editorEl.querySelectorAll("img"));
      for (const img of images) {
        if (isPointInElement(e.clientX, e.clientY, img)) {
          foundImg = img;
          break;
        }
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
  });

  editorEl.addEventListener("mouseleave", (e) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    // Don't hide if moving to overlay
    if (relatedTarget && overlayContainer?.contains(relatedTarget)) return;
    hideOverlay();
  });

  // Overlay hover: cancel hide timer, schedule hide on leave
  overlayContainer.addEventListener("mouseenter", () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  overlayContainer.addEventListener("mouseleave", () => {
    hideOverlay();
  });

  // Double-click on image or its container triggers edit
  editorEl.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    let img: HTMLImageElement | null = null;

    if (target.tagName === "IMG") {
      img = target as HTMLImageElement;
    } else {
      // Check if <img> is inside target (wrapper contains img)
      img = target.querySelector("img");
      // Fallback: check if target is inside .milkdown-image-block
      if (!img) {
        const imageBlock = target.closest(".milkdown-image-block");
        if (imageBlock) {
          img = imageBlock.querySelector("img");
        }
      }
    }
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      triggerImageEdit(img);
    }
  }, true);

  // Watch for newly added images (e.g., after paste) and show overlay if mouse is over them
  const observer = new MutationObserver(() => {
    // Delay to let Milkdown finish rendering
    setTimeout(() => {
      // Check image blocks first
      const imageBlocks = Array.from(editorEl.querySelectorAll(".milkdown-image-block"));
      for (const block of imageBlocks) {
        if (isPointInElement(lastMouseX, lastMouseY, block)) {
          const img = block.querySelector("img");
          if (img) {
            showOverlay(img);
            return;
          }
        }
      }
      // Fallback: direct img elements
      const images = Array.from(editorEl.querySelectorAll("img"));
      for (const img of images) {
        if (isPointInElement(lastMouseX, lastMouseY, img)) {
          showOverlay(img);
          return;
        }
      }
    }, 150);
  });
  observer.observe(editorEl, { childList: true, subtree: true });
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
        pendingRenames.set(renameId, { nodePos, nodeAttrs: { ...node.attrs } });

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
  const tr = state.tr.setNodeMarkup(nodePos, undefined, {
    ...attrs,
    src: newSrc,
  });
  dispatch(tr);
}

// Node types that represent images
const IMAGE_NODE_TYPES = ["image-block", "image", "image-inline"];

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
    const cleanedUrl = cleanImagePathInput(newUrl);
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
    // Update imageMap BEFORE updating editor so transformForSave works correctly
    // This ensures webviewUri gets converted back to relative path when saving
    currentImageMap[newPath] = webviewUri;

    // Now update editor with webviewUri for display
    updateEditorNode(pending.nodePos, pending.nodeAttrs, webviewUri);
  } else if (success) {
    // No webviewUri - use newPath directly
    updateEditorNode(pending.nodePos, pending.nodeAttrs, newPath);
  }
  // If failed, don't update editor (keep old path)
}

/**
 * Clean image path input
 */
function cleanImagePathInput(rawInput: string): string {
  let p = rawInput.trim();

  if (p.startsWith("<")) {
    const endBracket = p.indexOf(">");
    if (endBracket !== -1) {
      p = p.slice(1, endBracket);
    }
    return p.trim();
  }

  const titleSeparator = p.search(/\s+["']/);
  if (titleSeparator !== -1) {
    p = p.slice(0, titleSeparator);
  }

  return p.trim();
}
