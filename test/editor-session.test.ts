/**
 * Unit tests for EditorSession (#146).
 *
 * Verifies that:
 * 1. An in-flight edit is awaited before isDisposed is set (#104 teardown order).
 * 2. updateWebview does not post while withPendingEdit is active, and the flag clears on microtask.
 * 3. Concurrent exports: second is rejected; after first completes (or throws), a new export is accepted.
 * 4. handleExport rejects duplicate export requests with busy reason via withExportLock.
 * 5. handleRequestImageRename executes document updates via withPendingEdit.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { EditorSession } from "../src/host/session";
import { ImageLedger } from "../src/host/imageLedger";
import { handleExport } from "../src/host/exportDocument";
import { handleRequestImageRename } from "../src/host/requestImageRename";
import type { TypedWebview } from "../src/host/typedWebview";
import type { ExportMessage, RequestImageRenameMessage } from "../src/shared/messages";
import {
  setWorkspaceRoot,
  setApplyEditHandler,
  resetStub,
} from "./vscode-stub";

interface MockWebview {
  messages: any[];
  postMessage: (msg: any) => Promise<boolean>;
  asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
}

function createMockWebview(): MockWebview {
  const messages: any[] = [];
  return {
    messages,
    postMessage: async (msg: any) => {
      messages.push(msg);
      return true;
    },
    asWebviewUri: (uri: vscode.Uri) => uri,
  };
}

function createMockDoc(uri: vscode.Uri, initialText: string): vscode.TextDocument {
  let text = initialText;
  return {
    uri,
    getText: () => text,
    eol: vscode.EndOfLine.LF,
    positionAt: (offset: number) => new vscode.Position(0, offset),
    isClosed: false,
  } as unknown as vscode.TextDocument;
}

describe("EditorSession (#146)", () => {
  let tmpDir: string;
  let imagesDir: string;
  let docPath: string;
  let docUri: vscode.Uri;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-session-test-"));
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

  it("1. #104: an in-flight edit is awaited before isDisposed becomes true", async () => {
    let resolveEdit!: () => void;
    const editDeferred = new Promise<boolean>((resolve) => {
      resolveEdit = () => resolve(true);
    });

    setApplyEditHandler(async () => {
      await editDeferred;
      return true;
    });

    const doc = createMockDoc(docUri, "# Initial text\n");
    const webviewMock = createMockWebview();
    const ledger = new ImageLedger("# Initial text\n", docUri);
    const session = new EditorSession(
      doc,
      { webview: webviewMock } as unknown as vscode.WebviewPanel,
      ledger,
    );

    // Trigger an edit
    const applyPromise = session.applyEdit("# Changed text\n");

    // Immediately trigger dispose while edit is still in flight
    session.dispose();

    // Give setImmediate a turn to execute up to the await
    await new Promise((resolve) => setImmediate(resolve));

    // The edit is still awaiting editDeferred, so isDisposed must NOT be true yet
    assert.equal(
      session.isDisposed,
      false,
      "Session must not be disposed while in-flight edit is pending",
    );

    // Resolve the edit
    resolveEdit();
    await applyPromise;

    // Give setImmediate continuation a turn to run
    await new Promise((resolve) => setImmediate(resolve));

    // Now dispose has completed and isDisposed is true
    assert.equal(
      session.isDisposed,
      true,
      "Session must be disposed after in-flight edit settles",
    );
  });

  it("2. updateWebview does not post while withPendingEdit is active, and flag clears on microtask", async () => {
    const doc = createMockDoc(docUri, "# Content\n");
    const webviewMock = createMockWebview();
    const ledger = new ImageLedger("# Content\n", docUri);
    const session = new EditorSession(
      doc,
      { webview: webviewMock } as unknown as vscode.WebviewPanel,
      ledger,
    );

    let ranInside = false;
    let flagInside = false;

    await session.withPendingEdit(async () => {
      ranInside = true;
      flagInside = session.isApplyingEdit;

      // Attempt to update webview while withPendingEdit is active
      session.updateWebview();
    });

    assert.equal(ranInside, true);
    assert.equal(
      flagInside,
      true,
      "isApplyingEdit must be true inside withPendingEdit",
    );

    // Wait past the 50ms debounce window
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(
      webviewMock.messages.length,
      0,
      "updateWebview must not post while pendingEdit flag was set",
    );

    // After withPendingEdit completes and microtask runs, flag is false
    assert.equal(
      session.isApplyingEdit,
      false,
      "isApplyingEdit must be cleared after microtask",
    );

    // Now updateWebview should work
    session.updateWebview();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(
      webviewMock.messages.length,
      1,
      "updateWebview must post once flag is cleared",
    );
    assert.equal(webviewMock.messages[0].type, "update");
  });

  it("3. concurrent exports: second is rejected; after first completes (or throws), a new export is accepted", async () => {
    const doc = createMockDoc(docUri, "# Export Content\n");
    const webviewMock = createMockWebview();
    const ledger = new ImageLedger("# Export Content\n", docUri);
    const session = new EditorSession(
      doc,
      { webview: webviewMock } as unknown as vscode.WebviewPanel,
      ledger,
    );

    // 1. First export acquires lock
    let resolveExport1!: () => void;
    const export1Promise = new Promise<void>((resolve) => {
      resolveExport1 = resolve;
    });
    const ok1 = session.withExportLock(async () => {
      await export1Promise;
    });
    assert.equal(ok1, true, "First export must acquire the lock");

    // 2. Second concurrent export is rejected
    let secondRan = false;
    const ok2 = session.withExportLock(async () => {
      secondRan = true;
    });
    assert.equal(ok2, false, "Second overlapping export must be rejected");
    assert.equal(secondRan, false, "Second export action must not run");

    // 3. Complete first export
    resolveExport1();
    await new Promise((r) => setImmediate(r));

    // 4. Third export now succeeds
    let thirdRan = false;
    const ok3 = session.withExportLock(async () => {
      thirdRan = true;
    });
    assert.equal(ok3, true, "New export must succeed after previous finishes");
    await new Promise((r) => setImmediate(r));
    assert.equal(thirdRan, true, "Third export action must run");

    // 5. Test export error handling
    let rejectExport4!: (err: Error) => void;
    const export4Promise = new Promise<void>((_, reject) => {
      rejectExport4 = reject;
    });
    const ok4 = session.withExportLock(async () => {
      await export4Promise;
    });
    assert.equal(ok4, true, "Fourth export must acquire the lock");

    const ok5 = session.withExportLock(async () => {});
    assert.equal(ok5, false, "Concurrent export during fourth must be rejected");

    // Fourth export fails
    rejectExport4(new Error("Disk full"));
    await new Promise((r) => setImmediate(r));

    // Lock must be released in finally despite failure
    let sixthRan = false;
    const ok6 = session.withExportLock(async () => {
      sixthRan = true;
    });
    assert.equal(ok6, true, "New export must succeed even after previous threw");
    await new Promise((r) => setImmediate(r));
    assert.equal(sixthRan, true, "Sixth export action must run");
  });

  it("handleExport rejects overlapping request with busy response", async () => {
    const doc = createMockDoc(docUri, "# Test Export\n");
    const webviewMock = createMockWebview();
    const ledger = new ImageLedger("# Test Export\n", docUri);
    const session = new EditorSession(
      doc,
      { webview: webviewMock } as unknown as vscode.WebviewPanel,
      ledger,
    );

    let resolveActiveExport!: () => void;
    const activePromise = new Promise<void>((resolve) => {
      resolveActiveExport = resolve;
    });

    // Manually hold export lock
    session.withExportLock(async () => {
      await activePromise;
    });

    // Invoke handleExport while lock is held
    const exportMsg: ExportMessage = {
      type: "export",
      format: "docx",
    };
    handleExport(
      exportMsg,
      doc,
      webviewMock as unknown as TypedWebview,
      (action) => session.withExportLock(action),
    );

    // Expect busy response posted to webview
    assert.equal(webviewMock.messages.length, 1);
    assert.deepEqual(webviewMock.messages[0], {
      type: "exportDone",
      success: false,
      reason: "busy",
    });

    // Release lock
    resolveActiveExport();
    await new Promise((r) => setImmediate(r));
  });

  it("handleRequestImageRename executes edit under withPendingEdit", async () => {
    const origFile = path.join(imagesDir, "old.png");
    fs.writeFileSync(origFile, "image-bytes", "utf8");

    const initialText = "# Title\n\n![img](images/old.png)\n";
    const doc = createMockDoc(docUri, initialText);
    const webviewMock = createMockWebview();
    const ledger = new ImageLedger(initialText, docUri);
    const session = new EditorSession(
      doc,
      { webview: webviewMock } as unknown as vscode.WebviewPanel,
      ledger,
    );

    let withPendingEditCalled = false;
    let sawPendingEditActive = false;

    const wrappedWithPendingEdit = async <T>(action: () => Promise<T>): Promise<T> => {
      return await session.withPendingEdit(async () => {
        withPendingEditCalled = true;
        sawPendingEditActive = session.isApplyingEdit;
        return await action();
      });
    };

    const renameMsg: RequestImageRenameMessage = {
      type: "requestImageRename",
      renameId: "rename-1",
      oldPath: "images/old.png",
      newPath: "images/new.png",
    };

    handleRequestImageRename(
      renameMsg,
      doc,
      webviewMock as unknown as TypedWebview,
      ledger,
      wrappedWithPendingEdit,
    );

    // Wait for the async IIFE inside handleRequestImageRename
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(withPendingEditCalled, true, "handleRequestImageRename must use withPendingEdit");
    assert.equal(sawPendingEditActive, true, "isApplyingEdit must be active during document edit");
    assert.equal(session.isApplyingEdit, false, "isApplyingEdit must be cleared after completion");
  });
});
