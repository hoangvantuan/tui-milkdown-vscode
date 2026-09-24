/**
 * Drag handle plugin: enables drag-and-drop block reordering on hover.
 *
 * Lazy-loaded via loadArtifact("dragHandle") on first user interaction (first hover or mouse move)
 * to keep @tiptap/extension-drag-handle (127 KB) out of the startup bundle.
 *
 * Upstream DragHandlePlugin appends its wrapper div to editor.view.dom.parentElement,
 * which is #editor: already inside #editor-container and already outside the element
 * that carries the zoom's scale. AGENTS.md's rule for floating UI is therefore satisfied
 * with no intervention, so attachHandleToContainer() only reports; see its comment.
 *
 * The handle sits one gutter further out than upstream places it, so a heading's
 * collapse arrow keeps the strip beside the text; see HANDLE_GUTTER_PX.
 */
import { type Editor, getExtensionField } from "@tiptap/core";
import type DragHandleType from "@tiptap/extension-drag-handle";
import { loadArtifact } from "./artifact-bridge";

declare global {
  interface Window {
    __tuiDragHandleBundle?: { DragHandle: typeof DragHandleType };
  }
}

/**
 * Screen pixels between a block's left edge and the handle's right edge, at
 * zoom 1.0. Upstream places the handle flush against the block (`left-start`),
 * which is exactly the strip where heading-collapse-plugin draws its arrow
 * (`left: -15px` in editor.css). The two overlapped, and since upstream's
 * wrapper carries `z-index: 10` against the arrow's 2, a press on the arrow
 * went to the handle and no heading could be collapsed with the mouse. 15 is
 * that strip, plus a 2px gap.
 */
const HANDLE_GUTTER_PX = 17;

/**
 * floating-ui middleware moving the handle one gutter to the left. It shifts x
 * AFTER floating-ui has measured the block, so the reference box (the risk
 * attachHandleToContainer's comment is about) is untouched, and the floor
 * checks' vertical line-up cannot see it.
 *
 * Written inline rather than as `offset()` from @floating-ui/dom: that package
 * is only a transitive dependency, not one package.json declares, and a
 * middleware is a plain `{ name, fn }` object.
 *
 * Scaled by the editor's zoom because the arrow lives inside the scaled
 * .tiptap and the handle does not: the arrow renders at -15 * zoom screen px.
 * The zoom is read as on-screen width over layout width, the same measurement
 * the image resize handle makes, so it holds whatever applies the scale
 * (scaleEditor in main.ts). Read on every placement, which upstream runs when
 * the pointer reaches a new block or re-enters the editor.
 *
 * On a heading it also moves y, so the handle is centred on the heading's
 * first line, level with the collapse arrow (editor.css centres the arrow on
 * `1lh`). Upstream's `left-start` aligns the handle's top with the block's, so
 * a 24px handle beside a 38px H1 line sat above the arrow. Headings only: the
 * arrow is the thing to line up with, and code blocks, tables and alerts have
 * padding or headers that make "the first line" something other than `1lh`.
 * The block is not reachable from here (upstream hands floating-ui a virtual
 * element), so `heading` is the DOM onNodeChange recorded, which upstream
 * calls synchronously just before it repositions.
 */
function headingGutter(editor: Editor, heading: { current: HTMLElement | null }) {
  return {
    name: "tuiHeadingGutter",
    fn: ({ x, y, rects }: { x: number; y: number; rects: { floating: { height: number } } }) => {
      const dom = editor.view.dom as HTMLElement;
      const zoom = dom.offsetWidth ? dom.getBoundingClientRect().width / dom.offsetWidth : 1;
      let dy = 0;
      if (heading.current?.isConnected) {
        const lineBox = parseFloat(getComputedStyle(heading.current).lineHeight) * zoom;
        if (Number.isFinite(lineBox)) dy = (lineBox - rects.floating.height) / 2;
      }
      return { x: x - HANDLE_GUTTER_PX * zoom, y: y + dy };
    },
  };
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
 * Report where the handle ended up. It deliberately MOVES NOTHING.
 *
 * An earlier version appended the wrapper to #editor-container, reading
 * AGENTS.md's "popups attach to #editor-container, not .tiptap" as an
 * instruction to relocate it. The relocation is unnecessary: upstream appends
 * the handle to `editor.view.dom.parentElement`, which is #editor, already
 * inside #editor-container and already outside the element that carries the
 * zoom's scale. The rule was satisfied before anything moved.
 *
 * Measured rather than argued: with no relocation the floor check reports the
 * handle following the block under the pointer at zoom 1.0 and at zoom 1.2,
 * and a drag reordering the block it points at.
 *
 * Upstream positions the handle with floating-ui at `strategy: "absolute"`,
 * writing `left`/`top` onto the handle element itself, so anything that
 * changes which box those offsets are measured against is a risk taken for no
 * benefit.
 */
export function attachHandleToContainer(): boolean {
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

    const heading: { current: HTMLElement | null } = { current: null };
    const configured = bundle.DragHandle.configure({
      // Upstream spreads this over its default ({ placement: "left-start",
      // strategy: "absolute" }), so only the middleware is added here.
      computePositionConfig: { middleware: [headingGutter(editor, heading)] },
      // Upstream reports the OUTER node, a direct child of the doc, but its
      // typings omit the position, so it is found among the doc's children.
      onNodeChange({ node }) {
        heading.current = null;
        if (node?.type.name !== "heading") return;
        editor.state.doc.forEach((child, offset) => {
          if (child === node) heading.current = editor.view.nodeDOM(offset) as HTMLElement | null;
        });
      },
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
