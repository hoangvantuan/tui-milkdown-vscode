import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Applies a link edit to the current editor selection.
 * Handles:
 * - Plain text links: extends mark range and sets href.
 * - Empty href: unsets link mark.
 * - Empty selection outside link: inserts link with href as text.
 * - Linked images: sets or updates the link mark on the image node.
 */
export function applyLinkEdit(editor: Editor, rawHref: string): void {
  let href = rawHref.trim();
  if (href.startsWith("<") && href.endsWith(">")) {
    href = href.slice(1, -1).trim();
  }

  const { selection } = editor.state;
  const linkType = editor.schema.marks.link;

  // Check if selection targets an image node
  let targetImagePos = -1;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    targetImagePos = selection.from;
  } else if (selection.to === selection.from + 1 && editor.state.doc.nodeAt(selection.from)?.type.name === "image") {
    targetImagePos = selection.from;
  } else if (linkType) {
    const nodeAfter = selection.$from.nodeAfter;
    const nodeBefore = selection.$from.nodeBefore;
    if (nodeAfter?.type.name === "image" && nodeAfter.marks.some((m) => m.type === linkType)) {
      targetImagePos = selection.$from.pos;
    } else if (nodeBefore?.type.name === "image" && nodeBefore.marks.some((m) => m.type === linkType)) {
      targetImagePos = selection.$from.pos - nodeBefore.nodeSize;
    }
  }

  if (targetImagePos !== -1 && linkType) {
    const imageNode = editor.state.doc.nodeAt(targetImagePos);
    if (imageNode) {
      const tr = editor.state.tr;
      for (const m of imageNode.marks) {
        if (m.type.name === "link") {
          tr.removeNodeMark(targetImagePos, m);
        }
      }
      if (href) {
        tr.addNodeMark(targetImagePos, linkType.create({ href }));
      }
      editor.view.dispatch(tr);
      return;
    }
  }

  // Empty href unlinks / removes link mark
  if (!href) {
    if (selection.empty) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    return;
  }

  // Empty selection not on an existing link: insert link text
  if (selection.empty && !editor.isActive("link")) {
    editor.chain().focus().insertContent({
      type: "text",
      text: href,
      marks: [{ type: "link", attrs: { href } }],
    }).run();
    return;
  }

  // Cursor inside existing link: extend mark range to full link and set href
  if (editor.isActive("link") && selection.empty) {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  } else {
    // Non-empty selection: set link on selection
    editor.chain().focus().setLink({ href }).run();
  }
}

export interface LinkPopoverController {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

/**
 * Initializes the inline link editor popover.
 * Attaches to the popover element in #editor-container.
 */
export function initLinkPopover(editor: Editor): LinkPopoverController {
  const popover = document.getElementById("link-popover");
  const input = document.getElementById("link-url-input") as HTMLInputElement | null;
  const applyBtn = document.getElementById("link-apply-btn");
  const unlinkBtn = document.getElementById("link-unlink-btn");
  const closeBtn = document.getElementById("link-close-btn");

  let openState = false;

  function close(): void {
    if (!openState || !popover) return;
    openState = false;
    popover.classList.add("hidden");
    editor.commands.focus();
  }

  function apply(): void {
    if (!input) return;
    const value = input.value;
    applyLinkEdit(editor, value);
    close();
  }

  function unlink(): void {
    applyLinkEdit(editor, "");
    close();
  }

  function open(): void {
    if (!popover || !input) return;

    // Extend selection if cursor is currently within a text link
    if (editor.isActive("link") && editor.state.selection.empty) {
      editor.chain().extendMarkRange("link").run();
    }

    const currentHref = (editor.getAttributes("link").href as string) || "";
    input.value = currentHref;

    if (unlinkBtn) {
      unlinkBtn.style.display = currentHref ? "flex" : "none";
    }

    const container = document.getElementById("editor-container");
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const selection = editor.state.selection;
    const coords = editor.view.coordsAtPos(selection.from);

    // Position popover below caret / selection
    const top = coords.bottom - containerRect.top + container.scrollTop + 6;
    let left = coords.left - containerRect.left;

    const popoverWidth = 320;
    const maxLeft = container.clientWidth - popoverWidth - 16;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (left < 8) left = 8;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.classList.remove("hidden");
    openState = true;

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  applyBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    apply();
  });

  unlinkBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    unlink();
  });

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    close();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!openState || !popover) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (popover.contains(target)) return;

    // Also avoid closing if clicking the toolbar link button
    const isToolbarLink = target.closest('.toolbar-btn[data-command="link"]');
    const isBubbleLink = target.closest('.bubble-menu-btn[data-command="link"]');
    if (isToolbarLink || isBubbleLink) return;

    close();
  });

  return {
    open,
    close,
    isOpen: () => openState,
  };
}
