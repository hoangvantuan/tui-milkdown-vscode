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
/**
 * How long to wait for the runner to finish driving before giving up.
 *
 * The drive phase grew past 60s when the export probe landed: a PDF export
 * launches a real Chromium, and that alone is budgeted 30s on the runner side.
 */
const DRIVEN_TIMEOUT_MS = 180000;
/** How long the runner may go SILENT before this side calls the drive dead. */
const STALL_TIMEOUT_MS = 90000;
/** Backstop for a runner that dies before recording anything at all. */
const DRIVEN_CAP_MS = 900000;

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

/**
 * Wait for `file`, but measure patience against the runner's HEARTBEAT rather
 * than against a fixed clock.
 *
 * A fixed budget couples the rendezvous to how many probes the runner happens
 * to have: wave 8 added seven, the drive crept up on the old flat 180 s, and a
 * run that was merely slow lost every check after the tipping point and left
 * the reason invisible. What actually needs catching is a runner that has
 * STOPPED, and `phase-progress` says exactly that: the runner touches it as it
 * records each check, so a long drive is fine and a dead one is caught in
 * STALL_TIMEOUT_MS. The absolute cap is the backstop for a runner that dies
 * before its first heartbeat.
 */
async function waitForFileWithHeartbeat(
  file: string,
  heartbeat: string,
  stallMs: number,
  capMs: number,
): Promise<boolean> {
  const hardDeadline = Date.now() + capMs;
  let lastBeat = Date.now();
  let lastSeen = 0;
  while (Date.now() < hardDeadline) {
    if (fs.existsSync(file)) return true;
    let stamp = 0;
    try {
      stamp = fs.statSync(heartbeat).mtimeMs;
    } catch {
      /* not started yet */
    }
    if (stamp > lastSeen) {
      lastSeen = stamp;
      lastBeat = Date.now();
    }
    if (Date.now() - lastBeat > stallMs) return false;
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


/**
 * Does removing an image from the markdown actually remove the file on save?
 * (`autoDeleteImages`, one of the six #88 criteria that had never been run,
 * because it needs a real save.)
 *
 * The name says DELETES, not TRASHES, deliberately. The code passes
 * `useTrash: true` and the settings description promises the Trash, but this
 * host has measured `foundIn~/.Trash=no` while the file did leave the
 * workspace. That is reported and not asserted: one extension-test host is not
 * evidence about the user's own machine, and checking your own Trash after a
 * real delete is a line in `docs/manual-checks.md` for exactly that reason.
 *
 * It also MEASURES #126 rather than asserting it: a second document referencing
 * the same file must not make any difference to the current code, and the
 * detail line records whether it did. Change that behaviour and this line moves.
 *
 * Side effect worth knowing: whatever `useTrash` does here, it acts outside the
 * throwaway workspace. Two 1-pixel PNGs per run.
 */
async function runImageDeleteOnSaveCheck(uri: vscode.Uri): Promise<void> {
  const name = "removing an image from the markdown deletes the file on save";
  const docFolder = path.dirname(uri.fsPath);
  const imagesDir = path.join(docFolder, "images");
  // Smallest valid PNG, so nothing here depends on a fixture being staged.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const lone = path.join(imagesDir, "floor-delete-me.png");
  const shared = path.join(imagesDir, "floor-shared.png");
  const otherDoc = path.join(docFolder, "floor-other.md");

  try {
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(lone, PNG);
    fs.writeFileSync(shared, PNG);
    // A SECOND document referencing the shared image. This is #126's setup.
    fs.writeFileSync(otherDoc, "# Other\n\n![shared](images/floor-shared.png)\n", "utf8");

    const document = await vscode.workspace.openTextDocument(uri);
    const marker = "\n![lone](images/floor-delete-me.png)\n![shared](images/floor-shared.png)\n";

    // Save one: both images are in the text, so the rebuild at the end of
    // handleDocumentSave puts them in originalImagePaths. Without this the
    // next save has nothing to diff against and detects nothing.
    const addEdit = new vscode.WorkspaceEdit();
    addEdit.insert(uri, new vscode.Position(document.lineCount, 0), marker);
    await vscode.workspace.applyEdit(addEdit);
    await document.save();
    await sleep(1200);
    const baselined = fs.existsSync(lone) && fs.existsSync(shared);

    // Save two: both references leave this document.
    const text = document.getText();
    const start = document.positionAt(text.indexOf(marker));
    const end = document.positionAt(text.indexOf(marker) + marker.length);
    const removeEdit = new vscode.WorkspaceEdit();
    removeEdit.delete(uri, new vscode.Range(start, end));
    await vscode.workspace.applyEdit(removeEdit);
    await document.save();
    await sleep(2500);

    const loneGone = !fs.existsSync(lone);
    const sharedGone = !fs.existsSync(shared);
    // "Deleted" and "moved to the Trash" are different promises, and the
    // settings description makes the second one. `useTrash: true` is what the
    // code passes; whether the platform honours it is a separate fact, so it is
    // reported rather than assumed.
    let inTrash = "unknown";
    try {
      const trash = path.join(process.env.HOME ?? "", ".Trash");
      inTrash = fs
        .readdirSync(trash)
        .some((f) => f.startsWith("floor-delete-me"))
        ? "yes"
        : "no";
    } catch {
      inTrash = "unreadable";
    }
    record(
      name,
      baselined && loneGone,
      `baselined=${baselined} loneImageDeleted=${loneGone} foundIn~/.Trash=${inTrash}; ` +
        `imageStillUsedByFloorOther.mdDeleted=${sharedGone} (#126: true is the ` +
        `current behaviour, the reference in floor-other.md is not consulted)`,
    );
  } catch (err) {
    record(name, false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  } finally {
    for (const f of [lone, shared, otherDoc]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* the workspace is thrown away anyway */
      }
    }
  }
}


/** Where the stubbed save dialog sends each export. Set before the drive phase. */
const exportTargets = new Map<string, vscode.Uri>();

/**
 * Answer the export save dialog without a human, so the DOCX and PDF paths can
 * be driven at all. Two of the six #88 criteria are "needs a save dialog", and
 * that is the only reason they were never run.
 *
 * `vscode.window` is a plain object in the extension host, so its methods can be
 * replaced for the life of this process. Both stubs are needed: the dialog, and
 * the "Open the file?" notification afterwards, which has buttons and therefore
 * waits forever for a click that is never coming.
 *
 * Installed BEFORE `phase-interact`, because the runner clicks Export during the
 * drive phase and the stub has to already be in place.
 */
function stubExportDialogs(docFolder: string): void {
  (vscode.window as any).showSaveDialog = async (opts: any) => {
    const ext = String(opts?.defaultUri?.fsPath ?? "export.docx").split(".").pop();
    const target = vscode.Uri.file(path.join(docFolder, `floor-export.${ext}`));
    exportTargets.set(String(ext), target);
    return target;
  };
  const quiet = async () => undefined;
  (vscode.window as any).showInformationMessage = quiet;
}

/**
 * Assert what the driven Export button actually produced. The bytes are checked
 * by their magic number rather than by size, because an empty or truncated file
 * has a size too.
 */
function recordExportResults(docFolder: string): void {
  for (const [ext, magic, label] of [
    ["docx", "504b0304", "DOCX"],
    ["pdf", "25504446", "PDF"],
  ] as Array<[string, string, string]>) {
    const name = `export produces a real ${label} file`;
    const target = exportTargets.get(ext) ?? vscode.Uri.file(path.join(docFolder, `floor-export.${ext}`));
    try {
      if (!fs.existsSync(target.fsPath)) {
        record(name, false, `no file at ${path.basename(target.fsPath)}; the export never wrote one`);
        continue;
      }
      const buf = fs.readFileSync(target.fsPath);
      const head = buf.subarray(0, 4).toString("hex");
      record(
        name,
        head === magic && buf.length > 1000,
        `${path.basename(target.fsPath)} bytes=${buf.length} magic=${head} (expected ${magic})`,
      );
    } catch (err) {
      record(name, false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  }
}


/**
 * Does a DIFF of two `.md` files open as a diff editor, or does this extension
 * take it over? (#48, the half that does not need Git Graph installed.)
 *
 * #48 is about Git Graph's diff view, and the floor workspace has no Git Graph.
 * But the thing #48 is really asking is whether `contributes.customEditors`
 * with `priority: "default"` hijacks a DIFF, and `vscode.diff` opens exactly
 * that editor by exactly the same path a git extension uses. So this answers
 * the mechanism while leaving Git Graph's own UI to a human.
 *
 * Both states are exercised: with no association, and with
 * `"*.md": "tuiMarkdown.editor"` set, which is what a user who ran #122's
 * command has. The second is the one that could plausibly capture a diff.
 */
async function runDiffEditorCheck(uri: vscode.Uri): Promise<void> {
  const name = "a diff of two .md files opens as a diff editor, not this custom editor";
  const other = vscode.Uri.file(path.join(path.dirname(uri.fsPath), "floor-diff-other.md"));
  const config = vscode.workspace.getConfiguration("workbench");
  const original = config.inspect<Record<string, string>>("editorAssociations")?.workspaceValue;
  const DIFF_TITLE = "floor diff";

  const openDiff = async (): Promise<string> => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    await vscode.commands.executeCommand("vscode.diff", uri, other, DIFF_TITLE);
    await sleep(2500);

    // Read the TABS, not `tab.input`. On VS Code 1.85, the floor, a diff tab
    // reports `input === undefined`: two earlier versions of this probe read
    // `activeTabGroup.activeTab.input` and then every group's inputs, and both
    // reported "no tabs" while a tab labelled "floor diff" was sitting right
    // there. The label is the evidence the API will not give: a diff editor
    // carries the title passed to `vscode.diff`, and this extension's custom
    // editor would carry the file name and a `viewType`.
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (tabs.length === 0) return "no tabs";
    const hijacked = tabs.find(
      (t) => t.input && typeof (t.input as any).viewType === "string",
    );
    if (hijacked) return String((hijacked.input as any).viewType);
    return tabs.some((t) => t.label === DIFF_TITLE) ? "diff" : `other[${tabs.map((t) => t.label).join(",")}]`;
  };

  try {
    fs.writeFileSync(other.fsPath, "# Other\n\nA second document to diff against.\n", "utf8");

    const withoutSetting = await openDiff();
    await config.update(
      "editorAssociations",
      { "*.md": VIEW_TYPE },
      vscode.ConfigurationTarget.Workspace,
    );
    await sleep(600);
    const withCustom = await openDiff();

    record(
      name,
      withoutSetting === "diff" && withCustom === "diff",
      `noSetting=${withoutSetting} "*.md":"${VIEW_TYPE}"=${withCustom}; ` +
        "Git Graph's own diff view is NOT covered here and stays a hand check",
    );
  } catch (err) {
    record(name, false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  } finally {
    try {
      await config.update("editorAssociations", original, vscode.ConfigurationTarget.Workspace);
    } catch {
      /* the per-run workspace is thrown away anyway */
    }
    try {
      fs.rmSync(other.fsPath, { force: true });
    } catch {
      /* same */
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
      stubExportDialogs(path.dirname(samplePath));
      fs.writeFileSync(path.join(base, "phase-interact"), "go", "utf8");

      const drivenPath = path.join(base, "phase-driven");
      const progressPath = path.join(base, "phase-progress");
      if (!(await waitForFileWithHeartbeat(drivenPath, progressPath, STALL_TIMEOUT_MS, DRIVEN_CAP_MS))) {
        let beats = "never";
        try {
          beats = `${Math.round((Date.now() - fs.statSync(progressPath).mtimeMs) / 1000)}s ago`;
        } catch {
          /* the runner never recorded a check */
        }
        record(
          "runner drove the webview",
          false,
          `phase-driven never appeared; last runner heartbeat ${beats}`,
        );
      } else {
        const text = afterHold.getText();
        record(
          "a typed character reaches the document",
          afterHold.isDirty && text.includes(SENTINEL),
          `isDirty=${afterHold.isDirty} sentinelInText=${text.includes(SENTINEL)} version ${versionBeforeEdit}\u2192${afterHold.version}`,
        );

        // The runner clicked the first backlink entry, which posts openLink to
        // the host. Whether that actually OPENED the document can only be seen
        // from here; the webview has no way to know.
        const backlinkOpened = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => (tab.label || "").toLowerCase().includes("links-here"));
        record(
          "clicking a backlink opens the linking document",
          backlinkOpened,
          `linksHereTabOpen=${backlinkOpened} tabs=[${vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .map((tab) => tab.label)
            .join(", ")}]`,
        );

        // The runner opened and closed a <details> disclosure. That is a
        // VIEW action, and `open` is serialized by the details renderer, so a
        // toggle that reached the document would put ` open` into the user's
        // file just because they looked inside a block. #85's rule is that
        // rendering never changes what is saved, and this is the only place
        // that rule is checked against a real editor rather than a seam.
        record(
          "opening a <details> does not write ` open` into the document",
          !/<details\s+open/i.test(text),
          `detailsOpenInText=${/<details\s+open/i.test(text)} ` +
            `detailsTagsInText=${(text.match(/<details/gi) || []).length}`,
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
        recordExportResults(path.dirname(samplePath));

        // Both of these modify the document, so they sit after everything
        // above has been recorded.
        await runImageDeleteOnSaveCheck(uri);

        await runDiffEditorCheck(uri);

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
