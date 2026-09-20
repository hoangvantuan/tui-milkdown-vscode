/**
 * Dedicated Details/Summary extension (issue #132).
 *
 * Provides WYSIWYG collapsible <details>/<summary> nodes.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "inline*",
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("detailsSummary", {}, helpers.parseInline(token.tokens || []));
  },

  renderMarkdown(node: any, helpers: any) {
    return `<summary>${helpers.renderChildren(node)}</summary>`;
  },
});

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "detailsSummary block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => (attributes.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },

  /**
   * Why a NodeView at all, when renderHTML already produces a <details>:
   * clicking <summary> is handled by the browser, which flips the `open`
   * ATTRIBUTE on the DOM node without a ProseMirror transaction. ProseMirror
   * sees an unexplained mutation, redraws the node from a state that still
   * says closed, and the disclosure springs shut again. Measured before this
   * existed: open on the first click, closed again 900 ms later, so a second
   * click only reopened it and it could never be closed by hand.
   *
   * The fix is NOT to dispatch a transaction for the toggle. `open` is
   * serialized by renderMarkdown, so writing the user's disclosure state into
   * the document would put ` open` into their file just because they looked
   * inside a block, and #85's rule is that rendering never changes what is
   * saved. Instead the attribute mutation is ignored, which leaves the browser's
   * native toggle in charge of the DOM and leaves the document untouched.
   *
   * The attribute keeps its other job: `<details open>` written by hand parses
   * to open: true, renders open, and is saved back with ` open`.
   */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("details");
      if (node.attrs.open) dom.setAttribute("open", "");
      return {
        dom,
        // <summary> is the node's first child, so the children render inside
        // the same element, exactly as renderHTML would place them.
        contentDOM: dom,
        // ViewMutationRecord, not MutationRecord: ProseMirror also passes a
        // { type: "selection" } record through here, which has no attributeName.
        ignoreMutation: (mutation: { type: string; attributeName?: string | null }) =>
          mutation.type === "attributes" && mutation.attributeName === "open",
        update: (updated: { type: { name: string } }) => {
          if (updated.type.name !== "details") return false;
          // Keep the DOM, and with it whatever the reader has open right now.
          // Re-applying attrs here would undo the click all over again.
          return true;
        },
      };
    };
  },

  markdownTokenizer: {
    name: "details",
    level: "block",
    start(src: string) {
      return src.match(/^<details\b/i) ? 0 : -1;
    },
    tokenize(src: string, _tokens: any[], lexer: any) {
      const match = /^<details\b([^>]*)>([\s\S]*?)<\/details>/i.exec(src);
      if (!match) return;

      const raw = match[0];
      const rawAttrs = match[1];
      const inner = match[2];

      const summaryMatch = /^\s*<summary\b([^>]*)>([\s\S]*?)<\/summary>/i.exec(inner);
      const summaryText = summaryMatch ? summaryMatch[2].trim() : "Details";
      const bodyText = summaryMatch ? inner.slice(summaryMatch[0].length) : inner;

      const bodyTokens = lexer.blockTokens(bodyText.trim() ? bodyText : "");

      return {
        type: "details",
        raw,
        open: /\bopen\b/i.test(rawAttrs),
        summary: summaryText,
        tokens: [
          {
            type: "detailsSummary",
            raw: summaryMatch ? summaryMatch[0] : "<summary>Details</summary>",
            text: summaryText,
            tokens: lexer.inlineTokens(summaryText),
          },
          ...(bodyTokens.length > 0 ? bodyTokens : [{ type: "paragraph", raw: "", text: "", tokens: [] }]),
        ],
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    const content = helpers.parseChildren(token.tokens || []);
    return helpers.createNode("details", { open: token.open || false }, content);
  },

  renderMarkdown(node: any, helpers: any) {
    const summaryNode = node.content?.[0];
    const summary = summaryNode ? helpers.renderChild(summaryNode, 0) : "<summary>Details</summary>";
    const bodyNodes = node.content?.slice(1) || [];
    const body = helpers.renderChildren(bodyNodes, "\n\n");
    const openAttr = node.attrs.open ? " open" : "";
    return `<details${openAttr}>\n${summary}\n\n${body}\n\n</details>`;
  },
});

export const detailsExtensions = [DetailsSummary, Details];
