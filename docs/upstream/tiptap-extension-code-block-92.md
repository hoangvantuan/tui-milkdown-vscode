# Code blocks with nested backticks lose their outer fence length on markdown roundtrip

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #92. **Not filed upstream.** It lives here so the workaround in `src/webview/main.ts` and `harness/editor.ts` can be re-checked against a future Tiptap release without rediscovering why the override exists.

- Packages: `@tiptap/extension-code-block`, `@tiptap/extension-code-block-lowlight`
- Reproduced on: 3.30.1 (all four `@tiptap/*` packages in this repo)

## Summary

In CommonMark and GitHub Flavored Markdown (GFM), code blocks can be fenced with three or more backticks (or tildes). When a code block contains code that includes three consecutive backticks (for instance, a markdown snippet illustrating a code block), the outer fence must use at least four backticks so that the inner backticks do not prematurely close the block.

When a document containing a 4-backtick fenced code block is parsed and re-serialized with `@tiptap/extension-code-block`, it is saved with a 3-backtick fence. On subsequent saves, the prematurely closed fence corrupts the document structure and spills the nested code into the outer document.

## Root cause: hardcoded 3-backtick fence in renderMarkdown

In `@tiptap/extension-code-block` (`src/code-block.ts` line 181):

```ts
  renderMarkdown: (node, h) => {
    let output = ''
    const language = node.attrs?.language || ''

    if (!node.content) {
      output = `\`\`\`${language}\n\n\`\`\``
    } else {
      const lines = [`\`\`\`${language}`, h.renderChildren(node.content), '```']
      output = lines.join('\n')
    }

    return output
  },
```

The serializer hardcodes ` ``` ` for both the opening and closing fence, regardless of how many backticks were present in the source or how many backticks exist inside the code block's text content.

## Minimal reproduction

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

const input = [
  "````markdown",
  "```javascript",
  "console.log('hello');",
  "```",
  "````",
].join("\n");

const editor = new Editor({
  extensions: [StarterKit, Markdown],
  content: input,
  contentType: "markdown",
});

const output = editor.getMarkdown();
// actual output:
// ```markdown
// ```javascript
// console.log('hello');
// ```
// ```
//
// On a second roundtrip, the inner fence closes the code block at line 4,
// breaking the document on subsequent saves.
//
// expected output:
// ````markdown
// ```javascript
// console.log('hello');
// ```
// ````
```

## Proposed upstream fix

Compute the maximum run of backticks contained in the code block content, and make the fence at least `Math.max(3, maxBackticks + 1)` backticks long:

```ts
  renderMarkdown: (node, h) => {
    const language = node.attrs?.language || ''
    const text = node.content ? h.renderChildren(node.content) : ''
    const backtickMatches = text.match(/`+/g) || []
    let maxBackticks = 0
    for (const m of backtickMatches) {
      if (m.length > maxBackticks) maxBackticks = m.length
    }
    const fenceLength = Math.max(3, maxBackticks + 1)
    const fence = '`'.repeat(fenceLength)
    return `${fence}${language}\n${text}\n${fence}`
  },
```

## What we do instead

In `src/webview/main.ts` and mirrored in `harness/editor.ts`, we extend `CodeBlockLowlight` with a custom `renderMarkdown` hook implementing the dynamic fence sizing above:

```ts
CodeBlockLowlight.extend({
  renderMarkdown(node: any, h: any) {
    const language = node.attrs?.language || '';
    const text = node.content ? h.renderChildren(node.content) : '';
    const backtickMatches = text.match(/`+/g) || [];
    let maxBackticks = 0;
    for (const m of backtickMatches) {
      if (m.length > maxBackticks) maxBackticks = m.length;
    }
    const fenceLength = Math.max(3, maxBackticks + 1);
    const fence = '`'.repeat(fenceLength);
    return `${fence}${language}\n${text}\n${fence}`;
  },
}).configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: 2,
})
```
