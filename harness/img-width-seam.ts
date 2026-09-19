/**
 * Image width seam: how an image with a width attribute parses and serializes.
 *
 * Records parse and serialize for:
 *   1. ![a](x.png) (plain markdown image)
 *   2. <img src="x.png" width="200"> (HTML img with width)
 *   3. <img src="x.png" alt="c" width="200" height="100"> (HTML img with alt, width, height)
 *   4. <img src="x.png" align="left"> (must STAY raw HTML)
 *   5. an inline one inside a paragraph
 *   6. a linked image with a width
 */
import { createHarnessEditor } from "./editor";

interface ImgCase {
  label: string;
  note: string;
  markdown: string;
}

const CASES: ImgCase[] = [
  {
    label: "plain-markdown-image",
    note: "plain markdown image without width or height",
    markdown: "![a](x.png)\n",
  },
  {
    label: "html-img-width",
    note: "HTML img with width attribute only",
    markdown: '<img src="x.png" width="200">\n',
  },
  {
    label: "html-img-alt-width-height",
    note: "HTML img with alt, width and height attributes",
    markdown: '<img src="x.png" alt="c" width="200" height="100">\n',
  },
  {
    label: "html-img-unmodeled-align",
    note: "HTML img with unmodeled align attribute, must stay rawHtmlBlock",
    markdown: '<img src="x.png" align="left">\n',
  },
  {
    label: "inline-img-paragraph",
    note: "inline HTML img inside a paragraph, preserved as rawHtmlInline",
    markdown: 'text <img src="x.png" width="200"> tail\n',
  },
  {
    label: "linked-img-with-width",
    note: "linked image with width attribute, link mark preserved (#124)",
    markdown: '[<img src="a.png" width="200">](https://x)\n',
  },
];

interface NodeSummary {
  type: string;
  attrs: Record<string, unknown>;
  marks: string[];
}

function collectImageNodes(doc: any): NodeSummary[] {
  const list: NodeSummary[] = [];
  doc.descendants((node: any) => {
    if (
      node.type.name === "image" ||
      node.type.name === "rawHtmlBlock" ||
      node.type.name === "rawHtmlInline"
    ) {
      const marks = (node.marks || []).map((m: any) => {
        const typeName = typeof m.type === "string" ? m.type : m.type?.name;
        return `${typeName}:${JSON.stringify(m.attrs || {})}`;
      });
      list.push({
        type: node.type.name,
        attrs: { ...node.attrs },
        marks,
      });
    }
  });
  return list;
}

export function runImgWidthSeam(): string {
  const out: string[] = [];
  out.push("# image width parse and serialization seam");
  out.push("");
  out.push("Records parse node representation and serialized markdown for");
  out.push("plain, sized, aligned, inline, and linked images.");
  out.push("");

  for (const testCase of CASES) {
    const { editor, dispose } = createHarnessEditor({
      content: testCase.markdown,
      contentType: "markdown",
    });
    try {
      const nodes = collectImageNodes(editor.state.doc);
      const serialized = editor.getMarkdown();

      out.push(`[${testCase.label}] ${testCase.note}`);
      out.push(`  input: ${testCase.markdown.trim()}`);
      for (const n of nodes) {
        const markStr = n.marks.length > 0 ? ` marks=[${n.marks.join(", ")}]` : "";
        out.push(`  parsed: node=${n.type} attrs=${JSON.stringify(n.attrs)}${markStr}`);
      }
      out.push(`  serialized: ${serialized.trim()}`);
      out.push("");
    } finally {
      dispose();
    }
  }

  return out.join("\n");
}
