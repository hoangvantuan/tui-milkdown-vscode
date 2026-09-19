/**
 * Raw HTML preservation for Tiptap markdown editor (issue #96).
 *
 * Core rule:
 * The editor never invents or drops HTML; it renders a tag only when a
 * dedicated extension owns it.
 *
 * Trình soạn thảo không bịa ra HTML và không vứt HTML đi; nó chỉ render một
 * thẻ khi có extension chuyên trách nhận thẻ đó.
 *
 * Recognized tags that have dedicated extensions keep working natively:
 *   - <br> -> HardBreak
 *   - <u>, <ins> -> Underline
 *   - <table>, <thead>, <tbody>, <tr>, <th>, <td>, <colgroup>, <col> -> Table
 *   - <img> without unmodeled attributes -> Image (MarkdownImage)
 *
 * Unrecognized tags (or tags with attributes that markdown cannot express,
 * such as `<img align="left">` or `<a target="_blank">`) are preserved verbatim
 * as raw HTML nodes:
 *   - `rawHtmlBlock`: block-level HTML tokens (e.g. `<details>`, `<div>`, comments)
 *   - `rawHtmlInline`: inline HTML tokens (e.g. `<kbd>`, `<sub>`, `<a>`), where
 *     opening and closing tags are distinct atom nodes so enclosed text remains
 *     fully editable.
 */

import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Check if an <img> tag contains attributes that MarkdownImage cannot model
 * (specifically align). Width and height are modeled as node attributes on
 * MarkdownImage (#120).
 */
export function hasUnmodeledImageAttributes(tagOrHtml: string): boolean {
  return /\balign\s*=/i.test(tagOrHtml);
}

/**
 * Regex matching an HTML open/close/self-closing tag.
 * Allows valid attribute values with quotes or unquoted characters.
 * Excludes URI schemes like `<https://...>` because `:` immediately follows the tag name without whitespace.
 */
const HTML_TAG_REGEX =
  /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s+(?:[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>]+))?))*\s*\/?>/;

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-raw-html") ||
          element.querySelector("code")?.textContent ||
          "",
        renderHTML: (attributes) => ({ "data-raw-html": attributes.html }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="rawHtmlBlock"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "raw-html-block",
        "data-type": "rawHtmlBlock",
      }),
      ["span", { class: "raw-html-badge" }, "HTML"],
      ["pre", ["code", node.attrs.html]],
    ];
  },

  markdownTokenName: "html",

  parseMarkdown(token: any, helpers: any) {
    const raw = (token.raw || token.text || "").trim();

    // Recognized block tags that should be handled by their dedicated extensions
    if (/^<br\s*\/?>/i.test(raw)) return null;
    if (/^<\/?(table|thead|tbody|tfoot|tr|th|td|colgroup|col)\b/i.test(raw)) return null;
    if (/^<img\b/i.test(raw) && !hasUnmodeledImageAttributes(raw)) return null;

    // Preserve verbatim, stripping any trailing newlines marked attaches to block tokens
    const text = (token.raw || token.text || "").replace(/\n+$/, "");
    return helpers.createNode("rawHtmlBlock", { html: text });
  },

  renderMarkdown(node: any) {
    return node.attrs.html;
  },
});

export const RawHtmlInline = Node.create({
  name: "rawHtmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-raw-html") ||
          element.textContent ||
          "",
        renderHTML: (attributes) => ({ "data-raw-html": attributes.html }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="rawHtmlInline"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "raw-html-inline",
        "data-type": "rawHtmlInline",
      }),
      node.attrs.html,
    ];
  },

  markdownTokenizer: {
    name: "rawHtmlInline",
    level: "inline",
    start(src: string) {
      return src.indexOf("<");
    },
    tokenize(src: string) {
      // 1. HTML comments: <!-- ... -->
      const commentMatch = /^<!--[\s\S]*?-->/.exec(src);
      if (commentMatch) {
        return {
          type: "rawHtmlInline",
          raw: commentMatch[0],
          text: commentMatch[0],
        };
      }

      // 2. HTML tags
      const tagMatch = HTML_TAG_REGEX.exec(src);
      if (!tagMatch) return;

      const tag = tagMatch[0];
      const tagName = tagMatch[1].toLowerCase();

      // Recognized tags handled natively by dedicated extensions:
      if (tagName === "br") return;
      if (tagName === "u" || tagName === "ins") return;
      if (/^(table|thead|tbody|tfoot|tr|th|td|colgroup|col)$/.test(tagName)) return;

      return {
        type: "rawHtmlInline",
        raw: tag,
        text: tag,
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("rawHtmlInline", { html: token.raw || token.text || "" });
  },

  renderMarkdown(node: any) {
    return node.attrs.html;
  },
});
