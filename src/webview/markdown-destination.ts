/**
 * Tiptap `Link` and `Image` with destination-safe markdown serialization.
 *
 * Both replace the upstream `renderMarkdown`, which interpolates the raw
 * `href`/`src` and so emits `[text](a path with spaces)`, which is not a CommonMark
 * link, and plain text again the next time the file is opened. See
 * src/utils/markdown-destination.ts for the escaping rule itself.
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

export const MarkdownLink = Link.extend({
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
  renderMarkdown(node: any) {
    const src = wrapMarkdownDestination(node?.attrs?.src ?? "");
    const alt = escapeMarkdownAlt(node?.attrs?.alt ?? "");
    const title = node?.attrs?.title ?? "";
    return title
      ? `![${alt}](${src} "${escapeMarkdownTitle(title)}")`
      : `![${alt}](${src})`;
  },
});
