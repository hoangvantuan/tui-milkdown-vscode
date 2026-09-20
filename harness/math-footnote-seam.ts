/**
 * Math and footnote seam: what a formula and a footnote parse to and serialize back as.
 *
 * Records parse node representation and serialized markdown for:
 *   1. inline math ($\frac{a}{b}$, $\alpha$, $E = mc^2$)
 *   2. block math ($$\int_0^1 x^2 dx$$, single-line and multi-line)
 *   3. currency / whitespace ($5 and $10, $ not math $)
 *   4. footnote references ([^first], [^second], in paragraph and in table)
 *   5. footnote definitions ([^first]: ..., single-line and multi-line)
 *   6. unclosed footnote brackets (remains escaped plain text)
 */
import { createHarnessEditor } from "./editor";

interface SeamCase {
  label: string;
  note: string;
  markdown: string;
}

const CASES: SeamCase[] = [
  {
    label: "inline-math-fraction",
    note: "inline math with fraction and greek letter",
    markdown: "Fraction $\\frac{a}{b}$ and $\\alpha$.\n",
  },
  {
    label: "inline-math-equation",
    note: "inline math equation without special characters",
    markdown: "$E = mc^2$\n",
  },
  {
    label: "block-math-single-line",
    note: "single-line block math formula",
    markdown: "$$\\int_0^1 x^2 dx$$\n",
  },
  {
    label: "block-math-multi-line",
    note: "multi-line block math formula",
    markdown: "$$\n\\int_0^1 x^2 dx\n$$\n",
  },
  {
    label: "currency-not-math",
    note: "dollar amounts that must remain plain text",
    markdown: "It costs $5 and $10.\n",
  },
  {
    label: "space-delimiter-not-math",
    note: "dollar signs with whitespace that must remain plain text",
    markdown: "This is $ not math $ here.\n",
  },
  {
    label: "footnote-reference",
    note: "inline footnote references in paragraph",
    markdown: "Here is note[^first] and [^second].\n",
  },
  {
    label: "footnote-definition",
    note: "single-line footnote definition",
    markdown: "[^first]: First footnote definition.\n",
  },
  {
    label: "footnote-definition-multiline",
    note: "multi-line footnote definition",
    markdown: "[^second]: Second footnote definition, which is long and spans\nmultiple lines of text in the source.\n",
  },
  {
    label: "footnote-in-table",
    note: "footnote reference inside a table cell",
    markdown: "| Col |\n| --- |\n| Cell[^first] |\n",
  },
  {
    label: "unclosed-footnote-escaped",
    note: "unclosed footnote marker remains escaped text",
    markdown: "Literal [^abc without closing bracket.\n",
  },
];

interface NodeSummary {
  type: string;
  attrs: Record<string, unknown>;
}

function collectMathAndFootnoteNodes(doc: any): NodeSummary[] {
  const list: NodeSummary[] = [];
  doc.descendants((node: any) => {
    if (
      node.type.name === "inlineMath" ||
      node.type.name === "blockMath" ||
      node.type.name === "footnoteReference" ||
      node.type.name === "footnoteDefinition"
    ) {
      list.push({
        type: node.type.name,
        attrs: { ...node.attrs },
      });
    }
  });
  return list;
}

export function runMathFootnoteSeam(): string {
  const out: string[] = [];
  out.push("# math and footnote parse and serialization seam");
  out.push("");
  out.push("Records parse node representation and serialized markdown for");
  out.push("math formulas (inline and block) and footnotes (references and definitions).");
  out.push("");

  for (const testCase of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: testCase.markdown,
      contentType: "markdown",
    });
    try {
      const nodes = collectMathAndFootnoteNodes(editor.state.doc);
      const serialized = editor.getMarkdown();

      out.push(`[${testCase.label}] ${testCase.note}`);
      out.push(`  input: ${testCase.markdown.trim()}`);
      if (nodes.length === 0) {
        out.push("  parsed: (none)");
      } else {
        for (const n of nodes) {
          out.push(`  parsed: node=${n.type} attrs=${JSON.stringify(n.attrs)}`);
        }
      }
      out.push(`  serialized: ${serialized.trim()}`);
      out.push("");
    } finally {
      dispose();
    }
  }

  return out.join("\n");
}
