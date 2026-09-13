/**
 * Markdown link/image destination escaping.
 *
 * `@tiptap/extension-link` and `@tiptap/extension-image` serialize a mark or
 * node by interpolating the raw `href`/`src` straight into `[text](DEST)`.
 * A destination containing a space (a file mention for
 * `My Notes 2026-09-09.mp4`, a pasted image saved under a name with spaces)
 * therefore comes out as `[text](My Notes 2026-09-09.mp4)`, which is not a
 * CommonMark link. Saving is silent, but reopening the file parses it as
 * literal text: the link is gone.
 *
 * `wrapMarkdownDestination` restores the pointy-bracket form that
 * `file-mention-plugin.ts` already inserts and `cleanImagePath` already
 * understands, so the destination survives the save/reopen round trip.
 *
 * Shared between the extension and webview bundles; deliberately free of
 * Tiptap imports so the extension bundle does not pull the editor in.
 */

/** True when every `(` in `dest` has a matching `)` and none closes early. */
function hasBalancedParens(dest: string): boolean {
  let depth = 0;
  for (let i = 0; i < dest.length; i++) {
    const ch = dest[i];
    if (ch === "\\") {
      i++; // escaped character, not structural
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Render a link/image destination so the serialized markdown parses back to
 * the same destination. Wraps in `<...>` only when the bare form would not
 * survive: empty, containing whitespace, or with unbalanced parentheses.
 */
export function wrapMarkdownDestination(dest: string): string {
  // An empty destination is already valid as `[text]()`; wrapping it would
  // rewrite every such link for no gain.
  if (!dest) return "";

  const needsWrap = /\s/.test(dest) || !hasBalancedParens(dest);
  if (!needsWrap) return dest;

  // A newline cannot appear inside <...> either, so it is percent-encoded.
  // `<`, `>` and `\` are backslash-escaped, as CommonMark requires.
  const escaped = dest
    .replace(/[\\<>]/g, "\\$&")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");

  return `<${escaped}>`;
}

/**
 * Escape a link/image title for the `"..."` form.
 *
 * Same defect as the destination: the title is interpolated raw, so a title
 * containing a double quote closes the title early and the whole construct
 * stops being a link when the file is reopened.
 */
export function escapeMarkdownTitle(title: string): string {
  return title.replace(/[\\"]/g, "\\$&");
}

/**
 * Escape image alt text.
 *
 * A link's text goes through the serializer's own child rendering, which
 * escapes as it goes, but an image has no children: `alt` is a plain
 * attribute interpolated between `![` and `]`. An unescaped `]` there ends
 * the alt early and the image reopens as literal text.
 */
export function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/[\\[\]]/g, "\\$&");
}
