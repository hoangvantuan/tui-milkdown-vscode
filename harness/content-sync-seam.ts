/**
 * Content sync seam: which edits the rich text view posts to the host, and which it does not.
 *
 * SKELETON, committed by the wave-10 coordinator before the worktrees were cut
 * (#149). It exists so that the Content sync ticket (#148) can fill in cases
 * WITHOUT editing harness/roundtrip.ts, which every parallel worker would
 * otherwise have to touch at once. The registration line in roundtrip.ts and
 * this file's name are fixed; the case table is #148's to own, nobody else's.
 *
 * What the filled-in seam records, one line per case, through a recording post
 * adapter in place of `vscode.postMessage`:
 *   - a character typed and undone inside one debounce window posts nothing;
 *   - a document ending in an alert (StarterKit's trailingNode) posts nothing at load;
 *   - after a real post, the baseline is re-anchored to what was posted;
 *   - two rapid edits post once, with the last content;
 *   - a flush with a pending debounce posts immediately.
 * Removing the baseline gate from postEdit must change a countable number of
 * these lines. Until #148 lands, the body below returns a fixed placeholder.
 */
export function runContentSyncSeam(): string {
  const lines: string[] = [];
  lines.push("# content-sync-seam.ts: no cases yet");
  lines.push("");
  lines.push("This seam is a skeleton. Ticket #148 replaces this body with real cases.");
  return lines.join("\n") + "\n";
}
