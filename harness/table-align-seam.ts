/**
 * Table alignment seam: the separator row a set-alignment command produces.
 *
 * Records the separator row produced after a set-alignment command, for each of
 * left / center / right / none, on both a header-row table and a table whose
 * alignment sits on a body row.
 */
import { createHarnessEditor } from "./editor";
import {
  setTableColumnAlignment,
  ColumnAlignment,
} from "../src/webview/table-context-menu";

interface AlignCase {
  label: string;
  note: string;
  content: string;
  contentType: "markdown" | "html";
  alignment: ColumnAlignment;
}

const CASES: AlignCase[] = [
  {
    label: "header-table-left",
    note: "set column 0 to left alignment on a table with a header row",
    content: "| Col1 | Col2 |\n| --- | --- |\n| Val1 | Val2 |\n",
    contentType: "markdown",
    alignment: "left",
  },
  {
    label: "header-table-center",
    note: "set column 0 to center alignment on a table with a header row",
    content: "| Col1 | Col2 |\n| --- | --- |\n| Val1 | Val2 |\n",
    contentType: "markdown",
    alignment: "center",
  },
  {
    label: "header-table-right",
    note: "set column 0 to right alignment on a table with a header row",
    content: "| Col1 | Col2 |\n| --- | --- |\n| Val1 | Val2 |\n",
    contentType: "markdown",
    alignment: "right",
  },
  {
    label: "header-table-none",
    note: "clear alignment (none) on column 0 from an aligned header row",
    content: "| Col1 | Col2 |\n| :--- | :--- |\n| Val1 | Val2 |\n",
    contentType: "markdown",
    alignment: "none",
  },
  {
    label: "body-table-left",
    note: "set column 0 to left alignment on a table whose alignment sits on a body row",
    content: "<table><tbody><tr><td>Body1</td><td>Body2</td></tr><tr><td>Val1</td><td>Val2</td></tr></tbody></table>",
    contentType: "html",
    alignment: "left",
  },
  {
    label: "body-table-center",
    note: "set column 0 to center alignment on a table whose alignment sits on a body row",
    content: "<table><tbody><tr><td>Body1</td><td>Body2</td></tr><tr><td>Val1</td><td>Val2</td></tr></tbody></table>",
    contentType: "html",
    alignment: "center",
  },
  {
    label: "body-table-right",
    note: "set column 0 to right alignment on a table whose alignment sits on a body row",
    content: "<table><tbody><tr><td>Body1</td><td>Body2</td></tr><tr><td>Val1</td><td>Val2</td></tr></tbody></table>",
    contentType: "html",
    alignment: "right",
  },
  {
    label: "body-table-none",
    note: "clear alignment (none) on column 0 from a table with pre-existing body-row alignment",
    content: '<table><tbody><tr><td>Body1</td><td>Body2</td></tr><tr><td align="center">Val1</td><td align="center">Val2</td></tr></tbody></table>',
    contentType: "html",
    alignment: "none",
  },
];

function extractSeparatorRow(markdown: string): string {
  const lines = markdown.trim().split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|[\s:\-|]+\|$/.test(trimmed) && trimmed.includes("-")) {
      return trimmed;
    }
  }
  return "(none)";
}

function findFirstCellPos(doc: any): number | undefined {
  let cellPos: number | undefined;
  doc.descendants((node: any, pos: number) => {
    if (cellPos !== undefined) return false;
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellPos = pos;
      return false;
    }
  });
  return cellPos;
}

export function runTableAlignSeam(): string {
  const out: string[] = [];
  out.push("# table alignment seam");
  out.push("");
  out.push("Records the separator row produced after setTableColumnAlignment");
  out.push("for left / center / right / none, on header-row and body-row tables.");
  out.push("");

  for (const testCase of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: testCase.content,
      contentType: testCase.contentType,
    });
    try {
      const cellPos = findFirstCellPos(editor.state.doc);
      setTableColumnAlignment(editor, testCase.alignment, cellPos);
      const markdown = editor.getMarkdown();
      const sep = extractSeparatorRow(markdown);

      out.push(`[${testCase.label}] ${testCase.note}`);
      out.push(`  alignment: ${testCase.alignment}`);
      out.push(`  separator: ${sep}`);
      out.push(`  markdown:`);
      for (const line of markdown.trim().split("\n")) {
        out.push(`    ${line}`);
      }
      out.push("");
    } finally {
      dispose();
    }
  }

  return out.join("\n");
}
