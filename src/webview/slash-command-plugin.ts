/**
 * Slash command menu (/) for block insertion.
 *
 * Triggered at the start of an empty paragraph only. Built on @tiptap/suggestion
 * and drives SuggestionPopup<SlashCommandItem> appended to #editor-container
 * (unzoomed parent, per AGENTS.md coordinate convention).
 *
 * Inserts:
 *   - Heading 1, Heading 2, Heading 3
 *   - Bullet list, Numbered list, Task list
 *   - Table (3x3 with header row)
 *   - Code block
 *   - Mermaid diagram
 *   - Five GitHub alert blocks: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
 *   - Image
 *   - Collapsible (<details>/<summary>)
 *   - Quote
 *   - Horizontal rule (per #114 correction: replaces #84 "page break", serializes ---)
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import fuzzysort from "fuzzysort";
import { SuggestionPopup } from "./suggestion-popup";
import { insertDetails } from "./details-extension";

/**
 * How the Image entry obtains a path. `main.ts` wires this to the same input
 * box double-clicking an image opens; the harness leaves it null.
 */
let imageSrcProvider: ((onPicked: (src: string) => void) => void) | null = null;

export function setImageSrcProvider(
  provider: ((onPicked: (src: string) => void) => void) | null,
): void {
  imageSrcProvider = provider;
}

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  searchKeywords?: string;
  icon: string;
  command: (editor: Editor, range: Range) => void;
}

const SVG_ATTRS = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "heading-1",
    title: "Heading 1",
    description: "Large section heading",
    keywords: ["h1", "heading1", "title", "large"],
    icon: `<svg ${SVG_ATTRS}><path d="M4 12h8M4 6v12M12 6v12M17 12l3-3v9"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    id: "heading-2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "heading2", "subtitle", "medium"],
    icon: `<svg ${SVG_ATTRS}><path d="M4 12h8M4 6v12M12 6v12M21 18h-4c0-4 4-3 4-6 0-1.5-1-2.5-2.5-2.5S16 10.5 16 12"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    id: "heading-3",
    title: "Heading 3",
    description: "Small section heading",
    keywords: ["h3", "heading3", "subheading", "small"],
    icon: `<svg ${SVG_ATTRS}><path d="M4 12h8M4 6v12M12 6v12M17.5 10.5c.8-.7 2-1 2.5 0 .6 1.1-.3 2.5-1 2.5 1 .3 1.8 1.5 1.2 2.7-.6 1.1-2.2.8-2.7 0M16 18h4"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    id: "bullet-list",
    title: "Bullet List",
    description: "Unordered bulleted list",
    keywords: ["ul", "bullet", "list", "unordered"],
    icon: `<svg ${SVG_ATTRS}><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    id: "numbered-list",
    title: "Numbered List",
    description: "Ordered numbered list",
    keywords: ["ol", "number", "numbered", "list", "ordered"],
    icon: `<svg ${SVG_ATTRS}><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 7V4h1M4 13h2.5c0-1.5-1.5-1.5-1.5-2.5 0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5M4 19h3"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    id: "task-list",
    title: "Task List",
    description: "Checklist with checkboxes",
    keywords: ["todo", "task", "check", "checkbox", "list"],
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m5 8 1 1 2-2"/><line x1="13" y1="8" x2="21" y2="8"/><rect x="3" y="13" width="6" height="6" rx="1"/><line x1="13" y1="16" x2="21" y2="16"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    id: "table",
    title: "Table",
    description: "Insert a 3x3 table with headers",
    keywords: ["table", "grid", "rows", "columns"],
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    id: "code-block",
    title: "Code Block",
    description: "Fenced code block with syntax highlighting",
    keywords: ["code", "pre", "codeblock", "syntax"],
    icon: `<svg ${SVG_ATTRS}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    id: "mermaid",
    title: "Mermaid Diagram",
    description: "Flowchart, sequence or architecture diagram",
    keywords: ["mermaid", "diagram", "chart", "flowchart", "graph"],
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 8v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8M12 13v3"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "codeBlock",
        attrs: { language: "mermaid" },
      }).run();
    },
  },
  {
    id: "alert-note",
    title: "Note Alert",
    description: "Informational note block [!NOTE]",
    keywords: ["alert", "note", "callout", "info", "[!NOTE]"],
    icon: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "alert",
        attrs: { type: "NOTE" },
        content: [{ type: "paragraph" }],
      }).run();
    },
  },
  {
    id: "alert-tip",
    title: "Tip Alert",
    description: "Helpful advice or tip block [!TIP]",
    keywords: ["alert", "tip", "callout", "advice", "hint", "[!TIP]"],
    icon: `<svg ${SVG_ATTRS}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "alert",
        attrs: { type: "TIP" },
        content: [{ type: "paragraph" }],
      }).run();
    },
  },
  {
    id: "alert-important",
    title: "Important Alert",
    description: "Critical information block [!IMPORTANT]",
    keywords: ["alert", "important", "callout", "[!IMPORTANT]"],
    icon: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "alert",
        attrs: { type: "IMPORTANT" },
        content: [{ type: "paragraph" }],
      }).run();
    },
  },
  {
    id: "alert-warning",
    title: "Warning Alert",
    description: "Urgent warning block [!WARNING]",
    keywords: ["alert", "warning", "callout", "warn", "[!WARNING]"],
    icon: `<svg ${SVG_ATTRS}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "alert",
        attrs: { type: "WARNING" },
        content: [{ type: "paragraph" }],
      }).run();
    },
  },
  {
    id: "alert-caution",
    title: "Caution Alert",
    description: "Negative outcome alert block [!CAUTION]",
    keywords: ["alert", "caution", "callout", "danger", "risk", "[!CAUTION]"],
    icon: `<svg ${SVG_ATTRS}><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "alert",
        attrs: { type: "CAUTION" },
        content: [{ type: "paragraph" }],
      }).run();
    },
  },
  {
    id: "image",
    title: "Image",
    description: "Insert an image",
    keywords: ["image", "picture", "photo", "img"],
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      // Ask for the path FIRST. Inserting `setImage({ src: "" })` and leaving
      // it there is what made this entry look broken: an <img> with no src
      // renders nothing, so nothing appeared to happen.
      //
      // The fallback is deliberate rather than dead code: the harness editor
      // has no host to show an input box, so `harness/slash-seam.ts` still
      // records what this entry inserts, and its golden does not move.
      if (imageSrcProvider) {
        imageSrcProvider((src) => {
          if (src) editor.chain().focus().setImage({ src }).run();
        });
      } else {
        editor.chain().focus().setImage({ src: "" }).run();
      }
    },
  },
  {
    id: "details",
    title: "Collapsible",
    description: "Collapsible <details> block",
    // "more" is in here because that is the word the person who reported the
    // feature missing used for it. A menu entry nobody can name is still missing.
    keywords: [
      "details",
      "summary",
      "collapse",
      "collapsible",
      "expand",
      "fold",
      "toggle",
      "spoiler",
      "accordion",
      "more",
      "<details>",
    ],
    icon: `<svg ${SVG_ATTRS}><path d="m4 5 3 3-3 3"/><line x1="11" y1="8" x2="20" y2="8"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="4" y1="19" x2="16" y2="19"/></svg>`,
    command: (editor, range) => {
      insertDetails(editor, range);
    },
  },
  {
    id: "quote",
    title: "Quote",
    description: "Blockquote block",
    keywords: ["quote", "blockquote", "citation"],
    icon: `<svg ${SVG_ATTRS}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5-1.5 4-3 5M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5-1.5 4-3 5"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    id: "horizontal-rule",
    title: "Horizontal Rule",
    description: "Divider line (---)",
    keywords: ["horizontal", "rule", "divider", "line", "hr", "separator", "page", "break"],
    icon: `<svg ${SVG_ATTRS}><line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="4 2"/></svg>`,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

// Precompute combined keywords string for fuzzysort
for (const item of SLASH_COMMAND_ITEMS) {
  item.searchKeywords = item.keywords.join(" ");
}

/** Filter slash command items using fuzzysort */
export function filterSlashCommands(query: string): SlashCommandItem[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return SLASH_COMMAND_ITEMS;
  }

  const results = fuzzysort.go(trimmed, SLASH_COMMAND_ITEMS, {
    keys: ["title", "description", "searchKeywords"],
    threshold: 0,
  });

  return results.map((r) => r.obj);
}

/**
 * Execute a slash command by id.
 * Returns false if the slashCommand extension is not present on the editor,
 * or if the item id is unknown.
 * Exported for harness/slash-seam.ts.
 */
export function executeSlashCommand(
  editor: Editor,
  itemId: string,
  range?: Range,
): boolean {
  const hasExtension = editor.extensionManager.extensions.some(
    (ext) => ext.name === "slashCommand",
  );
  if (!hasExtension) return false;

  const item = SLASH_COMMAND_ITEMS.find((i) => i.id === itemId);
  if (!item) return false;

  const targetRange = range ?? {
    from: 1,
    to: editor.state.doc.content.size > 0 ? 1 : 1,
  };
  item.command(editor, targetRange);
  return true;
}

function renderSlashCommandItem(item: SlashCommandItem): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const iconSpan = document.createElement("span");
  iconSpan.className = "slash-command-icon";
  iconSpan.innerHTML = item.icon;

  const contentDiv = document.createElement("div");
  contentDiv.className = "slash-command-content";

  const titleSpan = document.createElement("span");
  titleSpan.className = "slash-command-title";
  titleSpan.textContent = item.title;

  const descSpan = document.createElement("span");
  descSpan.className = "slash-command-desc";
  descSpan.textContent = item.description;

  contentDiv.appendChild(titleSpan);
  contentDiv.appendChild(descSpan);

  fragment.appendChild(iconSpan);
  fragment.appendChild(contentDiv);

  return fragment;
}

const slashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        pluginKey: slashCommandPluginKey,
        editor: this.editor,
        char: "/",
        startOfLine: true,

        allow({ state, range }) {
          const $from = state.doc.resolve(range.from);
          // Trigger only at the start of an empty paragraph
          if ($from.parent.type.name !== "paragraph") return false;
          if ($from.parentOffset !== 0) return false;
          if ($from.parent.textContent.length !== range.to - range.from) return false;
          return true;
        },

        items({ query }) {
          return filterSlashCommands(query);
        },

        command({ editor, range, props }) {
          props.command(editor, range);
        },

        render() {
          const popup = new SuggestionPopup<SlashCommandItem>({
            popupClass: "slash-command-popup",
            itemClass: "slash-command-item",
            emptyClass: "slash-command-empty",
            emptyText: "No matching commands",
            renderItem: renderSlashCommandItem,
          });

          return {
            onStart(props: SuggestionProps<SlashCommandItem, SlashCommandItem>) {
              popup.onStart(props);
            },
            onUpdate(props: SuggestionProps<SlashCommandItem, SlashCommandItem>) {
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
