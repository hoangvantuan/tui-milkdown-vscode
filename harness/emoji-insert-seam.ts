/**
 * Emoji insert seam for the dependency-verification harness.
 *
 * Records what the emoji picker writes into the document, as markdown.
 *
 * Proves that:
 * 1. A shortcode picked from the menu inserts plain unicode text,
 * 2. A unicode character already in the document survives roundtrip verbatim
 *    and is NEVER converted to :shortcode: ("never how it is saved", #85),
 * 3. A shortcode typed but NOT picked survives roundtrip as literal text,
 * 4. Fuzzy search ranking through fuzzysort stably prioritizes emojis across
 *    names, shortcodes, and tags.
 */
import { createHarnessEditor, roundtripMarkdown } from "./editor";
import { insertEmoji, searchEmojis } from "../src/webview/emoji-plugin";
import { gitHubEmojis } from "@tiptap/extension-emoji";

interface EmojiInsertCase {
  label: string;
  note: string;
  markdown: string;
  trigger?: string;
  emoji?: string;
  expected: string;
}

const CASES: EmojiInsertCase[] = [
  {
    label: "shortcode-picked-from-menu",
    note: "picker replaces trigger query with unicode emoji",
    markdown: "Hello :smile",
    trigger: ":smile",
    emoji: "😄",
    expected: "Hello 😄",
  },
  {
    label: "shortcode-picked-in-paragraph",
    note: "picker replaces shortcode within surrounding text",
    markdown: "Celebration :tada: underway",
    trigger: ":tada:",
    emoji: "🎉",
    expected: "Celebration 🎉 underway",
  },
  {
    label: "shortcode-picked-in-list",
    note: "picker inserts inline unicode into a list item",
    markdown: "- Task with :heart:",
    trigger: ":heart:",
    emoji: "❤",
    expected: "- Task with ❤\n",
  },
  {
    label: "unicode-already-in-document",
    note: "existing unicode emoji is preserved and never converted to :shortcode:",
    markdown: "Unicode 😄 and 🎉 stay unicode, never :smile: or :tada:",
    expected: "Unicode 😄 and 🎉 stay unicode, never :smile: or :tada:",
  },
  {
    label: "shortcode-typed-not-picked",
    note: "literal shortcode typed without picking stays literal text",
    markdown: "Literal :smile: and :heart: left unpicked",
    expected: "Literal :smile: and :heart: left unpicked",
  },
];

const SEARCH_QUERIES = ["smile", "tada", "heart", "thumb", "fire"];

function runCase(testCase: EmojiInsertCase): string[] {
  const { editor, dispose } = createHarnessEditor({ content: testCase.markdown });
  try {
    if (testCase.trigger && testCase.emoji) {
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from !== -1) return false;
        if (node.isText && node.text) {
          const idx = node.text.indexOf(testCase.trigger!);
          if (idx !== -1) from = pos + idx;
        }
        return true;
      });
      if (from === -1) {
        return [`  ERROR trigger text ${JSON.stringify(testCase.trigger)} not found in fixture`];
      }
      const range = { from, to: from + testCase.trigger.length };
      editor.commands.setTextSelection(range.to);
      insertEmoji(editor, range, testCase.emoji);
    }

    const actual = editor.getMarkdown();
    const matchesExpected = actual === testCase.expected;
    const once = roundtripMarkdown(actual);
    const twice = roundtripMarkdown(once);
    const survivesReload = once.trim() === actual.trim();
    const isFixpoint = twice.trim() === once.trim();

    return [
      `  expected: ${JSON.stringify(testCase.expected)}`,
      `  actual:   ${JSON.stringify(actual)}`,
      `  matches expected: ${matchesExpected ? "yes" : "NO"}`,
      `  survives reload unchanged: ${survivesReload ? "yes" : `NO -> ${JSON.stringify(once)}`}`,
      `  reload is fixpoint: ${isFixpoint ? "yes" : "NO"}`,
    ];
  } finally {
    dispose();
  }
}

/** Render the seam as the text the golden records. */
export function runEmojiInsertSeam(): string {
  const lines: string[] = [
    "# emoji-insert seam — insertEmoji and searchEmojis (src/webview/emoji-plugin.ts)",
    "observes the markdown string only; every 'yes' below is a verdict, not a measurement",
    "",
  ];

  for (const testCase of CASES) {
    lines.push(`[${testCase.label}] fixture=${JSON.stringify(testCase.markdown)}`);
    lines.push(`note: ${testCase.note}`);
    lines.push(...runCase(testCase));
    lines.push("");
  }

  lines.push("--- fuzzy search ranking ---");
  for (const query of SEARCH_QUERIES) {
    const results = searchEmojis(query, gitHubEmojis, 3);
    const summary = results
      .map((r) => `${r.emoji.emoji} (:${r.emoji.name}: score=${r.score.toFixed(3)})`)
      .join(", ");
    lines.push(`query "${query}": ${summary}`);
  }
  lines.push("");

  return lines.join("\n");
}
