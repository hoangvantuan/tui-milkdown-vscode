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
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "tuanhv.tui-milkdown-vscode";
const VIEW_TYPE = "tuiMarkdown.editor";
const EXPECTED_COMMANDS = ["tuiMarkdown.viewSource", "tuiMarkdown.viewRichText"];
/** How long the custom editor stays open for the runner's DOM inspection. */
const HOLD_MS = Number(process.env.TUI_FLOOR_HOLD_MS ?? 25000);

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
