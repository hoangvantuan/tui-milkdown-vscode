/**
 * Math and footnote seam: what a formula and a footnote parse to and serialize back as.
 *
 * Skeleton. Registered in harness/roundtrip.ts by the wave-8 coordinator
 * before the worktrees were cut, so worker W1 owns this file and nobody has
 * to edit the shared seam list. W1 fills in the cases; the golden is a record
 * of measurements, and a seam whose cases do not change when the mechanism is
 * removed measures nothing.
 */

/** Render the seam as the text the golden records. */
export function runMathFootnoteSeam(): string {
  const lines: string[] = [];
  lines.push("# math-footnote seam");
  lines.push("");
  lines.push("(not filled in yet — owner: wave-8 W1)");
  return lines.join("\n") + "\n";
}
