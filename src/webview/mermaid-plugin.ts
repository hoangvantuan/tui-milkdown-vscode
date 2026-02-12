/**
 * Mermaid Diagram Rendering Plugin for Tiptap/ProseMirror
 *
 * Uses a ProseMirror Plugin with widget decorations to render SVG previews
 * after code blocks with language="mermaid". The code block itself remains
 * editable via CodeBlockLowlight; the rendered preview is a non-editable
 * widget decoration inserted after the code block.
 *
 * UX: View/Edit mode toggle
 * - View mode (default): code block is hidden, only SVG preview is shown
 * - Edit mode (double-click on preview): code block + preview shown (stacked)
 * - Click outside / cursor leaves: returns to view mode
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import mermaid from "mermaid";

const MERMAID_KEY = new PluginKey("mermaidDiagram");
const RENDER_DEBOUNCE_MS = 500;

let mermaidInitialized = false;
let renderCounter = 0;

function ensureMermaidInit(isDark: boolean): void {
    mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
        fontFamily: "inherit",
    });
    mermaidInitialized = true;
}

/**
 * Re-initialize mermaid with a new theme (called when editor theme changes).
 */
export function updateMermaidTheme(isDark: boolean): void {
    mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
        fontFamily: "inherit",
    });
    // Re-render all existing previews
    document.querySelectorAll<HTMLElement>(".mermaid-preview").forEach((el) => {
        const code = el.getAttribute("data-mermaid-src");
        if (code) renderToEl(el, code);
    });
}

function escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}

async function renderToEl(container: HTMLElement, code: string): Promise<void> {
    const id = `mermaid-render-${++renderCounter}`;
    try {
        const { svg } = await mermaid.render(id, code);
        container.innerHTML = svg;
        container.classList.remove("mermaid-error");
    } catch (err) {
        // Clean up stale temp element mermaid creates on failure
        const stale = document.getElementById(`d${id}`);
        if (stale) stale.remove();

        const msg = err instanceof Error ? err.message : String(err);
        const short = msg.split("\n").find((l) => l.trim()) || "Diagram error";
        container.innerHTML = `<span class="mermaid-err-msg">${escapeHtml(short)}</span>`;
        container.classList.add("mermaid-error");
    }
}

// Cache: code → rendered HTML to avoid re-rendering identical diagrams
const renderCache = new Map<string, string>();

async function renderMermaid(container: HTMLElement, code: string): Promise<void> {
    const cached = renderCache.get(code);
    if (cached) {
        container.innerHTML = cached;
        container.classList.remove("mermaid-error");
        return;
    }

    const id = `mermaid-render-${++renderCounter}`;
    try {
        const { svg } = await mermaid.render(id, code);
        renderCache.set(code, svg);
        container.innerHTML = svg;
        container.classList.remove("mermaid-error");
    } catch (err) {
        const stale = document.getElementById(`d${id}`);
        if (stale) stale.remove();

        const msg = err instanceof Error ? err.message : String(err);
        const short = msg.split("\n").find((l) => l.trim()) || "Diagram error";
        container.innerHTML = `<span class="mermaid-err-msg">${escapeHtml(short)}</span>`;
        container.classList.add("mermaid-error");
    }
}

/**
 * Clear render cache — call when mermaid theme changes.
 */
export function clearMermaidCache(): void {
    renderCache.clear();
}

/**
 * Check if cursor position is inside a mermaid code block.
 * Returns the start position of the mermaid code block, or -1 if not inside one.
 */
function getActiveMermaidPos(state: any): number {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
            return $from.before(d);
        }
    }
    return -1;
}

/**
 * Tiptap Extension — adds a ProseMirror plugin that creates widget
 * decorations after mermaid code blocks and manages view/edit mode.
 */
export const MermaidDiagram = Extension.create({
    name: "mermaidDiagram",

    addProseMirrorPlugins() {
        // Track pending renders by code-block position
        const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

        // Track previous active position to avoid unnecessary decoration rebuilds
        let prevActivePos = -1;

        return [
            new Plugin({
                key: MERMAID_KEY,

                state: {
                    init(_, state) {
                        prevActivePos = getActiveMermaidPos(state);
                        return buildDecorations(state.doc, prevActivePos);
                    },
                    apply(tr, oldDecos, _oldState, newState) {
                        const newActivePos = getActiveMermaidPos(newState);

                        if (tr.docChanged) {
                            // Content changed: rebuild everything (widgets + node decos)
                            prevActivePos = newActivePos;
                            return buildDecorations(newState.doc, newActivePos);
                        }

                        if (newActivePos !== prevActivePos) {
                            // Selection moved between mermaid blocks:
                            // Preserve widget decorations, only update node CSS classes
                            prevActivePos = newActivePos;
                            return rebuildNodeDecosOnly(newState.doc, newActivePos, oldDecos, tr);
                        }

                        return oldDecos;
                    },
                },

                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },

                view(editorView) {
                    // Native DOM handler: double-click on preview → enter edit mode
                    // Attached to document to capture events from widget decorations,
                    // which may render outside editorView.dom's subtree.
                    function handleDblClick(event: MouseEvent): void {
                        const target = event.target as HTMLElement;
                        const previewEl = target.closest?.(".mermaid-preview") as HTMLElement | null;
                        if (!previewEl) return;

                        const dataPosStr = previewEl.getAttribute("data-pos");
                        if (!dataPosStr) return;

                        event.preventDefault();
                        event.stopPropagation();

                        const endPos = parseInt(dataPosStr, 10);
                        // Find the mermaid code block that ends at this position
                        let targetPos = -1;
                        editorView.state.doc.descendants((n: any, p: number) => {
                            if (n.type.name === "codeBlock" && n.attrs.language === "mermaid") {
                                if (p + n.nodeSize === endPos) {
                                    targetPos = p;
                                }
                            }
                        });

                        if (targetPos >= 0) {
                            const tr = editorView.state.tr.setSelection(
                                TextSelection.near(
                                    editorView.state.doc.resolve(targetPos + 1)
                                )
                            );
                            editorView.dispatch(tr);
                            editorView.focus();
                        }
                    }

                    // Use document-level listener to ensure we catch events from widget
                    // decorations (they can be outside editorView.dom in the DOM tree)
                    document.addEventListener("dblclick", handleDblClick);

                    return {
                        update(view) {
                            const isDark = document.body.classList.contains("dark-theme");
                            if (!mermaidInitialized) ensureMermaidInit(isDark);

                            // After decorations are applied, find preview containers and render
                            requestAnimationFrame(() => {
                                const doc = view.state.doc;
                                doc.descendants((node, pos) => {
                                    if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;

                                    const code = node.textContent.trim();
                                    if (!code) return;

                                    const endPos = pos + node.nodeSize;
                                    // Find the widget element for this position
                                    const widget = document.querySelector(
                                        `.mermaid-preview[data-pos="${endPos}"]`
                                    ) as HTMLElement | null;
                                    if (!widget) return;

                                    // Check if already rendered with same code
                                    if (widget.getAttribute("data-mermaid-src") === code) return;

                                    widget.setAttribute("data-mermaid-src", code);

                                    // Cancel previous pending render for this position
                                    const prev = pendingTimers.get(endPos);
                                    if (prev) clearTimeout(prev);

                                    const timer = setTimeout(() => {
                                        renderMermaid(widget, code);
                                        pendingTimers.delete(endPos);
                                    }, RENDER_DEBOUNCE_MS);

                                    pendingTimers.set(endPos, timer);
                                });
                            });
                        },

                        destroy() {
                            document.removeEventListener("dblclick", handleDblClick);
                            for (const timer of pendingTimers.values()) clearTimeout(timer);
                            pendingTimers.clear();
                        },
                    };
                },
            }),
        ];
    },
});

/**
 * Scan the document and create decorations for mermaid code blocks:
 * 1. Node decoration on the code block itself (adds .mermaid-code-block class, and .mermaid-editing when active)
 * 2. Widget decoration after the code block (SVG preview container)
 */
function buildDecorations(doc: any, activeMermaidPos: number): DecorationSet {
    const decorations: Decoration[] = [];

    doc.descendants((node: any, pos: number) => {
        if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;

        const isEditing = pos === activeMermaidPos;
        const endPos = pos + node.nodeSize;

        // Node decoration: add classes to the code block's <pre> wrapper
        const nodeClasses = isEditing
            ? "mermaid-code-block mermaid-editing"
            : "mermaid-code-block";

        decorations.push(
            Decoration.node(pos, endPos, {
                class: nodeClasses,
            }, { isNodeDeco: true })
        );

        // Widget decoration: SVG preview container after the code block
        const widget = Decoration.widget(endPos, () => {
            const el = document.createElement("div");
            el.className = "mermaid-preview";
            el.contentEditable = "false";
            el.setAttribute("data-pos", String(endPos));
            el.innerHTML = `<span class="mermaid-loading">Rendering…</span>`;
            return el;
        }, {
            side: 1, // Place after the node
            ignoreSelection: true,
        });

        decorations.push(widget);
    });

    return DecorationSet.create(doc, decorations);
}

/**
 * Rebuild only node decorations (CSS classes) while preserving widget decorations.
 * This avoids destroying and recreating widget DOM elements when only the
 * selection/active-mermaid-block changes, preventing unnecessary re-renders.
 */
function rebuildNodeDecosOnly(
    doc: any,
    activeMermaidPos: number,
    oldDecos: DecorationSet,
    tr: any
): DecorationSet {
    // Map existing decorations to new positions
    let decos = oldDecos.map(tr.mapping, doc);

    // Collect old node decorations to remove, and build new ones
    const toRemove: Decoration[] = [];
    const toAdd: Decoration[] = [];

    doc.descendants((node: any, pos: number) => {
        if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;

        const isEditing = pos === activeMermaidPos;
        const endPos = pos + node.nodeSize;

        // Find and collect existing node decorations at this range for removal
        const existing = decos.find(pos, endPos, (spec: any) => spec.isNodeDeco);
        toRemove.push(...existing);

        // Create new node decoration with updated CSS class
        const nodeClasses = isEditing
            ? "mermaid-code-block mermaid-editing"
            : "mermaid-code-block";

        toAdd.push(
            Decoration.node(pos, endPos, { class: nodeClasses }, { isNodeDeco: true })
        );
    });

    // Apply: remove old node decos, add updated ones
    decos = decos.remove(toRemove);
    decos = decos.add(doc, toAdd);

    return decos;
}
