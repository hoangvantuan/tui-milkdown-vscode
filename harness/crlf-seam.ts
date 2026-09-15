/**
 * CRLF line ending seam for the dependency-verification harness.
 *
 * Exercises normalizeLineEndings from src/markdownEditorProvider.ts,
 * verifying that markdown content is converted to the document's EOL
 * sequence (CRLF or LF) on save, and that mixed endings normalize cleanly.
 * Also verifies that frontmatter rawBlock replay does not reintroduce
 * mixed endings after reconstruction.
 *
 * Observes the normalized string output only: every 'yes' below is a verdict.
 */
import { normalizeLineEndings } from "../src/markdownEditorProvider";

interface CrlfCase {
  label: string;
  note: string;
  input: string;
  eol: 1 | 2 | "\n" | "\r\n";
  eolName: string;
  expected: string;
}

const CASES: CrlfCase[] = [
  {
    label: "crlf-with-eol-crlf",
    note: "given a\\r\\n\\r\\nb\\r\\n and EOL=CRLF the text written back is a\\r\\n\\r\\nb\\r\\n",
    input: "a\r\n\r\nb\r\n",
    eol: 2,
    eolName: "CRLF",
    expected: "a\r\n\r\nb\r\n",
  },
  {
    label: "crlf-with-eol-lf",
    note: "given a\\r\\n\\r\\nb\\r\\n and EOL=LF the text written back is LF",
    input: "a\r\n\r\nb\r\n",
    eol: 1,
    eolName: "LF",
    expected: "a\n\nb\n",
  },
  {
    label: "lf-with-eol-crlf",
    note: "given a\\n\\nb\\n and EOL=CRLF the text written back is converted to CRLF",
    input: "a\n\nb\n",
    eol: 2,
    eolName: "CRLF",
    expected: "a\r\n\r\nb\r\n",
  },
  {
    label: "lf-with-eol-lf",
    note: "given a\\n\\nb\\n and EOL=LF the text written back stays LF",
    input: "a\n\nb\n",
    eol: 1,
    eolName: "LF",
    expected: "a\n\nb\n",
  },
  {
    label: "mixed-endings-with-eol-crlf",
    note: "mixed endings normalize to document.eol (CRLF)",
    input: "a\r\n\nb\r\n",
    eol: 2,
    eolName: "CRLF",
    expected: "a\r\n\r\nb\r\n",
  },
  {
    label: "mixed-endings-with-eol-lf",
    note: "mixed endings normalize to document.eol (LF)",
    input: "a\r\n\nb\r\n",
    eol: 1,
    eolName: "LF",
    expected: "a\n\nb\n",
  },
  {
    label: "mixed-lone-cr-with-eol-crlf",
    note: "mixed input with lone carriage return normalizes to CRLF",
    input: "a\r\nb\rc\n",
    eol: 2,
    eolName: "CRLF",
    expected: "a\r\nb\r\nc\r\n",
  },
  {
    label: "mixed-lone-cr-with-eol-lf",
    note: "mixed input with lone carriage return normalizes to LF",
    input: "a\r\nb\rc\n",
    eol: 1,
    eolName: "LF",
    expected: "a\nb\nc\n",
  },
  {
    label: "string-eol-crlf",
    note: "accepts \\r\\n string as EOL parameter",
    input: "a\n\nb\n",
    eol: "\r\n",
    eolName: "string-CRLF",
    expected: "a\r\n\r\nb\r\n",
  },
  {
    label: "string-eol-lf",
    note: "accepts \\n string as EOL parameter",
    input: "a\r\n\r\nb\r\n",
    eol: "\n",
    eolName: "string-LF",
    expected: "a\n\nb\n",
  },
];

function hasMixedEndings(text: string): boolean {
  const hasCrlf = /\r\n/.test(text);
  const withoutCrlf = text.replace(/\r\n/g, "");
  const hasLoneLf = /\n/.test(withoutCrlf);
  const hasLoneCr = /\r/.test(withoutCrlf);
  return (hasCrlf && (hasLoneLf || hasLoneCr)) || (hasLoneLf && hasLoneCr);
}

function runFrontmatterReplayCheck(): string[] {
  const lines: string[] = [];
  const rawBlockCrlf = "---\r\ntitle: Seam Test\r\nstatus: draft\r\n---\r\n\r\n";
  const editorBodyLf = "# Heading\n\nEdited body text.\n";
  // Simulated reconstructed content where rawBlock had CRLF and body was serialized with LF:
  const reconstructed = rawBlockCrlf + editorBodyLf;

  const normalizedCrlf = normalizeLineEndings(reconstructed, 2);
  const normalizedLf = normalizeLineEndings(reconstructed, 1);

  lines.push("[frontmatter-rawblock-replay]");
  lines.push("note: rawBlock replay in reconstructContent followed by normalizeLineEndings produces no mixed endings");
  lines.push(`  reconstructed has mixed endings: ${hasMixedEndings(reconstructed) ? "yes" : "no"}`);
  lines.push(`  normalized CRLF has mixed endings: ${hasMixedEndings(normalizedCrlf) ? "yes" : "no"}`);
  lines.push(`  normalized CRLF matches expected: ${!hasMixedEndings(normalizedCrlf) && normalizedCrlf.endsWith("\r\n") ? "yes" : "no"}`);
  lines.push(`  normalized LF has mixed endings: ${hasMixedEndings(normalizedLf) ? "yes" : "no"}`);
  lines.push(`  normalized LF matches expected: ${!hasMixedEndings(normalizedLf) && !normalizedLf.includes("\r") ? "yes" : "no"}`);
  return lines;
}

export function runCrlfSeam(): string {
  const lines: string[] = [
    "crlf seam: normalizeLineEndings (src/markdownEditorProvider.ts)",
    "observes line ending normalization; every 'yes' below is a verdict, not a measurement",
    "",
  ];

  for (const testCase of CASES) {
    const actual = normalizeLineEndings(testCase.input, testCase.eol);
    const matches = actual === testCase.expected;
    lines.push(`[${testCase.label}] eol=${testCase.eolName} input=${JSON.stringify(testCase.input)}`);
    lines.push(`note: ${testCase.note}`);
    lines.push(`  expected: ${JSON.stringify(testCase.expected)}`);
    lines.push(`  actual:   ${JSON.stringify(actual)}`);
    lines.push(`  matches:  ${matches ? "yes" : "NO"}`);
    lines.push("");
  }

  lines.push(...runFrontmatterReplayCheck());
  lines.push("");

  return lines.join("\n") + "\n";
}
