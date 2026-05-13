import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

export interface FileItem {
  name: string;
  path: string;
}

// Module-level cache: populated by setFileMentionFiles(), cleared on popup close
let cachedFiles: FileItem[] = [];

/**
 * Called by main.ts when extension responds with fileSearchResults.
 * Populates the local cache so subsequent typing filters locally.
 */
export function setFileMentionFiles(files: FileItem[]): void {
  cachedFiles = files;
  // Notify popup if already open — dispatch event so render can re-filter
  document.dispatchEvent(new CustomEvent("file-mention-results"));
}

const fileMentionPluginKey = new PluginKey("fileMention");

/**
 * Fuzzy match filter:
 * - Prefix match on name or path gets priority
 * - Then contains match
 * - Case-insensitive
 * - Max 20 results
 */
function filterFiles(query: string, files: FileItem[]): FileItem[] {
  if (!query) return files.slice(0, 20);

  const q = query.toLowerCase();
  const prefixMatches: FileItem[] = [];
  const containsMatches: FileItem[] = [];

  for (const file of files) {
    const nameLower = file.name.toLowerCase();
    const pathLower = file.path.toLowerCase();

    if (nameLower.startsWith(q) || pathLower.startsWith(q)) {
      prefixMatches.push(file);
    } else if (nameLower.includes(q) || pathLower.includes(q)) {
      containsMatches.push(file);
    }
  }

  return [...prefixMatches, ...containsMatches].slice(0, 20);
}

/**
 * Extract folder path from full path (everything before the last /).
 * Returns empty string if no folder separator.
 */
function getFolderPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : "";
}

// File icon SVG (simple document icon)
const FILE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

/**
 * FileMention — Tiptap Extension for @-mention file autocomplete.
 *
 * Typing `@` triggers a popup with workspace files.
 * Selecting a file inserts `[filename](path)` as plain text,
 * which Tiptap Markdown parser auto-converts to a link node.
 */
export const FileMention = Extension.create({
  name: "fileMention",

  addProseMirrorPlugins() {
    return [
      Suggestion<FileItem, FileItem>({
        pluginKey: fileMentionPluginKey,
        editor: this.editor,
        char: "@",
        allowSpaces: false,

        // Prevent trigger inside code blocks
        allow({ state, range }) {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== "codeBlock";
        },

        // Return filtered items from cache
        items({ query }) {
          return filterFiles(query, cachedFiles);
        },

        // On selection: delete @query range, insert markdown link text
        command({ editor, range, props }) {
          const { name, path } = props;
          const linkText = `[${name}](${path})`;

          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(linkText, { contentType: "markdown" })
            .run();
        },

        render() {
          let popup: HTMLDivElement | null = null;
          let items: FileItem[] = [];
          let selectedIndex = 0;
          let commandFn: ((props: FileItem) => void) | null = null;
          let resultListener: (() => void) | null = null;
          let currentQuery = "";

          function createPopup(): HTMLDivElement {
            const el = document.createElement("div");
            el.className = "file-mention-popup";
            const container = document.getElementById("editor-container");
            if (container) {
              container.appendChild(el);
            } else {
              document.body.appendChild(el);
            }
            return el;
          }

          function renderItems() {
            if (!popup) return;
            popup.innerHTML = "";

            if (items.length === 0) {
              const empty = document.createElement("div");
              empty.className = "file-mention-empty";
              empty.textContent = "No files found";
              popup.appendChild(empty);
              return;
            }

            items.forEach((file, index) => {
              const row = document.createElement("div");
              row.className = "file-mention-item";
              if (index === selectedIndex) row.classList.add("is-selected");

              const icon = document.createElement("span");
              icon.className = "file-mention-icon";
              icon.innerHTML = FILE_ICON_SVG;

              const nameSpan = document.createElement("span");
              nameSpan.className = "file-mention-name";
              nameSpan.textContent = file.name;

              const folder = getFolderPath(file.path);
              const pathSpan = document.createElement("span");
              pathSpan.className = "file-mention-path";
              pathSpan.textContent = folder;

              row.appendChild(icon);
              row.appendChild(nameSpan);
              if (folder) row.appendChild(pathSpan);

              row.addEventListener("mousedown", (e) => {
                e.preventDefault(); // Prevent editor blur
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
            const rows = popup.querySelectorAll(".file-mention-item");
            rows.forEach((row, i) => {
              row.classList.toggle("is-selected", i === selectedIndex);
            });
            scrollSelectedIntoView();
          }

          function scrollSelectedIntoView() {
            if (!popup) return;
            const selected = popup.querySelector(".file-mention-item.is-selected");
            if (selected) {
              selected.scrollIntoView({ block: "nearest" });
            }
          }

          function positionPopup(clientRect: (() => DOMRect | null) | null | undefined) {
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
            onStart(props: SuggestionProps<FileItem, FileItem>) {
              commandFn = props.command;
              items = props.items;
              selectedIndex = 0;
              currentQuery = props.query;

              popup = createPopup();
              positionPopup(props.clientRect);
              renderItems();

              // Request file list from extension via CustomEvent
              document.dispatchEvent(new CustomEvent("file-mention-search"));

              // Listen for results arriving
              const handler = () => {
                items = filterFiles(currentQuery, cachedFiles);
                selectedIndex = 0;
                renderItems();
              };
              document.addEventListener("file-mention-results", handler);
              resultListener = () => {
                document.removeEventListener("file-mention-results", handler);
              };
            },

            onUpdate(props: SuggestionProps<FileItem, FileItem>) {
              commandFn = props.command;
              currentQuery = props.query;
              items = props.items;
              // Clamp selectedIndex to valid range
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
                return false; // Let suggestion handle dismissal
              }

              return false;
            },

            onExit() {
              // Cleanup result listener
              resultListener?.();
              resultListener = null;

              // Remove popup DOM
              if (popup) {
                popup.remove();
                popup = null;
              }

              // Clear cache
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
