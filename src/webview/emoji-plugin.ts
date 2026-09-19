/**
 * Emoji autocomplete plugin on `:` trigger.
 *
 * Lazy-loads emojibase dataset via loadArtifact("emoji") so that the
 * 529 KB dataset stays out of the startup bundle.
 *
 * Uses SuggestionPopup<EmojiSearchResult> (the 4th consumer) appended to
 * #editor-container.
 *
 * Inserts plain unicode text node into the document; NEVER declares or adds
 * an emoji node to the schema, guaranteeing that markdown serialization
 * always saves unicode characters and never converts unicode to :shortcode:.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import fuzzysort from "fuzzysort";
import type { EmojiItem } from "@tiptap/extension-emoji";
import { loadArtifact } from "./artifact-bridge";
import { SuggestionPopup } from "./suggestion-popup";
import { highlightMatches } from "./file-search-utils";

export interface EmojiSearchResult {
  emoji: EmojiItem;
  score: number;
  nameIndexes: readonly number[] | null;
}

export const emojiPluginKey = new PluginKey("emojiSuggestion");

let cachedEmojis: EmojiItem[] | null = null;
let emojiLoadPromise: Promise<EmojiItem[]> | null = null;

/**
 * Set emoji data explicitly (used by tests and harness to provide data without network).
 */
export function setEmojiData(data: EmojiItem[]): void {
  cachedEmojis = data;
}

/**
 * Retrieve or lazy-load the GitHub emoji dataset.
 */
export async function ensureEmojiData(): Promise<EmojiItem[]> {
  if (cachedEmojis) return cachedEmojis;
  if (!emojiLoadPromise) {
    emojiLoadPromise = loadArtifact<{ gitHubEmojis: EmojiItem[] }>("emoji")
      .then((bundle) => {
        cachedEmojis = bundle.gitHubEmojis;
        return cachedEmojis;
      })
      .catch((err) => {
        emojiLoadPromise = null;
        throw err;
      });
  }
  return emojiLoadPromise;
}

const POPULAR_EMOJI_NAMES = [
  "smile",
  "joy",
  "heart",
  "tada",
  "+1",
  "-1",
  "fire",
  "rocket",
  "sparkles",
  "thinking_face",
  "wave",
  "eyes",
  "pray",
  "sunglasses",
  "sob",
  "clap",
];

/**
 * Filter emoji list using fuzzysort across name, shortcodes, and tags.
 */
export function searchEmojis(
  query: string,
  emojis: EmojiItem[],
  maxResults = 20,
): EmojiSearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    const popularMap = new Map<string, EmojiItem>();
    for (const e of emojis) {
      if (POPULAR_EMOJI_NAMES.includes(e.name) && !popularMap.has(e.name)) {
        popularMap.set(e.name, e);
      }
    }
    const results: EmojiSearchResult[] = [];
    for (const name of POPULAR_EMOJI_NAMES) {
      const e = popularMap.get(name);
      if (e) {
        results.push({ emoji: e, score: 1, nameIndexes: null });
      }
    }
    if (results.length < maxResults) {
      for (const e of emojis) {
        if (!popularMap.has(e.name)) {
          results.push({ emoji: e, score: 0.5, nameIndexes: null });
          if (results.length >= maxResults) break;
        }
      }
    }
    return results.slice(0, maxResults);
  }

  const results = fuzzysort.go(trimmed, emojis, {
    keys: [
      "name",
      (obj) => (obj.shortcodes ? obj.shortcodes.join(" ") : ""),
      (obj) => (obj.tags ? obj.tags.join(" ") : ""),
    ],
    threshold: 0,
    limit: maxResults * 2,
  });

  return results
    .map((r) => ({
      emoji: r.obj,
      score: r.score,
      nameIndexes: (r[0]?.indexes as readonly number[] | undefined) ?? null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Insert unicode emoji character at range, replacing the trigger or typed shortcode.
 * Plain unicode text node inserted; no node added to the ProseMirror schema.
 */
export function insertEmoji(
  editor: Editor,
  range: Range,
  emoji: string,
): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent(emoji)
    .run();
}



function renderEmojiItem(item: EmojiSearchResult): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const symbolSpan = document.createElement("span");
  symbolSpan.className = "emoji-item-symbol";
  symbolSpan.textContent = item.emoji.emoji ?? "";

  const nameSpan = document.createElement("span");
  nameSpan.className = "emoji-item-name";
  nameSpan.innerHTML = highlightMatches(item.emoji.name, item.nameIndexes);

  const shortcodeSpan = document.createElement("span");
  shortcodeSpan.className = "emoji-item-shortcode";
  shortcodeSpan.textContent = `:${item.emoji.name}:`;

  fragment.appendChild(symbolSpan);
  fragment.appendChild(nameSpan);
  fragment.appendChild(shortcodeSpan);

  return fragment;
}

export const EmojiSuggestion = Extension.create({
  name: "emojiSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiSearchResult, EmojiSearchResult>({
        pluginKey: emojiPluginKey,
        editor: this.editor,
        char: ":",
        allowSpaces: false,

        allow({ state, range }) {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;
          // Kick off lazy load in background as soon as colon is allowed
          ensureEmojiData().catch(() => {});
          return true;
        },

        async items({ query }) {
          try {
            const emojis = await ensureEmojiData();
            return searchEmojis(query, emojis, 20);
          } catch {
            return [];
          }
        },

        command({ editor, range, props }) {
          if (props.emoji.emoji) {
            insertEmoji(editor, range, props.emoji.emoji);
          }
        },

        render() {
          const popup = new SuggestionPopup<EmojiSearchResult>({
            popupClass: "emoji-popup",
            itemClass: "emoji-item",
            emptyClass: "emoji-empty",
            emptyText: "No matching emojis",
            renderItem: renderEmojiItem,
          });

          return {
            onStart(props: SuggestionProps<EmojiSearchResult, EmojiSearchResult>) {
              popup.onStart(props);
            },
            onUpdate(props: SuggestionProps<EmojiSearchResult, EmojiSearchResult>) {
              popup.onUpdate(props);
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              return popup.onKeyDown(props);
            },
            onExit() {
              popup.onExit();
            },
          };
        },
      }),
    ];
  },
});
