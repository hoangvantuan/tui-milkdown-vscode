/**
 * Markdown roundtrip harness — corpus enumeration.
 *
 * Two sources, per the spec in issue #65:
 *   1. Synthetic fixtures, one feature per file, in harness/fixtures/synthetic/.
 *   2. Real repository documents: the top-level *.md files.
 *
 * Real documents are enumerated at run time, so a newly added doc shows up as
 * a missing golden (fixable with `npm run roundtrip:update`) instead of being
 * silently outside the corpus.
 */
import * as fs from "fs";
import * as path from "path";

export interface CorpusEntry {
  /** Stable fixture id, also the golden file path relative to harness/golden/. */
  name: string;
  /** Absolute path of the source document. */
  sourcePath: string;
  /** Absolute path of the golden baseline. */
  goldenPath: string;
  /** Raw source content. */
  content: string;
}

const SYNTHETIC_DIR = "fixtures/synthetic";

function listMarkdownFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

function loadEntry(harnessRoot: string, name: string, sourcePath: string): CorpusEntry {
  return {
    name,
    sourcePath,
    goldenPath: path.join(harnessRoot, "golden", `${name}`),
    content: fs.readFileSync(sourcePath, "utf8"),
  };
}

export function loadCorpus(repoRoot: string): CorpusEntry[] {
  const harnessRoot = path.join(repoRoot, "harness");
  const entries: CorpusEntry[] = [];

  const syntheticDir = path.join(harnessRoot, SYNTHETIC_DIR);
  for (const file of listMarkdownFiles(syntheticDir)) {
    entries.push(
      loadEntry(harnessRoot, `synthetic/${file}`, path.join(syntheticDir, file)),
    );
  }

  const repoDocs: Array<[label: string, dir: string]> = [["repo", repoRoot]];
  for (const [label, dir] of repoDocs) {
    for (const file of listMarkdownFiles(dir)) {
      entries.push(loadEntry(harnessRoot, `${label}/${file}`, path.join(dir, file)));
    }
  }

  return entries;
}
