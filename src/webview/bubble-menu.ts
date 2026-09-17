import { Editor, Extension } from "@tiptap/core";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";

export interface BubbleMenuOptions {
  onOpenLink: () => void;
}

/**
 * Creates the DOM element for the selection bubble menu.
 */
function createBubbleMenuDom(
  editor: Editor,
  onOpenLink: () => void,
): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "bubble-menu";

  const buttonsData = [
    {
      command: "bold",
      title: "Bold (Ctrl+B)",
      svg: '<svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      command: "italic",
      title: "Italic (Ctrl+I)",
      svg: '<svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      command: "code",
      title: "Inline Code (Ctrl+E)",
      svg: '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      action: () => editor.chain().focus().toggleCode().run(),
    },
    {
      command: "link",
      title: "Link",
      svg: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
      action: () => onOpenLink(),
    },
    {
      command: "highlight",
      title: "Highlight",
      svg: '<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
      action: () => editor.chain().focus().toggleHighlight().run(),
    },
  ];

  for (const item of buttonsData) {
    const btn = document.createElement("button");
    btn.className = "bubble-menu-btn";
    btn.dataset.command = item.command;
    btn.title = item.title;
    btn.setAttribute("aria-label", item.title);
    btn.innerHTML = item.svg;

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      item.action();
    });

    menu.appendChild(btn);
  }

  return menu;
}

/**
 * Updates the active states on bubble menu buttons.
 */
function updateButtonStates(editor: Editor, menu: HTMLElement): void {
  const buttons = menu.querySelectorAll<HTMLButtonElement>(".bubble-menu-btn[data-command]");
  for (const btn of buttons) {
    const cmd = btn.dataset.command;
    if (!cmd) continue;
    let isActive = false;
    if (cmd === "bold") isActive = editor.isActive("bold");
    else if (cmd === "italic") isActive = editor.isActive("italic");
    else if (cmd === "code") isActive = editor.isActive("code");
    else if (cmd === "link") isActive = editor.isActive("link");
    else if (cmd === "highlight") isActive = editor.isActive("highlight");

    btn.classList.toggle("is-active", isActive);
  }
}

/**
 * Creates the Tiptap BubbleMenu extension using @tiptap/extension-bubble-menu.
 * Anchors inside #editor-container to avoid CSS zoom coordinate artifacts.
 */
export function createBubbleMenuExtension(
  options: BubbleMenuOptions,
): Extension {
  let menuElement: HTMLDivElement | null = null;

  return Extension.create({
    name: "selectionBubbleMenu",

    addProseMirrorPlugins() {
      const editor = this.editor;
      menuElement = createBubbleMenuDom(editor, options.onOpenLink);

      const container = document.getElementById("editor-container");
      if (container) {
        container.appendChild(menuElement);
      } else {
        document.body.appendChild(menuElement);
      }

      return [
        BubbleMenuPlugin({
          pluginKey: "selectionBubbleMenu",
          editor,
          element: menuElement,
          appendTo: () => document.getElementById("editor-container") || document.body,
          options: {
            scrollTarget: document.getElementById("editor-container") || window,
            placement: "top",
            offset: 8,
            onUpdate: () => {
              if (menuElement) {
                updateButtonStates(editor, menuElement);
              }
            },
          },
          shouldShow: ({ state, from, to }) => {
            if (!editor.isEditable) return false;
            if (from === to) return false;
            if (editor.isActive("codeBlock")) return false;
            const { selection } = state;
            if (selection.empty) return false;
            const text = state.doc.textBetween(from, to).trim();
            if (!text) return false;
            return true;
          },
        }),
      ];
    },

    onDestroy() {
      menuElement?.remove();
      menuElement = null;
    },
  });
}
