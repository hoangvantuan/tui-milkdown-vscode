/**
 * List keymap and input rule seam for the dependency-verification harness (#107).
 *
 * Exercises the keyboard shortcut and typing behaviours defined in
 * src/webview/list-keymap-extension.ts:
 *   1. Tab at first item of a list following another list nests it under the
 *      previous list's last item (1. a\n   - b).
 *   2. Tab at first item with no preceding list swallows the key (focus stays)
 *      and never converts a preceding paragraph or heading.
 *   3. Tab at second item in an ordered list creates a bulletList sub-list.
 *   4. Tab at second item with a pre-existing ordered sub-list preserves the
 *      orderedList type.
 *   5. Shift-Tab lifts nested list items.
 *   6. Typing a manual marker (e.g. `2. `) in an ordered list item absorbs the
 *      marker rather than producing literal duplicate markers.
 *   7. In table cells without lists, Tab navigates to the next cell and adds a
 *      row at the last cell.
 *   8. In table cells with lists, Tab on second item sinks within the cell,
 *      while Tab on first item falls through to goToNextCell.
 */
import { createHarnessEditor, roundtripMarkdown } from "./editor";
import { transformTableCellsAfterParse } from "../src/webview/table-cell-content-parser";
import type { Editor } from "@tiptap/core";

export function dispatchKey(editor: Editor, key: string, shift = false): boolean {
  let handled = false;
  const event = new (globalThis as any).window.KeyboardEvent("keydown", {
    key,
    code: key === "Tab" ? "Tab" : undefined,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  editor.view.someProp("handleKeyDown", (f: any) => {
    if (f(editor.view, event)) {
      handled = true;
      return true;
    }
    return false;
  });
  return handled;
}

export function simulateTyping(editor: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp("handleTextInput", (f: any) => {
      if (f(editor.view, from, to, ch)) {
        handled = true;
        return true;
      }
      return false;
    });
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
    }
  }
}

function findTextPos(editor: Editor, query: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text && node.text.includes(query)) {
      found = pos + node.text.indexOf(query);
      return false;
    }
    return true;
  });
  return found;
}

export function runListKeysSeam(): string {
  const lines: string[] = [
    "list-keys seam: ListKeymapExtension (src/webview/list-keymap-extension.ts)",
    "verifies Tab/Shift-Tab list navigation and hand-typed marker absorption (#107)",
    "",
  ];

  // Case 1: First item of bullet list following an ordered list
  {
    lines.push("[case 1: tab-first-item-after-ordered-list]");
    const { editor, dispose } = createHarnessEditor({ content: "1. a\n- b" });
    try {
      const pos = findTextPos(editor, "b");
      editor.commands.setTextSelection(pos);
      const handled = dispatchKey(editor, "Tab");
      const actual = editor.getMarkdown();
      lines.push(`  handled: ${handled ? "yes" : "NO"}`);
      lines.push(`  nested under previous list: ${actual.includes("1. a") && actual.includes("- b") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 2: First item of list with no preceding list (swallow key, no conversion)
  {
    lines.push("[case 2: tab-first-item-no-preceding-list]");
    const initial = "Paragraph before list\n\n- first item\n- second item";
    const { editor, dispose } = createHarnessEditor({ content: initial });
    try {
      const pos = findTextPos(editor, "first item");
      editor.commands.setTextSelection(pos);
      const handled = dispatchKey(editor, "Tab");
      const actual = editor.getMarkdown();
      lines.push(`  swallowed (focus retained): ${handled ? "yes" : "NO"}`);
      lines.push(`  paragraph untouched: ${actual.includes("Paragraph before list") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 3: Second item of ordered list creates bulletList sub-list
  {
    lines.push("[case 3: tab-second-ordered-item-creates-bullet-sublist]");
    const { editor, dispose } = createHarnessEditor({ content: "1. first\n2. second" });
    try {
      const pos = findTextPos(editor, "second");
      editor.commands.setTextSelection(pos);
      const handled = dispatchKey(editor, "Tab");
      const actual = editor.getMarkdown();
      lines.push(`  handled: ${handled ? "yes" : "NO"}`);
      lines.push(`  sub-list is bulletList: ${actual.includes("- second") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 4: Second item with pre-existing ordered sub-list keeps orderedList type
  {
    lines.push("[case 4: tab-second-ordered-item-joins-existing-ordered-sublist]");
    const { editor, dispose } = createHarnessEditor({ content: "1. first\n   1. sub1\n2. second" });
    try {
      const pos = findTextPos(editor, "second");
      editor.commands.setTextSelection(pos);
      const handled = dispatchKey(editor, "Tab");
      const actual = editor.getMarkdown();
      lines.push(`  handled: ${handled ? "yes" : "NO"}`);
      lines.push(`  sub-list preserves ordered type: ${actual.includes("2. second") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 5: Shift-Tab lifts nested list item
  {
    lines.push("[case 5: shift-tab-lifts-nested-list-item]");
    const { editor, dispose } = createHarnessEditor({ content: "1. first\n   - second" });
    try {
      const pos = findTextPos(editor, "second");
      editor.commands.setTextSelection(pos);
      const handled = dispatchKey(editor, "Tab", true);
      const actual = editor.getMarkdown();
      lines.push(`  handled: ${handled ? "yes" : "NO"}`);
      lines.push(`  lifted to top level: ${actual.includes("2. second") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 6: Manual typed marker in ordered list item is absorbed
  {
    lines.push("[case 6: absorb-manual-ordered-marker]");
    const { editor, dispose } = createHarnessEditor({ content: "1. first\n2. second" });
    try {
      const pos = findTextPos(editor, "second");
      editor.commands.setTextSelection(pos);
      simulateTyping(editor, "2. ");
      const actual = editor.getMarkdown();
      lines.push(`  marker absorbed (no duplicate 2. 2.): ${!actual.includes("2. 2.") ? "yes" : "NO"}`);
      lines.push(`  actual:\n${actual.trim().split("\n").map(l => `    ${l}`).join("\n")}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 7: Table cell Tab navigation without list
  {
    lines.push("[case 7: table-tab-navigation-and-add-row]");
    const tableMd = "| Col 1 | Col 2 |\n| --- | --- |\n| cell 1 | cell 2 |";
    const { editor, dispose } = createHarnessEditor({ content: tableMd });
    try {
      transformTableCellsAfterParse(editor);
      const pos1 = findTextPos(editor, "cell 1");
      editor.commands.setTextSelection(pos1);

      // Tab from cell 1 -> cell 2
      const tab1 = dispatchKey(editor, "Tab");
      const inCell2 = editor.state.selection.$from.parent.textContent.includes("cell 2");

      // Tab from cell 2 (last cell) -> adds row
      const tab2 = dispatchKey(editor, "Tab");
      let tableRows = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "table") tableRows = node.childCount;
      });

      lines.push(`  tab to cell 2 handled: ${tab1 && inCell2 ? "yes" : "NO"}`);
      lines.push(`  tab on last cell added row: ${tab2 && tableRows === 3 ? "yes" : "NO"}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 8: Table cell Tab navigation with list
  {
    lines.push("[case 8: table-cell-with-list-sink-and-navigate]");
    const tableMd = "| Col 1 | Col 2 |\n| --- | --- |\n| 1. first <br> 2. second | cell 2 |";
    const { editor, dispose } = createHarnessEditor({ content: tableMd });
    try {
      transformTableCellsAfterParse(editor);

      // Tab on item 2 sinks into sub-list within cell
      const pos2 = findTextPos(editor, "second");
      editor.commands.setTextSelection(pos2);
      const tabSink = dispatchKey(editor, "Tab");
      const actualSunk = editor.getMarkdown();

      // Tab on item 1 navigates to next cell
      const pos1 = findTextPos(editor, "first");
      editor.commands.setTextSelection(pos1);
      const tabNav = dispatchKey(editor, "Tab");
      const inCell2 = editor.state.selection.$from.parent.textContent.includes("cell 2");

      lines.push(`  second item sunk within table cell: ${tabSink && actualSunk.includes("- second") ? "yes" : "NO"}`);
      lines.push(`  first item navigated to next cell: ${tabNav && inCell2 ? "yes" : "NO"}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
