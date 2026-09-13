/**
 * File-mention insert seam for the dependency-verification harness.
 *
 * Exercises insertFileMention from src/webview/file-mention-plugin.ts — the
 * body of the @-mention Suggestion `command` — against an editor built from
 * the same markdown-relevant extension set as the corpus seam, and observes
 * only the resulting markdown string.
 *
 * Why it exists: the insert used to go through
 * `insertContent(md, { contentType: "markdown" })`, which parses
 * `[name](<path>)` into a paragraph. Tiptap's insertContentAt widens the
 * replaced range for a block only when the parent textblock is empty, so
 * inserting into a paragraph that already had text split it and dropped the
 * link onto its own line. "mention alone on an empty line" is the case that
 * stayed correct throughout; it is kept here so a future regression can be
 * told apart from a change in the empty-parent path.
 *
 * Assertions are the markdown string plus a roundtrip fixpoint check, never
 * node structure — the same rule the rest of the harness follows.
 */
import { createHarnessEditor, roundtripMarkdown } from "./editor";
import { insertFileMention } from "../src/webview/file-mention-plugin";
import type { FileItem } from "../src/webview/file-search-utils";

interface InsertCase {
  label: string;
  note: string;
  /** Document body; must contain `mention` verbatim. */
  markdown: string;
  /** The "@query" text the suggestion plugin would hand over as `range`. */
  mention: string;
  file: FileItem;
  /** Markdown the insert must produce, in full. */
  expected: string;
}

const SPACED: FileItem = {
  name: "transcript.md",
  path: "docs/Cẩm nang GXD - transcript.md",
};

const SYNTAX_IN_NAME: FileItem = {
  name: "a]b*c_d[e.md",
  path: "docs/a]b*c_d[e.md",
};

const CASES: InsertCase[] = [
  {
    label: "list-item-with-text-before",
    note: "the reported bug: parent textblock already has content, so a block insert would split it",
    markdown: "- **Bài toán số 1:** @Cẩm",
    mention: "@Cẩm",
    file: SPACED,
    expected: "- **Bài toán số 1:** [transcript.md](<docs/Cẩm nang GXD - transcript.md>)\n",
  },
  {
    label: "paragraph-with-text-before",
    note: "minimised form of the same bug — the list is not load-bearing, the non-empty parent is",
    markdown: "Xem @Cẩm",
    mention: "@Cẩm",
    file: SPACED,
    expected: "Xem [transcript.md](<docs/Cẩm nang GXD - transcript.md>)",
  },
  {
    label: "mention-alone-empty-parent",
    note: "the case that was always correct — insertContentAt widens the range when the parent textblock is empty",
    markdown: "@Cẩm",
    mention: "@Cẩm",
    file: SPACED,
    expected: "[transcript.md](<docs/Cẩm nang GXD - transcript.md>)",
  },
  {
    label: "markdown-syntax-in-filename",
    note: "escaping belongs to MarkdownLink.renderMarkdown on save; the old string path escaped only ] and emitted a broken link",
    markdown: "Xem @a",
    mention: "@a",
    file: SYNTAX_IN_NAME,
    expected: "Xem [a\\]b\\*c\\_d\\[e.md](docs/a]b*c_d[e.md)",
  },
];

function runCase(testCase: InsertCase): string[] {
  const { editor, dispose } = createHarnessEditor({ content: testCase.markdown });
  try {
    // Locate the mention text the way the Suggestion plugin reports `range`.
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from !== -1) return false;
      if (node.isText && node.text) {
        const index = node.text.indexOf(testCase.mention);
        if (index !== -1) from = pos + index;
      }
      return true;
    });
    if (from === -1) {
      return [`  ERROR mention text ${JSON.stringify(testCase.mention)} not found in fixture`];
    }
    const range = { from, to: from + testCase.mention.length };
    // The caret sits right after the mention text, where the user typed it.
    editor.commands.setTextSelection(range.to);

    insertFileMention(editor, range, testCase.file);

    const actual = editor.getMarkdown();
    const lines = [
      `  expected: ${JSON.stringify(testCase.expected)}`,
      `  actual:   ${JSON.stringify(actual)}`,
      `  inline (link stays on the line it was inserted on): ${actual === testCase.expected ? "yes" : "NO"}`,
    ];

    // roundtripMarkdown() goes through reconstructContent(), which trims the
    // trailing newline getMarkdown() leaves on a list. Compare trimmed so the
    // check reports link fidelity, not that one formatting difference.
    const once = roundtripMarkdown(actual);
    const twice = roundtripMarkdown(once);
    lines.push(`  survives a reload unchanged: ${once.trim() === actual.trim() ? "yes" : `NO -> ${JSON.stringify(once)}`}`);
    lines.push(`  reload is a fixpoint: ${twice.trim() === once.trim() ? "yes" : "NO"}`);
    return lines;
  } finally {
    dispose();
  }
}

export function runFileMentionSeam(): string {
  const lines: string[] = [
    "file-mention insert seam — insertFileMention (src/webview/file-mention-plugin.ts)",
    "observes the markdown string only; every 'yes' below is a verdict, not a measurement",
    "",
  ];

  for (const testCase of CASES) {
    lines.push(`[${testCase.label}] fixture=${JSON.stringify(testCase.markdown)} file=${JSON.stringify(testCase.file.path)}`);
    lines.push(`note: ${testCase.note}`);
    lines.push(...runCase(testCase));
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
