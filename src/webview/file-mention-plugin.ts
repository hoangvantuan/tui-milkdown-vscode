import { Extension, type Editor, type Range } from "@tiptap/core";
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

export function setFileMentionFiles(
  files: FileItem[],
  docFolder?: string,
): void {
  cachedFiles = files;
  currentDocFolder = docFolder;
  document.dispatchEvent(new CustomEvent("file-mention-results"));
}

const fileMentionPluginKey = new PluginKey("fileMention");

/**
 * Replace `range` with a link to `file`, as an inline node.
 *
 * Inline, not a markdown string: `insertContent(md, { contentType: "markdown" })`
 * parses `[name](<path>)` into a *paragraph*, and Tiptap's insertContentAt only
 * widens the replaced range for a block when the parent textblock is empty.
 * Inserted into a paragraph that already has text, the block splits it and the
 * link lands on its own line. Handing it a text node with a link mark keeps the
 * insert inline wherever the caret is.
 *
 * Building the node directly also leaves escaping to MarkdownLink's
 * `renderMarkdown` on save, which escapes every markdown-significant character
 * in the link text, not just `]`.
 *
 * Exported for harness/filemention-seam.ts.
 */
export function insertFileMention(
  editor: Editor,
  range: Range,
  file: FileItem,
): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: "text",
      text: file.name,
      marks: [{ type: "link", attrs: { href: file.path } }],
    })
    .run();
}

function renderFileMentionItem(result: FileSearchResult): DocumentFragment {
  const fragment = document.createDocumentFragment();

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

  fragment.appendChild(icon);
  fragment.appendChild(nameSpan);
  if (folder) fragment.appendChild(pathSpan);

  return fragment;
}

export const FileMention = Extension.create({
  name: "fileMention",

  addProseMirrorPlugins() {
    return [
      Suggestion<FileSearchResult, FileSearchResult>({
        pluginKey: fileMentionPluginKey,
        editor: this.editor,
        char: "@",
        allowSpaces: true,

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
          insertFileMention(editor, range, props.file);
        },

        render() {
          const popup = new SuggestionPopup<FileSearchResult>({
            popupClass: "file-mention-popup",
            itemClass: "file-mention-item",
            emptyClass: "file-mention-empty",
            emptyText: "No files found",
            renderItem: renderFileMentionItem,
          });
          let resultListener: (() => void) | null = null;

          return {
            onStart(
              props: SuggestionProps<FileSearchResult, FileSearchResult>,
            ) {
              popup.onStart(props);

              document.dispatchEvent(
                new CustomEvent("file-mention-search"),
              );

              const handler = () => {
                popup.setItems(
                  searchFiles({
                    query: popup.query,
                    files: cachedFiles,
                    currentDocFolder,
                  }),
                );
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
