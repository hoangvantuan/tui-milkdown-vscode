/**
 * Table column-width seam for the dependency-verification harness.
 *
 * Why this seam exists: issue #67 carries an acceptance box for "a table with
 * explicit column widths parses correctly", and the markdown string seam is
 * structurally blind to it — GFM table markdown has no width syntax, so the
 * serialized string is byte-identical whether widths were parsed or dropped.
 * That box was previously deferred to a human ("author such HTML in a real
 * session and inspect the editor's DOM attributes"). It does not need a human:
 * width parsing happens in `parseColwidth` inside `@tiptap/extension-table`,
 * which is pure DOM-in / attribute-out and runs perfectly well under jsdom.
 *
 * What is observed: HTML goes in through `setContent(html, {contentType:
 * 'html'})`, and the seam records the `colwidth` attribute of every cell from
 * `editor.getJSON()`, plus the `<col>` elements the editor renders back out.
 * These are node attributes on the public document JSON, not plugin state —
 * the same class of thing `getMarkdown()` is for the markdown seam.
 *
 * Two input shapes matter, and they exercise the two branches of
 * `parseColwidth`:
 *   1. `<colgroup><col width="…">` — the shape a pasted HTML table (from a
 *      browser, Word, Google Docs) actually carries. Reading it is the
 *      upstream fix that landed in the Tiptap 3.29 line; before it, widths
 *      on this shape were silently dropped.
 *   2. `colwidth="…"` on the cell — the shape Tiptap itself serializes after
 *      a column resize, i.e. what a saved-then-reloaded resized table looks
 *      like.
 *
 * A regression in either branch shows up as `colwidth: null` in the golden.
 */
import { createHarnessEditor } from "./editor";

interface ColwidthCase {
  label: string;
  note: string;
  html: string;
}

const CASES: ColwidthCase[] = [
  {
    label: "colgroup-col-width",
    note: "widths declared in <colgroup>, the shape pasted HTML tables carry",
    html:
      "<table>" +
      '<colgroup><col width="150"><col width="320"></colgroup>' +
      "<tbody>" +
      "<tr><th>Narrow</th><th>Wide</th></tr>" +
      "<tr><td>a</td><td>b</td></tr>" +
      "</tbody></table>",
  },
  {
    label: "cell-colwidth-attribute",
    note: "widths on the cells, the shape Tiptap emits after a column resize",
    html:
      "<table><tbody>" +
      '<tr><th colwidth="150">Narrow</th><th colwidth="320">Wide</th></tr>' +
      '<tr><td colwidth="150">a</td><td colwidth="320">b</td></tr>' +
      "</tbody></table>",
  },
  {
    label: "colgroup-partial",
    note: "only the first column carries a width; the rest must stay null",
    html:
      "<table>" +
      '<colgroup><col width="200"><col></colgroup>' +
      "<tbody>" +
      "<tr><th>Sized</th><th>Auto</th></tr>" +
      "<tr><td>a</td><td>b</td></tr>" +
      "</tbody></table>",
  },
  {
    label: "colspan-multi-width",
    note: "comma-separated colwidth across a merged cell",
    html:
      "<table><tbody>" +
      '<tr><th colspan="2" colwidth="150,320">Merged</th></tr>' +
      "<tr><td>a</td><td>b</td></tr>" +
      "</tbody></table>",
  },
  {
    label: "no-widths",
    note: "control: a plain table must report null everywhere",
    html:
      "<table><tbody>" +
      "<tr><th>One</th><th>Two</th></tr>" +
      "<tr><td>a</td><td>b</td></tr>" +
      "</tbody></table>",
  },
];

interface CellRecord {
  row: number;
  col: number;
  type: string;
  colspan: number;
  colwidth: string;
}

/** Walk the document JSON and report the width attributes of every cell. */
function collectCells(json: any): CellRecord[] {
  const cells: CellRecord[] = [];
  const table = (json?.content ?? []).find((n: any) => n.type === "table");
  if (!table) return cells;
  const rows = table.content ?? [];
  rows.forEach((row: any, rowIndex: number) => {
    (row.content ?? []).forEach((cell: any, colIndex: number) => {
      const colwidth = cell.attrs?.colwidth;
      cells.push({
        row: rowIndex,
        col: colIndex,
        type: cell.type,
        colspan: cell.attrs?.colspan ?? 1,
        colwidth: Array.isArray(colwidth) ? `[${colwidth.join(",")}]` : String(colwidth ?? null),
      });
    });
  });
  return cells;
}

/** The `<col …>` tags the editor renders back out, in source order. */
function renderedCols(html: string): string {
  const cols = html.match(/<col\b[^>]*>/g);
  return cols ? cols.join(" ") : "(none)";
}

export function runTableColwidthSeam(): string {
  const out: string[] = [];
  out.push("# table column width seam");
  out.push("");
  out.push("HTML in -> document attributes out, per case. `colwidth: null`");
  out.push("means the width was dropped during parsing.");
  out.push("");

  for (const testCase of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: testCase.html,
      contentType: "html",
    });
    try {
      const cells = collectCells(editor.getJSON());
      const html = editor.getHTML();
      const markdown = editor.getMarkdown();

      out.push(`[${testCase.label}] ${testCase.note}`);
      out.push(`  input: ${testCase.html}`);
      for (const cell of cells) {
        out.push(
          `  cell r${cell.row}c${cell.col} ${cell.type} colspan=${cell.colspan} colwidth=${cell.colwidth}`,
        );
      }
      out.push(`  rendered cols: ${renderedCols(html)}`);
      out.push(`  serialized markdown: ${JSON.stringify(markdown)}`);
      out.push("");
    } finally {
      dispose();
    }
  }

  out.push("Note: the `serialized markdown` lines are why the markdown corpus");
  out.push("cannot cover this — GFM has no width syntax, so those strings are");
  out.push("identical whether the widths above parsed or were dropped.");
  out.push("");

  return out.join("\n");
}
