/**
 * Footnote extensions for Tiptap: FootnoteReference and FootnoteDefinition nodes.
 *
 * Footnote references [^label] render as numbered superscripts with hover preview of
 * the definition body.
 *
 * Footnote definitions [^label]: content render as definition blocks.
 * Both serialize losslessly back to markdown.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

/** Active tooltip element for footnote preview, if open. */
let activeFootnoteTooltip: HTMLDivElement | null = null;

function removeActiveTooltip(): void {
  if (activeFootnoteTooltip) {
    activeFootnoteTooltip.remove();
    activeFootnoteTooltip = null;
  }
}

/** Show hover preview of definition body attached to #editor-container. */
function showFootnoteTooltip(referenceEl: HTMLElement, content: string): void {
  removeActiveTooltip();
  if (!content) return;

  const container = document.getElementById("editor-container") || document.body;
  const tooltip = document.createElement("div");
  tooltip.className = "footnote-tooltip";
  tooltip.textContent = content;

  container.appendChild(tooltip);
  activeFootnoteTooltip = tooltip;

  const refRect = referenceEl.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  // Position above the reference by default
  const top = refRect.top - containerRect.top - tooltip.offsetHeight - 6;
  const left = Math.max(
    8,
    Math.min(
      refRect.left - containerRect.left,
      containerRect.width - tooltip.offsetWidth - 8,
    ),
  );

  tooltip.style.top = `${top < 0 ? refRect.bottom - containerRect.top + 6 : top}px`;
  tooltip.style.left = `${left}px`;
}

/**
 * Footnote Reference node: [^label]
 * Inline atom node, displayed as superscript with hover preview.
 */
export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || "",
        renderHTML: (attrs: { label?: string }) => ({ "data-label": attrs.label || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote-reference"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote-reference",
        class: "footnote-reference",
      }),
      `[^${node.attrs.label}]`,
    ];
  },

  markdownTokenName: "footnoteReference",

  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start(src: string) {
      const match = src.match(/(^|[^\\])\[\^/);
      return typeof match?.index === "number" ? match.index + (match[1] ? match[1].length : 0) : -1;
    },
    tokenize(src: string) {
      // Matches [^label] not followed by a colon
      const match = src.match(/^\[\^([^\]\s]+)\](?!\:)/);
      if (!match) return undefined;
      return {
        type: "footnoteReference",
        raw: match[0],
        label: match[1],
        text: match[0],
        tokens: [],
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("footnoteReference", {
      label: token.label ?? "",
    });
  },

  renderMarkdown(node: any) {
    return `[^${node.attrs?.label ?? ""}]`;
  },

  addNodeView() {
    return ({ node, editor }: any) => {
      const dom = document.createElement("sup");
      dom.className = "footnote-reference";
      dom.setAttribute("data-type", "footnote-reference");
      dom.setAttribute("data-label", node.attrs.label || "");

      let currentLabel = node.attrs.label || "";

      const updateContent = () => {
        let footnoteNumber = 1;
        if (editor?.state?.doc) {
          const labels = new Set<string>();
          editor.state.doc.descendants((n: any) => {
            if (n.type.name === "footnoteReference" && n.attrs.label) {
              labels.add(n.attrs.label);
            }
          });
          const idx = Array.from(labels).indexOf(currentLabel);
          if (idx >= 0) footnoteNumber = idx + 1;
        }

        dom.textContent = `[${footnoteNumber}]`;
        dom.title = `[^${currentLabel}]`;
      };

      updateContent();

      const onMouseEnter = () => {
        let defContent = "";
        if (editor?.state?.doc) {
          editor.state.doc.descendants((n: any) => {
            if (n.type.name === "footnoteDefinition" && n.attrs.label === currentLabel) {
              defContent = n.attrs.content || "";
              return false;
            }
          });
        }
        if (defContent) {
          showFootnoteTooltip(dom, defContent);
        }
      };

      const onMouseLeave = () => {
        removeActiveTooltip();
      };

      dom.addEventListener("mouseenter", onMouseEnter);
      dom.addEventListener("mouseleave", onMouseLeave);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "footnoteReference") return false;
          if (updatedNode.attrs.label !== currentLabel) {
            currentLabel = updatedNode.attrs.label || "";
            dom.setAttribute("data-label", currentLabel);
            updateContent();
          }
          return true;
        },
        destroy() {
          dom.removeEventListener("mouseenter", onMouseEnter);
          dom.removeEventListener("mouseleave", onMouseLeave);
          removeActiveTooltip();
        },
      };
    };
  },
});

/**
 * Footnote Definition node: [^label]: content
 * Block node holding footnote body.
 */
export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || "",
        renderHTML: (attrs: { label?: string }) => ({ "data-label": attrs.label || "" }),
      },
      content: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-content") || el.textContent || "",
        renderHTML: (attrs: { content?: string }) => ({ "data-content": attrs.content || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="footnote-definition"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote-definition",
        class: "footnote-definition",
      }),
      ["span", { class: "footnote-def-label" }, `[^${node.attrs.label}]: `],
      ["span", { class: "footnote-def-content" }, node.attrs.content],
    ];
  },

  markdownTokenName: "footnoteDefinition",

  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start: () => -1,
    tokenize(src: string) {
      // Matches [^label]: content
      // Allows optional 0-3 leading spaces; continuation lines continue until blank line or next footnote definition
      const match = src.match(/^[ \t]{0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?!\n|[ \t]{0,3}\[\^).*)*)(?:\n|$)/);
      if (!match) return undefined;
      const content = match[2].trimEnd();
      return {
        type: "footnoteDefinition",
        raw: match[0],
        label: match[1],
        content,
        text: content,
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("footnoteDefinition", {
      label: token.label ?? "",
      content: token.content ?? "",
    });
  },

  renderMarkdown(node: any) {
    return `[^${node.attrs?.label ?? ""}]: ${node.attrs?.content ?? ""}`;
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement("div");
      dom.className = "footnote-definition";
      dom.setAttribute("data-type", "footnote-definition");
      dom.setAttribute("data-label", node.attrs.label || "");
      dom.setAttribute("data-content", node.attrs.content || "");

      const labelBadge = document.createElement("span");
      labelBadge.className = "footnote-def-label";
      labelBadge.textContent = `[^${node.attrs.label}]: `;

      const contentSpan = document.createElement("span");
      contentSpan.className = "footnote-def-content";
      contentSpan.textContent = node.attrs.content || "";

      dom.appendChild(labelBadge);
      dom.appendChild(contentSpan);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "footnoteDefinition") return false;
          labelBadge.textContent = `[^${updatedNode.attrs.label}]: `;
          contentSpan.textContent = updatedNode.attrs.content || "";
          dom.setAttribute("data-label", updatedNode.attrs.label || "");
          dom.setAttribute("data-content", updatedNode.attrs.content || "");
          return true;
        },
      };
    };
  },
});

export const footnoteExtensions = [FootnoteReference, FootnoteDefinition];
