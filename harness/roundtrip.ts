/**
 * Dependency-verification harness — runner.
 *
 * Single command (npm run roundtrip) runs every seam and reports
 * per-item diffs against the committed golden baselines:
 *   1. the markdown corpus (synthetic fixtures + repo documents) roundtripped
 *      through the Tiptap editor (see ./editor.ts),
 *   2. the frontmatter parse/reconstruct seam (see ./frontmatter-seam.ts),
 *   3. the file search ranking seam (see ./filesearch-seam.ts),
 *   4. the table column-width seam (see ./table-colwidth-seam.ts),
 *   5. the placeholder rendering seam (see ./placeholder-seam.ts),
 *   6. the file-mention insert seam (see ./filemention-seam.ts),
 *   7. the CRLF seam, the list-keys seam, and the wave-7 seams
 *      (slash, replace, link-edit, table-align, img-width).
 *
 * Exit code 1 on any diff, missing golden or error; 0 when everything
 * matches.
 *
 * `npm run roundtrip:update` re-captures goldens instead of comparing.
 * Only ever do that deliberately, as part of a reviewed change.
 */
import * as fs from "fs";
import * as path from "path";
import { roundtripMarkdown } from "./editor";
import { loadCorpus, type CorpusEntry } from "./corpus";
import { runFrontmatterSeam } from "./frontmatter-seam";
import { runFileSearchSeam } from "./filesearch-seam";
import { runTableColwidthSeam } from "./table-colwidth-seam";
import { runPlaceholderSeam } from "./placeholder-seam";
import { runFileMentionSeam } from "./filemention-seam";
import { runCrlfSeam } from "./crlf-seam";
import { runListKeysSeam } from "./list-keys-seam";
import { runSlashSeam } from "./slash-seam";
import { runReplaceSeam } from "./replace-seam";
import { runLinkEditSeam } from "./link-edit-seam";
import { runTableAlignSeam } from "./table-align-seam";
import { runImgWidthSeam } from "./img-width-seam";
import { runMathFootnoteSeam } from "./math-footnote-seam";
import { runHtmlRenderSeam } from "./html-render-seam";
import { runEmojiInsertSeam } from "./emoji-insert-seam";
import { runCodeBlockSeam } from "./codeblock-seam";
import { formatUnifiedDiff } from "./diff";

const MAX_DIFF_LINES = 120;

type Outcome =
  | { kind: "pass" }
  | { kind: "fail"; additions: number; deletions: number; diff: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function runFixture(
  entry: CorpusEntry,
  update: boolean,
  run: (content: string) => string = roundtripMarkdown,
): Outcome {
  let output: string;
  try {
    output = run(entry.content);
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
  // Counted from the diff, not from the line totals. This used to be
  // `newLines.length - oldLines.length` and its negation, which reads as
  // "added / removed" and is neither: a one-line replacement printed
  // `(+0 -0 lines)` on a real failure, and a three-line addition printed
  // `(+3 --3 lines)`. Both were misread during the 2.17 wave.
  const diffLines = (diff ?? "").split("\n");
  const additions = diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deletions = diffLines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return {
    kind: "fail",
    additions,
    deletions,
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

  const seams: Array<{ name: string; goldenPath: string; run: () => string }> = [
    {
      name: "seams/frontmatter.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "frontmatter.txt"),
      run: runFrontmatterSeam,
    },
    {
      name: "seams/file-search.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "file-search.txt"),
      run: runFileSearchSeam,
    },
    {
      name: "seams/table-colwidth.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "table-colwidth.txt"),
      run: runTableColwidthSeam,
    },
    {
      name: "seams/placeholder.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "placeholder.txt"),
      run: runPlaceholderSeam,
    },
    {
      name: "seams/file-mention.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "file-mention.txt"),
      run: runFileMentionSeam,
    },
    {
      name: "seams/crlf.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "crlf.txt"),
      run: runCrlfSeam,
    },
    {
      name: "seams/list-keys.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "list-keys.txt"),
      run: runListKeysSeam,
    },
    // Wave-7 seams. Registered here by the coordinator BEFORE the worktrees were
    // cut, so four parallel workers each own one seam file and none of them has
    // to edit this shared list. Their bodies are skeletons until filled in.
    {
      name: "seams/slash.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "slash.txt"),
      run: runSlashSeam,
    },
    {
      name: "seams/replace.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "replace.txt"),
      run: runReplaceSeam,
    },
    {
      name: "seams/link-edit.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "link-edit.txt"),
      run: runLinkEditSeam,
    },
    {
      name: "seams/table-align.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "table-align.txt"),
      run: runTableAlignSeam,
    },
    {
      name: "seams/img-width.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "img-width.txt"),
      run: runImgWidthSeam,
    },
    // Wave-8 seams (#85), same rule: registered before the worktrees were cut so
    // each worker owns one seam file and this list stays untouched.
    {
      name: "seams/math-footnote.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "math-footnote.txt"),
      run: runMathFootnoteSeam,
    },
    {
      name: "seams/html-render.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "html-render.txt"),
      run: runHtmlRenderSeam,
    },
    {
      name: "seams/emoji-insert.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "emoji-insert.txt"),
      run: runEmojiInsertSeam,
    },
    {
      name: "seams/codeblock.txt",
      goldenPath: path.join(repoRoot, "harness", "golden", "seams", "codeblock.txt"),
      run: runCodeBlockSeam,
    },
  ];

  for (const seam of seams) {
    const outcome = runFixture(
      { name: seam.name, sourcePath: "", goldenPath: seam.goldenPath, content: "" },
      update,
      seam.run,
    );
    switch (outcome.kind) {
      case "pass":
        if (update) {
          console.log(`CAPTURED ${seam.name}`);
        } else {
          passed++;
        }
        break;
      case "missing":
        missing++;
        console.log(`MISSING  ${seam.name} (no golden; run: npm run roundtrip:update)`);
        break;
      case "error":
        errored++;
        console.log(`ERROR    ${seam.name}`);
        console.log(`         ${outcome.message}`);
        break;
      case "fail": {
        failed++;
        console.log(`FAIL     ${seam.name} (+${outcome.additions} -${outcome.deletions} lines)`);
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
    console.log(`goldens written for ${corpus.length} fixtures and ${seams.length} seams to harness/golden/`);
    console.log("review them with git diff before committing.");
    return 0;
  }
  console.log(
    `${corpus.length} markdown fixtures + ${seams.length} seams: ${passed} passed, ${failed} failed, ${missing} missing, ${errored} errored`,
  );
  return failed + missing + errored > 0 ? 1 : 0;
}

process.exit(main());
