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
 * Where a trashed file landed, or why the answer is not known. macOS renames
 * on collision but keeps the leading name, hence the prefix match. Shared by
 * the image check and the isolated probe, so the two readings are comparable.
 */
function findInTrash(prefix: string): string {
  const home = process.env.HOME ?? "";
  const candidates: Array<[string, string]> = [
    ["~/.Trash", path.join(home, ".Trash")],
    ["/System/Volumes/Data/.Trashes", `/System/Volumes/Data/.Trashes/${process.getuid?.() ?? ""}`],
    ["/.Trashes", `/.Trashes/${process.getuid?.() ?? ""}`],
  ];
  const seen: string[] = [];
  for (const [label, dir] of candidates) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some((f) => f.startsWith(prefix))) return label;
      seen.push(`${label}:${entries.length}entries`);
    } catch (err) {
      seen.push(`${label}:${err instanceof Error ? err.name : "unreadable"}`);
    }
  }
  return `nowhere found (HOME=${home || "unset"}, ${seen.join(" ")})`;
}


/**
 * `autoDeleteImages`, all three of its branches, in a live host (#88, #126).
 *
 * The name of the first check says DELETES, not TRASHES, deliberately. The
 * code passes `useTrash: true` and the settings description promises the
 * Trash; whether the platform honours it is a separate fact, so the landing
 * place is REPORTED with enough diagnostics to tell "the host did not trash
 * it" apart from "this process cannot see the Trash".
 *
 * Three things here exist only against a live host and are the reason this is
 * not all unit tests:
 *
 * - The prompt is a real notification with buttons, so it waits for a click
 *   that is never coming. It is replaced the way `stubExportDialogs` replaces
 *   the save dialog. The replacement takes an `answer` AND an `onPrompt` hook,
 *   because the only way to observe ORDERING from outside is to look at the
 *   world at the moment the question is asked.
 * - The stale-Yes branch needs a document that changes UNDER the open prompt.
 *   `onPrompt` puts the image reference back with a real `WorkspaceEdit`, which
 *   is what a user typing during the prompt does, and the handler's
 *   re-validation must then refuse its own Yes.
 * - The unqueued-delete branch is invisible to a clock: it asserts that the
 *   image nothing else references is ALREADY gone when the question about a
 *   different image is asked.
 *
 * Side effect worth knowing: whatever `useTrash` does here, it acts outside
 * the throwaway workspace. Three 1-pixel PNGs per run.
 */
async function runImageDeleteOnSaveCheck(uri: vscode.Uri): Promise<void> {
  const docFolder = path.dirname(uri.fsPath);
  const imagesDir = path.join(docFolder, "images");
  // Smallest valid PNG, so nothing here depends on a fixture being staged.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const lone = path.join(imagesDir, "floor-delete-me.png");
  const kept = path.join(imagesDir, "floor-shared-kept.png");
  const doomed = path.join(imagesDir, "floor-shared-doomed.png");
  const restored = path.join(imagesDir, "floor-shared-restored.png");
  const otherDoc = path.join(docFolder, "floor-other.md");
  const staged = [lone, kept, doomed, restored, otherDoc];

  const KEEP_NAME = "removing an image from the markdown deletes the file on save";
  const YES_NAME = "answering the prompt deletes the shared image after all";
  const STALE_NAME = "an image put back while the prompt is open survives the answer";

  // The prompt stub. Only the #126 question carries the buttons, so anything
  // else the handler says (a failed delete) is recorded separately instead of
  // being mistaken for a prompt.
  const prompts: string[] = [];
  const otherWarnings: string[] = [];
  let answer: (items: string[]) => string | undefined = () => undefined;
  let onPrompt: () => Promise<void> = async () => {};
  const realWarning = vscode.window.showWarningMessage;
  (vscode.window as any).showWarningMessage = async (message: string, ...items: string[]) => {
    if (!items.includes("Delete Anyway")) {
      otherWarnings.push(message);
      return undefined;
    }
    prompts.push(message);
    await onPrompt();
    return answer(items);
  };

  const document = await vscode.workspace.openTextDocument(uri);

  /** Append the references and save, so they enter `originalImagePaths`. */
  async function baseline(marker: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(document.lineCount, 0), marker);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    // The rebuild at the end of the save handler emits nothing, so this one
    // wait really is a clock. Everything that CAN be waited on, is.
    await sleep(1200);
  }

  /** Take the references out and save: this is the save that detects. */
  async function dropMarker(marker: string): Promise<void> {
    const text = document.getText();
    const at = text.indexOf(marker);
    if (at < 0) throw new Error(`marker missing from the document: ${JSON.stringify(marker)}`);
    const edit = new vscode.WorkspaceEdit();
    edit.delete(
      uri,
      new vscode.Range(document.positionAt(at), document.positionAt(at + marker.length)),
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  /**
   * Wait for the THING BEING ASSERTED, never for a clock: the handler now runs
   * a workspace scan before it can prompt, so a flat budget that was generous
   * before #126 would report `prompts=0` on a loaded machine and that would
   * read as a defect. The settle afterwards is for the negative halves, which
   * are deletes that must never come and so cannot be waited on.
   */
  async function waitFor(done: () => boolean, settleMs = 500): Promise<void> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !done()) await sleep(200);
    await sleep(settleMs);
  }

  try {
    fs.mkdirSync(imagesDir, { recursive: true });
    for (const f of [lone, kept, doomed, restored]) fs.writeFileSync(f, PNG);
    // The SECOND document. It references all three shared images and not the
    // lone one, which is the whole of #126's setup.
    fs.writeFileSync(
      otherDoc,
      "# Other\n\n![kept](images/floor-shared-kept.png)\n" +
        "![doomed](images/floor-shared-doomed.png)\n" +
        "![restored](images/floor-shared-restored.png)\n",
      "utf8",
    );

    // --- 1. Keep: the shared image survives, the lone one does not, and the
    //        lone one is already gone when the question is asked.
    const keepMarker =
      "\n![lone](images/floor-delete-me.png)\n![kept](images/floor-shared-kept.png)\n";
    let loneGoneWhenAsked: boolean | undefined;
    answer = () => "Keep";
    onPrompt = async () => {
      loneGoneWhenAsked = !fs.existsSync(lone);
    };

    await baseline(keepMarker);
    const baselined = fs.existsSync(lone) && fs.existsSync(kept);
    await dropMarker(keepMarker);
    await waitFor(() => prompts.length > 0 && !fs.existsSync(lone));

    const loneGone = !fs.existsSync(lone);
    const keptSurvived = fs.existsSync(kept);
    const asked = prompts.length;
    const namedOther = prompts.some((m) => m.includes("floor-other.md"));
    const trashedTo = loneGone ? findInTrash("floor-delete-me") : "not deleted";
    record(
      KEEP_NAME,
      baselined && loneGone && keptSurvived && asked === 1 && namedOther && loneGoneWhenAsked === true,
      `baselined=${baselined} loneImageDeleted=${loneGone} trashedTo=${trashedTo}; ` +
        `sharedImageSurvived=${keptSurvived} prompts=${asked} namedOther=${namedOther} ` +
        `loneAlreadyGoneWhenAsked=${loneGoneWhenAsked} otherWarnings=${otherWarnings.length}` +
        ` (#126: the shared image must survive a Keep, and the unreferenced one must` +
        ` not queue behind the question. trashedTo is REPORTED: one extension-test` +
        ` host is not evidence about the user's own desktop)`,
    );

    // --- 2. Delete Anyway: the same prompt, the other button.
    const yesMarker = "\n![doomed](images/floor-shared-doomed.png)\n";
    const promptsBeforeYes = prompts.length;
    answer = () => "Delete Anyway";
    onPrompt = async () => {};

    await baseline(yesMarker);
    await dropMarker(yesMarker);
    await waitFor(() => prompts.length > promptsBeforeYes && !fs.existsSync(doomed));

    const doomedGone = !fs.existsSync(doomed);
    const askedYes = prompts.length - promptsBeforeYes;
    record(
      YES_NAME,
      askedYes === 1 && doomedGone,
      `prompts=${askedYes} sharedImageDeleted=${doomedGone} ` +
        `trashedTo=${doomedGone ? findInTrash("floor-shared-doomed") : "not deleted"} ` +
        `(#126: Keep is not the only answer the host can give, and this is the half` +
        ` the Keep check cannot reach)`,
    );

    // --- 3. The document changes under the open prompt, and the Yes goes stale.
    const staleMarker = "\n![restored](images/floor-shared-restored.png)\n";
    const promptsBeforeStale = prompts.length;
    let putBack = false;
    answer = () => "Delete Anyway";
    onPrompt = async () => {
      // What a user typing while the notification sits there actually does.
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(document.lineCount, 0), staleMarker);
      putBack = await vscode.workspace.applyEdit(edit);
    };

    await baseline(staleMarker);
    await dropMarker(staleMarker);
    // The assertion is a delete that must NOT happen, so the settle is longer.
    await waitFor(() => prompts.length > promptsBeforeStale, 2000);

    const restoredSurvived = fs.existsSync(restored);
    const askedStale = prompts.length - promptsBeforeStale;
    record(
      STALE_NAME,
      askedStale === 1 && putBack && restoredSurvived,
      `prompts=${askedStale} referencePutBackDuringPrompt=${putBack} ` +
        `imageSurvivedTheYes=${restoredSurvived} ` +
        `(#126: the prompt has no deadline, and the save that puts the image back` +
        ` detects nothing because the baseline was already cleared, so the answer` +
        ` is re-validated against a fresh read of the document)`,
    );

    // Leave the document without the re-added line. This save detects nothing:
    // the baseline was rebuilt from the text that did not contain it.
    await dropMarker(staleMarker);
    await sleep(500);
  } catch (err) {
    record(
      KEEP_NAME,
      false,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  } finally {
    (vscode.window as any).showWarningMessage = realWarning;
    for (const f of staged) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* the workspace is thrown away anyway */
      }
    }
  }
}


/**
 * Does `vscode.workspace.fs.delete(..., { useTrash: true })` reach the Trash in
 * THIS host, with no extension code in the way?
 *
 * The image check reports `trashedTo=` and cannot attribute it: a file that
 * left the workspace without appearing in the Trash could be our call passing
 * the wrong option, or the host not honouring it. This probe makes the same
 * call `executeImageDeletes` makes, on a file the extension has never heard
 * of, so the two readings can be compared and only one of them can be about
 * our code.
 *
 * It ASSERTS the delete and REPORTS the destination, which is the split the
 * settings description forces: "deletes the file" is ours to guarantee,
 * "moves it to the Trash" is the platform's, and a red check every run for a
 * host limitation would only teach people to ignore this command. Where the
 * file really goes on a human's desktop stays a line in `docs/manual-checks.md`.
 */
async function runTrashCapabilityProbe(docFolder: string, findInTrash: (p: string) => string): Promise<void> {
  const name = "vscode.workspace.fs.delete accepts useTrash in this host";
  const probe = path.join(docFolder, "floor-trash-probe.txt");
  try {
    fs.writeFileSync(probe, "floor trash probe", "utf8");
    let threw = "";
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(probe), { useTrash: true });
    } catch (err) {
      threw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    const gone = !fs.existsSync(probe);
    record(
      name,
      gone && threw === "",
      `deleted=${gone} threw=${threw || "no"} ` +
        `landedIn=${gone ? findInTrash("floor-trash-probe") : "still on disk"} ` +
        `(landedIn is REPORTED, not asserted: compare it with the image check's` +
        ` trashedTo — the same reading from both means the Trash half is VS` +
        ` Code's behaviour as this harness launches it, not this extension's call)`,
    );
  } catch (err) {
    record(name, false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  } finally {
    try {
      fs.rmSync(probe, { force: true });
    } catch {
      /* the workspace is thrown away anyway */
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

/** What the image-rename input box was shown, and how often it was asked (#142). */
const renameInput = { asked: 0, shownValue: "" };

/**
 * Answer the image URL edit box without a human, so the double-click rename
 * path can be driven at all (#142, #149). Keyed on the prompt text: any other
 * input box passes through to the real one. The value the box was shown is
 * RECORDED, because a pre-cbf5b5e regression would show the whole webview
 * address instead of `media/icon.png`, the plugin would then take the
 * non-local branch, write the typed path straight into the node and rename
 * nothing on disk, and the document text would read clean. Installed next to
 * the export stubs, before `phase-interact`.
 */
function stubImageRenameInput(): void {
  const realInputBox = vscode.window.showInputBox;
  (vscode.window as any).showInputBox = async (opts: any, ...rest: any[]) => {
    const prompt = String(opts?.prompt ?? "");
    if (!prompt.includes("Enter new image path")) {
      return (realInputBox as any).call(vscode.window, opts, ...rest);
    }
    renameInput.asked += 1;
    renameInput.shownValue = String(opts?.value ?? "");
    return "media/icon-renamed.png";
  };
}

/**
 * What the double-click rename left in the document (#142). The runner renamed
 * the plain `![A plain image](media/icon.png)`; sample.md references that file
 * TWICE (the other is an `<img width>`), and the host's rename rewrites both
 * references while the webview updates only the node that was clicked. So the
 * detail counts three things apart: references on the new name, references
 * still on the old name, and webview addresses in the text. The invariant is
 * the honest one: every reference points at the new name and the file is there.
 *
 * Polls until `icon-renamed` appears in any form and the text has been stable
 * for a second, because the rename is at least two host writes (the rename
 * rewrite, then the webview's debounced edit) and the bounce check that follows
 * must not read those as a bounce.
 */
async function recordImageRenameResult(doc: vscode.TextDocument, docFolder: string): Promise<void> {
  const name = "double-click rename leaves every reference on the new relative path (#142)";
  const deadline = Date.now() + 10000;
  let text = doc.getText();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    const next = doc.getText();
    if (next !== text) {
      text = next;
      stableSince = Date.now();
    } else if (text.includes("icon-renamed") && Date.now() - stableSince >= 1000) {
      break;
    }
  }
  const count = (re: RegExp) => (text.match(re) || []).length;
  // Relative references only: a webview address ends in the same file name,
  // so a bare `media/icon-renamed.png` match would count the defect as a pass.
  const newRelative = count(/(\]\(|src=["'])media\/icon-renamed\.png/g);
  const oldRelative = count(/(\]\(|src=["'])media\/icon\.png/g);
  // One per address, not one per substring: an address carries both
  // `vscode-resource` and `vscode-cdn.net`.
  const webviewUrls = count(/https?:\/\/[^\s)"']*vscode-(?:resource|webview|cdn)[^\s)"']*/g);
  const renamedOnDisk = fs.existsSync(path.join(docFolder, "media", "icon-renamed.png"));
  const oldGone = !fs.existsSync(path.join(docFolder, "media", "icon.png"));
  const shownRelative = renameInput.shownValue === "media/icon.png";
  record(
    name,
    renameInput.asked === 1 && shownRelative && renamedOnDisk && oldGone &&
      webviewUrls === 0 && oldRelative === 0 && newRelative === 2,
    `asked=${renameInput.asked} shown=${JSON.stringify(renameInput.shownValue)} ` +
      `renamedOnDisk=${renamedOnDisk} oldGone=${oldGone} ` +
      `newRelative=${newRelative} oldRelative=${oldRelative} webviewUrls=${webviewUrls} ` +
      `(two references in sample.md, so two must come out on the new name; a webview ` +
      `address here is the #142 lossy shape, an oldRelative>0 is the second image node ` +
      `serialized from a stale map; the later save may trash a dangling reference)`,
  );
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
    // Compared, not just printed: it used to record `true` whatever it read,
    // and three runs in a row passed it while reading 1.138.0 on a floor of
    // 1.85.0, because the cached build had been updated in place.
    const expected = process.env.TUI_FLOOR_EXPECT_VERSION;
    record(
      "vscode version is the floor",
      !!expected && vscode.version === expected,
      `running ${vscode.version}, expected ${expected ?? "(TUI_FLOOR_EXPECT_VERSION unset)"}`,
    );

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
      stubImageRenameInput();
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
        // The rename probe (#142) writes the document at least twice more, so it
        // is settled and recorded HERE, before the idle window below is measured.
        await recordImageRenameResult(afterHold, path.dirname(samplePath));

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
        await runTrashCapabilityProbe(path.dirname(samplePath), findInTrash);

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
