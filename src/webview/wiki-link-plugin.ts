/**
 * Wiki links `[[file]]` / `[[file|alias]]`: an inline node with its own
 * MarkedJS tokenizer (`markdownTokenizer`) plus parse/render hooks so the
 * syntax round-trips, and a `[[` autocomplete built on @tiptap/suggestion.
 *
 * Search runs against a module-level cache filled from the extension
 * (`wikiLinkSearch` -> `wikiLinkSearchResults`) on popup open and cleared on
 * close; typing filters locally via file-search-utils.ts. The popup is
 * appended to `#editor-container`, not `.tiptap`, because of CSS zoom.
 * Ctrl/Cmd+click resolves the target through the `openWikiLink` message.
 */
import { Node, mergeAttributes, Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import {
  type FileItem,
  type FileSearchResult,
  searchFiles,
  getFileIcon,
  getFolderPath,
  highlightMatches,
} from "./file-search-utils";
import { SuggestionPopup } from "./suggestion-popup";

let cachedFiles: FileItem[] = [];
let currentDocFolder: string | undefined;

export function setWikiLinkFiles(
  files: FileItem[],
  docFolder?: string,
): void {
  cachedFiles = files;
  currentDocFolder = docFolder;
  document.dispatchEvent(new CustomEvent("wiki-link-results"));
}

const wikiLinkPluginKey = new PluginKey("wikiLinkSuggestion");

export const WIKI_LINK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

function renderWikiLinkItem(result: FileSearchResult): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const icon = document.createElement("span");
  icon.className = "wiki-link-item-icon";
  icon.innerHTML = getFileIcon(result.file.name);

  const displayName = result.file.name.replace(/\.md$/i, "");
  const displayIndexes = result.nameIndexes
    ? result.nameIndexes.filter((i) => i < displayName.length)
    : null;

  const nameSpan = document.createElement("span");
  nameSpan.className = "wiki-link-item-name";
  nameSpan.innerHTML = highlightMatches(
    displayName,
    displayIndexes && displayIndexes.length > 0
      ? displayIndexes
      : null,
  );

  const folder = getFolderPath(result.file.path);
  const folderIndexes = result.pathIndexes
    ? result.pathIndexes.filter((i) => i < folder.length)
    : null;

  const pathSpan = document.createElement("span");
  pathSpan.className = "wiki-link-item-path";
  pathSpan.innerHTML = highlightMatches(
    folder,
    folderIndexes && folderIndexes.length > 0
      ? folderIndexes
      : null,
  );

  fragment.appendChild(icon);
  fragment.appendChild(nameSpan);
  if (folder) fragment.appendChild(pathSpan);

  return fragment;
}

export const WikiLinkSuggestion = Extension.create({
  name: "wikiLinkSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<FileSearchResult, FileSearchResult>({
        pluginKey: wikiLinkPluginKey,
        editor: this.editor,

        findSuggestionMatch({ $position }) {
          const text = $position.parent.textBetween(
            0,
            $position.parentOffset,
            undefined,
            "￼",
          );
          if (!text) return null;

          const match = text.match(/\[\[([^\]]*?)$/);
          if (!match || match.index === undefined) return null;

          const from =
            $position.pos - $position.parentOffset + match.index;
          const to = $position.pos;
          if (from >= $position.pos) return null;

          return {
            range: { from, to },
            query: match[1],
            text: match[0],
          };
        },

        allow({ state, range }) {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;

          const textBefore = $from.parent.textBetween(
            0,
            $from.parentOffset,
            undefined,
            "￼",
          );
          if (textBefore.length > 0 && /\w$/.test(textBefore)) return false;
          return true;
        },

        items({ query }) {
          return searchFiles({
            query,
            files: cachedFiles,
            currentDocFolder,
          });
        },

        command({ editor, range, props }) {
          const filename = props.file.name.replace(/\.md$/i, "");
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: { filename, alias: null },
            })
            .run();
        },

        render() {
          const popup = new SuggestionPopup<FileSearchResult>({
            popupClass: "wiki-link-popup",
            itemClass: "wiki-link-item",
            emptyClass: "wiki-link-empty",
            emptyText: "No .md files found",
            renderItem: renderWikiLinkItem,
          });
          let resultListener: (() => void) | null = null;

          return {
            onStart(
              props: SuggestionProps<FileSearchResult, FileSearchResult>,
            ) {
              popup.onStart(props);

              document.dispatchEvent(new CustomEvent("wiki-link-search"));

              const handler = () => {
                popup.setItems(
                  searchFiles({
                    query: popup.query,
                    files: cachedFiles,
                    currentDocFolder,
                  }),
                );
              };
              document.addEventListener("wiki-link-results", handler);
              resultListener = () => {
                document.removeEventListener("wiki-link-results", handler);
              };
            },

            onUpdate(
              props: SuggestionProps<FileSearchResult, FileSearchResult>,
            ) {
              popup.onUpdate(props);
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              return popup.onKeyDown(props);
            },

            onExit() {
              resultListener?.();
              resultListener = null;

              popup.onExit();

              cachedFiles = [];
            },
          };
        },
      }),
    ];
  },
});

// --- WikiLink Node Definition (unchanged) ---

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,

  // Tell @tiptap/markdown which MarkedJS token type this extension handles
  markdownTokenName: "wikiLink",

  // Register custom inline tokenizer with MarkedJS via @tiptap/markdown bridge
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline" as const,
    start: "[[",
    tokenize(src: string) {
      const match = src.match(/^\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/);
      if (!match) return undefined;

      return {
        type: "wikiLink",
        raw: match[0],
        filename: match[1].trim(),
        alias: match[2]?.trim() || null,
        tokens: [],
      };
    },
  },

  // Parse MarkedJS token -> ProseMirror node
  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("wikiLink", {
      filename: token.filename || "",
      alias: token.alias || null,
    });
  },

  // Serialize ProseMirror node -> markdown string
  renderMarkdown(node: any) {
    const filename = node.attrs?.filename || "";
    if (!filename) return "";
    const alias = node.attrs?.alias;
    if (alias) return `[[${filename}|${alias}]]`;
    return `[[${filename}]]`;
  },

  addAttributes() {
    return {
      filename: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wiki-link]",
        getAttrs: (el: HTMLElement) => ({
          filename: el.getAttribute("data-filename"),
          alias: el.getAttribute("data-alias") || null,
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const filename = node.attrs.filename as string;
    const alias = node.attrs.alias as string | null;
    const displayText = alias || filename || "";

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        "data-filename": filename,
        ...(alias ? { "data-alias": alias } : {}),
        class: "wiki-link",
      }),
      ["span", { class: "wiki-link-icon" }],
      displayText,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("span");
      const attrs = mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        "data-filename": node.attrs.filename,
        ...(node.attrs.alias ? { "data-alias": node.attrs.alias } : {}),
        class: "wiki-link",
      });
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) dom.setAttribute(key, value);
      }

      const icon = document.createElement("span");
      icon.className = "wiki-link-icon";
      icon.innerHTML = WIKI_LINK_ICON_SVG;
      dom.appendChild(icon);

      const text = document.createTextNode(node.attrs.alias || node.attrs.filename || "");
      dom.appendChild(text);

      return { dom };
    };
  },
});
