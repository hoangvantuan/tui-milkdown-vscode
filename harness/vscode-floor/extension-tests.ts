/**
 * Extension-host side of the VS Code floor check (see ./run.mjs).
 *
 * VS Code loads this through `--extensionTestsPath`, inside the very
 * extension host whose Node version is what the `engines.vscode` floor is
 * really about. Everything here runs against the real `vscode` API of the
 * downloaded build, so a green run is runtime evidence, not type-level
 * evidence.
 *
 * What it asserts:
 *   1. the extension resolves and activates on this VS Code build,
 *   2. both contributed commands are registered,
 *   3. a `.md` file opens in the custom editor (`vscode.openWith` →
 *      `resolveCustomTextEditor`, i.e. the webview HTML is built), and
 *   4. the tab that ends up active really is that custom editor.
 *
 * It then holds the editor open for `HOLD_MS` so the runner, attached over
 * the DevTools protocol, can inspect the live webview DOM — the part the
 * extension host cannot see. Results are written to the JSON file named by
 * `TUI_FLOOR_RESULT`, which the runner reads after the process exits.
 *
 * Everything above is READ-ONLY, and two of its checks assert the document is
 * not dirty. A second phase then deliberately modifies it, which is why the
 * order is fixed and the two phases rendezvous on marker files rather than
 * overlapping: this side writes `phase-interact` once its read-only checks
 * have been recorded, the runner drives the webview's own UI, the runner
 * writes `phase-driven`, and this side then asserts what the driving produced.
 *
 * What the second phase is for: `resolveCustomTextEditor` carries the whole
 * per-document contract — `pendingEdit`, `inFlightEdit`, the debounce timer —
 * and the markdown roundtrip harness cannot see any of it, because that
 * harness measures a string through an editor, not a provider through VS Code.
 * A typed character proving that (a) it reaches the document and (b) it does
 * NOT bounce back as a second update is the cheapest evidence that contract
 * still holds. It is what a refactor of that method has to keep green.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "tuanhv.tui-milkdown-vscode";
const VIEW_TYPE = "tuiMarkdown.editor";
const EXPECTED_COMMANDS = [
  "tuiMarkdown.viewSource",
  "tuiMarkdown.viewRichText",
  // #122. Registered in src/extension.ts; a command contributed in
  // package.json but never registered is invisible here and in the palette.
  "tuiMarkdown.useAsDefaultEditor",
];
/** How long the custom editor stays open for the runner's DOM inspection. */
const HOLD_MS = Number(process.env.TUI_FLOOR_HOLD_MS ?? 25000);
/** The text the runner types in. Spelled once, in run.mjs, and passed here. */
const SENTINEL = process.env.TUI_FLOOR_SENTINEL ?? "FLOORPROBE";
/** How long to wait for the runner to finish driving before giving up. */
const DRIVEN_TIMEOUT_MS = 60000;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): boolean {
  checks.push({ name, ok, detail });
  return ok;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a file to appear, or give up. Used for the phase rendezvous. */
async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    await sleep(250);
  }
  return false;
}

/** The active tab, once it is the custom editor — or null after `timeoutMs`. */
async function waitForCustomTab(timeoutMs: number): Promise<vscode.Tab | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input: any = tab?.input;
    if (input && typeof input === "object" && input.viewType === VIEW_TYPE) {
      return tab as vscode.Tab;
    }
    await sleep(250);
  }
  return null;
}


/**
 * Does `workbench.editorAssociations` at workspace scope actually change which
 * editor opens a `.md` file? (#122, and the half of #48 that is testable here.)
 *
 * Three states, each asserted by opening the document with `vscode.open`, which
 * is what a click in the explorer or a link does: no association (the
 * extension's own `priority: "default"` wins), `"default"` (VS Code's text
 * editor must win), and back to the custom editor.
 *
 * What this does NOT cover, and the reason #48 stays open: a diff editor is a
 * different path in VS Code, and Git Graph is not installed here. This proves
 * the setting works for ordinary opens, nothing more.
 */
async function runDefaultEditorAssociationCheck(uri: vscode.Uri): Promise<void> {
  const config = vscode.workspace.getConfiguration("workbench");
  const original = config.inspect<Record<string, string>>("editorAssociations")?.workspaceValue;

  const activeViewType = async (): Promise<string> => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    await vscode.commands.executeCommand("vscode.open", uri);
    await sleep(1200);
    const input: any = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input && typeof input === "object" && typeof input.viewType === "string") {
      return input.viewType;
    }
    // A plain text editor's tab input has a `uri` and no `viewType`.
    return input && typeof input === "object" && input.uri ? "text" : "unknown";
  };

  try {
    const withoutSetting = await activeViewType();

    await config.update("editorAssociations", { "*.md": "default" }, vscode.ConfigurationTarget.Workspace);
    await sleep(600);
    const withText = await activeViewType();

    await config.update(
      "editorAssociations",
      { "*.md": VIEW_TYPE },
      vscode.ConfigurationTarget.Workspace,
    );
    await sleep(600);
    const withCustom = await activeViewType();

    record(
      "workbench.editorAssociations decides which editor opens .md",
      withoutSetting === VIEW_TYPE && withText === "text" && withCustom === VIEW_TYPE,
      `noSetting=${withoutSetting} "*.md":"default"=${withText} "*.md":"${VIEW_TYPE}"=${withCustom}`,
    );
  } catch (err) {
    record(
      "workbench.editorAssociations decides which editor opens .md",
      false,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  } finally {
    try {
      await config.update("editorAssociations", original, vscode.ConfigurationTarget.Workspace);
    } catch {
      /* the per-run workspace is thrown away anyway */
    }
  }
}

export async function run(): Promise<void> {
  const resultPath = process.env.TUI_FLOOR_RESULT;
  const samplePath = process.env.TUI_FLOOR_SAMPLE;

  try {
    record("vscode version", true, vscode.version);

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    if (!record("extension resolves", !!extension, extension ? extension.extensionPath : "not found")) {
      return;
    }

    await extension!.activate();
    record("extension activates", extension!.isActive, `isActive=${extension!.isActive}`);

    const commands = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      record(`command registered: ${command}`, commands.includes(command), "");
    }

    if (!samplePath || !fs.existsSync(samplePath)) {
      record("sample document exists", false, String(samplePath));
      return;
    }

    const uri = vscode.Uri.file(samplePath);
    await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
    const tab = await waitForCustomTab(20000);
    record(
      "custom editor opens the document",
      !!tab,
      tab ? `${tab.label} (${VIEW_TYPE})` : "custom editor tab never became active",
    );

    // The document itself must be untouched by merely opening it: the
    // webview round-trips content back through an edit, and an unwanted
    // normalization would show up here as a dirty document.
    const document = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === samplePath);
    record(
      "opening the document leaves it unmodified",
      !!document && !document.isDirty,
      document ? `isDirty=${document.isDirty}` : "document not open in the text model",
    );

    // Hold the editor open so the runner can inspect the webview DOM.
    await sleep(HOLD_MS);

    const stillOpen = vscode.window.tabGroups.activeTabGroup.activeTab;
    const stillCustom = (stillOpen?.input as any)?.viewType === VIEW_TYPE;
    record("custom editor still open after the hold", stillCustom, `held ${HOLD_MS}ms`);

    const afterHold = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === samplePath);
    record(
      "document still unmodified after the hold",
      !!afterHold && !afterHold.isDirty,
      afterHold ? `isDirty=${afterHold.isDirty}` : "document not open in the text model",
    );

    // ---- Phase two: the document is modified from here on. ----
    if (afterHold && resultPath) {
      const base = path.dirname(resultPath);

      // Phase 1.5 (#111): the runner types one character and removes it again
      // inside a single 300ms debounce window. The editor ends where it began,
      // so nothing should reach the file, but the webview posts
      // `editor.getMarkdown()` rather than the text it was handed, and
      // `sample.md` is deliberately not a fixed point under that serializer,
      // so an unguarded post rewrites the user's file with normalizations they
      // never typed. That is #111's defect, driven on purpose so it is
      // deterministic rather than a coin flip.
      //
      // This proves the guard exists. It does NOT reproduce the load-time
      // transaction #111 observed; nothing here fires that one.
      fs.writeFileSync(path.join(base, "phase-transient"), "go", "utf8");
      const transientPath = path.join(base, "phase-transient-done");
      if (!(await waitForFile(transientPath, DRIVEN_TIMEOUT_MS))) {
        record(
          "a keystroke undone inside the debounce window leaves the document clean",
          false,
          "phase-transient-done never appeared",
        );
      } else {
        const transientDetail = fs.readFileSync(transientPath, "utf8").trim();
        const drivenOk = !transientDetail.startsWith("FAIL");
        record(
          "a keystroke undone inside the debounce window leaves the document clean",
          drivenOk && !afterHold.isDirty,
          `isDirty=${afterHold.isDirty} version=${afterHold.version}; ${transientDetail}`,
        );
      }

      // Captured AFTER the transient phase: on code where that phase dirties
      // the document, the version here is no longer 1, and the assertion below
      // is about the delta rather than an absolute number.
      const versionBeforeEdit = afterHold.version;
      fs.writeFileSync(path.join(base, "phase-interact"), "go", "utf8");

      const drivenPath = path.join(base, "phase-driven");
      if (!(await waitForFile(drivenPath, DRIVEN_TIMEOUT_MS))) {
        record("runner drove the webview", false, "phase-driven never appeared");
      } else {
        const text = afterHold.getText();
        record(
          "a typed character reaches the document",
          afterHold.isDirty && text.includes(SENTINEL),
          `isDirty=${afterHold.isDirty} sentinelInText=${text.includes(SENTINEL)} version ${versionBeforeEdit}\u2192${afterHold.version}`,
        );

        // The `pendingEdit` guard is what stops the host's own WorkspaceEdit
        // from being echoed back to the webview as an `update`, re-serialized
        // and posted again as a new `edit`. A broken guard is a runaway
        // version count, not a wrong character, so the only way to see it is
        // to look twice with the editor idle in between.
        const versionAfterEdit = afterHold.version;
        await sleep(3000);
        record(
          "the edit does not bounce between host and webview",
          afterHold.version === versionAfterEdit,
          `version ${versionAfterEdit} then ${afterHold.version} after 3s idle`,
        );

        // The runner clicked `#btn-source`, so the `viewSource` case must have
        // opened the raw markdown in an ordinary text editor.
        const sourceEditor = vscode.window.visibleTextEditors.find(
          (editor) =>
            editor.document.uri.fsPath === samplePath &&
            editor.document.uri.scheme === "file",
        );
        record(
          "view source opens the raw markdown in a text editor",
          !!sourceEditor,
          sourceEditor
            ? `${vscode.window.visibleTextEditors.length} visible text editor(s)`
            : `no text editor for the sample; visible=${vscode.window.visibleTextEditors.length}`,
        );

        // Leave nothing dirty behind: VS Code can block its own shutdown on a
        // modified document, and the runner would then SIGKILL the host and
        // report a timeout instead of these results.
        try {
          await afterHold.save();
        } catch {
          /* the run is over either way; the checks above are already recorded */
        }

        // LAST, because it changes workspace settings and then reopens the
        // document: everything above must already be recorded.
        //
        // What #122 actually claims. `contributes.customEditors` registers this
        // editor with priority "default", so `.md` opens here everywhere, and
        // #48 asked for the opposite: a workspace where it does not. The unit
        // tests prove the command writes the right JSON; they cannot prove VS
        // Code then honours it. This opens the file the ordinary way, with no
        // viewType, and asks which editor won.
        await runDefaultEditorAssociationCheck(uri);
      }
    }
  } catch (err) {
    record(
      "extension host run completed without throwing",
      false,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  } finally {
    if (resultPath) {
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, JSON.stringify(checks, null, 2), "utf8");
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} extension-host check(s) failed: ${failed.map((c) => c.name).join(", ")}`,
    );
  }
}
