# Ordered list continuation lines under-indent and lose spaces on roundtrip

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #109.
**Not filed upstream.** It lives here so the workaround in
`src/webview/ordered-list-extension.ts` can be re-checked against a future Tiptap
release without rediscovering why the override exists.

- Package: `@tiptap/extension-list`
- Reproduced on: 3.30.1

## Problem

In an ordered list with multi-digit markers (such as `10.`) or single-digit markers,
continuation lines aligned with or under-indented relative to the marker column lose
leading spaces progressively on each markdown roundtrip pass until reaching 0 leading spaces:

```markdown
10. ordered item with a two-digit marker
    continuation at the four-character marker
```

Pass 1 produces:
```markdown
10. ordered item with a two-digit marker
 continuation at the four-character marker
```
(1 leading space left instead of 0 spaces).

Pass 2 produces:
```markdown
10. ordered item with a two-digit marker
continuation at the four-character marker
```
(0 spaces left, causing a diff between pass 1 and pass 2).

This violates roundtrip fixed-point stability.

## Root cause

In `packages/extension-list/src/ordered-list/utils.ts` (line 174):

```ts
const leadingWhitespace = nextLine.length - nextLine.trimStart().length
const contentIndent = indentLevel + marker.length + 1
itemLines.push(nextLine)
itemContentLines.push(nextLine.slice(Math.min(leadingWhitespace, contentIndent)))
```

`ORDERED_LIST_ITEM_REGEX` captures:
`(1) indent`, `(2) marker`, `(3) separator` (`.` or `)`), and `(4) content`.

Here `marker` only contains the digits or letters (e.g. `'10'`), NOT the separator (`'.'`).
The formula `indentLevel + marker.length + 1` omits `separator.length`.
For `10. `, `marker.length` is 2. `contentIndent` evaluates to `0 + 2 + 1 = 3` rather than 4.
When an aligned continuation line has 4 leading spaces (`leadingWhitespace = 4`),
`Math.min(leadingWhitespace, contentIndent)` slices only 3 spaces, leaving 1 extraneous leading space
on pass 1. On pass 2, the remaining 1 space is sliced away by `min(1, 3) = 1`, reaching 0 spaces.

For single-digit markers like `2. `, `marker.length` is 1. `contentIndent` evaluates to `0 + 1 + 1 = 2`
rather than 3. An aligned continuation line with 3 spaces gets 2 spaces sliced, leaving 1 space
on pass 1, which drops to 0 on pass 2.

## Minimal reproduction

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

const input = "10. item\n    continuation at four spaces";
const editor1 = new Editor({
  extensions: [StarterKit, Markdown],
  content: input,
  contentType: "markdown",
});
const pass1 = editor1.getMarkdown();
// pass1: "10. item\n continuation at four spaces" (1 space remaining)

const editor2 = new Editor({
  extensions: [StarterKit, Markdown],
  content: pass1,
  contentType: "markdown",
});
const pass2 = editor2.getMarkdown();
// pass2: "10. item\ncontinuation at four spaces" (diff between pass 1 and pass 2)
```

## Proposed upstream fix

Include `separator.length` and delimiter whitespace in `contentIndent`:

```ts
const contentIndent = indentLevel + marker.length + separator.length + spacing.length;
```
or equivalently:
```ts
const contentIndent = line.length - content.length;
```

## What we do instead

In `src/webview/ordered-list-extension.ts`:

We extend `OrderedList` with a custom `markdownTokenizer` that corrects `collectOrderedListItems`
to calculate `contentIndent = indentLevel + marker.length + separator.length + spacing.length`.
Both single-digit and multi-digit markers now slice the exact prefix width on pass 1,
achieving immediate fixed-point stability across roundtrip passes.
