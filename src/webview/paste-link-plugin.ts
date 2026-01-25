import { Plugin, PluginKey } from "@milkdown/prose/state";

const pasteLinkKey = new PluginKey("paste-link");

// URL regex: http/https with at least one character after ://
// Requires domain portion to exist (not just http://)
const URL_REGEX = /^https?:\/\/[^\s/]+[^\s]*$/;

/**
 * Check if text is a valid http/https URL
 * - Must be single line (no newlines)
 * - Must have protocol (http/https) and domain
 */
function isValidUrl(text: string): boolean {
  const trimmed = text.trim();
  // Reject multi-line text
  if (trimmed.includes("\n")) return false;
  return URL_REGEX.test(trimmed);
}

/**
 * ProseMirror plugin that converts selected text to link when pasting URL.
 * - Only triggers when there's a text selection
 * - Only triggers when clipboard contains a valid http/https URL
 * - Replaces existing link URL if selection is already a link
 * - Preserves default paste behavior otherwise
 */
export function createPasteLinkPlugin(): Plugin {
  return new Plugin({
    key: pasteLinkKey,
    props: {
      handlePaste(view, event) {
        const { state, dispatch } = view;
        const { selection } = state;
        const { from, to, empty } = selection;

        // Must have non-empty selection
        if (empty || from === to) {
          return false;
        }

        // Get clipboard data
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }

        // Skip if clipboard has files (let image handler process)
        if (clipboardData.files.length > 0) {
          return false;
        }

        // Get plain text from clipboard
        const text = clipboardData.getData("text/plain");
        if (!text || !isValidUrl(text)) {
          return false;
        }

        // Get link mark type from schema
        const linkMark = state.schema.marks.link;
        if (!linkMark) {
          return false;
        }

        // Create link mark with pasted URL
        const url = text.trim();
        const mark = linkMark.create({ href: url });

        // Apply mark to selection (replaces existing link if any)
        const tr = state.tr.addMark(from, to, mark);
        dispatch(tr);

        return true; // Handled, prevent default paste
      },
    },
  });
}
