/**
 * #126: an image still referenced by another document must not go to the Trash
 * without a word.
 *
 * Two layers are covered here, because the bug lived in the seam between them:
 * `populateImageUsage` answers "who else points at this file", and
 * `handleDocumentSave` decides what to do with that answer. The field it fills
 * existed with a `// Will be populated by caller` note and no caller, so a test
 * of either half alone would have passed on the broken code.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { populateImageUsage } from "../src/host/imageUsage";
import { handleDocumentSave } from "../src/host/documentSave";
import { buildOriginalImageMap } from "../src/host/imagePaths";
import type { ImageDelete } from "../src/utils/image-rename-handler";
import {
  setWorkspaceRoot,
  setWarningChoice,
  getWarningCalls,
  resetStub,
} from "./vscode-stub";

const DELETE_ANYWAY = "Delete Anyway";

describe("image usage across documents (#126)", () => {
  let tmpDir: string;
  let imagesDir: string;
  let docPath: string;
  let docUri: vscode.Uri;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-img-usage-"));
    imagesDir = path.join(tmpDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    docPath = path.join(tmpDir, "a.md");
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

  function makeDelete(relative: string): ImageDelete {
    return {
      relativePath: relative,
      absolutePath: path.join(tmpDir, relative),
      usedInFiles: [],
    };
  }

  describe("populateImageUsage", () => {
    it("records a sibling document that references the same image", async () => {
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      const deletes = [makeDelete("images/shared.png")];

      await populateImageUsage(deletes, docUri);

      assert.deepEqual(deletes[0].usedInFiles, ["b.md"]);
    });

    it("matches by resolved path, so a subfolder document writing ../images/x.png counts", async () => {
      const subDir = path.join(tmpDir, "notes");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "c.md"), "![up](../images/shared.png)\n", "utf8");
      const deletes = [makeDelete("images/shared.png")];

      await populateImageUsage(deletes, docUri);

      assert.deepEqual(deletes[0].usedInFiles, ["notes/c.md"]);
    });

    it("counts an <img src> reference too", async () => {
      fs.writeFileSync(path.join(tmpDir, "b.md"), '<img src="images/shared.png">\n', "utf8");
      const deletes = [makeDelete("images/shared.png")];

      await populateImageUsage(deletes, docUri);

      assert.deepEqual(deletes[0].usedInFiles, ["b.md"]);
    });

    it("never counts the saved document itself", async () => {
      fs.writeFileSync(docPath, "![still here](images/shared.png)\n", "utf8");
      const deletes = [makeDelete("images/shared.png")];

      await populateImageUsage(deletes, docUri);

      assert.deepEqual(deletes[0].usedInFiles, []);
    });

    it("leaves usedInFiles empty when a same-named image lives in another folder", async () => {
      fs.mkdirSync(path.join(tmpDir, "other"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![elsewhere](other/shared.png)\n", "utf8");
      const deletes = [makeDelete("images/shared.png")];

      await populateImageUsage(deletes, docUri);

      assert.deepEqual(deletes[0].usedInFiles, []);
    });
  });

  describe("handleDocumentSave", () => {
    // `handleDocumentSave` only reads `uri` and `getText()` off the document.
    // `getText` is a live read in production, and one test depends on that.
    function fakeDoc(uri: vscode.Uri, text: () => string): vscode.TextDocument {
      return { uri, getText: text } as unknown as vscode.TextDocument;
    }

    async function save(
      textAfterSave: string,
      textBefore: string,
    ): Promise<void> {
      const originalImagePaths = new Map<string, Map<string, string>>();
      originalImagePaths.set(docUri.toString(), buildOriginalImageMap(textBefore, docUri));
      const doc = fakeDoc(docUri, () => textAfterSave);
      await handleDocumentSave(doc, doc, docUri.toString(), originalImagePaths);
    }

    it("deletes an image nothing else references, with no warning", async () => {
      const lone = path.join(imagesDir, "lone.png");
      fs.writeFileSync(lone, "png", "utf8");

      await save("# a\n", "# a\n\n![lone](images/lone.png)\n");

      assert.equal(fs.existsSync(lone), false);
      assert.equal(getWarningCalls().length, 0);
    });

    it("asks before deleting an image another document still references", async () => {
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      setWarningChoice("Keep");

      await save("# a\n", "# a\n\n![shared](images/shared.png)\n");

      assert.equal(fs.existsSync(shared), true);
      const calls = getWarningCalls();
      assert.equal(calls.length, 1);
      assert.ok(calls[0].message.includes("b.md"), calls[0].message);
      assert.ok(calls[0].items.includes(DELETE_ANYWAY));
    });

    it("keeps the image when the warning is dismissed rather than answered", async () => {
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      setWarningChoice(() => undefined);

      await save("# a\n", "# a\n\n![shared](images/shared.png)\n");

      assert.equal(fs.existsSync(shared), true);
      assert.equal(getWarningCalls().length, 1);
    });

    it("deletes the shared image when the answer is the button", async () => {
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      setWarningChoice(DELETE_ANYWAY);

      await save("# a\n", "# a\n\n![shared](images/shared.png)\n");

      assert.equal(fs.existsSync(shared), false);
      assert.equal(getWarningCalls().length, 1);
    });

    it("deletes the lone image and keeps the shared one from the same save", async () => {
      const lone = path.join(imagesDir, "lone.png");
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(lone, "png", "utf8");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      setWarningChoice("Keep");

      await save(
        "# a\n",
        "# a\n\n![lone](images/lone.png)\n![shared](images/shared.png)\n",
      );

      assert.equal(fs.existsSync(lone), false);
      assert.equal(fs.existsSync(shared), true);
      assert.equal(getWarningCalls().length, 1);
    });

    // The two saves are started CONCURRENTLY on purpose. Awaited one after the
    // other, a rebuild at the end of the handler would also be done before the
    // second call began, and this test would pass on the ordering it exists to
    // reject. Overlapped, only a rebuild taken before the first `await` — the
    // one inside populateImageUsage — is visible to the second call.
    it("re-baselines before the prompt, so a save landing during it cannot ask again", async () => {
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");
      setWarningChoice("Keep");

      const originalImagePaths = new Map<string, Map<string, string>>();
      const docKey = docUri.toString();
      originalImagePaths.set(
        docKey,
        buildOriginalImageMap("# a\n\n![shared](images/shared.png)\n", docUri),
      );
      const doc = fakeDoc(docUri, () => "# a\n");

      await Promise.all([
        handleDocumentSave(doc, doc, docKey, originalImagePaths),
        handleDocumentSave(doc, doc, docKey, originalImagePaths),
      ]);

      assert.equal(getWarningCalls().length, 1);
      assert.equal(fs.existsSync(shared), true);
    });

    it("does not act on a Yes that the document has since made stale", async () => {
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");

      // The prompt has no deadline. Here the user puts the image back while it
      // is open, then answers it.
      let text = "# a\n";
      setWarningChoice(() => {
        text = "# a\n\n![shared](images/shared.png)\n";
        return DELETE_ANYWAY;
      });

      const originalImagePaths = new Map<string, Map<string, string>>();
      const docKey = docUri.toString();
      originalImagePaths.set(
        docKey,
        buildOriginalImageMap("# a\n\n![shared](images/shared.png)\n", docUri),
      );
      const doc = fakeDoc(docUri, () => text);

      await handleDocumentSave(doc, doc, docKey, originalImagePaths);

      assert.equal(getWarningCalls().length, 1);
      assert.equal(fs.existsSync(shared), true);
    });

    it("trashes an unreferenced image without waiting for the prompt about another", async () => {
      const lone = path.join(imagesDir, "lone.png");
      const shared = path.join(imagesDir, "shared.png");
      fs.writeFileSync(lone, "png", "utf8");
      fs.writeFileSync(shared, "png", "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.md"), "![shared](images/shared.png)\n", "utf8");

      // The prompt answers only once the lone image is already gone, which is
      // only true if the unreferenced delete does not queue behind it.
      let loneGoneWhenAsked: boolean | undefined;
      setWarningChoice(() => {
        loneGoneWhenAsked = !fs.existsSync(lone);
        return "Keep";
      });

      await save(
        "# a\n",
        "# a\n\n![lone](images/lone.png)\n![shared](images/shared.png)\n",
      );

      assert.equal(loneGoneWhenAsked, true);
      assert.equal(fs.existsSync(shared), true);
    });

    it("does nothing when autoDeleteImages is off", async () => {
      fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".vscode", "settings.json"),
        JSON.stringify({ "tuiMarkdown.autoDeleteImages": false }),
        "utf8",
      );
      const lone = path.join(imagesDir, "lone.png");
      fs.writeFileSync(lone, "png", "utf8");

      await save("# a\n", "# a\n\n![lone](images/lone.png)\n");

      assert.equal(fs.existsSync(lone), true);
      assert.equal(getWarningCalls().length, 0);
    });
  });
});
