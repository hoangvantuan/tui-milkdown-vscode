/**
 * Slash command seam: what each menu entry inserts, as markdown.
 *
 * Exercises executeSlashCommand from src/webview/slash-command-plugin.ts
 * against an editor built with SlashCommand.
 *
 * Observes the resulting node and serialized markdown string after each
 * slash command menu entry runs on an empty document, recorded one line per entry.
 */
import { createHarnessEditor } from "./editor";
import {
  SlashCommand,
  SLASH_COMMAND_ITEMS,
  executeSlashCommand,
} from "../src/webview/slash-command-plugin";

export function runSlashSeam(): string {
  const lines: string[] = [
    "slash command seam — markdown output per menu entry on empty document",
    "one line per entry: [id] ok=... node=... md=...",
    "",
  ];

  for (const item of SLASH_COMMAND_ITEMS) {
    const { editor, dispose } = createHarnessEditor({
      content: "/",
      extraExtensions: [SlashCommand],
    });
    try {
      editor.commands.setTextSelection(2);
      const ok = executeSlashCommand(editor, item.id, { from: 1, to: 2 });
      const first = editor.state.doc.firstChild;
      let nodeDesc = first ? first.type.name : "none";
      if (first?.attrs?.level) {
        nodeDesc += `(h${first.attrs.level})`;
      } else if (first?.attrs?.type) {
        nodeDesc += `(${first.attrs.type})`;
      } else if (first?.attrs?.language) {
        nodeDesc += `(${first.attrs.language})`;
      }
      const md = editor.getMarkdown();
      lines.push(`[${item.id}] ok=${ok} node=${nodeDesc} md=${JSON.stringify(md)}`);
    } finally {
      dispose();
    }
  }

  return lines.join("\n") + "\n";
}
