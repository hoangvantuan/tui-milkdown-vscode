# Named and numeric HTML entities other than &amp; &lt; &gt; &quot; are double-escaped on save

Upstream defect report for `ueberdosis/tiptap`, written while fixing issue #97.
**Not filed upstream.** It lives here so the workaround in
`src/webview/markdown-text-escape.ts` can be re-checked against a future Tiptap
release without rediscovering why the override exists.

- Package: `@tiptap/core`
- Reproduced on: 3.30.1

## Problem

`@tiptap/core`'s `decodeHtmlEntities`/`encodeHtmlEntities` handle only `&amp; &lt; &gt; &quot;`. Anything else is left undecoded on parse and then re-encoded on save:

| Input | Output |
| --- | --- |
| `&amp; &lt; &copy; &#169;` | `&amp; &lt; &amp;copy; &amp;#169;` |

`&amp;copy;` renders as the literal text `&copy;`, not `©`. Lossy on the first save for any document using `&nbsp;`, `&copy;`, `&mdash;`, `&rarr;` or numeric references (`&#169;`, `&#xa9;`).

## Root cause

In `@tiptap/core/src/utilities/htmlEntities.ts`:

```ts
export function encodeHtmlEntities(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
```

`encodeHtmlEntities` blindly replaces every `&` with `&amp;`, regardless of whether `&` already introduces a valid named or numeric entity reference. Coupled with `decodeHtmlEntities` only decoding the basic four entities (`&lt;`, `&gt;`, `&quot;`, `&amp;`), any other entity reference remains in text nodes as raw text `&name;` or `&#nnn;`, which then gets turned into `&amp;name;` on serialization.

## Minimal reproduction

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

const editor = new Editor({
  extensions: [StarterKit, Markdown],
  content: "&amp; &lt; &copy; &#169;",
  contentType: "markdown",
});

editor.getMarkdown();
// actual:   "&amp; &lt; &amp;copy; &amp;#169;"
// expected: "&amp; &lt; &copy; &#169;"
```

## What we do instead

In `src/webview/markdown-text-escape.ts`:

We override `MarkdownManager.prototype.encodeTextForMarkdown` to encode `&` to `&amp;` only when it does **not** begin a valid HTML entity reference (`&([a-zA-Z][a-zA-Z0-9]*|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});`). Valid entity references (`&copy;`, `&#169;`, `&#xa9;`, `&nbsp;`, `&mdash;`, `&rarr;`, etc.) pass through intact without double encoding.
