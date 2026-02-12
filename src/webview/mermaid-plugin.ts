/**
 * Mermaid Diagram Rendering Plugin for Tiptap/ProseMirror
 *
 * Uses a ProseMirror Plugin with widget decorations to render SVG previews
 * after code blocks with language="mermaid". The code block itself remains
 * editable via CodeBlockLowlight; the rendered preview is a non-editable
 * widget decoration inserted after the code block.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
 * Tiptap Extension — adds a ProseMirror plugin that creates widget
 * decorations after mermaid code blocks.
 */
export const MermaidDiagram = Extension.create({
    name: "mermaidDiagram",

    addProseMirrorPlugins() {
        // Track pending renders by code-block position
        const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
        // Track DOM elements by code
        const activeEls = new Map<number, { el: HTMLElement; code: string }>();

        return [
            new Plugin({
                key: MERMAID_KEY,

                state: {
                    init(_, state) {
                        return buildDecorations(state.doc);
                    },
                    apply(tr, oldDecos, _oldState, newState) {
                        if (tr.docChanged) {
                            return buildDecorations(newState.doc);
                        }
                        return oldDecos;
                    },
                },

                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },

                view() {
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
                            for (const timer of pendingTimers.values()) clearTimeout(timer);
                            pendingTimers.clear();
                            activeEls.clear();
                        },
                    };
                },
            }),
        ];
    },
});

/**
 * Scan the document and create widget decorations after each mermaid code block.
 */
function buildDecorations(doc: any): DecorationSet {
    const decorations: Decoration[] = [];

    doc.descendants((node: any, pos: number) => {
        if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;

        const endPos = pos + node.nodeSize;
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
