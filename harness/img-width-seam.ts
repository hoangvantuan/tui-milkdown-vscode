/**
 * Image width seam: how an image with a width attribute parses and serializes.
 *
 * SKELETON, committed by the wave-7 coordinator before the worktrees were cut.
 * It exists so that W3 can fill in cases WITHOUT editing harness/roundtrip.ts,
 * which every worker would otherwise have to touch at the same time. The
 * registration line in roundtrip.ts and this file's name are fixed; the case
 * table below is W3's to own, and nobody else's.
 *
 * A seam is a golden of MEASUREMENTS, not a markdown roundtrip. Record what the
 * webview function actually returns, one line per case, so that removing the
 * extension under test changes a countable number of lines. See #S7.
 */
export function runImgWidthSeam(): string {
  const lines: string[] = [];
  lines.push("# img-width-seam.ts — no cases yet");
  lines.push("");
  lines.push("This seam is a skeleton. W3 replaces this body with real cases.");
  return lines.join("\n") + "\n";
}
