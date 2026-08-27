/**
 * Minimal unified line diff (LCS-based), dependency-free.
 * Output format follows the unified-diff convention so maintainers can pipe
 * it into other tools if they want to.
 */

function lcsMatrix(a: string[], b: string[]): Int32Array {
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  return table;
}

export type DiffOp = { op: "equal" | "add" | "del"; line: string };

export function diffLines(a: string[], b: string[]): DiffOp[] {
  const width = b.length + 1;
  const table = lcsMatrix(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: "equal", line: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ op: "del", line: a[i] });
      i++;
    } else {
      ops.push({ op: "add", line: b[j] });
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ op: "del", line: a[i] });
    i++;
  }
  while (j < b.length) {
    ops.push({ op: "add", line: b[j] });
    j++;
  }
  return ops;
}

/**
 * Render ops as unified diff hunks with up to `context` equal lines around
 * changes. Returns null when there is no change.
 */
export function formatUnifiedDiff(
  fromName: string,
  toName: string,
  a: string[],
  b: string[],
  context = 3,
): string | null {
  const ops = diffLines(a, b);
  const changed = ops.some((op) => op.op !== "equal");
  if (!changed) return null;

  const lines: string[] = [`--- ${fromName}`, `+++ ${toName}`];

  let idx = 0;
  let anyHunk = false;
  while (idx < ops.length) {
    if (ops[idx].op === "equal") {
      idx++;
      continue;
    }
    // Find hunk boundaries: extend until `context` equal lines separate changes.
    let start = Math.max(0, idx - context);
    let end = idx;
    let equalRun = 0;
    let k = idx;
    while (k < ops.length) {
      if (ops[k].op === "equal") {
        equalRun++;
        if (equalRun > context * 2) break;
      } else {
        equalRun = 0;
        end = k;
      }
      k++;
    }
    end = Math.min(ops.length, end + context + 1);

    const aStart = ops.slice(0, start).filter((op) => op.op !== "add").length + 1;
    const bStart = ops.slice(0, start).filter((op) => op.op !== "del").length + 1;
    const aCount = ops.slice(start, end).filter((op) => op.op !== "add").length;
    const bCount = ops.slice(start, end).filter((op) => op.op !== "del").length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (let m = start; m < end; m++) {
      const prefix = ops[m].op === "add" ? "+" : ops[m].op === "del" ? "-" : " ";
      lines.push(prefix + ops[m].line);
    }
    anyHunk = true;
    idx = end;
  }

  return anyHunk ? lines.join("\n") : null;
}
