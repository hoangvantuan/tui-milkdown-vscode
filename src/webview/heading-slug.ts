/**
 * The GitHub-style anchor slug for a heading's text.
 *
 * Lowercase, keep Unicode letters, digits and hyphens, and turn each single
 * whitespace character into one hyphen without collapsing runs. That last part
 * is what GitHub does and what the table of contents already relies on, so a
 * `#anchor` link and the target `scrollToHeading` looks for are the same
 * string by construction rather than by two copies agreeing.
 *
 * Its own module since the H1-H6 level badge plugin it used to share a file
 * with was removed: `scrollToHeading` in main.ts is the only caller, and a
 * second copy of these three replaces is how the two drift apart.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}
