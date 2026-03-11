/**
 * LCS-based diff & patch for markdown fidelity (Layer 3).
 *
 * Compares serialized output with original line-by-line.
 * Unchanged lines → keep original verbatim (preserving whitespace).
 * Changed/new lines → use serialized version (already marker-preserved by Layer 1+2).
 */

/**
 * Patch serialized markdown using LCS diff with original.
 * @param original - Original markdown (source of truth for formatting)
 * @param serialized - Output from editor.getMarkdown() (content changes applied)
 * @returns Patched markdown preserving original formatting where unchanged
 */
export function patchMarkdown(original: string, serialized: string): string {
  if (original === serialized) return original;

  const origLines = original.split('\n');
  const newLines = serialized.split('\n');

  // Performance guard: skip LCS for very large files
  if (origLines.length > 2000 || newLines.length > 2000) {
    return serialized;
  }

  const lcs = computeLCS(origLines, newLines);

  const result: string[] = [];
  let ni = 0;
  let li = 0;

  while (li < lcs.length) {
    const [origIdx, newIdx] = lcs[li];

    // New lines inserted before this match
    while (ni < newIdx) {
      result.push(newLines[ni++]);
    }

    // LCS match → keep ORIGINAL line verbatim
    result.push(origLines[origIdx]);
    ni = newIdx + 1;
    li++;
  }

  // Remaining new lines after last match
  while (ni < newLines.length) {
    result.push(newLines[ni++]);
  }

  return result.join('\n');
}

/**
 * Compute Longest Common Subsequence between two string arrays.
 * Returns array of [origIndex, newIndex] matched pairs.
 * O(m*n) time/space, capped at 2000 lines.
 */
function computeLCS(a: string[], b: string[]): [number, number][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find pairs
  const result: [number, number][] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result.reverse();
}
