import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const headingLevelKey = new PluginKey("heading-level");

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
