import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeUpdatedAssociations,
  getCurrentWorkspaceMode,
  buildQuickPickOptions,
  useAsDefaultEditor,
} from "../src/host/defaultEditor";
import {
  setWorkspaceRoot,
  resetStub,
  window,
} from "./vscode-stub";

describe("default-editor", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-editor-assoc-test-"));
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

  describe("computeUpdatedAssociations", () => {
    it("sets TUI Markdown editor for wysiwyg mode", () => {
      const updated = computeUpdatedAssociations({}, "wysiwyg");
      assert.deepEqual(updated, {
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
      });
    });

    it("sets default text editor for text mode", () => {
      const updated = computeUpdatedAssociations({}, "text");
      assert.deepEqual(updated, {
        "*.md": "default",
        "*.markdown": "default",
      });
    });

    it("removes markdown associations on reset while preserving other associations", () => {
      const current = {
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
        "*.png": "imagePreview",
        "{git,gitlens}:/**/*.md": "default",
      };
      const updated = computeUpdatedAssociations(current, "reset");
      assert.deepEqual(updated, {
        "*.png": "imagePreview",
        "{git,gitlens}:/**/*.md": "default",
      });
    });

    it("returns undefined on reset when no other associations remain", () => {
      const current = {
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
      };
      const updated = computeUpdatedAssociations(current, "reset");
      assert.equal(updated, undefined);
    });
  });

  describe("getCurrentWorkspaceMode", () => {
    it("identifies wysiwyg, text, and default modes", () => {
      assert.equal(getCurrentWorkspaceMode({ "*.md": "tuiMarkdown.editor" }), "wysiwyg");
      assert.equal(getCurrentWorkspaceMode({ "*.md": "default" }), "text");
      assert.equal(getCurrentWorkspaceMode({}), "default");
      assert.equal(getCurrentWorkspaceMode(undefined), "default");
    });
  });

  describe("buildQuickPickOptions", () => {
    it("marks current mode with (current) description", () => {
      const options = buildQuickPickOptions("text");
      const textOpt = options.find((o) => o.mode === "text");
      const wysiwygOpt = options.find((o) => o.mode === "wysiwyg");
      const resetOpt = options.find((o) => o.mode === "reset");

      assert.equal(textOpt?.description, "(current)");
      assert.equal(wysiwygOpt?.description, undefined);
      assert.equal(resetOpt?.description, undefined);
    });
  });

  describe("useAsDefaultEditor (disk verification)", () => {
    it("writes default text editor associations to .vscode/settings.json on disk", async () => {
      // Mock user picking "Text editor (raw markdown)"
      const origShowQuickPick = window.showQuickPick;
      window.showQuickPick = (async (items: any[]) => {
        return items.find((item) => item.mode === "text");
      }) as any;

      try {
        const mode = await useAsDefaultEditor();
        assert.equal(mode, "text");

        // Read settings.json directly from disk
        const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
        assert.equal(fs.existsSync(settingsPath), true, "settings.json must exist on disk");

        const diskJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        assert.deepEqual(diskJson["workbench.editorAssociations"], {
          "*.md": "default",
          "*.markdown": "default",
        });
      } finally {
        window.showQuickPick = origShowQuickPick;
      }
    });

    it("writes TUI Markdown editor associations to .vscode/settings.json on disk", async () => {
      const origShowQuickPick = window.showQuickPick;
      window.showQuickPick = (async (items: any[]) => {
        return items.find((item) => item.mode === "wysiwyg");
      }) as any;

      try {
        const mode = await useAsDefaultEditor();
        assert.equal(mode, "wysiwyg");

        const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
        assert.equal(fs.existsSync(settingsPath), true, "settings.json must exist on disk");

        const diskJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        assert.deepEqual(diskJson["workbench.editorAssociations"], {
          "*.md": "tuiMarkdown.editor",
          "*.markdown": "tuiMarkdown.editor",
        });
      } finally {
        window.showQuickPick = origShowQuickPick;
      }
    });

    it("resets markdown associations by removing key from .vscode/settings.json", async () => {
      // Seed settings.json with existing associations
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "settings.json"),
        JSON.stringify({
          "workbench.editorAssociations": {
            "*.md": "default",
            "*.markdown": "default",
          },
        }),
        "utf8"
      );

      const origShowQuickPick = window.showQuickPick;
      window.showQuickPick = (async (items: any[]) => {
        return items.find((item) => item.mode === "reset");
      }) as any;

      try {
        const mode = await useAsDefaultEditor();
        assert.equal(mode, "reset");

        const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
        const diskJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        assert.equal(diskJson["workbench.editorAssociations"], undefined);
      } finally {
        window.showQuickPick = origShowQuickPick;
      }
    });
  });
});
