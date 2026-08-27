/**
 * Markdown roundtrip harness — runner.
 *
 * Single command (npm run roundtrip): parses every corpus document into a
 * Tiptap editor, serializes it back, and reports per-fixture diffs against
 * the committed golden baselines. Exit code 1 on any diff, missing golden or
 * error; 0 when everything matches.
 *
 * `npm run roundtrip:update` re-captures goldens instead of comparing.
 * Only ever do that deliberately, as part of a reviewed change.
 */
import * as fs from "fs";
import * as path from "path";
import { roundtripMarkdown } from "./editor";
import { loadCorpus, type CorpusEntry } from "./corpus";
import { formatUnifiedDiff } from "./diff";

const MAX_DIFF_LINES = 120;

type Outcome =
  | { kind: "pass" }
  | { kind: "fail"; additions: number; deletions: number; diff: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function runFixture(entry: CorpusEntry, update: boolean): Outcome {
  let output: string;
  try {
    output = roundtripMarkdown(entry.content);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  if (update) {
    fs.mkdirSync(path.dirname(entry.goldenPath), { recursive: true });
    fs.writeFileSync(entry.goldenPath, output, "utf8");
    return { kind: "pass" };
  }

  if (!fs.existsSync(entry.goldenPath)) {
    return { kind: "missing" };
  }

  const golden = fs.readFileSync(entry.goldenPath, "utf8");
  if (golden === output) {
    return { kind: "pass" };
  }

  const oldLines = golden.split("\n");
  const newLines = output.split("\n");
  const diff = formatUnifiedDiff(`golden/${entry.name}`, `current/${entry.name}`, oldLines, newLines);
  const additions = newLines.length - oldLines.length;
  return {
    kind: "fail",
    additions,
    deletions: -additions,
    diff,
  };
}

function main(): number {
  const update = process.argv.includes("--update");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const corpus = loadCorpus(repoRoot);

  const syntheticCount = corpus.filter((e) => e.name.startsWith("synthetic/")).length;
  console.log(`markdown roundtrip harness — mode: ${update ? "update goldens" : "check"}`);
  console.log(`corpus: ${corpus.length} fixtures (${syntheticCount} synthetic, ${corpus.length - syntheticCount} repo docs)`);
  console.log("");

  let passed = 0;
  let failed = 0;
  let missing = 0;
  let errored = 0;

  for (const entry of corpus) {
    const outcome = runFixture(entry, update);
    switch (outcome.kind) {
      case "pass":
        if (update) {
          console.log(`CAPTURED ${entry.name}`);
        } else {
          passed++;
        }
        break;
      case "missing":
        missing++;
        console.log(`MISSING  ${entry.name} (no golden; run: npm run roundtrip:update)`);
        break;
      case "error":
        errored++;
        console.log(`ERROR    ${entry.name}`);
        console.log(`         ${outcome.message}`);
        break;
      case "fail": {
        failed++;
        console.log(`FAIL     ${entry.name} (+${outcome.additions} -${outcome.deletions} lines)`);
        if (outcome.diff) {
          const diffLines = outcome.diff.split("\n");
          const shown = diffLines.slice(0, MAX_DIFF_LINES);
          console.log(shown.map((l) => `  ${l}`).join("\n"));
          if (diffLines.length > shown.length) {
            console.log(`  ... ${diffLines.length - shown.length} more diff lines not shown`);
          }
          console.log("");
        }
        break;
      }
    }
  }

  console.log("──────────────────────────────────────────");
  if (update) {
    console.log(`goldens written for ${corpus.length} fixtures to harness/golden/`);
    console.log("review them with git diff before committing.");
    return 0;
  }
  console.log(
    `${corpus.length} fixtures: ${passed} passed, ${failed} failed, ${missing} missing, ${errored} errored`,
  );
  return failed + missing + errored > 0 ? 1 : 0;
}

process.exit(main());
