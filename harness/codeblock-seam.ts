/**
 * Code block seam: language, line numbers and wrap state as they survive a roundtrip.
 *
 * Skeleton. Registered in harness/roundtrip.ts by the wave-8 coordinator
 * before the worktrees were cut, so worker W4 owns this file and nobody has
 * to edit the shared seam list. W4 fills in the cases; the golden is a record
 * of measurements, and a seam whose cases do not change when the mechanism is
 * removed measures nothing.
 */

/** Render the seam as the text the golden records. */
export function runCodeBlockSeam(): string {
  const lines: string[] = [];
  lines.push("# codeblock seam");
  lines.push("");
  lines.push("(not filled in yet — owner: wave-8 W4)");
  return lines.join("\n") + "\n";
}
