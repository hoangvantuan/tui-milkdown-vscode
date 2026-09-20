import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findBacklinks, matchesDocument } from "../src/host/backlinks";
import { setWorkspaceRoot, resetStub } from "./vscode-stub";

describe("backlinks", () => {
  let tmpDir: string;
  let docsDir: string;
  let targetDocPath: string;
  let targetDocUri: vscode.Uri;
  let mockDoc: vscode.TextDocument;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-backlinks-test-"));
    setWorkspaceRoot(tmpDir);

    docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    targetDocPath = path.join(docsDir, "target.md");
    fs.writeFileSync(targetDocPath, "# Target Document\n", "utf8");
    targetDocUri = vscode.Uri.file(targetDocPath);

    mockDoc = {
      uri: targetDocUri,
      fileName: targetDocPath,
      isClosed: false,
      getText: () => fs.readFileSync(targetDocPath, "utf8"),
    } as unknown as vscode.TextDocument;
  });

  afterEach(() => {
    resetStub();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("matchesDocument helper", () => {
    it("matches wiki link target by stem and basename without slashes", () => {
      assert.equal(
        matchesDocument("target", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
      assert.equal(
        matchesDocument("target.md", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
    });

    it("matches slugified wiki link target with spaces", () => {
      const spacedDocPath = path.join(docsDir, "target-doc.md");
      assert.equal(
        matchesDocument("target doc", docsDir, tmpDir, spacedDocPath, "target-doc.md", "target-doc", "docs/target-doc.md"),
        true,
      );
    });

    it("matches relative path from source document folder", () => {
      const notesDir = path.join(tmpDir, "notes");
      assert.equal(
        matchesDocument("../docs/target.md", notesDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
      assert.equal(
        matchesDocument("./target.md", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
    });

    it("matches workspace-relative path from @-mentions", () => {
      assert.equal(
        matchesDocument("docs/target.md", tmpDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
      assert.equal(
        matchesDocument("docs/target", tmpDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        true,
      );
    });

    it("rejects web URLs and unrelated files", () => {
      assert.equal(
        matchesDocument("https://example.com/target.md", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        false,
      );
      assert.equal(
        matchesDocument("other.md", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        false,
      );
      assert.equal(
        matchesDocument("subfolder/other.md", docsDir, tmpDir, targetDocPath, "target.md", "target", "docs/target.md"),
        false,
      );
    });
  });

  describe("findBacklinks workspace scan", () => {
    it("returns empty array when no markdown files link to target", async () => {
      const otherFile = path.join(tmpDir, "other.md");
      fs.writeFileSync(otherFile, "# Unrelated\nJust some notes here.\n", "utf8");

      const links = await findBacklinks(mockDoc);
      assert.deepEqual(links, []);
    });

    it("does not report self-references from the target document itself", async () => {
      fs.writeFileSync(targetDocPath, "# Target\nSelf reference [[target]] or [link](target.md)\n", "utf8");

      const links = await findBacklinks(mockDoc);
      assert.deepEqual(links, []);
    });

    it("finds wiki links with and without aliases", async () => {
      const noteA = path.join(tmpDir, "note-a.md");
      fs.writeFileSync(noteA, "Referencing [[target]] in text.\n", "utf8");

      const noteB = path.join(tmpDir, "note-b.md");
      fs.writeFileSync(noteB, "Referencing [[target|Custom Alias]] here.\n", "utf8");

      const links = await findBacklinks(mockDoc);
      assert.equal(links.length, 2);

      assert.equal(links[0].label, "note-a.md");
      assert.equal(links[0].count, 1);
      assert.ok(links[0].preview?.includes("[[target]]"));

      assert.equal(links[1].label, "note-b.md");
      assert.equal(links[1].count, 1);
      assert.ok(links[1].preview?.includes("[[target|Custom Alias]]"));
    });

    it("finds markdown links and workspace-relative @-mentions", async () => {
      const mentionDoc = path.join(tmpDir, "mention.md");
      fs.writeFileSync(
        mentionDoc,
        "Here is a file mention: [target.md](<docs/target.md>) and anchor [link](<docs/target.md#section>).\n",
        "utf8",
      );

      const links = await findBacklinks(mockDoc);
      assert.equal(links.length, 1);
      assert.equal(links[0].label, "mention.md");
      assert.equal(links[0].count, 2);
    });

    it("ignores links inside fenced code blocks", async () => {
      const codeDoc = path.join(tmpDir, "code.md");
      fs.writeFileSync(
        codeDoc,
        "Example code:\n```markdown\n[[target]]\n[target](docs/target.md)\n```\nDone.\n",
        "utf8",
      );

      const links = await findBacklinks(mockDoc);
      assert.deepEqual(links, []);
    });

    it("finds multiple links across multiple documents with correct relative paths", async () => {
      const subDir = path.join(tmpDir, "sub");
      fs.mkdirSync(subDir, { recursive: true });
      const subDoc = path.join(subDir, "subnote.md");
      fs.writeFileSync(subDoc, "See [[target]] for details.\n", "utf8");

      const rootDoc = path.join(tmpDir, "root.md");
      fs.writeFileSync(rootDoc, "Check [docs/target.md](docs/target.md)\n", "utf8");

      const links = await findBacklinks(mockDoc);
      assert.equal(links.length, 2);

      const rootItem = links.find((l) => l.label === "root.md");
      const subItem = links.find((l) => l.label === "subnote.md");

      assert.ok(rootItem);
      assert.ok(subItem);

      assert.equal(rootItem.path, "root.md");
      assert.equal(rootItem.relativePath, "../root.md");

      assert.equal(subItem.path, "sub/subnote.md");
      assert.equal(subItem.relativePath, "../sub/subnote.md");
    });
  });
});
