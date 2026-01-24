import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

const lineHighlightKey = new PluginKey("line-highlight");

// Node types that should NOT receive line highlight (they have their own highlighting)
const EXCLUDED_NODE_TYPES = new Set(["code_block", "fence"]);

/**
 * Create ProseMirror plugin that highlights the immediate block containing cursor.
 * - Highlights individual list items, not entire lists
 * - Skips code blocks (they have built-in line highlighting)
 * - Uses Decoration API to add 'line-highlight' CSS class
 */
export function createLineHighlightPlugin(): Plugin {
  return new Plugin({
    key: lineHighlightKey,
    props: {
      decorations(state) {
        const { selection } = state;
        const { $from } = selection;

        // Return empty if cursor at document root (depth 0)
        if ($from.depth === 0) return DecorationSet.empty;

        // Walk up from cursor to find the nearest highlightable block
        // Skip: code blocks, and stop at list items or paragraphs
        for (let depth = $from.depth; depth >= 1; depth--) {
          const node = $from.node(depth);
          const nodeType = node.type.name;

          // Skip code blocks - they have their own line highlighting
          if (EXCLUDED_NODE_TYPES.has(nodeType)) {
            return DecorationSet.empty;
          }

          // For list items: highlight the list_item itself
          if (nodeType === "list_item") {
            const start = $from.start(depth);
            const end = $from.end(depth);
            const decoration = Decoration.node(start - 1, end + 1, {
              class: "line-highlight",
            });
            return DecorationSet.create(state.doc, [decoration]);
          }

          // For paragraphs/headings at depth 1 (top-level): highlight them
          if (depth === 1) {
            const start = $from.start(depth);
            const end = $from.end(depth);
            const decoration = Decoration.node(start - 1, end + 1, {
              class: "line-highlight",
            });
            return DecorationSet.create(state.doc, [decoration]);
          }
        }

        return DecorationSet.empty;
      },
    },
  });
}
