/**
 * Tiptap `Link` and `Image` with destination-safe markdown serialization and
 * support for linked images.
 *
 * Both replace the upstream `renderMarkdown`, which interpolates the raw
 * `href`/`src` and so emits `[text](a path with spaces)`, which is not a CommonMark
 * link, and plain text again the next time the file is opened. See
 * src/utils/markdown-destination.ts for the escaping rule itself.
 *
 * Linked images (`[![alt](src)](dest)` or `[<img src="..." width="...">](dest)`):
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
import { Paragraph } from "@tiptap/extension-paragraph";
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

/** Parse attribute map from raw HTML img tag string */
function parseHtmlImgAttrs(html: string): Record<string, string> | null {
  const match = /^<img\b([^>]*)>/i.exec(html.trim());
  if (!match) return null;
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(match[1])) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

export const MarkdownLink = Link.extend({
  parseMarkdown(token: any, helpers: any) {
    const rawTokens = token.tokens || [];
    const inlineNodes: any[] = [];
    let currentBatch: any[] = [];

    const flushBatch = () => {
      if (currentBatch.length === 0) return;
      const parsed = helpers.parseInline(currentBatch);
      if (Array.isArray(parsed)) {
        inlineNodes.push(...parsed);
      } else if (parsed) {
        inlineNodes.push(parsed);
      }
      currentBatch = [];
    };

    for (const childToken of rawTokens) {
      if (
        (childToken.type === "html" || childToken.type === "rawHtmlInline") &&
        /^<img\b/i.test(childToken.text || childToken.raw || "")
      ) {
        flushBatch();
        const raw = (childToken.text || childToken.raw || "").trim();
        const imgAttrs = parseHtmlImgAttrs(raw);
        if (imgAttrs && imgAttrs.src) {
          inlineNodes.push(
            helpers.createNode("image", {
              src: imgAttrs.src,
              alt: imgAttrs.alt || null,
              title: imgAttrs.title || null,
              width: imgAttrs.width || null,
              height: imgAttrs.height || null,
            })
          );
          continue;
        }
      }
      currentBatch.push(childToken);
    }
    flushBatch();
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

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width"),
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        },
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute("height"),
        renderHTML: (attributes) => {
          if (!attributes.height) return {};
          return { height: attributes.height };
        },
      },
    };
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const img = document.createElement("img");
      img.draggable = false;
      const src = node.attrs.src || "";
      if (src) img.src = src;
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      if (node.attrs.height) img.style.height = `${node.attrs.height}px`;

      let handle: HTMLDivElement | null = null;
      let isDragging = false;

      const container =
        (typeof document !== "undefined" &&
          (document.getElementById("editor-container") || document.body)) ||
        null;

      if (container) {
        const resizeHandle = document.createElement("div");
        handle = resizeHandle;
        handle.className = "image-resize-handle";
        handle.style.display = "none";
        handle.style.position = "absolute";
        handle.style.width = "12px";
        handle.style.height = "12px";
        handle.style.cursor = "nwse-resize";
        handle.style.background = "var(--vscode-focusBorder, #007acc)";
        handle.style.border = "2px solid #ffffff";
        handle.style.borderRadius = "50%";
        handle.style.zIndex = "20";
        handle.style.boxShadow = "0 1px 4px rgba(0,0,0,0.3)";
        container.appendChild(handle);

        const updateHandlePosition = () => {
          if (!handle || isDragging || !img.isConnected) return;
          const imgRect = img.getBoundingClientRect();
          const contRect = container.getBoundingClientRect();
          if (imgRect.width > 0 && imgRect.height > 0) {
            const top = imgRect.bottom - contRect.top + container.scrollTop - 6;
            const left = imgRect.right - contRect.left + container.scrollLeft - 6;
            handle.style.top = `${top}px`;
            handle.style.left = `${left}px`;
            handle.style.display = "block";
          }
        };

        const hideHandle = () => {
          if (!handle || isDragging) return;
          handle.style.display = "none";
        };

        img.addEventListener("mouseenter", updateHandlePosition);
        img.addEventListener("mouseleave", (e) => {
          if (e.relatedTarget === handle) return;
          hideHandle();
        });
        handle.addEventListener("mouseleave", (e) => {
          if (e.relatedTarget === img) return;
          hideHandle();
        });

        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          isDragging = true;
          const startX = e.clientX;
          const imgRect = img.getBoundingClientRect();
          const startWidth = imgRect.width;
          const zoom = imgRect.width / (img.offsetWidth || 1);

          let currentNewWidth = Math.round(startWidth / zoom);

          const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            currentNewWidth = Math.max(50, Math.round((startWidth + deltaX) / zoom));
            img.style.width = `${currentNewWidth}px`;
            const updatedImgRect = img.getBoundingClientRect();
            const updatedContRect = container.getBoundingClientRect();
            const top = updatedImgRect.bottom - updatedContRect.top + container.scrollTop - 6;
            const left = updatedImgRect.right - updatedContRect.left + container.scrollLeft - 6;
            resizeHandle.style.top = `${top}px`;
            resizeHandle.style.left = `${left}px`;
          };

          const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            if (typeof getPos === "function") {
              const pos = getPos();
              if (pos !== undefined) {
                editor.view.dispatch(
                  editor.state.tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    width: String(currentNewWidth),
                  })
                );
              }
            }
          };

          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        });
      }

      return {
        dom: img,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          node = updatedNode;
          const newSrc = updatedNode.attrs.src || "";
          if (img.getAttribute("src") !== newSrc) {
            img.src = newSrc;
          }
          if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt;
          else img.removeAttribute("alt");
          if (updatedNode.attrs.title) img.title = updatedNode.attrs.title;
          else img.removeAttribute("title");
          if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`;
          else img.style.removeProperty("width");
          if (updatedNode.attrs.height) img.style.height = `${updatedNode.attrs.height}px`;
          else img.style.removeProperty("height");
          return true;
        },
        destroy() {
          if (handle) {
            handle.remove();
            handle = null;
          }
        },
      };
    };
  },

  renderMarkdown(node: any) {
    const width = node?.attrs?.width;
    const height = node?.attrs?.height;
    const hasWidthOrHeight =
      (width != null && width !== "") || (height != null && height !== "");

    let imageContent: string;
    if (!hasWidthOrHeight) {
      const src = wrapMarkdownDestination(node?.attrs?.src ?? "");
      const alt = escapeMarkdownAlt(node?.attrs?.alt ?? "");
      const title = node?.attrs?.title ?? "";
      imageContent = title
        ? `![${alt}](${src} "${escapeMarkdownTitle(title)}")`
        : `![${alt}](${src})`;
    } else {
      const src = node?.attrs?.src ?? "";
      const alt = node?.attrs?.alt;
      const title = node?.attrs?.title;
      let attrsStr = `src="${src.replace(/"/g, "&quot;")}"`;
      if (alt != null && alt !== "") {
        attrsStr += ` alt="${String(alt).replace(/"/g, "&quot;")}"`;
      }
      if (title != null && title !== "") {
        attrsStr += ` title="${String(title).replace(/"/g, "&quot;")}"`;
      }
      if (width != null && width !== "") {
        attrsStr += ` width="${width}"`;
      }
      if (height != null && height !== "") {
        attrsStr += ` height="${height}"`;
      }
      imageContent = `<img ${attrsStr}>`;
    }

    const linkMark = node?.marks?.find(
      (m: any) => (typeof m.type === "string" ? m.type : m.type?.name) === "link"
    );
    if (linkMark) {
      const href = wrapMarkdownDestination(linkMark?.attrs?.href ?? "");
      const linkTitle = linkMark?.attrs?.title ?? "";
      return linkTitle
        ? `[${imageContent}](${href} "${escapeMarkdownTitle(linkTitle)}")`
        : `[${imageContent}](${href})`;
    }
    return imageContent;
  },
});

/**
 * `Paragraph` with the markdown serializer both editors need, and with one
 * upstream parse rule corrected.
 *
 * The serializer half is the old behaviour, moved here from two identical
 * copies in src/webview/main.ts and harness/editor.ts.
 *
 * The parse half fixes a real defect. `@tiptap/extension-paragraph@3.30.1`
 * lifts a lone image out of its paragraph unconditionally:
 *
 *     if (tokens.length === 1 && tokens[0].type === "image") {
 *       return helpers.parseChildren([tokens[0]]);
 *     }
 *
 * That is right for upstream's default, where `Image` is configured
 * `inline: false` and so cannot sit inside a paragraph. This editor configures
 * it `inline: true`, because a link mark cannot be applied to a block-level
 * image without violating the paragraph content schema, and then the same rule
 * produces a document with an INLINE image as a direct child of `doc`.
 * `doc.check()` rejects it, and the editor does not merely render it wrong: the
 * view throws `Called contentMatchAt on a node with invalid content` while it is
 * being built, and NOTHING mounts. Every markdown file with an image on its own
 * line, which is most of them, opened to a blank editor.
 *
 * The condition upstream is missing is whether the image node is actually a
 * block node, so that is what this checks, rather than hard-coding the answer
 * for this repo's configuration. Written up in docs/upstream/tiptap-paragraph-image.md.
 *
 * The roundtrip harness could not have caught this: it serializes a document
 * back to a string and never mounts a view or calls `doc.check()`, so the
 * invalid document round-trips to the right text. The VS Code floor check
 * caught it on its first run, because it mounts a real editor.
 */
/**
 * Whether `MarkdownImage` is configured as an inline node.
 *
 * ONE definition, consumed by `MarkdownParagraph` below and passed to
 * `MarkdownImage.configure()` by both `src/webview/main.ts` and
 * `harness/editor.ts`. The paragraph parse rule below is only correct for one
 * value of this flag, so the flag and the configuration must not be able to
 * disagree; a boolean spelled in three places can.
 *
 * It is `true` because a link mark cannot be applied to a block-level image
 * without violating ProseMirror's paragraph content schema, which the inline
 * link editor needs (#117).
 */
export const IMAGE_IS_INLINE = true;

/**
 * Upstream's own paragraph parser, captured before the override below replaces
 * it. Returning `null` from a `parseMarkdown` hook does NOT fall through to it:
 * it falls through to the manager's generic `parseFallbackToken`, which has
 * none of upstream's empty-paragraph-marker handling. So the non-image path has
 * to call this explicitly, or overriding one case silently downgrades the rest.
 */
const baseParagraphParseMarkdown = (Paragraph as any).config?.parseMarkdown;

/**
 * `Paragraph` with the markdown serializer both editors need, and with one
 * upstream parse rule corrected.
 *
 * The serializer half is the old behaviour, moved here from two identical
 * copies in src/webview/main.ts and harness/editor.ts.
 *
 * The parse half fixes a real defect. `@tiptap/extension-paragraph@3.30.1`
 * lifts a lone image out of its paragraph unconditionally:
 *
 *     if (tokens.length === 1 && tokens[0].type === "image") {
 *       return helpers.parseChildren([tokens[0]]);
 *     }
 *
 * That is right for upstream's default, where `Image` is `inline: false` and so
 * cannot sit inside a paragraph. This editor configures it inline, and then the
 * same rule produces a document with an INLINE image as a direct child of
 * `doc`. The editor does not merely render that wrong: the view throws
 * `Called contentMatchAt on a node with invalid content` while it is being
 * built, and NOTHING mounts. Every markdown file with an image on its own line,
 * which is most of them, opened to a blank editor. Written up in
 * docs/upstream/tiptap-paragraph-image.md.
 *
 * The condition is read from `IMAGE_IS_INLINE` and NOT from
 * `this.editor.schema`. `this.editor` is undefined while the initial content is
 * parsed, so a schema lookup silently took its default and the rule never ran
 * on the path that matters. That version passed the floor check anyway, because
 * a later `setContent` does have an editor; it was the teeth test, removing the
 * rule and expecting red, that exposed it.
 *
 * The roundtrip harness could not have caught the original defect: it
 * serializes a document back to a string and never mounts a view or calls
 * `doc.check()`, so the invalid document round-trips to the right text. The VS
 * Code floor check caught it on its first run, because it mounts a real editor.
 */
export const MarkdownParagraph = Paragraph.extend({
  parseMarkdown(token: any, helpers: any) {
    const tokens = token?.tokens ?? [];
    const isLoneImage = tokens.length === 1 && tokens[0]?.type === "image";
    if (isLoneImage && IMAGE_IS_INLINE) {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    }
    return baseParagraphParseMarkdown
      ? baseParagraphParseMarkdown.call(this, token, helpers)
      : null;
  },

  renderMarkdown(node: any, h: any) {
    if (!node) return "";
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) return "";
    return h.renderChildren(content);
  },
});
