/**
 * Tiptap `Link` and `Image` with destination-safe markdown serialization and
 * support for linked images.
 *
 * Both replace the upstream `renderMarkdown`, which interpolates the raw
 * `href`/`src` and so emits `[text](a path with spaces)`, which is not a CommonMark
 * link, and plain text again the next time the file is opened. See
 * src/utils/markdown-destination.ts for the escaping rule itself.
 *
 * Linked images (`[![alt](src)](dest)`):
 *   1. `MarkdownImage` sets `marks: "link"` so ProseMirror allows a link mark
 *      on image leaf nodes.
 *   2. `MarkdownLink.parseMarkdown` recursively attaches the link mark to inline
 *      nodes including images (upstream `@tiptap/markdown` only attaches marks to
 *      text nodes and drops them on leaf nodes).
 *   3. `MarkdownImage.renderMarkdown` wraps the rendered image markdown in the
 *      enclosing link if a link mark is present (upstream `@tiptap/markdown`
 *      ignores marks on non-text nodes during serialization).
 *
 * All three are needed; fixing any two still loses the link. The upstream
 * report, with the code behind each of the three, is in
 * docs/upstream/tiptap-linked-image.md. It was never filed, so check it against
 * the release notes before dropping any of these overrides on a Tiptap bump.
 *
 * Exported from here rather than defined at each call site so
 * src/webview/main.ts and harness/editor.ts serialize through the same code
 * instead of two copies that can drift apart. Callers still apply their own
 * `.configure()`.
 */
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import {
  wrapMarkdownDestination,
  escapeMarkdownTitle,
  escapeMarkdownAlt,
} from "../utils/markdown-destination";

/** Recursively apply a mark to inline nodes, including image leaf nodes. */
function applyMarkToNodes(markType: string, nodes: any[], attrs?: any): any[] {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "image") {
      const existingMarks = node.marks || [];
      const newMark = attrs ? { type: markType, attrs } : { type: markType };
      return {
        ...node,
        marks: [...existingMarks, newMark],
      };
    }
    if (node.content && Array.isArray(node.content)) {
      return {
        ...node,
        content: applyMarkToNodes(markType, node.content, attrs),
      };
    }
    return node;
  });
}

export const MarkdownLink = Link.extend({
  parseMarkdown(token: any, helpers: any) {
    const inlineNodes = helpers.parseInline(token.tokens || []);
    return applyMarkToNodes("link", inlineNodes, {
      href: token.href,
      title: token.title || null,
    });
  },

  renderMarkdown(node: any, h: any) {
    const href = wrapMarkdownDestination(node?.attrs?.href ?? "");
    const title = node?.attrs?.title ?? "";
    const text = h.renderChildren(node);
    return title
      ? `[${text}](${href} "${escapeMarkdownTitle(title)}")`
      : `[${text}](${href})`;
  },
});

export const MarkdownImage = Image.extend({
  marks: "link",

  renderMarkdown(node: any) {
    const src = wrapMarkdownDestination(node?.attrs?.src ?? "");
    const alt = escapeMarkdownAlt(node?.attrs?.alt ?? "");
    const title = node?.attrs?.title ?? "";
    const imageMd = title
      ? `![${alt}](${src} "${escapeMarkdownTitle(title)}")`
      : `![${alt}](${src})`;

    const linkMark = node?.marks?.find(
      (m: any) => (typeof m.type === "string" ? m.type : m.type?.name) === "link"
    );
    if (linkMark) {
      const href = wrapMarkdownDestination(linkMark?.attrs?.href ?? "");
      const linkTitle = linkMark?.attrs?.title ?? "";
      return linkTitle
        ? `[${imageMd}](${href} "${escapeMarkdownTitle(linkTitle)}")`
        : `[${imageMd}](${href})`;
    }
    return imageMd;
  },
});

