# An image wrapped in a link loses the link on markdown roundtrip

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #93's
sibling, issue #98. **Not filed upstream.** It lives here so the workaround in
`src/webview/markdown-destination.ts` can be re-checked against a future Tiptap
release without rediscovering why all three overrides exist.

- Packages: `@tiptap/extension-image`, `@tiptap/markdown`
- Reproduced on: 3.30.1 (all four `@tiptap/*` packages in this repo)

## Summary

`[![CI](badge.svg)](https://ci.example)`, the badge row most READMEs open with,
parses into an image carrying no link and serializes back as `![CI](badge.svg)`.
The link is gone after one save and never returns. This repository's own README
was losing its badge links on every save.

Three independent defects have to line up for this to happen. Fixing any two of
them is not enough, which is why the workaround has three parts.

## Root cause 1: the image node schema forbids the mark

`@tiptap/extension-image` declares no `marks` in its node spec. An `image` is a
leaf node, so it has no `content`, and ProseMirror then defaults its allowed
mark set to none (`""`) rather than to `_`. A `link` mark on an `image` is
rejected by the schema before any markdown code runs.

Proposed fix: `marks: 'link'` (or a configurable `marks`) on the Image node spec.

## Root cause 2: the parser drops marks on every non-text node

`MarkdownParser.applyMarkToContent`:

```js
applyMarkToContent(markType, content, attrs) {
  return content.map((node) => {
    if (node.type === "text") {
      const existingMarks = node.marks || [];
      const newMark = attrs ? { type: markType, attrs } : { type: markType };
      return { ...node, marks: [...existingMarks, newMark] };
    }
    return {
      ...node,
      content: node.content ? this.applyMarkToContent(markType, node.content, attrs) : void 0
    };
  });
}
```

marked parses `[![alt](src)](url)` into a `link` token containing an `image`
token, and `Link.parseMarkdown` calls `applyMark` on the parsed inline nodes.
The child node is `{ type: "image" }`, so `node.type === "text"` is false and
`node.content` is undefined: the recursion reaches nothing and the mark is
dropped silently. Note the second branch also rewrites `content` to `undefined`
on every leaf it touches.

Proposed fix: apply the mark to any inline leaf node that permits marks, not
only to text.

```js
if (node.type === "text" || !node.content) {
  const existingMarks = node.marks || [];
  const newMark = attrs ? { type: markType, attrs } : { type: markType };
  return { ...node, marks: [...existingMarks, newMark] };
}
```

## Root cause 3: the serializer only reads marks on text nodes

`MarkdownSerializer.renderNodesWithMarkBoundaries` opens and closes marks inside
`if (node.type === "text") { ... }`. A non-text node is handed to
`renderNodeToMarkdown` with no mark context at all, so even a correctly-marked
image node serializes without its link: only `activeMarks` carried over from
preceding text nodes are closed and reopened around it.

Proposed fix: give `renderMarkdown` the node's own marks, or run the
mark-boundary logic for every node whose schema allows marks.

## Minimal reproduction

```ts
const editor = new Editor({
  extensions: [StarterKit, Image, Link, Markdown],
  content: "[![CI](badge.svg)](https://ci.example)",
  contentType: "markdown",
});

editor.getJSON();
// actual:   the image node has no `marks` array
// expected: marks: [{ type: "link", attrs: { href: "https://ci.example" } }]

editor.getMarkdown();
// actual:   ![CI](badge.svg)
// expected: [![CI](badge.svg)](https://ci.example)
```

## What we do instead

`src/webview/markdown-destination.ts`, one override per root cause:

1. `Image.extend({ marks: "link" })`
2. `MarkdownLink.parseMarkdown` recurses with `applyMarkToNodes`, which marks
   `text` **and** `image` nodes
3. `MarkdownImage.renderMarkdown` wraps its output in the enclosing link when a
   link mark is present

Pinned by `harness/fixtures/synthetic/image-in-link.md`: a badge row, a linked
image carrying both an image title and a link title, and a link destination
containing spaces. All three are byte-identical on roundtrip with the overrides
and all three are lossy without them.

When a future Tiptap release claims to fix any of this, drop the corresponding
override and run `npm run roundtrip`: that fixture is the test.
