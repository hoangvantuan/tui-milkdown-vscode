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
import elkLayouts from "@mermaid-js/layout-elk";
import { openMermaidLightbox } from "./image-lightbox-plugin";
import {
    copyPngBlobToClipboard,
    reportCopyError,
    svgToPngBlob,
} from "./svg-to-png";

// Register ELK layout engine for better subgraph/edge routing
let elkAvailable = false;
try {
    mermaid.registerLayoutLoaders(elkLayouts);
    elkAvailable = true;
} catch {
    console.warn("ELK layout registration failed, falling back to dagre");
}

const EXPAND_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const COPY_FEEDBACK_MS = 1500;
const PNG_SCALE = 2;

const MERMAID_KEY = new PluginKey("mermaidDiagram");
const RENDER_DEBOUNCE_MS = 500;

let mermaidInitialized = false;
let renderCounter = 0;
let mermaidBlockCount = 0;

/** Shared mermaid config (layout tuning for complex diagrams). */
const MERMAID_FLOWCHART_CFG = {
    nodeSpacing: 80,
    rankSpacing: 70,
    subGraphTitleMargin: { top: 10, bottom: 6 },
    diagramPadding: 16,
    wrappingWidth: 300,
    padding: 20,
};

function ensureMermaidInit(isDark: boolean): void {
    mermaid.initialize({
        startOnLoad: false,
        layout: elkAvailable ? "elk" : "dagre",
        theme: isDark ? "dark" : "default",
        securityLevel: "loose",
        flowchart: MERMAID_FLOWCHART_CFG,
    });
    mermaidInitialized = true;
}

/**
 * Re-initialize mermaid with a new theme (called when editor theme changes).
 */
export function updateMermaidTheme(isDark: boolean): void {
    mermaid.initialize({
        startOnLoad: false,
        layout: elkAvailable ? "elk" : "dagre",
        theme: isDark ? "dark" : "default",
        securityLevel: "loose",
        flowchart: MERMAID_FLOWCHART_CFG,
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

function getSvgHost(preview: HTMLElement): HTMLElement {
    let host = preview.querySelector<HTMLElement>(".mermaid-svg-host");
    if (!host) {
        host = document.createElement("div");
        host.className = "mermaid-svg-host";
        preview.insertBefore(host, preview.firstChild);
    }
    return host;
}

async function renderToEl(preview: HTMLElement, code: string): Promise<void> {
    const host = getSvgHost(preview);
    const id = `mermaid-render-${++renderCounter}`;
    try {
        const { svg } = await mermaid.render(id, code);
        host.innerHTML = svg;
        preview.classList.remove("mermaid-error");
        preview.setAttribute("data-rendered", "true");
    } catch (err) {
        // Clean up stale temp element mermaid creates on failure
        const stale = document.getElementById(`d${id}`);
        if (stale) stale.remove();

        const msg = err instanceof Error ? err.message : String(err);
        const short = msg.split("\n").find((l) => l.trim()) || "Diagram error";
        host.innerHTML = `<span class="mermaid-err-msg">${escapeHtml(short)}</span>`;
        preview.classList.add("mermaid-error");
        preview.removeAttribute("data-rendered");
    }
}

// Cache: code → rendered HTML to avoid re-rendering identical diagrams
const renderCache = new Map<string, string>();
const MAX_RENDER_CACHE = 30;

async function renderMermaid(preview: HTMLElement, code: string): Promise<void> {
    const host = getSvgHost(preview);
    const cached = renderCache.get(code);
    if (cached) {
        host.innerHTML = cached;
        preview.classList.remove("mermaid-error");
        preview.setAttribute("data-rendered", "true");
        return;
    }

    const id = `mermaid-render-${++renderCounter}`;
    try {
        // Mermaid v11 no longer auto-converts literal \n inside labels.
        // Replace \n with <br/> inside any bracket group ([...], (...), {...})
        // regardless of quote style. Covers plain labels like A[Line1\nLine2].
        const processed = code.replace(
            /(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/g,
            (match) => match.replace(/\\n/g, "<br/>"),
        );
        const { svg } = await mermaid.render(id, processed);
        if (renderCache.size >= MAX_RENDER_CACHE) {
            const oldest = renderCache.keys().next().value;
            if (oldest !== undefined) renderCache.delete(oldest);
        }
        renderCache.set(code, svg);
        host.innerHTML = svg;
        preview.classList.remove("mermaid-error");
        preview.setAttribute("data-rendered", "true");
    } catch (err) {
        const stale = document.getElementById(`d${id}`);
        if (stale) stale.remove();

        const msg = err instanceof Error ? err.message : String(err);
        const short = msg.split("\n").find((l) => l.trim()) || "Diagram error";
        host.innerHTML = `<span class="mermaid-err-msg">${escapeHtml(short)}</span>`;
        preview.classList.add("mermaid-error");
        preview.removeAttribute("data-rendered");
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

                            // Skip expensive scan when no mermaid blocks exist
                            if (mermaidBlockCount === 0) return;

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
    let blockCount = 0;

    doc.descendants((node: any, pos: number) => {
        if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;
        blockCount++;

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

            const host = document.createElement("div");
            host.className = "mermaid-svg-host";
            host.innerHTML = `<span class="mermaid-loading">Rendering…</span>`;
            el.appendChild(host);

            const expandBtn = document.createElement("button");
            expandBtn.className = "mermaid-expand-btn";
            expandBtn.type = "button";
            expandBtn.setAttribute("aria-label", "View fullscreen");
            expandBtn.title = "View fullscreen";
            expandBtn.innerHTML = EXPAND_ICON_SVG;
            expandBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            expandBtn.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            expandBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const svgEl = host.querySelector("svg");
                if (svgEl) openMermaidLightbox(svgEl.outerHTML, "");
            });
            el.appendChild(expandBtn);

            const copyBtn = document.createElement("button");
            copyBtn.className = "mermaid-copy-btn";
            copyBtn.type = "button";
            copyBtn.setAttribute("aria-label", "Copy as PNG");
            copyBtn.title = "Copy as PNG";
            copyBtn.innerHTML =
                `<span class="icon icon-copy">${COPY_ICON_SVG}</span>` +
                `<span class="icon icon-check">${CHECK_ICON_SVG}</span>`;
            copyBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            copyBtn.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            copyBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (copyBtn.disabled) return;
                const svgEl = host.querySelector("svg");
                if (!svgEl) return;
                const svgMarkup = svgEl.outerHTML;
                copyBtn.disabled = true;
                try {
                    const blob = await svgToPngBlob(svgMarkup, PNG_SCALE);
                    await copyPngBlobToClipboard(blob);
                    if (copyBtn.isConnected) flashCopiedState(copyBtn);
                } catch (err) {
                    reportCopyError(
                        `Failed to copy mermaid diagram: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                } finally {
                    if (copyBtn.isConnected) copyBtn.disabled = false;
                }
            });
            el.appendChild(copyBtn);
            return el;
        }, {
            side: 1, // Place after the node
            ignoreSelection: true,
        });

        decorations.push(widget);
    });

    mermaidBlockCount = blockCount;
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

function flashCopiedState(button: HTMLElement): void {
    if (!button.isConnected) return;
    button.classList.add("is-copied");
    const host = button as HTMLElement & { __copyTimer?: number };
    if (host.__copyTimer !== undefined) {
        window.clearTimeout(host.__copyTimer);
    }
    host.__copyTimer = window.setTimeout(() => {
        if (button.isConnected) button.classList.remove("is-copied");
    }, COPY_FEEDBACK_MS);
}
