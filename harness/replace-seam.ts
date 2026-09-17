/**
 * Find-and-replace seam: document text after replace / replaceAll, per case.
 *
 * SKELETON, committed by the wave-7 coordinator before the worktrees were cut.
 * It exists so that W1 can fill in cases WITHOUT editing harness/roundtrip.ts,
 * which every worker would otherwise have to touch at the same time. The
 * registration line in roundtrip.ts and this file's name are fixed; the case
 * table below is W1's to own, and nobody else's.
 *
 * A seam is a golden of MEASUREMENTS, not a markdown roundtrip. Record what the
 * webview function actually returns, one line per case, so that removing the
 * extension under test changes a countable number of lines. See #S2.
 */
export function runReplaceSeam(): string {
  const lines: string[] = [];
  lines.push("# replace-seam.ts — no cases yet");
  lines.push("");
  lines.push("This seam is a skeleton. W1 replaces this body with real cases.");
  return lines.join("\n") + "\n";
}
