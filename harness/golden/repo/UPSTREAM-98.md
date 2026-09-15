# Upstream Bug Report: Image wrapped in link loses link mark during markdown parse and serialization

- **Repository**: ueberdosis/tiptap (packages: `@tiptap/extension-image`, `@tiptap/markdown`)
- **Title**: An image wrapped in a link `[![alt](src)](url)` loses the link on markdown roundtrip
- **Affected versions**: `@tiptap/extension-image` 3.30.1, `@tiptap/markdown` 3.30.1 (and earlier 3.x)

## Summary

When an image is wrapped in a markdown link (e.g. badge rows `[![CI](badge.svg)](https://ci.example)` commonly found in READMEs), the link is completely stripped upon parsing and saving.

## Root Cause Analysis

There are three distinct issues in the upstream packages that prevent linked images from functioning:

1. **`@tiptap/extension-image` does not specify `marks` in its Node schema**:
 In `Image.create`:
 Because `image` has no `content` (it is an inline/block leaf node) and does not define `marks`, ProseMirror schema defaults `marks` to none (`""`). ProseMirror will not allow a `link` mark on an `image` node unless `marks: "link"` or `marks: "_"` is explicitly allowed.
2. **`@tiptap/markdown` parser (`applyMarkToContent`) drops marks on non-text leaf nodes**:
 In `applyMarkToContent(markType, content, attrs)`:
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

   When marked parses `[![alt](src)](url)`, it produces a `link` token containing an `image` token.
   `Link.parseMarkdown` calls `helpers.applyMark('link', helpers.parseInline(token.tokens), attrs)`.
   Because the child node is `{ type: "image" }`, `node.type === "text"` evaluates to `false` and `node.content` is undefined. The mark is dropped completely during parsing.
3. **`@tiptap/markdown` serializer (`renderNodesWithMarkBoundaries`) ignores marks on non-text nodes**:
 In `renderNodesWithMarkBoundaries`:
  ```js
   if (node.type === "text") {
     // Marks are tracked, opened, and closed here via getMarkOpening / getMarkClosing
   } else {
     // Non-text node: marks on the node itself are completely ignored.
     // Only activeMarks from preceding text nodes are closed and reopened.
     const nodeContent = this.renderNodeToMarkdown(node, parentNode, i, level);
     result.push(beforeMarkdown + nodeContent + afterMarkdown);
   }
  ```

   Even when an `image` node carries a `link` mark in the ProseMirror document, `@tiptap/markdown` does not serialize the mark opening or closing around the image.

## Minimal Reproduction

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Markdown from "@tiptap/markdown";

const editor = new Editor({
  extensions: [
    StarterKit,
    Image,
    Link,
    Markdown,
  ],
  content: "[![CI](badge.svg)](https://ci.example)",
  contentType: "markdown",
});

// 1. Inspect parsed document:
console.log(JSON.stringify(editor.getJSON()));
// Actual: Image node has no "marks" array.
// Expected: Image node has marks: [{ type: "link", attrs: { href: "https://ci.example" } }].

// 2. Inspect serialized markdown:
console.log(editor.getMarkdown());
// Actual: "![CI](badge.svg)"
// Expected: "[![CI](badge.svg)](https://ci.example)"
```

## Proposed Fix

1. In `@tiptap/extension-image`:
 Allow `marks: "link"` (or configurable `marks`) on the image node schema.
2. In `@tiptap/markdown`:
 In `applyMarkToContent`, apply marks to inline leaf nodes that permit marks (such as image), not just text nodes:
  ```js
   if (node.type === "text" || !node.content) {
     const existingMarks = node.marks || [];
     const newMark = attrs ? { type: markType, attrs } : { type: markType };
     return { ...node, marks: [...existingMarks, newMark] };
   }
  ```

   In `renderNodesWithMarkBoundaries`, open and close marks for non-text inline nodes with marks, or delegate mark wrapping to the node renderer.