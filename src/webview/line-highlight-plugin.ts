import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const lineHighlightKey = new PluginKey("line-highlight");

// Node types that should NOT receive line highlight (they have their own highlighting)
const EXCLUDED_NODE_TYPES = new Set(["codeBlock"]);

/**
 * Compute highlight decoration for the block containing the cursor.
 */
function computeHighlight(state: EditorState): DecorationSet {
  const { $from } = state.selection;

  if ($from.depth === 0) return DecorationSet.empty;

  // First pass: check for excluded nodes and find listItem
  let listItemDepth: number | null = null;
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    const nodeType = node.type.name;

    if (EXCLUDED_NODE_TYPES.has(nodeType)) {
      return DecorationSet.empty;
    }

    if (nodeType === "listItem" || nodeType === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  // If inside listItem/taskItem, highlight it (priority over textblocks)
  if (listItemDepth !== null) {
    const decoration = Decoration.node(
      $from.before(listItemDepth),
      $from.after(listItemDepth),
      { class: "line-highlight" }
    );
    return DecorationSet.create(state.doc, [decoration]);
  }

  // Second pass: find nearest textblock (paragraph, heading, etc.)
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      const decoration = Decoration.node(
        $from.before(depth),
        $from.after(depth),
        { class: "line-highlight" }
      );
      return DecorationSet.create(state.doc, [decoration]);
    }
  }

  return DecorationSet.empty;
}

/**
 * Tiptap Extension that highlights the immediate block containing cursor.
 * - Highlights individual list items, not entire lists
 * - Skips code blocks (they have built-in line highlighting)
 * - Uses Decoration API to add 'line-highlight' CSS class
 */
export const LineHighlight = Extension.create({
  name: "lineHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: lineHighlightKey,
        state: {
          init(_, state) {
            return computeHighlight(state);
          },
          apply(tr, value, _oldState, newState) {
            if (!tr.selectionSet && !tr.docChanged) return value;
            return computeHighlight(newState);
          },
        },
        props: {
          decorations(state) {
            return lineHighlightKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
