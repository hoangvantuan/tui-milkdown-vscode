/**
 * Unit tests for ImageLedger (#144).
 *
 * Verifies that ImageLedger encapsulates per-document image baseline state,
 * supports rename detection and execution with optimistic baseline updates,
 * enforces mutual exclusion during concurrent renames, and survives the race
 * where a save lands while an async rename is awaiting.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ImageLedger } from "../src/host/imageLedger";
import { handleDocumentSave } from "../src/host/documentSave";
import type { ImageRename } from "../src/utils/image-rename-handler";
import {
  setWorkspaceRoot,
  setWarningChoice,
  getWarningCalls,
  resetStub,
} from "./vscode-stub";

describe("ImageLedger (#144)", () => {
  let tmpDir: string;
  let imagesDir: string;
  let docPath: string;
  let docUri: vscode.Uri;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-ledger-test-"));
    imagesDir = path.join(tmpDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    docPath = path.join(tmpDir, "doc.md");
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

  function fakeDoc(uri: vscode.Uri, text: () => string): vscode.TextDocument {
    return { uri, getText: text } as unknown as vscode.TextDocument;
  }

  it("1. setting a baseline then providing content with a changed path detects exactly one rename", () => {
    const origFile = path.join(imagesDir, "photo.png");
    fs.writeFileSync(origFile, "data", "utf8");

    const initialContent = "# Note\n\n![photo](images/photo.png)\n";
    const ledger = new ImageLedger(initialContent, docUri);

    assert.equal(ledger.getBaseline().has("images/photo.png"), true);
    assert.equal(ledger.getBaseline().size, 1);

    const editedContent = "# Note\n\n![photo](images/renamed-photo.png)\n";
    const renames = ledger.detectRenames(editedContent, docUri);

    assert.equal(renames.length, 1);
    assert.equal(renames[0].oldRelative, "images/photo.png");
    assert.equal(renames[0].newRelative, "images/renamed-photo.png");
    assert.equal(renames[0].oldAbsolute, origFile);
    assert.equal(
      renames[0].newAbsolute,
      path.resolve(tmpDir, "images/renamed-photo.png"),
    );
  });

  it("2. setting a baseline after save discards the old map and the next detection uses the new baseline", () => {
    const fileA = path.join(imagesDir, "a.png");
    const fileB = path.join(imagesDir, "b.png");
    fs.writeFileSync(fileA, "dataA", "utf8");
    fs.writeFileSync(fileB, "dataB", "utf8");

    const contentA = "# Note\n\n![a](images/a.png)\n";
    const ledger = new ImageLedger(contentA, docUri);
    assert.equal(ledger.getBaseline().has("images/a.png"), true);

    // Save replaces the baseline with content containing b.png
    const contentB = "# Note\n\n![b](images/b.png)\n";
    const oldBaseline = ledger.setBaseline(contentB, docUri);

    // Returned old baseline should have a.png
    assert.equal(oldBaseline.has("images/a.png"), true);
    assert.equal(oldBaseline.has("images/b.png"), false);

    // Current baseline should have b.png, not a.png
    assert.equal(ledger.getBaseline().has("images/b.png"), true);
    assert.equal(ledger.getBaseline().has("images/a.png"), false);

    // Next rename detection from b.png to c.png compares against b.png
    const contentC = "# Note\n\n![c](images/c.png)\n";
    const renames = ledger.detectRenames(contentC, docUri);

    assert.equal(renames.length, 1);
    assert.equal(renames[0].oldRelative, "images/b.png");
    assert.equal(renames[0].newRelative, "images/c.png");
  });

  it("3. two concurrent applyRenames calls: second is rejected (renameInProgress lock)", async () => {
    const file = path.join(imagesDir, "img.png");
    fs.writeFileSync(file, "data", "utf8");

    const content = "![img](images/img.png)";
    const ledger = new ImageLedger(content, docUri);

    const rename1: ImageRename = {
      oldRelative: "images/img.png",
      newRelative: "images/img1.png",
      oldAbsolute: file,
      newAbsolute: path.join(imagesDir, "img1.png"),
    };

    const rename2: ImageRename = {
      oldRelative: "images/img.png",
      newRelative: "images/img2.png",
      oldAbsolute: file,
      newAbsolute: path.join(imagesDir, "img2.png"),
    };

    let finishRename1!: () => void;
    const rename1Promise = new Promise<void>((resolve) => {
      finishRename1 = resolve;
    });

    const customExecutor1 = async (renames: ImageRename[]) => {
      await rename1Promise;
      return { succeeded: renames, failed: [] };
    };

    // Start first rename (will block until finishRename1 is called)
    const run1 = ledger.applyRenames([rename1], customExecutor1);

    // Lock is held
    assert.equal(ledger.renameInProgress, true);

    // Second call while first is in progress
    const run2Result = await ledger.applyRenames([rename2]);
    assert.equal(run2Result, null, "Second concurrent rename must be rejected");

    // Complete first rename
    finishRename1();
    const run1Result = await run1;
    assert.ok(run1Result);
    assert.equal(run1Result.succeeded.length, 1);

    // Lock is released after completion
    assert.equal(ledger.renameInProgress, false);
  });

  it("4. save arriving while a rename is awaiting does not lose the rename result and does not make next save ask about the removed image", async () => {
    const origFile = path.join(imagesDir, "shared.png");
    fs.writeFileSync(origFile, "data", "utf8");

    // Sibling document references shared.png so any delete detection would trigger a prompt
    fs.writeFileSync(
      path.join(tmpDir, "sibling.md"),
      "![shared](images/shared.png)\n",
      "utf8",
    );
    setWarningChoice("Keep");

    const contentBefore = "# Title\n\n![shared](images/shared.png)\n";
    const ledger = new ImageLedger(contentBefore, docUri);

    const renames = ledger.detectRenames(
      "# Title\n\n![shared](images/shared-renamed.png)\n",
      docUri,
    );
    assert.equal(renames.length, 1);

    // Delayed executor simulating async disk I/O
    let completeDiskRename!: () => void;
    const diskRenameGate = new Promise<void>((resolve) => {
      completeDiskRename = resolve;
    });

    const delayedExecutor = async (items: ImageRename[]) => {
      await diskRenameGate;
      // Perform the actual rename on disk
      fs.renameSync(items[0].oldAbsolute, items[0].newAbsolute);
      return { succeeded: items, failed: [] };
    };

    // 1. Rename begins and is in-flight (awaiting disk I/O)
    const renamePromise = ledger.applyRenames(renames, delayedExecutor);
    assert.equal(ledger.renameInProgress, true);

    // 2. WHILE rename is awaiting, a save arrives!
    const savedText = "# Title\n\n![shared](images/shared-renamed.png)\n";
    const doc = fakeDoc(docUri, () => savedText);

    await handleDocumentSave(doc, doc, ledger);

    // Baseline was updated optimistically so delete detection saw shared-renamed.png, NOT shared.png
    // It must NOT prompt about shared.png being deleted!
    assert.equal(
      getWarningCalls().length,
      0,
      "Save during in-flight rename must not ask to delete the renamed image",
    );

    // 3. Disk rename finishes
    completeDiskRename();
    const renameResult = await renamePromise;
    assert.ok(renameResult);
    assert.equal(renameResult.succeeded.length, 1);

    // The rename result is intact in the ledger baseline
    assert.equal(ledger.getBaseline().has("images/shared-renamed.png"), true);
    assert.equal(ledger.getBaseline().has("images/shared.png"), false);

    // 4. A subsequent save arrives
    await handleDocumentSave(doc, doc, ledger);

    // Subsequent save must still NOT prompt about shared.png
    assert.equal(
      getWarningCalls().length,
      0,
      "Subsequent save must not ask about the image that was renamed",
    );
    assert.equal(fs.existsSync(path.join(imagesDir, "shared-renamed.png")), true);
  });

  it("reverts baseline when rename execution fails", async () => {
    const origFile = path.join(imagesDir, "fail.png");
    fs.writeFileSync(origFile, "data", "utf8");

    const content = "![fail](images/fail.png)";
    const ledger = new ImageLedger(content, docUri);

    const renames = ledger.detectRenames("![fail](images/target.png)", docUri);
    assert.equal(renames.length, 1);

    const failingExecutor = async (items: ImageRename[]) => {
      return {
        succeeded: [],
        failed: [{ rename: items[0], error: "disk error" }],
      };
    };

    const result = await ledger.applyRenames(renames, failingExecutor);
    assert.ok(result);
    assert.equal(result.failed.length, 1);

    // Baseline should be reverted to original
    assert.equal(ledger.getBaseline().has("images/fail.png"), true);
    assert.equal(ledger.getBaseline().has("images/target.png"), false);
  });

  it("updateEntry updates the baseline for direct renames", () => {
    const content = "![img](images/old.png)";
    const ledger = new ImageLedger(content, docUri);
    assert.equal(ledger.getBaseline().has("images/old.png"), true);

    ledger.updateEntry("images/old.png", "images/new.png", "/abs/images/new.png");
    assert.equal(ledger.getBaseline().has("images/old.png"), false);
    assert.equal(ledger.getBaseline().get("images/new.png"), "/abs/images/new.png");
  });

  it("dispose clears baseline and lock", () => {
    const content = "![img](images/a.png)";
    const ledger = new ImageLedger(content, docUri);
    assert.equal(ledger.getBaseline().size, 1);

    ledger.acquireRenameLock();
    assert.equal(ledger.renameInProgress, true);

    ledger.dispose();
    assert.equal(ledger.getBaseline().size, 0);
    assert.equal(ledger.renameInProgress, false);
  });
});
