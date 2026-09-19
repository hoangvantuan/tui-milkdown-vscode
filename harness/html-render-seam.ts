/**
 * HTML whitelist seam: what <details>, <kbd>, <sub> and <sup> parse to and serialize back as.
 *
 * Skeleton. Registered in harness/roundtrip.ts by the wave-8 coordinator
 * before the worktrees were cut, so worker W2 owns this file and nobody has
 * to edit the shared seam list. W2 fills in the cases; the golden is a record
 * of measurements, and a seam whose cases do not change when the mechanism is
 * removed measures nothing.
 */

/** Render the seam as the text the golden records. */
export function runHtmlRenderSeam(): string {
  const lines: string[] = [];
  lines.push("# html-render seam");
  lines.push("");
  lines.push("(not filled in yet — owner: wave-8 W2)");
  return lines.join("\n") + "\n";
}
