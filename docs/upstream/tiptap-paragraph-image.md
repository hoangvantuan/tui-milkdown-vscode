# `@tiptap/extension-paragraph` lifts a lone image out of its paragraph unconditionally

Package: `@tiptap/extension-paragraph@3.30.1` (also `@tiptap/markdown@3.30.1`)
Found: 2026-09-17, by this repository's VS Code floor check, on its first run
after the check learned to open a document containing an image.

Not filed upstream. Following the convention in `AGENTS.md`, the report lives
here; check it against the release notes before removing the local override.

## The rule

`dist/index.js`, in the paragraph extension's `parseMarkdown`:

```js
parseMarkdown: (token, helpers) => {
  const tokens = token.tokens || [];
  if (tokens.length === 1 && tokens[0].type === "image") {
    return helpers.parseChildren([tokens[0]]);
  }
  ...
}
```

A markdown paragraph whose only child is an image is unwrapped, and the image
node is returned in the paragraph's place.

## Why it is wrong

The rule is correct for the package's own default, `Image` configured
`inline: false`, where the image is a block node and cannot sit inside a
paragraph. It is applied unconditionally, so it also fires when `Image` is
configured `inline: true`, and then it produces a document with an INLINE node
as a direct child of `doc`.

That document is invalid. `doc.check()` rejects it:

```
Invalid content for node doc: <image>
```

and the failure is not cosmetic. Building the editor view throws

```
[Tiptap] Update failed: Error: Called contentMatchAt on a node with invalid content
```

and nothing mounts at all. In this extension that meant every markdown file
with an image on its own line, which is most of them, opened to a blank editor.

## Reproduction

```js
const editor = new Editor({
  extensions: [/* ... */, Image.configure({ inline: true })],
  content: "![x](a.png)\n",
  contentType: "markdown",
});
editor.getJSON();       // { type: "doc", content: [ { type: "image", ... } ] }
editor.state.doc.check(); // throws: Invalid content for node doc: <image>
```

Marked itself is not at fault: its token stream for that input is
`[{ type: "paragraph", tokens: [{ type: "image", ... }] }]`, i.e. correctly
wrapped.

## The condition the rule is missing

Whether the `image` node is actually a block node. Upstream has that at hand:
the extension's `group()` already returns `this.options.inline ? "inline" : "block"`.

## What this repository does instead

`src/webview/markdown-destination.ts` exports `MarkdownParagraph`, which
intercepts the lone-image case and keeps the paragraph wrapper, and delegates
every other paragraph token to upstream's own implementation. Both
`src/webview/main.ts` and `harness/editor.ts` use it.

The flag it reads is the exported constant `IMAGE_IS_INLINE`, which is also what
both of them pass to `MarkdownImage.configure()`. An earlier version read
`this.editor.schema.nodes.image.isBlock` instead, and that is worth recording as
a trap: `this.editor` is undefined while the INITIAL content is parsed, so the
lookup silently took its default and the rule never ran on the path that
mattered. It still passed the floor check, because a later `setContent` does
have an editor. The teeth test caught it, not the green run.

## Note for whoever removes this override

The markdown roundtrip harness cannot see this defect. It measures a string
through an editor and never mounts a view or calls `doc.check()`, so the invalid
document serializes back to exactly the right text: with the override removed,
`npm run roundtrip` reports 52 passed, 0 failed, and `npm run verify:vscode-floor`
reports 6 failures. Use the floor check.
