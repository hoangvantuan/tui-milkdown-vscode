/**
 * Code block seam: language, line numbers and wrap state as they survive a roundtrip.
 *
 * Records parse, view state (line numbers and wrap), and serialized markdown
 * for fenced code blocks. Proves that line numbers and wrap are view state only
 * and do not pollute or alter markdown serialization.
 */
import { createHarnessEditor } from "./editor";
import {
  setCodeBlockViewState,
  resetCodeBlockViewStates,
} from "../src/webview/code-block-plugin";

interface CodeBlockCase {
  label: string;
  note: string;
  markdown: string;
  viewState?: { lineNumbers: boolean; wrap: boolean };
}

const CASES: CodeBlockCase[] = [
  {
    label: "plain-codeblock",
    note: "plain fenced code block without language tag",
    markdown: "```\nconst a = 1;\n```\n",
  },
  {
    label: "fenced-with-language",
    note: "fenced code block with typescript language tag",
    markdown: "```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```\n",
  },
  {
    label: "multiline-linenumbers",
    note: "multiline code block with line numbers active in view state",
    markdown: "```python\ndef hello():\n    print(\"line 1\")\n    print(\"line 2\")\n```\n",
    viewState: { lineNumbers: true, wrap: false },
  },
  {
    label: "multiline-wrap",
    note: "multiline code block with wrap active in view state",
    markdown: "```bash\necho \"This is a long command line that wraps across multiple display lines\"\n```\n",
    viewState: { lineNumbers: false, wrap: true },
  },
  {
    label: "multiline-both",
    note: "multiline code block with both line numbers and wrap active in view state",
    markdown: "```javascript\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);\n```\n",
    viewState: { lineNumbers: true, wrap: true },
  },
  {
    label: "empty-codeblock",
    note: "empty code block preserves fences",
    markdown: "```\n```\n",
  },
  {
    label: "markdown-inside-codeblock",
    note: "markdown syntax inside code block remains verbatim content",
    markdown: "```markdown\n# Heading inside code\n- list item\n```\n",
    viewState: { lineNumbers: true, wrap: true },
  },
];

/** Render the seam as the text the golden records. */
export function runCodeBlockSeam(): string {
  const out: string[] = [];
  out.push("# codeblock seam");
  out.push("");
  out.push("Records parse, view state (line numbers and wrap), and serialized markdown");
  out.push("for fenced code blocks.");
  out.push("");

  resetCodeBlockViewStates();

  for (let i = 0; i < CASES.length; i++) {
    const testCase = CASES[i];
    const blockKey = `cb-${i}`;
    if (testCase.viewState) {
      setCodeBlockViewState(blockKey, testCase.viewState);
    }

    const { editor, dispose } = createHarnessEditor({
      content: testCase.markdown,
      contentType: "markdown",
    });

    try {
      let codeNode: any = null;
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === "codeBlock" && !codeNode) {
          codeNode = node;
        }
      });

      const serialized = editor.getMarkdown();
      const vs = testCase.viewState || { lineNumbers: false, wrap: false };

      out.push(`[${testCase.label}] ${testCase.note}`);
      out.push(`  input: ${testCase.markdown.trim().split("\n").join(" \\n ")}`);
      if (codeNode) {
        out.push(`  parsed: node=${codeNode.type.name} lang=${JSON.stringify(codeNode.attrs.language || "")}`);
      }
      out.push(`  view: lineNumbers=${vs.lineNumbers} wrap=${vs.wrap}`);
      out.push(`  serialized: ${serialized.trim().split("\n").join(" \\n ")}`);
      out.push("");
    } finally {
      dispose();
    }
  }

  resetCodeBlockViewStates();
  return out.join("\n");
}
