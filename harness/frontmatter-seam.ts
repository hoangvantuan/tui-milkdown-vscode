/**
 * Frontmatter seam for the dependency-verification harness.
 *
 * Exercises the two existing exported functions of
 * src/utils/frontmatter-parser.ts (parseContent / reconstructContent) and
 * the webview's YAML validation helper validateYaml from
 * src/webview/frontmatter.ts, all through their public signatures with
 * plain string inputs. No production code is restructured and no DOM is
 * needed: both modules are pure string/YAML logic.
 *
 * The function returns a deterministic text report that the runner diffs
 * against a committed golden. The report records behaviour, not verdicts:
 * whatever parse/reconstruct/validation produces on the current dependency
 * tree is what lands in the golden.
 */
import {
  parseContent,
  reconstructContent,
} from "../src/utils/frontmatter-parser";
import { validateYaml } from "../src/webview/frontmatter";

interface FmCase {
  label: string;
  source: string;
}

const CASES: FmCase[] = [
  {
    label: "standard",
    source: '---\ntitle: Seam Fixture\ntags:\n  - frontmatter\n  - roundtrip\ndraft: false\n---\n\n# Body\n\nText under standard frontmatter.\n',
  },
  {
    label: "implicit",
    source: "title: Implicit Form\ntype: note\ncreated: 2024-02-01\n\n---\n\n# Body\n\nText under the implicit separator.\n",
  },
  {
    label: "empty-delimiters",
    source: "---\n---\n\n# Body\n\nOnly the two delimiters, nothing between.\n",
  },
  {
    label: "comment-only",
    source: "---\n# only a comment\n---\n\n# Body\n\nFrontmatter consisting solely of a comment line.\n",
  },
  {
    label: "blank-line-only",
    source: "---\n\n---\n\n# Body\n\nFrontmatter containing only a blank line.\n",
  },
  {
    label: "no-blank-line-after-fm",
    source:
      "---\ntitle: No Blank Line\ndraft: true\n---\n# Body\n\nThe body starts on the line immediately after the closing delimiter.\n",
  },
  {
    label: "no-blank-line-after-empty-delims",
    source: "---\n---\n# Body\n\nThe body starts on the line immediately after the empty delimiters.\n",
  },
  {
    label: "two-blank-lines-after-fm",
    source:
      "---\ntitle: Two Blank Lines\ndraft: true\n---\n\n\n# Body\n\nTwo blank lines separate the closing delimiter from the body.\n",
  },
  {
    label: "trailing-space-delimiters",
    source:
      "--- \ntitle: Trailing Space\ndraft: true\n--- \n\n# Body\n\nBoth delimiters carry a trailing space that must survive the round-trip.\n",
  },
  {
    label: "invalid-yaml",
    source: '---\ntitle: Valid Line\ntags: [unclosed\n---\n\n# Body\n\nThe flow sequence on line 3 is never closed.\n',
  },
  {
    label: "no-frontmatter",
    source: "# Just a body\n\nNo frontmatter anywhere in this document.\n",
  },
];

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => `${prefix}${String(i + 1).padStart(2)}| ${line}`)
    .join("\n");
}

export function runFrontmatterSeam(): string {
  const lines: string[] = [
    "frontmatter seam — parseContent / reconstructContent (src/utils/frontmatter-parser.ts)",
    "                + validateYaml (src/webview/frontmatter.ts)",
    "recorded on the current dependency tree; observations, not verdicts",
    "",
  ];

  for (const testCase of CASES) {
    const parsed = parseContent(testCase.source);
    const validation = validateYaml(parsed.frontmatter ?? "");
    const reconstructed = reconstructContent(
      parsed.frontmatter,
      parsed.body,
      parsed.format,
      parsed.rawBlock,
    );
    const byteForByte = reconstructed === testCase.source;

    lines.push(`[case ${testCase.label}]`);
    lines.push("input:");
    lines.push(indentBlock(testCase.source.replace(/\n$/, ""), "  "));
    lines.push(
      `parse: format=${parsed.format} isValid=${parsed.isValid} error=${JSON.stringify(parsed.error ?? null)}`,
    );
    lines.push(
      `validateYaml(frontmatter): isValid=${validation.isValid} error=${JSON.stringify(validation.error ?? null)} reportedLine=${validation.line ?? "none"}`,
    );
    lines.push(`reconstruct === input (byte for byte): ${byteForByte ? "yes" : "no"}`);
    if (!byteForByte) {
      lines.push("reconstructed:");
      lines.push(indentBlock(reconstructed.replace(/\n$/, ""), "  "));
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
