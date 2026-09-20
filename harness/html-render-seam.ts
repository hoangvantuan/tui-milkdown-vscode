/**
 * HTML whitelist seam: what <details>, <kbd>, <sub> and <sup> parse to and serialize back as.
 *
 * Registered in harness/roundtrip.ts by the wave-8 coordinator.
 * Records parse node/mark representation and serialized markdown for:
 *   - <details>/<summary>
 *   - <kbd>
 *   - <sub>
 *   - <sup>
 *   - linked <kbd> ([<kbd>Ctrl</kbd> docs](url) and [<kbd>Ctrl</kbd>](url))
 *   - mixed inline marks (Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now., H<sub>2</sub>O and x<sup>2</sup>)
 */

import { createHarnessEditor } from "./editor";

interface HtmlTestCase {
  label: string;
  note: string;
  markdown: string;
}

const CASES: HtmlTestCase[] = [
  {
    label: "details-summary",
    note: "collapsible details block with summary and hidden body",
    markdown: "<details>\n<summary>More</summary>\n\nHidden\n\n</details>\n",
  },
  {
    label: "kbd-simple",
    note: "keyboard key tag parsed as mark",
    markdown: "<kbd>Ctrl</kbd>\n",
  },
  {
    label: "sub-simple",
    note: "subscript tag parsed as mark",
    markdown: "<sub>2</sub>\n",
  },
  {
    label: "sup-simple",
    note: "superscript tag parsed as mark",
    markdown: "<sup>2</sup>\n",
  },
  {
    label: "linked-kbd-with-text",
    note: "link wrapping kbd and text (upstream mark-around-atom test)",
    markdown: "[<kbd>Ctrl</kbd> docs](https://example.com)\n",
  },
  {
    label: "linked-kbd-only",
    note: "link wrapping kbd alone",
    markdown: "[<kbd>Ctrl</kbd>](https://example.com)\n",
  },
  {
    label: "inline-sentence",
    note: "inline sentence with multiple kbd caps and formula sub/sup",
    markdown: "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now. H<sub>2</sub>O and x<sup>2</sup>.\n",
  },
];

interface NodeDump {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: string[];
}

function dumpNodes(doc: any): NodeDump[] {
  const result: NodeDump[] = [];
  doc.descendants((node: any) => {
    const marks = (node.marks || []).map((m: any) => {
      const typeName = typeof m.type === "string" ? m.type : m.type?.name;
      const attrKeys = Object.keys(m.attrs || {});
      return attrKeys.length > 0
        ? `${typeName}:${JSON.stringify(m.attrs)}`
        : typeName;
    });

    const isLeafOrTarget =
      node.isText ||
      node.isAtom ||
      node.type.name === "details" ||
      node.type.name === "detailsSummary" ||
      node.type.name === "rawHtmlBlock" ||
      node.type.name === "rawHtmlInline";

    if (isLeafOrTarget) {
      const item: NodeDump = {
        type: node.type.name,
      };
      if (node.isText) {
        item.text = node.text;
      }
      if (node.attrs && Object.keys(node.attrs).length > 0) {
        item.attrs = { ...node.attrs };
      }
      if (marks.length > 0) {
        item.marks = marks;
      }
      result.push(item);
    }
  });
  return result;
}

/** Render the seam as the text the golden records. */
export function runHtmlRenderSeam(): string {
  const lines: string[] = [];
  lines.push("# html-render seam");
  lines.push("");
  lines.push("Records parse node/mark representation and serialized markdown for");
  lines.push("<details>, <summary>, <kbd>, <sub>, and <sup>.");
  lines.push("");

  for (const testCase of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: testCase.markdown,
      contentType: "markdown",
    });
    try {
      const nodes = dumpNodes(editor.state.doc);
      const serialized = editor.getMarkdown();

      lines.push(`[${testCase.label}] ${testCase.note}`);
      lines.push(`  input: ${JSON.stringify(testCase.markdown.trim())}`);
      for (const n of nodes) {
        const textStr = n.text !== undefined ? ` text=${JSON.stringify(n.text)}` : "";
        const attrStr = n.attrs ? ` attrs=${JSON.stringify(n.attrs)}` : "";
        const markStr = n.marks && n.marks.length > 0 ? ` marks=[${n.marks.join(", ")}]` : "";
        lines.push(`  parsed: node=${n.type}${textStr}${attrStr}${markStr}`);
      }
      lines.push(`  serialized: ${JSON.stringify(serialized.trim())}`);
      lines.push("");
    } finally {
      dispose();
    }
  }

  return lines.join("\n");
}
