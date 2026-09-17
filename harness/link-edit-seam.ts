/**
 * Inline link editor seam: the markdown a link edit writes back.
 *
 * Exercises applyLinkEdit from src/webview/link-popover.ts against an editor
 * built from the same markdown-relevant extension set as the corpus seam,
 * and observes only the resulting markdown string.
 */
import { createHarnessEditor, roundtripMarkdown } from "./editor";
import { applyLinkEdit } from "../src/webview/link-popover";
import { NodeSelection } from "@tiptap/pm/state";

interface LinkEditCase {
  label: string;
  note: string;
  markdown: string;
  target: "text" | "image";
  targetText?: string;
  newHref: string;
  expected: string;
}

const CASES: LinkEditCase[] = [
  {
    label: "plain-url",
    note: "standard web URL",
    markdown: "Here is a [website](https://old.com) to visit.",
    target: "text",
    targetText: "website",
    newHref: "https://example.com",
    expected: "Here is a [website](https://example.com) to visit.",
  },
  {
    label: "path-containing-spaces",
    note: "space-containing destination must be wrapped in <...>",
    markdown: "Read the [manual](https://old.com) for details.",
    target: "text",
    targetText: "manual",
    newHref: "docs/getting started guide.md",
    expected: "Read the [manual](<docs/getting started guide.md>) for details.",
  },
  {
    label: "relative-path",
    note: "relative path with parent traversal",
    markdown: "Check [notes](./old.md) here.",
    target: "text",
    targetText: "notes",
    newHref: "../subfolder/notes.md",
    expected: "Check [notes](../subfolder/notes.md) here.",
  },
  {
    label: "empty-href",
    note: "empty href unlinks the text mark",
    markdown: "Click [unlink me](https://old.com) please.",
    target: "text",
    targetText: "unlink me",
    newHref: "",
    expected: "Click unlink me please.",
  },
  {
    label: "linked-image",
    note: "linked image destination edit",
    markdown: "[![banner](images/banner.png)](https://old-dest.com)",
    target: "image",
    newHref: "https://new-dest.com",
    expected: "[![banner](images/banner.png)](https://new-dest.com)",
  },
  {
    label: "linked-image-spaces",
    note: "linked image destination with spaces wrapped in <...>",
    markdown: "Here is [![logo](images/logo.png)](https://old-dest.com) above.",
    target: "image",
    newHref: "assets/my new logo.png",
    expected: "Here is [![logo](images/logo.png)](<assets/my new logo.png>) above.",
  },
  {
    label: "linked-image-empty-href",
    note: "empty href unlinks the image mark leaving plain image",
    markdown: "Here is [![icon](images/icon.png)](https://old-dest.com) above.",
    target: "image",
    newHref: "",
    expected: "Here is ![icon](images/icon.png) above.",
  },
];

function runCase(c: LinkEditCase): string[] {
  const { editor, dispose } = createHarnessEditor({ content: c.markdown });
  try {
    if (c.target === "image") {
      let imgPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (imgPos !== -1) return false;
        if (node.type.name === "image") {
          imgPos = pos;
        }
        return true;
      });
      if (imgPos === -1) {
        return ["  ERROR image node not found in fixture"];
      }
      editor.commands.setNodeSelection(imgPos);
    } else {
      let textPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (textPos !== -1) return false;
        if (node.isText && node.text?.includes(c.targetText || "")) {
          textPos = pos + 1;
        }
        return true;
      });
      if (textPos === -1) {
        return [`  ERROR text node ${JSON.stringify(c.targetText)} not found in fixture`];
      }
      editor.commands.setTextSelection(textPos);
    }

    applyLinkEdit(editor, c.newHref);

    const actual = editor.getMarkdown();
    const lines = [
      `  expected: ${JSON.stringify(c.expected)}`,
      `  actual:   ${JSON.stringify(actual)}`,
      `  matches:  ${actual === c.expected ? "yes" : "NO"}`,
    ];

    const once = roundtripMarkdown(actual);
    const twice = roundtripMarkdown(once);
    lines.push(`  survives a reload unchanged: ${once.trim() === actual.trim() ? "yes" : `NO -> ${JSON.stringify(once)}`}`);
    lines.push(`  reload is a fixpoint: ${twice.trim() === once.trim() ? "yes" : "NO"}`);
    return lines;
  } finally {
    dispose();
  }
}

export function runLinkEditSeam(): string {
  const lines: string[] = [
    "link-edit seam: applyLinkEdit (src/webview/link-popover.ts)",
    "observes the markdown string only: every 'yes' below is a verdict, not a measurement",
    "",
  ];

  for (const c of CASES) {
    lines.push(`[${c.label}] target=${c.target} newHref=${JSON.stringify(c.newHref)}`);
    lines.push(`note: ${c.note}`);
    lines.push(...runCase(c));
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
