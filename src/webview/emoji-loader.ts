/**
 * Lazy emoji-data artifact -> out/webview/emoji-loader.js.
 *
 * Only the DATA is lazy-loaded, deliberately. `@tiptap/extension-emoji` also
 * declares a schema node named `emoji` with its own `renderMarkdown`, and a
 * schema is fixed when the Editor is constructed, so the extension itself
 * cannot be added later; registering it would also risk re-serializing a
 * unicode character the user already saved as a `:shortcode:`, which #85
 * forbids ("never how it is saved"). The picker therefore uses the shared
 * suggestion popup and inserts plain unicode text, and this artifact exists
 * only so the 529 KB emojibase dataset stays out of the startup bundle.
 */
import { gitHubEmojis, type EmojiItem } from "@tiptap/extension-emoji";

declare global {
  interface Window {
    __tuiEmojiBundle?: { gitHubEmojis: EmojiItem[] };
  }
}

window.__tuiEmojiBundle = { gitHubEmojis };
