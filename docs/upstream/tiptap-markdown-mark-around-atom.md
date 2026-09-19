# @tiptap/markdown: a mark can never wrap an atom node on serialization

**Package**: `@tiptap/markdown@3.30.1`
**Found while**: closing the second half of hoangvantuan/tui-milkdown-vscode#124
**Status**: measured, not reported upstream yet. Not worked around, on purpose (see the last section).

## The claim

`MarkdownSerializer.renderNodesWithMarkBoundaries` has two branches. Text nodes get
full mark bookkeeping: open, close, reopen across boundaries. Every other node type
takes the `else` branch, which does the opposite of wrapping:

```js
// node_modules/@tiptap/markdown/dist/index.js, the else branch of
// renderNodesWithMarkBoundaries
const beforeMarkdown = closeMarksBeforeNode(activeMarks, ...);
const nodeContent   = this.renderNodeToMarkdown(node, parentNode, i, level);
const afterMarkdown = node.type === "hardBreak" ? "" : reopenMarksAfterNode(marksToReopen, ...);
result.push(beforeMarkdown + nodeContent + afterMarkdown);
```

Every active mark is CLOSED before the node and REOPENED after it. So a mark that
covers an atom is emitted around the atom's neighbours and never around the atom.
`closeMarksBeforeNode` and `reopenMarksAfterNode` are module-level helpers, so this
is the deliberate shape of the code and not an oversight in one call site.

## What it costs, measured

`[<kbd>K</kbd>](https://x)` parses to three inline nodes: the `rawHtmlInline` atom
`<kbd>`, the text `K`, and the `rawHtmlInline` atom `</kbd>`. Through
`roundtripMarkdown` from `harness/editor.ts`, on `develop`:

```
kbd            "[<kbd>K</kbd>](https://x)"          -> "<kbd>[K](https://x)</kbd>"
sub            "[<sub>s</sub>](https://x)"          -> "<sub>[s](https://x)</sub>"
kbd-with-text  "before [<kbd>K</kbd>](https://x) after"
                                                    -> "before <kbd>[K](https://x)</kbd> after"
nested-two     "[<kbd>K</kbd> and <kbd>J</kbd>](https://x)"
                                                    -> "<kbd>[K](https://x)</kbd> [and](https://x) <kbd>[J](https://x)</kbd>"
```

The link survives, so this is lossless, but it migrates INSIDE the tag, and
`nested-two` shows one link becoming three.

## The obvious fix, and why it is worse

`applyMarkToNodes` in `src/webview/markdown-destination.ts` marks `text` and `image`
nodes. Adding `rawHtmlInline` to that condition puts the mark on the atoms as well.
Measured with exactly that one-line change:

```
kbd            -> "<kbd>[K](https://x)</kbd>["
kbd-with-text  -> "before <kbd>[K](https://x)</kbd>[ after](https://x)"
nested-two     -> "<kbd>[K](https://x)</kbd>[ and ](https://x)<kbd>[J](https://x)</kbd>["
```

A stray unclosed `[`, and now the output is not even valid. The mechanism is in the
snippet above: the trailing `</kbd>` atom carries the link, so `reopenMarksAfterNode`
emits the opening `[` after it and the loop ends with nothing to close it. Marking
the atom makes the defect worse, not better.

## Why `image` is not a counter-example

`[![alt](a.png)](https://x)` and `[<img src="a.png" width="200">](https://x)` both
survive, and neither survives through the serializer's mark handling.
`MarkdownImage.renderMarkdown` reads the node's own link mark and emits the whole
`[![alt](src)](href)` itself. That works because ONE node carries the whole shape.
A paired tag is three nodes, and `renderMarkdown` sees one node at a time, so the
same technique does not reach it.

## Why nothing is worked around here

Three workarounds were considered and all three trade a correct property for
another one:

1. **Collapse the whole link into one `rawHtmlInline` at parse time**, holding
   `token.raw`. The file roundtrips byte-exact. The user then sees the literal
   text `[<kbd>K</kbd>](https://x)` in the editor instead of a rendered, clickable
   key cap. Fidelity bought with rendering.
2. **A `linkHref` attribute on the opening and closing atoms**, with
   `renderMarkdown` emitting `[` on one and `](href)` on the other. It roundtrips
   and it renders, and it breaks the moment someone deletes the closing atom, which
   ProseMirror lets them do: the document then serializes a stray `[`. An invariant
   that spans two independently deletable atoms is not an invariant.
3. **Reopen the link as `<a href>` via the serializer's `getHtmlReopenTags` path.**
   Lossless and correct-rendering, but it rewrites the user's `[..](..)` into an
   HTML anchor, which is a different edit to their file than the one they made.

The current behaviour is lossless. Each fix above either stops being lossless in
some state or changes the file in a way the user did not ask for. Recorded rather
than shipped; the second half of #124 stays open with this as its starting point.
