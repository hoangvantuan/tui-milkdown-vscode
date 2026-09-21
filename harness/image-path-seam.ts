/**
 * Image path seam: the path written to the file for an image the rich text view displays.
 *
 * SKELETON, committed by the wave-10 coordinator before the worktrees were cut
 * (#149). Two tickets own it in sequence: the rename fix (#142) fills the first
 * cases, the Image path translation refactor (#147) extends them. Neither edits
 * harness/roundtrip.ts; the registration line and this file's name are fixed.
 *
 * What the filled-in seam records, one line per case: given a document with an
 * image and a host image map, the serialized markdown after
 *   - a plain roundtrip (relative path in, relative path out);
 *   - the host map changing under the editor (a new update from the host);
 *   - the plugin renaming an image (old entry removed, new entry added) and the
 *     node's address changing, which is the #142 shape: the relative path must
 *     come out, never the display address.
 * Breaking cache invalidation must change a countable number of these lines.
 * The seam cannot see VS Code's RPC ordering; the floor probe in run.mjs does.
 * Until #142 lands, the body below returns a fixed placeholder.
 */
export function runImagePathSeam(): string {
  const lines: string[] = [];
  lines.push("# image-path-seam.ts: no cases yet");
  lines.push("");
  lines.push("This seam is a skeleton. Ticket #142 fills it; #147 extends it.");
  return lines.join("\n") + "\n";
}
