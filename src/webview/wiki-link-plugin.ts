// src/webview/wiki-link-plugin.ts
import { Node, mergeAttributes } from "@tiptap/core";

export const WIKI_LINK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      filename: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wiki-link]",
        getAttrs: (el: HTMLElement) => ({
          filename: el.getAttribute("data-filename"),
          alias: el.getAttribute("data-alias") || null,
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const filename = node.attrs.filename as string;
    const alias = node.attrs.alias as string | null;
    const displayText = alias || filename || "";

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        "data-filename": filename,
        ...(alias ? { "data-alias": alias } : {}),
        class: "wiki-link",
      }),
      ["span", { class: "wiki-link-icon" }],
      displayText,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("span");
      const attrs = mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        "data-filename": node.attrs.filename,
        ...(node.attrs.alias ? { "data-alias": node.attrs.alias } : {}),
        class: "wiki-link",
      });
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) dom.setAttribute(key, value);
      }

      const icon = document.createElement("span");
      icon.className = "wiki-link-icon";
      icon.innerHTML = WIKI_LINK_ICON_SVG;
      dom.appendChild(icon);

      const text = document.createTextNode(node.attrs.alias || node.attrs.filename || "");
      dom.appendChild(text);

      return { dom };
    };
  },
});
