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

        // First pass: check for excluded nodes and find list_item
        let listItemDepth: number | null = null;
        for (let depth = $from.depth; depth >= 1; depth--) {
          const node = $from.node(depth);
          const nodeType = node.type.name;

          // Skip code blocks - they have their own line highlighting
          if (EXCLUDED_NODE_TYPES.has(nodeType)) {
            return DecorationSet.empty;
          }

          // Remember list_item depth for priority handling
          if (nodeType === "list_item") {
            listItemDepth = depth;
            break;
          }
        }

        // If inside list_item, highlight it (priority over textblocks)
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
      },
    },
  });
}
