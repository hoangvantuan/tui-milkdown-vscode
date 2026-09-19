/**
 * Find-and-replace seam: document text after replace / replaceAll, per case.
 *
 * Exercises replaceCurrent, replaceAllMatches, and setCaseSensitivity from
 * src/webview/search-plugin.ts against an editor built with SearchPlugin.
 *
 * Covers:
 * - no match (replace and replaceAll)
 * - one match (replace and replaceAll)
 * - several matches (replace single match vs replace all)
 * - case sensitivity toggle off vs on
 * - replacement strings containing markdown syntax characters
 */
import { createHarnessEditor } from "./editor";
import {
  SearchPlugin,
  performSearch,
  setCaseSensitivity,
  replaceCurrent,
  replaceAllMatches,
} from "../src/webview/search-plugin";

interface ReplaceCase {
  label: string;
  initial: string;
  search: string;
  replace: string;
  caseSensitive: boolean;
  action: "replace" | "replaceAll";
}

const CASES: ReplaceCase[] = [
  {
    label: "no-match-replace",
    initial: "The quick brown fox jumps over the lazy dog.",
    search: "cat",
    replace: "tiger",
    caseSensitive: false,
    action: "replace",
  },
  {
    label: "no-match-replace-all",
    initial: "The quick brown fox jumps over the lazy dog.",
    search: "cat",
    replace: "tiger",
    caseSensitive: false,
    action: "replaceAll",
  },
  {
    label: "one-match-replace",
    initial: "Hello world from VS Code.",
    search: "world",
    replace: "friend",
    caseSensitive: false,
    action: "replace",
  },
  {
    label: "one-match-replace-all",
    initial: "Hello world from VS Code.",
    search: "world",
    replace: "friend",
    caseSensitive: false,
    action: "replaceAll",
  },
  {
    label: "several-matches-replace-one",
    initial: "foo bar foo baz foo",
    search: "foo",
    replace: "qux",
    caseSensitive: false,
    action: "replace",
  },
  {
    label: "several-matches-replace-all",
    initial: "foo bar foo baz foo",
    search: "foo",
    replace: "qux",
    caseSensitive: false,
    action: "replaceAll",
  },
  {
    label: "case-toggle-off",
    initial: "Case test: Foo foo FOO.",
    search: "foo",
    replace: "bar",
    caseSensitive: false,
    action: "replaceAll",
  },
  {
    label: "case-toggle-on",
    initial: "Case test: Foo foo FOO.",
    search: "foo",
    replace: "bar",
    caseSensitive: true,
    action: "replaceAll",
  },
  {
    label: "markdown-syntax-in-replacement",
    initial: "Normal text to be replaced here.",
    search: "replaced",
    replace: "**bold** and [link](<url>) and # h1",
    caseSensitive: false,
    action: "replace",
  },
  {
    label: "markdown-syntax-in-replacement-all",
    initial: "Alpha beta alpha gamma.",
    search: "alpha",
    replace: "*italic* and `code`",
    caseSensitive: false,
    action: "replaceAll",
  },
];

export function runReplaceSeam(): string {
  const lines: string[] = [
    "find-and-replace seam — document text after replace / replaceAll",
    "observes the markdown string after replacement operations",
    "",
  ];

  for (const c of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: c.initial,
      extraExtensions: [SearchPlugin],
    });
    try {
      if (c.caseSensitive) {
        setCaseSensitivity(editor, true);
      }
      performSearch(editor, c.search);
      let ok = false;
      if (c.action === "replace") {
        ok = replaceCurrent(editor, c.replace);
      } else {
        ok = replaceAllMatches(editor, c.replace);
      }
      const actual = editor.getMarkdown();
      lines.push(
        `[${c.label}] search=${JSON.stringify(c.search)} replace=${JSON.stringify(c.replace)} action=${c.action} caseSensitive=${c.caseSensitive} ok=${ok}`,
      );
      lines.push(`  initial: ${JSON.stringify(c.initial)}`);
      lines.push(`  actual:  ${JSON.stringify(actual)}`);
      lines.push("");
    } finally {
      dispose();
    }
  }

  return lines.join("\n") + "\n";
}
