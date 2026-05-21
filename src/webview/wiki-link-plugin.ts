// src/webview/wiki-link-plugin.ts
import { Node, mergeAttributes, Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

export interface WikiFileItem {
  name: string;
  path: string;
}

let cachedFiles: WikiFileItem[] = [];

export function setWikiLinkFiles(files: WikiFileItem[]): void {
  cachedFiles = files;
  document.dispatchEvent(new CustomEvent("wiki-link-results"));
}

const wikiLinkPluginKey = new PluginKey("wikiLinkSuggestion");

function filterMdFiles(query: string, files: WikiFileItem[]): WikiFileItem[] {
  if (!query) return files.slice(0, 20);
  const q = query.toLowerCase();
  const prefixMatches: WikiFileItem[] = [];
  const containsMatches: WikiFileItem[] = [];

  for (const file of files) {
    const nameLower = file.name.toLowerCase();
    if (nameLower.startsWith(q)) {
      prefixMatches.push(file);
    } else if (nameLower.includes(q)) {
      containsMatches.push(file);
    }
  }
  return [...prefixMatches, ...containsMatches].slice(0, 20);
}

function getFolderPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : "";
}

export const WIKI_LINK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

export const WikiLinkSuggestion = Extension.create({
  name: "wikiLinkSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<WikiFileItem, WikiFileItem>({
        pluginKey: wikiLinkPluginKey,
        editor: this.editor,

        findSuggestionMatch({ $position }) {
          const text = $position.parent.textBetween(0, $position.parentOffset, undefined, "￼");
          if (!text) return null;

          const match = text.match(/\[\[([^\]]*?)$/);
          if (!match || match.index === undefined) return null;

          const from = $position.pos - $position.parentOffset + match.index;
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

          const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
          if (textBefore.length > 0 && /\w$/.test(textBefore)) return false;
          return true;
        },

        items({ query }) {
          return filterMdFiles(query, cachedFiles);
        },

        command({ editor, range, props }) {
          const filename = props.name.replace(/\.md$/i, "");
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
          let popup: HTMLDivElement | null = null;
          let items: WikiFileItem[] = [];
          let selectedIndex = 0;
          let commandFn: ((props: WikiFileItem) => void) | null = null;
          let resultListener: (() => void) | null = null;
          let currentQuery = "";

          function createPopup(): HTMLDivElement {
            const el = document.createElement("div");
            el.className = "wiki-link-popup";
            const container = document.getElementById("editor-container");
            (container || document.body).appendChild(el);
            return el;
          }

          function renderItems() {
            if (!popup) return;
            popup.innerHTML = "";

            if (items.length === 0) {
              const empty = document.createElement("div");
              empty.className = "wiki-link-empty";
              empty.textContent = "No .md files found";
              popup.appendChild(empty);
              return;
            }

            items.forEach((file, index) => {
              const row = document.createElement("div");
              row.className = "wiki-link-item";
              if (index === selectedIndex) row.classList.add("is-selected");

              const icon = document.createElement("span");
              icon.className = "wiki-link-item-icon";
              icon.innerHTML = WIKI_LINK_ICON_SVG;

              const nameSpan = document.createElement("span");
              nameSpan.className = "wiki-link-item-name";
              nameSpan.textContent = file.name.replace(/\.md$/i, "");

              const folder = getFolderPath(file.path);
              const pathSpan = document.createElement("span");
              pathSpan.className = "wiki-link-item-path";
              pathSpan.textContent = folder;

              row.appendChild(icon);
              row.appendChild(nameSpan);
              if (folder) row.appendChild(pathSpan);

              row.addEventListener("mousedown", (e) => {
                e.preventDefault();
                commandFn?.(file);
              });

              row.addEventListener("mouseenter", () => {
                selectedIndex = index;
                updateSelected();
              });

              popup!.appendChild(row);
            });
            scrollSelectedIntoView();
          }

          function updateSelected() {
            if (!popup) return;
            const rows = popup.querySelectorAll(".wiki-link-item");
            rows.forEach((row, i) => {
              row.classList.toggle("is-selected", i === selectedIndex);
            });
            scrollSelectedIntoView();
          }

          function scrollSelectedIntoView() {
            if (!popup) return;
            const selected = popup.querySelector(".wiki-link-item.is-selected");
            selected?.scrollIntoView({ block: "nearest" });
          }

          function positionPopup(
            clientRect: (() => DOMRect | null) | null | undefined
          ) {
            if (!popup || !clientRect) return;
            const rect = clientRect();
            if (!rect) return;
            const container = document.getElementById("editor-container");
            if (!container) return;
            const containerRect = container.getBoundingClientRect();
            popup.style.position = "absolute";
            popup.style.left = `${rect.left - containerRect.left}px`;
            popup.style.top = `${rect.bottom - containerRect.top + container.scrollTop}px`;
          }

          return {
            onStart(props: SuggestionProps<WikiFileItem, WikiFileItem>) {
              commandFn = props.command;
              items = props.items;
              selectedIndex = 0;
              currentQuery = props.query;

              popup = createPopup();
              positionPopup(props.clientRect);
              renderItems();

              document.dispatchEvent(new CustomEvent("wiki-link-search"));

              const handler = () => {
                items = filterMdFiles(currentQuery, cachedFiles);
                selectedIndex = 0;
                renderItems();
              };
              document.addEventListener("wiki-link-results", handler);
              resultListener = () => {
                document.removeEventListener("wiki-link-results", handler);
              };
            },

            onUpdate(props: SuggestionProps<WikiFileItem, WikiFileItem>) {
              commandFn = props.command;
              currentQuery = props.query;
              items = props.items;
              if (selectedIndex >= items.length) {
                selectedIndex = Math.max(0, items.length - 1);
              }
              positionPopup(props.clientRect);
              renderItems();
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              const { event } = props;

              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (items.length > 0) {
                  selectedIndex = (selectedIndex + 1) % items.length;
                  updateSelected();
                }
                return true;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (items.length > 0) {
                  selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                  updateSelected();
                }
                return true;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (items.length > 0 && items[selectedIndex]) {
                  commandFn?.(items[selectedIndex]);
                }
                return true;
              }
              if (event.key === "Escape") {
                return false;
              }
              return false;
            },

            onExit() {
              resultListener?.();
              resultListener = null;
              if (popup) {
                popup.remove();
                popup = null;
              }
              cachedFiles = [];
              commandFn = null;
              items = [];
              selectedIndex = 0;
            },
          };
        },
      }),
    ];
  },
});

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
