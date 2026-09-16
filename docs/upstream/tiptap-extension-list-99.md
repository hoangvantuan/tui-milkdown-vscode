# Task item inside an ordered list (1. [ ] a) becomes escaped literal text on save

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #99.
**Not filed upstream.** It lives here so the workaround in
`src/webview/markdown-text-escape.ts` can be re-checked against a future Tiptap
release without rediscovering why the override exists.

- Package: `@tiptap/extension-list`
- Reproduced on: 3.30.1

## Problem

`TaskList`'s markdown tokenizer in `@tiptap/extension-list` matches only bullet markers: `/^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/`. `1. [ ] a` therefore parses as a plain ordered item whose text starts with `[ ]`, and the generic bracket escaping then saves it as `1. \[ \] a`:

| Input | Output |
| --- | --- |
| `1. [ ] a` | `1. \[ \] a` |
| `2. [x] b` | `2. \[x\] b` |

Stable across passes, so the checkbox is permanently downgraded to escaped literal text. GFM renders `1. [ ] a` as an interactive checkbox under an ordered marker.

## Root cause

`@tiptap/extension-list` only recognizes bullet markers (`-`, `+`, `*`) when tokenizing task lists. When encountering `1. [ ] a`, marked and `@tiptap/extension-list` treat it as an `orderedList` containing a `listItem` whose child paragraph starts with text `"[ ] a"`. During serialization, `@tiptap/markdown`'s `escapeMarkdownSyntax` unconditionally escapes `[` and `]`, emitting `1. \[ \] a`.

## Minimal reproduction

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";

const editor = new Editor({
  extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Markdown],
  content: "1. [ ] a\n2. [x] b",
  contentType: "markdown",
});

editor.getMarkdown();
// actual:   "1. \\[ \\] a\n2. \\[x\\] b"
// expected: "1. [ ] a\n2. [x] b"
```

## What we do instead

In `src/webview/markdown-text-escape.ts`:

We take the minimal non-invasive path: detect when a text node begins the first paragraph of an ordered list item (`orderedList > listItem > paragraph`) and starts with a valid task list item marker (`[ ] ` or `[x] `). In that context, we suppress escaping of the opening `[` and closing `]`, allowing the checkbox to serialize verbatim so GitHub Flavored Markdown continues rendering the checkbox.
