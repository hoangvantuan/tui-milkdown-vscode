/**
 * Drag handle plugin: enables drag-and-drop block reordering on hover.
 *
 * Lazy-loaded via loadArtifact("dragHandle") on first user interaction (first hover or mouse move)
 * to keep @tiptap/extension-drag-handle (127 KB) out of the startup bundle.
 *
 * Upstream DragHandlePlugin appends its wrapper div to editor.view.dom.parentElement
 * (#editor), which is not #editor-container. Per AGENTS.md, floating UI elements must attach
 * to #editor-container (the unzoomed parent) to survive CSS zoom on .tiptap.
 * attachHandleToContainer() moves the handle wrapper into #editor-container.
 */
import { type Editor, getExtensionField } from "@tiptap/core";
import type DragHandleType from "@tiptap/extension-drag-handle";
import { loadArtifact } from "./artifact-bridge";

declare global {
  interface Window {
    __tuiDragHandleBundle?: { DragHandle: typeof DragHandleType };
  }
}

const registeredEditors = new WeakSet<Editor>();
let isRegistering = false;

/**
 * Check whether the drag handle is attached to #editor-container and outside .tiptap.
 */
export function isHandleInContainer(): boolean {
  const handle = document.querySelector(".drag-handle");
  if (!handle) return false;
  return !!handle.closest("#editor-container") && !handle.closest(".tiptap");
}

/**
 * Move the drag handle wrapper into #editor-container if not already there.
 * Returns true if the handle is inside #editor-container.
 */
export function attachHandleToContainer(): boolean {
  const container = document.getElementById("editor-container");
  const handle = document.querySelector(".drag-handle");
  if (!container || !handle) return false;

  const wrapper = handle.parentElement;
  if (wrapper && wrapper.parentElement !== container) {
    container.appendChild(wrapper);
  }
  return isHandleInContainer();
}

/**
 * Register DragHandle extension on a live Tiptap editor after loading the artifact.
 */
export async function registerDragHandle(editor: Editor): Promise<boolean> {
  if (registeredEditors.has(editor) || editor.isDestroyed) return true;
  if (isRegistering) return false;
  isRegistering = true;

  try {
    const bundle = await loadArtifact<{ DragHandle: typeof DragHandleType }>("dragHandle");
    if (editor.isDestroyed) return false;

    const configured = bundle.DragHandle.configure({
      render() {
        const element = document.createElement("div");
        element.className = "drag-handle";
        element.setAttribute("aria-label", "Drag to move block");
        element.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`;
        return element;
      },
    });

    const ctx = {
      name: configured.name,
      options: configured.options,
      storage: {},
      editor,
      type: null,
      parent: undefined,
    };

    const fn = getExtensionField(configured, "addProseMirrorPlugins", ctx);
    for (const p of fn.call(ctx)) {
      editor.registerPlugin(p);
    }

    registeredEditors.add(editor);
    attachHandleToContainer();
    return true;
  } catch (err) {
    console.error("[DragHandle] Failed to load or register drag handle:", err);
    return false;
  } finally {
    isRegistering = false;
  }
}

/**
 * Wire drag handle lazy loading on first mouse interaction with the editor.
 */
export function setupDragHandle(editor: Editor): void {
  const container = document.getElementById("editor-container") ?? editor.view.dom;
  if (!container) return;

  const onFirstInteraction = () => {
    container.removeEventListener("mouseenter", onFirstInteraction);
    container.removeEventListener("mousemove", onFirstInteraction);
    registerDragHandle(editor);
  };

  container.addEventListener("mouseenter", onFirstInteraction, { once: true });
  container.addEventListener("mousemove", onFirstInteraction, { once: true });
}
