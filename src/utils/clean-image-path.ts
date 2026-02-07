/**
 * Clean image path by removing title/caption and angle brackets.
 * Handles: `path "title"`, `path 'title'`, `<path>`, `<path> "title"`
 * Shared between extension and webview bundles.
 */
export function cleanImagePath(rawPath: string): string {
  let p = rawPath.trim();

  // Handle angle brackets: <path> or <path with spaces>
  if (p.startsWith("<")) {
    const endBracket = p.indexOf(">");
    if (endBracket !== -1) {
      p = p.slice(1, endBracket);
    }
    return p.trim();
  }

  // Remove title: `path "title"` or `path 'title'`
  const titleSeparator = p.search(/\s+["']/);
  if (titleSeparator !== -1) {
    p = p.slice(0, titleSeparator);
  }

  return p.trim();
}
