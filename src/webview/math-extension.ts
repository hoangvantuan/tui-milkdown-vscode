/**
 * Math extensions for Tiptap: InlineMath and BlockMath nodes.
 *
 * LaTeX source is stored as a node attribute ('latex'), parsed via custom MarkedJS
 * tokenizers so that @tiptap/markdown's text escaping never touches the formula (#131).
 *
 * Lazy rendering with KaTeX via artifact-bridge.ts.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { getCachedArtifact, getKatexAssetsUri, loadArtifact } from "./artifact-bridge";

/** Inject KaTeX stylesheet once into webview document.head if not already present. */
export function ensureKatexStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("tui-katex-stylesheet")) return;
  const assetsUri = getKatexAssetsUri();
  if (!assetsUri) return;
  const link = document.createElement("link");
  link.id = "tui-katex-stylesheet";
  link.rel = "stylesheet";
  link.href = `${assetsUri}/katex.min.css`;
  document.head.appendChild(link);
}

/**
 * Inline Math node: $...$
 * Follows GitHub delimiter rules:
 * - Opening $ not followed by whitespace or another $
 * - Closing $ not preceded by whitespace
 * - Closing $ not followed by digit
 * - Does not span newlines
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") || "",
        renderHTML: (attrs: { latex?: string }) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-math",
        class: "inline-math",
      }),
      `$${node.attrs.latex}$`,
    ];
  },

  markdownTokenName: "inlineMath",

  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start(src: string) {
      const match = src.match(/(^|[^\\])\$/);
      return typeof match?.index === "number" ? match.index + (match[1] ? match[1].length : 0) : -1;
    },
    tokenize(src: string) {
      // Delimiter rules:
      // 1. Opening $ not followed by whitespace or $
      // 2. Formula body contains no unescaped $ or newline
      // 3. Closing $ not preceded by whitespace
      // 4. Closing $ not followed by digit
      const match = src.match(/^\$((?:\\\$|[^\s\$\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\s\$\n]))?)\$(?!\d)/);
      if (!match) return undefined;
      return {
        type: "inlineMath",
        raw: match[0],
        latex: match[1],
        text: match[1],
        tokens: [],
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("inlineMath", {
      latex: token.latex ?? token.text ?? "",
    });
  },

  renderMarkdown(node: any) {
    return `$${node.attrs?.latex ?? ""}$`;
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement("span");
      dom.className = "inline-math";
      dom.setAttribute("data-type", "inline-math");
      dom.setAttribute("data-latex", node.attrs.latex || "");

      let currentLatex = node.attrs.latex || "";
      let renderId = 0;

      const render = (latex: string) => {
        const id = ++renderId;
        ensureKatexStylesheet();

        const cached = getCachedArtifact<{ katex: typeof import("katex") }>("katex");
        if (cached?.katex) {
          try {
            dom.innerHTML = cached.katex.renderToString(latex, {
              displayMode: false,
              throwOnError: false,
            });
            return;
          } catch {
            dom.textContent = `$${latex}$`;
            return;
          }
        }

        dom.textContent = `$${latex}$`;

        loadArtifact<{ katex: typeof import("katex") }>("katex")
          .then((bundle) => {
            if (id !== renderId) return;
            if (bundle?.katex) {
              dom.innerHTML = bundle.katex.renderToString(latex, {
                displayMode: false,
                throwOnError: false,
              });
            }
          })
          .catch(() => {
            if (id === renderId) {
              dom.textContent = `$${latex}$`;
            }
          });
      };

      render(currentLatex);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "inlineMath") return false;
          if (updatedNode.attrs.latex !== currentLatex) {
            currentLatex = updatedNode.attrs.latex || "";
            dom.setAttribute("data-latex", currentLatex);
            render(currentLatex);
          }
          return true;
        },
      };
    };
  },
});

/**
 * Block Math node: $$...$$
 * Supports single-line and multi-line formulas.
 */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") || "",
        renderHTML: (attrs: { latex?: string }) => ({ "data-latex": attrs.latex || "" }),
      },
      multiline: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "block-math",
        class: "block-math",
      }),
      `$$${node.attrs.latex}$$`,
    ];
  },

  markdownTokenName: "blockMath",

  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: () => -1,
    tokenize(src: string) {
      // Matches $$...$$ single-line or multi-line block
      const match = src.match(/^[ \t]{0,3}\$\$([ \t]*\n[\s\S]*?\n[ \t]*|[^\n]*?)\$\$(?:\n+|$)/);
      if (!match) return undefined;
      const rawContent = match[1];
      const isMultiline = rawContent.includes("\n");
      const latex = isMultiline ? rawContent.trim() : rawContent;
      return {
        type: "blockMath",
        raw: match[0],
        latex,
        text: latex,
        multiline: isMultiline,
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("blockMath", {
      latex: token.latex ?? token.text ?? "",
      multiline: Boolean(token.multiline),
    });
  },

  renderMarkdown(node: any) {
    const latex = node.attrs?.latex ?? "";
    if (node.attrs?.multiline || latex.includes("\n")) {
      return `$$\n${latex.trim()}\n$$`;
    }
    return `$$${latex}$$`;
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement("div");
      dom.className = "block-math";
      dom.setAttribute("data-type", "block-math");
      dom.setAttribute("data-latex", node.attrs.latex || "");

      let currentLatex = node.attrs.latex || "";
      let renderId = 0;

      const render = (latex: string) => {
        const id = ++renderId;
        ensureKatexStylesheet();

        const cached = getCachedArtifact<{ katex: typeof import("katex") }>("katex");
        if (cached?.katex) {
          try {
            dom.innerHTML = cached.katex.renderToString(latex, {
              displayMode: true,
              throwOnError: false,
            });
            return;
          } catch {
            dom.textContent = `$$${latex}$$`;
            return;
          }
        }

        dom.textContent = `$$${latex}$$`;

        loadArtifact<{ katex: typeof import("katex") }>("katex")
          .then((bundle) => {
            if (id !== renderId) return;
            if (bundle?.katex) {
              dom.innerHTML = bundle.katex.renderToString(latex, {
                displayMode: true,
                throwOnError: false,
              });
            }
          })
          .catch(() => {
            if (id === renderId) {
              dom.textContent = `$$${latex}$$`;
            }
          });
      };

      render(currentLatex);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "blockMath") return false;
          if (updatedNode.attrs.latex !== currentLatex) {
            currentLatex = updatedNode.attrs.latex || "";
            dom.setAttribute("data-latex", currentLatex);
            render(currentLatex);
          }
          return true;
        },
      };
    };
  },
});

export const mathExtensions = [InlineMath, BlockMath];
