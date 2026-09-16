# Escaped heading and list markers at line start (\# and 1\.) lose their backslash and change meaning on reopen

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #100.
**Not filed upstream.** It lives here so the workaround in
`src/webview/markdown-text-escape.ts` can be re-checked against a future Tiptap
release without rediscovering why the override exists.

- Package: `@tiptap/markdown`
- Reproduced on: 3.30.1

## Problem

Marked parses `\#` and `1\.` into text nodes with literal characters `#` and `1.`. However, `@tiptap/markdown`'s inline serializer only escapes the inline delimiter set `` [\\`*_[\]~] ``. It has no rule for text that begins a block construct:

| Input | Save 1 | Reopen |
| --- | --- | --- |
| `\# not heading` | `# not heading` | a real heading |
| `1\. not list` | `1. not list` | a real ordered list |

Lossy: the meaning changes on the next open.

## Root cause

In `@tiptap/markdown`:

```ts
escapeMarkdownSyntax(text: string): string {
  return text.replace(/([\\`*_[\]~])/g, "\\$1");
}
```

The inline serializer operates without knowledge of whether the text node begins a block construct. Characters like `#`, `.`, `-`, `+`, and `>` are not in the inline escape set because they are ordinary text characters mid-sentence. But at the beginning of a paragraph, list item, or table cell, unescaped `# ` or `1. ` triggers block syntax parsing in CommonMark / GFM.

## Minimal reproduction

```ts
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

const EscapeToken = Extension.create({
  name: "escapeToken",
  markdownTokenName: "escape",
  parseMarkdown(token, helpers) {
    return helpers.createTextNode(token.text || "");
  },
});

const editor = new Editor({
  extensions: [StarterKit, Markdown, EscapeToken],
  content: "\\# not heading\n\n1\\. not list",
  contentType: "markdown",
});

editor.getMarkdown();
// actual:   "# not heading\n\n1. not list"
// expected: "\\# not heading\n\n1\\. not list"
```

## What we do instead

In `src/webview/markdown-text-escape.ts`:

We track the active ancestor block context during serialization. When a text node is the first unformatted child at the start of a block (paragraph, list item, or table cell), we escape the construct-starting marker:
- ATX heading: `#{1,6} ` -> `\#...`
- Ordered list marker: `\d{1,9}[.)] ` -> `\d{1,9}\...`
- Bullet list marker: `[-+*] ` -> `\- ` or `\+ `
- Blockquote marker: `>` -> `\>`
- Thematic break: `---` -> `\---`

Characters occurring mid-line (such as `#1` or `1.` in the middle of a sentence) are strictly left unescaped.
