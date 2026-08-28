/**
 * File search ranking seam for the dependency-verification harness.
 *
 * Exercises searchFiles from src/webview/file-search-utils.ts, an existing
 * exported pure function, through its public options object. No production
 * code is restructured and no DOM is involved.
 *
 * The function returns a deterministic text report diffed against a
 * committed golden. It records measurements only: candidate breadth,
 * proximity ordering, presence of match indices on every result, and the
 * ordering of a diacritic-bearing query against accented and unaccented
 * filenames. The diacritic ordering in particular is a RECORDED
 * MEASUREMENT, never a pass/fail assertion: the upcoming search library
 * major is expected to reverse it, and that reversal has been accepted.
 */
import {
  searchFiles,
  type FileItem,
  type FileSearchResult,
} from "../src/webview/file-search-utils";

const FILES: FileItem[] = [
  { name: "README.md", path: "README.md" },
  { name: "CHANGELOG.md", path: "CHANGELOG.md" },
  { name: "notes.md", path: "docs/notes.md" },
  { name: "editor-core.md", path: "docs/editor-core.md" },
  { name: "table-system.md", path: "docs/table-system.md" },
  { name: "café.md", path: "docs/café.md" },
  { name: "cafe.md", path: "docs/cafe.md" },
  { name: "main.ts", path: "src/main.ts" },
  { name: "search.ts", path: "src/utils/search.ts" },
  { name: "README.md", path: "tests/README.md" },
  { name: "my-photo.png", path: "assets/my-photo.png" },
  { name: "road-map.md", path: "plans/road-map.md" },
];

function formatIndexes(indexes: readonly number[] | null): string {
  return indexes === null ? "null" : `[${indexes.join(",")}]`;
}

interface QueryCase {
  label: string;
  note: string;
  query: string;
  currentDocFolder?: string;
}

const QUERY_CASES: QueryCase[] = [
  {
    label: "candidate-breadth",
    note: "loose query — how many of the fixture files come back at all",
    query: "ma",
    currentDocFolder: "docs",
  },
  {
    label: "proximity-ordering",
    note: "currentDocFolder=tests must lift tests/README.md above the root README.md",
    query: "readme",
    currentDocFolder: "tests",
  },
  {
    label: "proximity-contrast-no-folder",
    note: "same query with no currentDocFolder — ordering falls back to score alone",
    query: "readme",
  },
  {
    label: "diacritic-ordering",
    note: "RECORDED MEASUREMENT, NOT A PASS/FAIL: accented vs unaccented filename order for a diacritic-bearing query; the upcoming search library major is expected to reverse this and that has been accepted",
    query: "café",
    currentDocFolder: "docs",
  },
];

function formatResults(results: FileSearchResult[]): string[] {
  const lines: string[] = [`results: ${results.length} of ${FILES.length} fixture files`];
  results.forEach((r, i) => {
    lines.push(
      `  ${i + 1}. ${r.file.path} nameIndexes=${formatIndexes(r.nameIndexes)} pathIndexes=${formatIndexes(r.pathIndexes)}`,
    );
  });
  const missingName = results.filter((r) => r.nameIndexes === null).length;
  const missingPath = results.filter((r) => r.pathIndexes === null).length;
  lines.push(`every result carries nameIndexes: ${missingName === 0 ? "yes" : `no (${missingName} without)`}`);
  lines.push(`every result carries pathIndexes: ${missingPath === 0 ? "yes" : `no (${missingPath} without)`}`);
  return lines;
}

export function runFileSearchSeam(): string {
  const lines: string[] = [
    "file search seam — searchFiles (src/webview/file-search-utils.ts)",
    "recorded on the current dependency tree; measurements, not verdicts",
    "",
    `fixture files (${FILES.length}):`,
  ];
  for (const f of FILES) {
    lines.push(`  ${f.path}`);
  }
  lines.push("");

  lines.push("[empty query — full breadth, proximity + name ordering]");
  lines.push(...formatResults(searchFiles({ query: "", files: FILES })));
  lines.push("");

  for (const testCase of QUERY_CASES) {
    lines.push(`[${testCase.label}] query=${JSON.stringify(testCase.query)}${testCase.currentDocFolder ? ` currentDocFolder=${testCase.currentDocFolder}` : ""}`);
    lines.push(`note: ${testCase.note}`);
    lines.push(
      ...formatResults(
        searchFiles({
          query: testCase.query,
          files: FILES,
          currentDocFolder: testCase.currentDocFolder,
        }),
      ),
    );
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
