import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  getEditorPositionKey,
  clampPosition,
  clampScrollTop,
  saveEditorPosition,
  getSavedEditorPosition,
  sendSavedEditorPosition,
  EditorPosition,
} from "../src/host/editorPosition";
import type { TypedWebview } from "../src/host/typedWebview";

class MockMemento implements vscode.Memento {
  private store = new Map<string, any>();

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }
}

describe("editor-position", () => {
  describe("getEditorPositionKey", () => {
    it("derives deterministic key from Uri and string", () => {
      const uri = vscode.Uri.file("/workspace/notes/test.md");
      const keyFromUri = getEditorPositionKey(uri);
      const keyFromStr = getEditorPositionKey(uri.toString());

      assert.equal(keyFromUri, `editorPosition:${uri.toString()}`);
      assert.equal(keyFromStr, keyFromUri);
      assert.ok(keyFromUri.startsWith("editorPosition:"));
    });
  });

  describe("clampPosition", () => {
    it("clamps position against stale/shorter document size", () => {
      // Normal within range
      assert.equal(clampPosition(42, 100), 42);

      // Stale position past end of edited shorter document
      assert.equal(clampPosition(150, 100), 100);

      // Negative position clamped to 0
      assert.equal(clampPosition(-10, 100), 0);

      // Empty document (docLength 0)
      assert.equal(clampPosition(25, 0), 0);

      // Non-number / NaN
      assert.equal(clampPosition(Number.NaN, 100), 0);
    });
  });

  describe("clampScrollTop", () => {
    it("clamps scroll offset to [0, maxScroll]", () => {
      assert.equal(clampScrollTop(250, 1000), 250);
      assert.equal(clampScrollTop(1500, 1000), 1000);
      assert.equal(clampScrollTop(-50, 1000), 0);
      assert.equal(clampScrollTop(Number.NaN, 1000), 0);
    });
  });

  describe("saveEditorPosition and getSavedEditorPosition", () => {
    it("persists position in workspaceState and retrieves it", async () => {
      const memento = new MockMemento();
      const uri = vscode.Uri.file("/workspace/doc.md");

      assert.equal(getSavedEditorPosition(memento, uri), undefined);

      const pos: EditorPosition = { cursor: 128, scrollTop: 350 };
      await saveEditorPosition(memento, uri, pos);

      const retrieved = getSavedEditorPosition(memento, uri);
      assert.deepEqual(retrieved, pos);

      // Verify stored under the derived key
      const key = getEditorPositionKey(uri);
      assert.deepEqual(memento.get(key), pos);
    });
  });

  describe("sendSavedEditorPosition", () => {
    it("replays saved position to webview", async () => {
      const memento = new MockMemento();
      const uri = vscode.Uri.file("/workspace/doc.md");
      const posted: any[] = [];
      const mockWebview: TypedWebview = {
        postMessage: (msg: any) => {
          posted.push(msg);
          return Promise.resolve(true);
        },
        asWebviewUri: (u: vscode.Uri) => u,
        cspSource: "mock-csp",
      };

      // Nothing saved: should not post message
      sendSavedEditorPosition(mockWebview, memento, uri);
      assert.equal(posted.length, 0);

      // Save position
      await saveEditorPosition(memento, uri, { cursor: 75, scrollTop: 210 });
      sendSavedEditorPosition(mockWebview, memento, uri);

      assert.equal(posted.length, 1);
      assert.deepEqual(posted[0], {
        type: "savedEditorPosition",
        cursor: 75,
        scrollTop: 210,
      });
    });
  });
});
