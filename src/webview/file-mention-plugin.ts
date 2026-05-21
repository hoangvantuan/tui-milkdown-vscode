import { Extension } from "@tiptap/core";
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

let cachedFiles: FileItem[] = [];
let currentDocFolder: string | undefined;

export function setFileMentionFiles(
  files: FileItem[],
  docFolder?: string,
): void {
  cachedFiles = files;
  currentDocFolder = docFolder;
  document.dispatchEvent(new CustomEvent("file-mention-results"));
}

const fileMentionPluginKey = new PluginKey("fileMention");

export const FileMention = Extension.create({
  name: "fileMention",

  addProseMirrorPlugins() {
    return [
      Suggestion<FileSearchResult, FileSearchResult>({
        pluginKey: fileMentionPluginKey,
        editor: this.editor,
        char: "@",
        allowSpaces: false,

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
          const escapedName = props.file.name.replace(/\]/g, "\\]");
          const linkText = `[${escapedName}](<${props.file.path}>)`;

          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(linkText, { contentType: "markdown" })
            .run();
        },

        render() {
          let popup: HTMLDivElement | null = null;
          let items: FileSearchResult[] = [];
          let selectedIndex = 0;
          let commandFn: ((props: FileSearchResult) => void) | null = null;
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

            items.forEach((result, index) => {
              const row = document.createElement("div");
              row.className = "file-mention-item";
              if (index === selectedIndex) row.classList.add("is-selected");

              const icon = document.createElement("span");
              icon.className = "file-mention-icon";
              icon.innerHTML = getFileIcon(result.file.name);

              const nameSpan = document.createElement("span");
              nameSpan.className = "file-mention-name";
              nameSpan.innerHTML = highlightMatches(
                result.file.name,
                result.nameIndexes,
              );

              const folder = getFolderPath(result.file.path);
              const folderIndexes = result.pathIndexes
                ? result.pathIndexes.filter((i) => i < folder.length)
                : null;

              const pathSpan = document.createElement("span");
              pathSpan.className = "file-mention-path";
              pathSpan.innerHTML = highlightMatches(
                folder,
                folderIndexes && folderIndexes.length > 0
                  ? folderIndexes
                  : null,
              );

              row.appendChild(icon);
              row.appendChild(nameSpan);
              if (folder) row.appendChild(pathSpan);

              row.addEventListener("mousedown", (e) => {
                e.preventDefault();
                commandFn?.(result);
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
            const selected = popup.querySelector(
              ".file-mention-item.is-selected",
            );
            if (selected) {
              selected.scrollIntoView({ block: "nearest" });
            }
          }

          function positionPopup(
            clientRect: (() => DOMRect | null) | null | undefined,
          ) {
            if (!popup) return;
            let rect: DOMRect | null = null;
            if (clientRect) rect = clientRect();
            if (!rect) {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                rect = sel.getRangeAt(0).getBoundingClientRect();
              }
            }
            if (!rect) return;

            const container = document.getElementById("editor-container");
            if (!container) return;
            const containerRect = container.getBoundingClientRect();

            popup.style.position = "absolute";
            popup.style.left = `${rect.left - containerRect.left}px`;
            popup.style.top = `${rect.bottom - containerRect.top + container.scrollTop}px`;
          }

          return {
            onStart(
              props: SuggestionProps<FileSearchResult, FileSearchResult>,
            ) {
              commandFn = props.command;
              items = props.items;
              selectedIndex = 0;
              currentQuery = props.query;

              popup = createPopup();
              positionPopup(props.clientRect);
              renderItems();

              document.dispatchEvent(
                new CustomEvent("file-mention-search"),
              );

              const handler = () => {
                items = searchFiles({
                  query: currentQuery,
                  files: cachedFiles,
                  currentDocFolder,
                });
                selectedIndex = 0;
                renderItems();
              };
              document.addEventListener("file-mention-results", handler);
              resultListener = () => {
                document.removeEventListener(
                  "file-mention-results",
                  handler,
                );
              };
            },

            onUpdate(
              props: SuggestionProps<FileSearchResult, FileSearchResult>,
            ) {
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
                  selectedIndex =
                    (selectedIndex - 1 + items.length) % items.length;
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
