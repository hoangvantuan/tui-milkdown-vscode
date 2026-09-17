import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { openWikiLink } from "../src/host/openWikiLink";
import {
  setWorkspaceRoot,
  setWarningChoice,
  getWarningCalls,
  getExecutedCommands,
  resetStub,
} from "./vscode-stub";

describe("openWikiLink", () => {
  let tmpDir: string;
  let docDir: string;
  let docPath: string;
  let docUri: vscode.Uri;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-wiki-test-"));
    docDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docDir, { recursive: true });
    docPath = path.join(docDir, "index.md");
    fs.writeFileSync(docPath, "# Test index\n", "utf8");
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

  it("resolves and opens an existing file", async () => {
    const existingPath = path.join(docDir, "existing.md");
    fs.writeFileSync(existingPath, "# Existing\n", "utf8");

    const opened = await openWikiLink("existing", docUri);

    assert.ok(opened, "should return resolved Uri");
    assert.equal(opened.fsPath, existingPath);
    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, "vscode.open");
    assert.equal(cmds[0].args[0].fsPath, existingPath);
  });

  it("creates a missing file next to the current document and opens it", async () => {
    const expectedPath = path.join(docDir, "new-note.md");
    assert.equal(fs.existsSync(expectedPath), false, "file should not exist before call");

    const opened = await openWikiLink("new-note", docUri);

    assert.ok(opened, "should return created Uri");
    assert.equal(opened.fsPath, expectedPath);
    assert.equal(fs.existsSync(expectedPath), true, "file must be created on disk");

    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, "vscode.open");
    assert.equal(cmds[0].args[0].fsPath, expectedPath);

    const warnings = getWarningCalls();
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].message.includes("new-note.md"));
    assert.deepEqual(warnings[0].items, ["Create"]);
  });

  it("creates a missing file with path separator in subfolder next to current document", async () => {
    const expectedPath = path.join(docDir, "sub", "deep-note.md");
    assert.equal(fs.existsSync(expectedPath), false, "nested file should not exist before call");

    const opened = await openWikiLink("sub/deep-note", docUri);

    assert.ok(opened, "should return created Uri");
    assert.equal(opened.fsPath, expectedPath);
    assert.equal(fs.existsSync(expectedPath), true, "nested file must be created on disk");

    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, "vscode.open");
    assert.equal(cmds[0].args[0].fsPath, expectedPath);
  });

  it("refuses to create a file that would escape the document folder", async () => {
    const escapedPath = path.resolve(docDir, "../escaped.md");
    assert.equal(fs.existsSync(escapedPath), false);

    const opened = await openWikiLink("../escaped", docUri);

    assert.equal(opened, undefined, "should not return uri for escaped target");
    assert.equal(fs.existsSync(escapedPath), false, "must NOT create file outside document folder");

    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 0, "should not execute open command");

    const warnings = getWarningCalls();
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].message.includes("escaped.md"));
    // When path traversal is detected, no "Create" action is offered
    assert.deepEqual(warnings[0].items, []);
  });

  it("does not create file when user declines the creation prompt", async () => {
    setWarningChoice(() => undefined); // user dismisses dialog without clicking Create
    const expectedPath = path.join(docDir, "declined.md");

    const opened = await openWikiLink("declined", docUri);

    assert.equal(opened, undefined);
    assert.equal(fs.existsSync(expectedPath), false, "file must NOT be created when dismissed");
    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 0);
  });
});
