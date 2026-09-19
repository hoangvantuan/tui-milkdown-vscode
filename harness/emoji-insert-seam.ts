/**
 * Emoji insert seam: what the picker writes into the document, as markdown.
 *
 * Skeleton. Registered in harness/roundtrip.ts by the wave-8 coordinator
 * before the worktrees were cut, so worker W3 owns this file and nobody has
 * to edit the shared seam list. W3 fills in the cases; the golden is a record
 * of measurements, and a seam whose cases do not change when the mechanism is
 * removed measures nothing.
 */

/** Render the seam as the text the golden records. */
export function runEmojiInsertSeam(): string {
  const lines: string[] = [];
  lines.push("# emoji-insert seam");
  lines.push("");
  lines.push("(not filled in yet — owner: wave-8 W3)");
  return lines.join("\n") + "\n";
}
