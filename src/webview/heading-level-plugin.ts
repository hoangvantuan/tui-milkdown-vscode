import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const headingLevelKey = new PluginKey("heading-level");

/**
 * The GitHub-style anchor slug for a heading's text.
 *
 * Lowercase, keep Unicode letters, digits and hyphens, and turn each single
 * whitespace character into one hyphen without collapsing runs. That last part
 * is what GitHub does and what the table of contents already relies on, so the
 * anchor copied from a heading and the target `scrollToHeading` looks for are
 * the same string by construction rather than by two copies agreeing.
 *
 * Exported because main.ts needs the identical rule; a second copy of these
 * three replaces is how the two drift apart.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Compute heading badge decorations for all heading nodes in the document.
 */
function computeHeadingDecorations(doc: Parameters<typeof DecorationSet.create>[0]): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const widget = Decoration.widget(
        pos + 1,
        () => {
          const badge = document.createElement("span");
          badge.className = "heading-level-badge";
          badge.textContent = `H${level}`;
          badge.setAttribute("contenteditable", "false");
          return badge;
        },
        { side: -1 }
      );
      decorations.push(widget);

      // Anchor copy button, revealed on hover by the CSS. It writes the slug
      // with a leading `#`, the form a markdown link to this heading takes.
      // `mousedown` rather than `click`: the button sits inside contenteditable
      // and a click would first move the selection into the heading.
      const slug = headingSlug(node.textContent);
      const anchor = Decoration.widget(
        pos + 1,
        () => {
          const btn = document.createElement("button");
          btn.className = "heading-anchor-btn";
          btn.type = "button";
          btn.textContent = "#";
          btn.title = `Copy link to "${node.textContent}"`;
          btn.setAttribute("aria-label", `Copy link to heading ${node.textContent}`);
          btn.setAttribute("contenteditable", "false");
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void navigator.clipboard.writeText(`#${slug}`).then(
              () => {
                btn.classList.add("is-copied");
                setTimeout(() => btn.classList.remove("is-copied"), 1200);
              },
              () => {
                // Clipboard can be refused by the webview; say nothing rather
                // than replace the document with an error screen, which is what
                // showError() in main.ts actually does.
              },
            );
          });
          return btn;
        },
        { side: -1 }
      );
      decorations.push(anchor);
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Tiptap Extension that displays heading level badges (H1, H2, etc.)
 * next to each heading for quick visual identification.
 */
export const HeadingLevel = Extension.create({
  name: "headingLevel",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingLevelKey,
        state: {
          init(_, state) {
            return computeHeadingDecorations(state.doc);
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            return computeHeadingDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return headingLevelKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
