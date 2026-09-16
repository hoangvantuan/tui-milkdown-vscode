/**
 * Keymap and input rules for Markdown list editing (#107).
 *
 * Registered after StarterKit and Table so it intercepts Tab and Shift-Tab
 * before Table's default cell navigation and StarterKit's list handling:
 *   1. First item: if immediately preceded by another list, indent item under
 *      that list's last item; otherwise swallow the key (focus stays in editor).
 *   2. Table cells: try sinking/lifting list items first; fall back to
 *      goToNextCell on Tab (at cell 1 or not in list) and goToPreviousCell
 *      on Shift-Tab (at top-level item or not in list).
 *   3. Sub-list type: when sinking from an ordered list, if a sub-list is
 *      created by this action, make it a bulletList (like Notion / Google Docs);
 *      if an ordered sub-list already exists, keep its type.
 *   4. Hand-typed marker: input rule absorbs `^\d{1,9}[.)] ` typed at the
 *      start of an item already inside an ordered list.
 */
import { Extension, InputRule } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { ReplaceAroundStep } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';

export function isInsideTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') {
      return true;
    }
  }
  return false;
}

export function goToNextTableCell(editor: Editor): boolean {
  if (editor.commands.goToNextCell()) {
    return true;
  }
  if (!editor.can().addRowAfter()) {
    return false;
  }
  return editor.chain().addRowAfter().goToNextCell().run();
}

export function customSinkListItem(editor: Editor): boolean {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, $to } = state.selection;
    let itemDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === 'listItem' || name === 'taskItem') {
        itemDepth = d;
        break;
      }
    }
    if (itemDepth === -1) return false;
    const itemType = $from.node(itemDepth).type;
    const range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild!.type === itemType);
    if (!range) return false;
    const startIndex = range.startIndex;
    if (startIndex === 0) return false;
    const parent = range.parent;
    const nodeBefore = parent.child(startIndex - 1);
    if (nodeBefore.type !== itemType) return false;

    const existingSubList = nodeBefore.lastChild && (
      nodeBefore.lastChild.type.name === 'orderedList' ||
      nodeBefore.lastChild.type.name === 'bulletList' ||
      nodeBefore.lastChild.type.name === 'taskList'
    ) ? nodeBefore.lastChild : null;

    const nestedBefore = existingSubList !== null;
    // If sinking from an orderedList and no sub-list exists yet, create a bulletList (#107 case 3).
    // If a sub-list already exists, preserve its existing list type.
    const targetListType = nestedBefore
      ? existingSubList.type
      : (parent.type.name === 'orderedList' ? state.schema.nodes.bulletList : parent.type);

    if (dispatch) {
      const inner = Fragment.from(nestedBefore ? itemType.create() : null);
      const slice = new Slice(
        Fragment.from(itemType.create(null, Fragment.from(targetListType.create(null, inner)))),
        nestedBefore ? 3 : 1,
        0,
      );
      const before = range.start;
      const after = range.end;
      const step = new ReplaceAroundStep(
        before - (nestedBefore ? 3 : 1),
        after,
        before,
        after,
        slice,
        1,
        true,
      );
      dispatch(state.tr.step(step).scrollIntoView());
    }
    return true;
  });
}

export function handleFirstItemIndent(editor: Editor, itemDepth: number, listDepth: number): boolean {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from } = state.selection;
    const listNode = $from.node(listDepth);
    const listStart = $from.before(listDepth);
    const $list = state.doc.resolve(listStart);
    const prevBlock = $list.nodeBefore;

    const isList = prevBlock && (
      prevBlock.type.name === 'orderedList' ||
      prevBlock.type.name === 'bulletList' ||
      prevBlock.type.name === 'taskList'
    );

    if (!isList) {
      // Preceding block is not a list (or at document start): swallow key so focus stays in editor.
      // Absolutely do not convert preceding paragraph or heading to list item (#107 case 1).
      return true;
    }

    if (dispatch) {
      const itemNode = $from.node(itemDepth);
      const itemStart = $from.before(itemDepth);
      const itemEnd = $from.after(itemDepth);

      const isOnlyItem = listNode.childCount === 1;
      const deleteFrom = isOnlyItem ? listStart : itemStart;
      const deleteTo = isOnlyItem ? $from.after(listDepth) : itemEnd;

      const tr = state.tr;
      tr.delete(deleteFrom, deleteTo);

      const lastItem = prevBlock.lastChild!;
      const prevSubList = lastItem.lastChild && (
        lastItem.lastChild.type.name === 'orderedList' ||
        lastItem.lastChild.type.name === 'bulletList' ||
        lastItem.lastChild.type.name === 'taskList'
      ) ? lastItem.lastChild : null;

      let insertPos: number;
      let nodeToInsert: any;
      if (prevSubList && prevSubList.type === listNode.type) {
        insertPos = listStart - 3;
        nodeToInsert = itemNode;
      } else {
        insertPos = listStart - 2;
        nodeToInsert = listNode.type.create(listNode.attrs, itemNode);
      }

      tr.insert(insertPos, nodeToInsert);
      let textPos = -1;
      tr.doc.descendants((node, pos) => {
        if (textPos === -1 && pos >= insertPos && node.isText) {
          textPos = pos;
        }
      });
      if (textPos !== -1) {
        tr.setSelection(TextSelection.create(tr.doc, textPos));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  });
}

/**
 * Input rule that absorbs manual ordered markers (e.g. `2. ` or `2) `)
 * typed at the start of a list item that is already inside an ordered list (#107 case 4).
 */
export const absorbOrderedListMarkerRule = new InputRule({
  find: /^(\d{1,9}[.)]\s)$/,
  handler: ({ state, range }) => {
    const { $from } = state.selection;
    let inOrderedList = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'orderedList') {
        inOrderedList = true;
        break;
      }
    }
    if (!inOrderedList) {
      return null;
    }
    // Delete the matched marker text so the item retains only its content
    state.tr.delete(range.from, range.to);
  },
});

export const ListKeymapExtension = Extension.create({
  name: 'listKeymapExtension',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const inTable = isInsideTable(state);

        let itemDepth = -1;
        for (let d = state.selection.$from.depth; d > 0; d--) {
          const name = state.selection.$from.node(d).type.name;
          if (name === 'listItem' || name === 'taskItem') {
            itemDepth = d;
            break;
          }
        }

        if (itemDepth !== -1) {
          const listDepth = itemDepth - 1;
          const indexInList = state.selection.$from.index(listDepth);

          if (indexInList > 0) {
            // Second or later item: sink list item
            if (customSinkListItem(editor)) {
              return true;
            }
          } else {
            // First item in list
            if (inTable) {
              // Inside table cell, first item falls through to goToNextCell
              return goToNextTableCell(editor);
            }
            // Outside table, nest into preceding list or swallow key
            return handleFirstItemIndent(editor, itemDepth, listDepth);
          }
        }

        if (inTable) {
          return goToNextTableCell(editor);
        }

        return false;
      },

      'Shift-Tab': ({ editor }) => {
        const { state } = editor;
        const inTable = isInsideTable(state);

        let itemDepth = -1;
        for (let d = state.selection.$from.depth; d > 0; d--) {
          const name = state.selection.$from.node(d).type.name;
          if (name === 'listItem' || name === 'taskItem') {
            itemDepth = d;
            break;
          }
        }

        if (itemDepth !== -1) {
          const itemNode = state.selection.$from.node(itemDepth);
          if (editor.commands.liftListItem(itemNode.type.name)) {
            return true;
          }
        }

        if (inTable) {
          return editor.commands.goToPreviousCell();
        }

        return false;
      },
    };
  },

  addInputRules() {
    return [
      absorbOrderedListMarkerRule,
    ];
  },
});
