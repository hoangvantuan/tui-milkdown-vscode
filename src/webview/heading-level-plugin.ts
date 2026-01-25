import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

const headingLevelKey = new PluginKey("heading-level");

/**
 * ProseMirror plugin that displays heading level badges (H1, H2, etc.)
 * next to each heading in the editor for quick visual identification.
 */
export function createHeadingLevelPlugin(): Plugin {
  return new Plugin({
    key: headingLevelKey,
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level as number;
            // pos + 1 = inside heading node (after opening tag, before text content)
            const widget = Decoration.widget(
              pos + 1,
              () => {
                const badge = document.createElement("span");
                badge.className = "heading-level-badge";
                badge.textContent = `H${level}`;
                badge.setAttribute("contenteditable", "false");
                return badge;
              },
              { side: -1 } // Position before text content
            );
            decorations.push(widget);
          }
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
