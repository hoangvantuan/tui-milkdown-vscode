import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  detectImageRenames,
  executeImageRenames,
  updateWorkspaceReferences,
  detectImageDeletes,
  executeImageDeletes,
  normalizePath,
  hasPathTraversal,
} from "../src/utils/image-rename-handler";
import {
  setWorkspaceRoot,
  setWarningChoice,
  getWarningCalls,
  getDeletedUris,
  resetStub,
} from "./vscode-stub";

describe("image-rename-handler", () => {
  let tmpDir: string;
  let docPath: string;
  let docUri: vscode.Uri;
  let imagesDir: string;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-img-test-"));
    imagesDir = path.join(tmpDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    docPath = path.join(tmpDir, "doc.md");
    fs.writeFileSync(docPath, "# Test doc\n", "utf8");
    docUri = vscode.Uri.file(docPath);
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    resetStub();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("path helpers", () => {
    it("normalizePath normalizes backslashes, leading ./, and multiple slashes", () => {
      assert.equal(normalizePath("images\\pic.png"), "images/pic.png");
      assert.equal(normalizePath("./images/pic.png"), "images/pic.png");
      assert.equal(normalizePath(".\\images\\sub\\\\pic.png"), "images/sub/pic.png");
      assert.equal(normalizePath("images///pic.png"), "images/pic.png");
    });

    it("hasPathTraversal detects traversal and absolute paths", () => {
      assert.equal(hasPathTraversal("../secret.png"), true);
      assert.equal(hasPathTraversal("images/../../secret.png"), true);
      assert.equal(hasPathTraversal("/root/pic.png"), true);
      assert.equal(hasPathTraversal("C:\\Windows\\pic.png"), true);
      assert.equal(hasPathTraversal("%2e%2e/pic.png"), true);

      // Safe paths
      assert.equal(hasPathTraversal("images/pic.png"), false);
      assert.equal(hasPathTraversal("images/my..pic.png"), false); // Double dot in filename is ok
    });
  });

  describe("detectImageRenames", () => {
    it("detects image rename within the same folder when source file exists", () => {
      const oldImg = path.join(imagesDir, "old.png");
      fs.writeFileSync(oldImg, "fake png content", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/old.png", oldImg],
      ]);
      const currentPaths = ["images/new.png"];

      const renames = detectImageRenames(originalPaths, currentPaths, docUri);
      assert.equal(renames.length, 1);
      assert.equal(renames[0].oldRelative, "images/old.png");
      assert.equal(renames[0].newRelative, "images/new.png");
      assert.equal(renames[0].oldAbsolute, oldImg);
      assert.equal(renames[0].newAbsolute, path.join(imagesDir, "new.png"));
    });

    it("does NOT detect rename when directory changes (different folder)", () => {
      const oldImg = path.join(imagesDir, "pic.png");
      fs.writeFileSync(oldImg, "fake png content", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/pic.png", oldImg],
      ]);
      // Directory changed to other/
      const currentPaths = ["other/pic.png"];

      const renames = detectImageRenames(originalPaths, currentPaths, docUri);
      assert.equal(renames.length, 0);
    });

    it("does NOT detect rename when path has path traversal", () => {
      const oldImg = path.join(imagesDir, "pic.png");
      fs.writeFileSync(oldImg, "fake png content", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/pic.png", oldImg],
      ]);
      const currentPaths = ["../images/pic2.png"];

      const renames = detectImageRenames(originalPaths, currentPaths, docUri);
      assert.equal(renames.length, 0);
    });

    it("does NOT detect rename when source file does not exist on disk", () => {
      const nonexistentImg = path.join(imagesDir, "ghost.png");

      const originalPaths = new Map<string, string>([
        ["images/ghost.png", nonexistentImg],
      ]);
      const currentPaths = ["images/new-ghost.png"];

      const renames = detectImageRenames(originalPaths, currentPaths, docUri);
      assert.equal(renames.length, 0);
    });

    it("does NOT detect rename when original path was not removed from document", () => {
      const oldImg = path.join(imagesDir, "img1.png");
      fs.writeFileSync(oldImg, "fake png", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/img1.png", oldImg],
      ]);
      // Both old and new are present in document (e.g. pasted a new image)
      const currentPaths = ["images/img1.png", "images/img2.png"];

      const renames = detectImageRenames(originalPaths, currentPaths, docUri);
      assert.equal(renames.length, 0);
    });
  });

  describe("executeImageRenames", () => {
    it("renames source file to target file on disk", async () => {
      const oldImg = path.join(imagesDir, "source.png");
      const newImg = path.join(imagesDir, "renamed.png");
      fs.writeFileSync(oldImg, "image data", "utf8");

      const renames = [
        {
          oldRelative: "images/source.png",
          newRelative: "images/renamed.png",
          oldAbsolute: oldImg,
          newAbsolute: newImg,
        },
      ];

      const result = await executeImageRenames(renames);
      assert.equal(result.succeeded.length, 1);
      assert.equal(result.failed.length, 0);
      assert.equal(fs.existsSync(oldImg), false);
      assert.equal(fs.existsSync(newImg), true);
      assert.equal(fs.readFileSync(newImg, "utf8"), "image data");
    });

    it("prompts warning and skips rename when target file already exists and user chooses Skip", async () => {
      const oldImg = path.join(imagesDir, "source.png");
      const newImg = path.join(imagesDir, "existing.png");
      fs.writeFileSync(oldImg, "source data", "utf8");
      fs.writeFileSync(newImg, "existing data", "utf8");

      setWarningChoice("Skip");

      const renames = [
        {
          oldRelative: "images/source.png",
          newRelative: "images/existing.png",
          oldAbsolute: oldImg,
          newAbsolute: newImg,
        },
      ];

      const result = await executeImageRenames(renames);
      assert.equal(result.succeeded.length, 0);
      assert.equal(result.failed.length, 1);
      assert.match(result.failed[0].error, /Skipped - target exists/);

      // Warning was recorded
      const warnings = getWarningCalls();
      assert.equal(warnings.length, 1);
      assert.match(warnings[0].message, /already exists/);

      // Files remain unchanged
      assert.equal(fs.existsSync(oldImg), true);
      assert.equal(fs.readFileSync(newImg, "utf8"), "existing data");
    });

    it("overwrites target file when user chooses Overwrite", async () => {
      const oldImg = path.join(imagesDir, "source.png");
      const newImg = path.join(imagesDir, "existing.png");
      fs.writeFileSync(oldImg, "new data", "utf8");
      fs.writeFileSync(newImg, "old data", "utf8");

      setWarningChoice("Overwrite");

      const renames = [
        {
          oldRelative: "images/source.png",
          newRelative: "images/existing.png",
          oldAbsolute: oldImg,
          newAbsolute: newImg,
        },
      ];

      const result = await executeImageRenames(renames);
      assert.equal(result.succeeded.length, 1);
      assert.equal(result.failed.length, 0);
      assert.equal(fs.existsSync(oldImg), false);
      assert.equal(fs.readFileSync(newImg, "utf8"), "new data");
    });
  });

  describe("detectImageDeletes and executeImageDeletes", () => {
    it("detects image deletion when original path is absent from current paths", () => {
      const imgPath = path.join(imagesDir, "todelete.png");
      fs.writeFileSync(imgPath, "content", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/todelete.png", imgPath],
      ]);
      const currentPaths: string[] = [];

      const deletes = detectImageDeletes(originalPaths, currentPaths);
      assert.equal(deletes.length, 1);
      assert.equal(deletes[0].relativePath, "images/todelete.png");
      assert.equal(deletes[0].absolutePath, imgPath);
    });

    it("does NOT detect delete when same filename exists in another folder (move operation)", () => {
      const imgPath = path.join(imagesDir, "moved.png");
      fs.writeFileSync(imgPath, "content", "utf8");

      const originalPaths = new Map<string, string>([
        ["images/moved.png", imgPath],
      ]);
      // Filename "moved.png" is still present in "other_dir/moved.png"
      const currentPaths = ["other_dir/moved.png"];

      const deletes = detectImageDeletes(originalPaths, currentPaths);
      assert.equal(deletes.length, 0);
    });

    it("executes image deletes by removing file from disk", async () => {
      const imgPath = path.join(imagesDir, "doomed.png");
      fs.writeFileSync(imgPath, "doomed content", "utf8");

      const deletes = [
        {
          relativePath: "images/doomed.png",
          absolutePath: imgPath,
          usedInFiles: [],
        },
      ];

      const result = await executeImageDeletes(deletes);
      assert.equal(result.succeeded.length, 1);
      assert.equal(result.failed.length, 0);
      assert.equal(fs.existsSync(imgPath), false);
      assert.equal(getDeletedUris().length, 1);
    });
  });

  describe("updateWorkspaceReferences", () => {
    it("rewrites standard references, space-containing paths wrapped in <...>, and HTML img tags, skipping code fences", async () => {
      const otherDocPath = path.join(tmpDir, "other.md");
      const initialContent = [
        "# Other Document",
        "![Normal](images/old.png)",
        "![With spaces](<images/old with spaces.png>)",
        "Link to [file](images/old.png)",
        '<img src="images/old.png" alt="html" />',
        "",
        "```markdown",
        "Inside code fence: ![Preserved](images/old.png)",
        "```",
        "",
        "End of doc.",
      ].join("\n");

      fs.writeFileSync(otherDocPath, initialContent, "utf8");

      const renames = [
        {
          oldRelative: "images/old.png",
          newRelative: "images/new.png",
          oldAbsolute: path.join(imagesDir, "old.png"),
          newAbsolute: path.join(imagesDir, "new.png"),
        },
        {
          oldRelative: "images/old with spaces.png",
          newRelative: "images/new with spaces.png",
          oldAbsolute: path.join(imagesDir, "old with spaces.png"),
          newAbsolute: path.join(imagesDir, "new with spaces.png"),
        },
      ];

      // Exclude the current document
      const updatedCount = await updateWorkspaceReferences(renames, docUri);
      assert.equal(updatedCount, 1);

      const updatedContent = fs.readFileSync(otherDocPath, "utf8");

      // Verify normal reference updated
      assert.ok(updatedContent.includes("![Normal](images/new.png)"));
      assert.ok(updatedContent.includes("Link to [file](images/new.png)"));

      // Verify space-containing path updated and wrapped in <...>
      assert.ok(updatedContent.includes("![With spaces](<images/new with spaces.png>)"));

      // Verify HTML img tag updated
      assert.ok(updatedContent.includes('<img src="images/new.png" alt="html" />'));

      // Verify code fence content is untouched
      assert.ok(updatedContent.includes("Inside code fence: ![Preserved](images/old.png)"));
    });

    it("skips excluded active document URI", async () => {
      // docUri is active document
      fs.writeFileSync(docPath, "![Self](images/old.png)\n", "utf8");

      const renames = [
        {
          oldRelative: "images/old.png",
          newRelative: "images/new.png",
          oldAbsolute: path.join(imagesDir, "old.png"),
          newAbsolute: path.join(imagesDir, "new.png"),
        },
      ];

      const updatedCount = await updateWorkspaceReferences(renames, docUri);
      assert.equal(updatedCount, 0);

      // docPath content remains unchanged
      assert.equal(fs.readFileSync(docPath, "utf8"), "![Self](images/old.png)\n");
    });
  });
});
