import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

const lineHighlightKey = new PluginKey("line-highlight");

/**
 * Create ProseMirror plugin that highlights current block containing cursor.
 * Uses Decoration API to add 'line-highlight' CSS class to active block node.
 */
export function createLineHighlightPlugin(): Plugin {
  return new Plugin({
    key: lineHighlightKey,
    props: {
      decorations(state) {
        const { selection } = state;
        const { $from } = selection;

        // Return empty if cursor at document root (depth 0)
        const depth = $from.depth;
        if (depth === 0) return DecorationSet.empty;

        // Find top-level block (depth 1) containing cursor
        const blockStart = $from.start(1);
        const blockEnd = $from.end(1);

        // Create node decoration wrapping entire block
        // ProseMirror positions: start() returns pos after opening, end() returns pos before closing
        // Offset -1/+1 needed to include the node wrapper itself in decoration range
        const decoration = Decoration.node(blockStart - 1, blockEnd + 1, {
          class: "line-highlight",
        });

        return DecorationSet.create(state.doc, [decoration]);
      },
    },
  });
}
