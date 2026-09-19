#!/usr/bin/env node
/**
 * VS Code floor check — does this extension actually run on the oldest
 * VS Code it claims to support?
 *
 * `engines.vscode` in package.json is a promise to users on older editors,
 * and a green `npm run lint` against a pinned `@types/vscode` only proves
 * that no API *above* the floor is referenced. It cannot prove that the
 * extension host at that floor (an older Node) loads the bundle, that the
 * custom editor registers, or that the webview bundle parses in that
 * Chromium. This script proves those, by downloading the floor build and
 * driving it:
 *
 *   1. Downloads (and caches) the exact VS Code version named by
 *      `engines.vscode`, or by `--version`.
 *   2. Launches it as an Extension Development Host over a throwaway
 *      user-data dir, with `--extensionTestsPath` pointing at the compiled
 *      ./extension-tests.ts — those checks run inside the extension host.
 *   3. Attaches to the same window over the DevTools protocol and inspects
 *      the live webview DOM: the editor mounted, the document rendered,
 *      diagrams rendered, and no CSP violation in the console.
 *
 * Usage:
 *   npm run verify:vscode-floor                 # the floor from engines.vscode
 *   npm run verify:vscode-floor -- --version 1.95.0
 *   npm run verify:vscode-floor -- --keep       # keep the temp dirs
 *
 * Exit code 0 when every check passed, 1 otherwise. Requires a display:
 * VS Code opens a real window (it is closed again automatically).
 *
 * Two runs may go at once: every directory this script writes is private to
 * the run (`perRunBase`) and every write into the shared download cache is
 * staged then renamed (`ensureVsCode`). That was not true before #110, and
 * the failure looked like flakiness under load rather than a collision.
 * A passing run deletes its directory; a failing one keeps it.
 *
 * One thing is still shared and is NOT private to the run: `npm run
 * verify:vscode-floor` builds into the repo's own `out/`, and VS Code loads
 * the extension from the repo path, so concurrent runs overwrite each other's
 * bundles while their webviews are about to fetch them. A truncated artifact
 * surfaces as `errors=1`, not as the `errors=0 stuck=1` of #112, so it is not
 * that bug, but "two runs may go at once" is only true because the builds
 * happen to produce identical bytes from one checkout.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SAMPLE = path.join(HERE, "sample.md");
const TESTS_ENTRY = path.join(REPO, "out", "harness", "vscode-floor-tests.js");
/** How long to wait for the webview to mount before giving up. */
const MOUNT_TIMEOUT_MS = 40000;
/**
 * How long the lazily-fetched mermaid artifact gets, counted FROM THE MOUNT
 * rather than from the start of the probe (#112). The number is unchanged;
 * what changed is that the diagram no longer pays for the mount out of its
 * own budget. Measured on this machine (12-core darwin, VS Code 1.85.0),
 * time from mount to `rendered>=1 && stuck===0`, probe granularity 1.5s:
 *
 *   1 run                        1507ms   (mount 1530ms)
 *   3 concurrent                 1506ms   (mount 3170ms)
 *   6 concurrent                 1510ms   (mount 5172ms)
 *   3 concurrent, 12 busy cores  1523ms   (mount 3875ms, load average 24)
 *
 * Contention moves the MOUNT and leaves the diagram flat, so this budget is
 * roughly 25x the worst measurement. #112 reported three concurrent runs all
 * exhausting the old budget with `stuckPlaceholders=1 errors=0`; none of the
 * rows above reproduces that, so the budget is not why it failed and raising
 * it would have been a guess dressed as a fix. See the issue for the table.
 */
const MERMAID_TIMEOUT_MS = 40000;
/**
 * What the driving phase types into the document. Both processes need it, so
 * it travels to the extension host in the environment rather than being
 * spelled twice.
 */
const EDIT_SENTINEL = "FLOORPROBE";
/**
 * The character typed and immediately removed by the transient-keystroke
 * phase (#111). One character, so a single Backspace undoes it exactly.
 */
const TRANSIENT_CHAR = "Z";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const versionArg = valueOf("--version");

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function floorVersion() {
  if (versionArg) return versionArg;
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const range = pkg.engines?.vscode ?? "";
  const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`cannot read a version out of engines.vscode: ${range}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * A short base directory PREFIX. VS Code puts an IPC socket inside the
 * user-data dir and macOS caps socket paths at 103 characters, so a long
 * temp path silently breaks the launch.
 */
function shortTempBase() {
  const preferred = path.join(os.tmpdir(), "tuimd-floor");
  // macOS puts os.tmpdir() under a long /var/folders/... path; /tmp is the
  // short escape hatch there. Windows has no /tmp, so it keeps os.tmpdir().
  if (preferred.length <= 40 || process.platform === "win32") return preferred;
  return "/tmp/tuimd-floor";
}

/**
 * A base directory private to THIS run (#110).
 *
 * Every per-run directory used to hang off the constant `shortTempBase()`,
 * so two concurrent runs shared `ws/sample.md` (each one's `copyFileSync`
 * rewrote the file the other was asserting was unmodified), shared the
 * user-data dir (VS Code keeps its IPC socket and its single-instance lock
 * there, so the second launch could forward to the first and every DevTools
 * check then inspected the wrong window), and — worst — the second run's
 * startup `rmSync(base)` deleted the first run's whole tree underneath it.
 * `mkdtemp` costs six characters, well inside the socket-path cap.
 */
function perRunBase() {
  reapStaleBases();
  return fs.mkdtempSync(shortTempBase() + "-");
}

/**
 * Delete abandoned per-run directories older than a day.
 *
 * A failing run keeps its directory on purpose, and a run killed with Ctrl-C
 * keeps it by accident; before #110 the next run's `rmSync` of the one fixed
 * base swept both away. Nothing does now, and a kept directory carries a
 * whole VS Code user-data dir. A run lasts about 90 seconds, so a day-old
 * directory cannot belong to a run still going, and anyone inspecting a
 * failure does it long before that.
 */
function reapStaleBases() {
  const prefix = path.basename(shortTempBase()) + "-";
  const parent = path.dirname(shortTempBase());
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const full = path.join(parent, entry.name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      /* someone else's, or already gone */
    }
  }
}

/**
 * The environment for the floor VS Code, with the launching editor's own
 * variables removed.
 *
 * When this script is started from inside VS Code (its integrated terminal,
 * or an extension host), `process.env` carries `ELECTRON_RUN_AS_NODE`, which
 * makes any Electron binary run as plain Node. The floor build then rejects
 * every VS Code flag with `bad option: --extensionDevelopmentPath=...` and
 * exits 1 without a window, so the run reports a webview that never mounted
 * rather than a launch that never happened. `VSCODE_IPC_HOOK` is just as
 * damaging in the other direction: it forwards the launch to the editor that
 * is already running, so the checks would inspect the wrong instance.
 */
function childEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("ELECTRON_") || key.startsWith("VSCODE_")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function platformSlug() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return arch === "arm64" ? "win32-arm64-archive" : "win32-x64-archive";
  return `linux-${arch}`;
}

function executableIn(dir) {
  if (process.platform === "darwin") {
    const app = fs
      .readdirSync(dir)
      .map((entry) => path.join(dir, entry))
      .find((entry) => entry.endsWith(".app"));
    if (!app) return null;
    // The binary inside Contents/MacOS is named "Electron" in older builds
    // and "Code" in newer ones, so read it rather than assuming either.
    const macOs = path.join(app, "Contents", "MacOS");
    if (!fs.existsSync(macOs)) return null;
    const [binary] = fs.readdirSync(macOs);
    return binary ? path.join(macOs, binary) : null;
  }
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "code" || entry.name === "Code.exe" || entry.name === "code.exe") return full;
    }
  }
  return null;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

/**
 * The cached floor build, downloaded on first use.
 *
 * The cache is shared between runs on purpose — it is 120 MB and read-only
 * once populated — so every write into it goes to a pid-private path and is
 * then moved into place. Two concurrent COLD runs used to `curl` into one
 * `vscode.zip` (interleaved writes, corrupt archive) and `unzip -o` into one
 * `app/`, which also made `app/` exist while still half-written, so a third
 * run could take the `existsSync` branch and find no executable. Rename is
 * atomic within a filesystem, so `app/` now appears only complete. This is
 * the second half of #110: the per-run base fixes warm-cache collisions,
 * this fixes cold-cache ones.
 */
async function ensureVsCode(version) {
  const cacheRoot = path.join(os.homedir(), ".cache", "tui-markdown-vscode-floor", version);
  const unpacked = path.join(cacheRoot, "app");
  if (fs.existsSync(unpacked)) {
    const existing = executableIn(unpacked);
    if (existing) return existing;
  }
  fs.mkdirSync(cacheRoot, { recursive: true });
  const url = `https://update.code.visualstudio.com/${version}/${platformSlug()}/stable`;
  const archive = path.join(cacheRoot, "vscode.zip");
  if (!fs.existsSync(archive)) {
    console.log(`downloading VS Code ${version} (${platformSlug()})…`);
    const partial = `${archive}.${process.pid}`;
    await run("curl", ["-sSL", "-o", partial, url]);
    fs.renameSync(partial, archive);
  }
  const staging = `${unpacked}.${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  console.log("unpacking…");
  await run("unzip", ["-q", "-o", archive, "-d", staging]);
  try {
    fs.renameSync(staging, unpacked);
  } catch {
    // Another run finished first. Its tree is as good as ours; drop ours.
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const executable = executableIn(unpacked);
  if (!executable) throw new Error(`no VS Code executable found under ${unpacked}`);
  return executable;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A free localhost port, so two runs (or a stray VS Code) do not collide.
 *
 * Bind-then-close is a time-of-check race in principle: two runs started in
 * the same instant can be handed the same port. Left as is — the kernel
 * rotates ephemeral ports, so the window is tiny, and unlike the shared
 * user-data dir of #110 a collision here fails loudly (the DevTools attach
 * finds no target) instead of silently inspecting the wrong window.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Minimal DevTools-protocol client over one WebSocket. */
class DevToolsSession {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.contexts = [];
    this.consoleEntries = [];
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
        return;
      }
      if (message.method === "Runtime.executionContextCreated") {
        this.contexts.push(message.params.context);
      }
      if (message.method === "Runtime.executionContextsCleared") {
        this.contexts = [];
      }
      if (message.method === "Log.entryAdded") {
        this.consoleEntries.push(`${message.params.entry.level}: ${message.params.entry.text}`);
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
        this.consoleEntries.push(`${message.params.type}: ${text}`);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

/** The webview's DOM state, or null while it has not mounted yet. */
async function probeWebview(session) {
  const expression = `JSON.stringify({
    href: location.href.slice(0, 40),
    editorMounted: !!document.querySelector('.tiptap'),
    heading: document.querySelector('.tiptap h1')?.textContent ?? null,
    boldText: !!document.querySelector('.tiptap strong'),
    tableRows: document.querySelectorAll('.tiptap table tr').length,
    taskItems: document.querySelectorAll('.tiptap ul[data-type="taskList"] > li').length,
    taskCheckboxes: document.querySelectorAll('.tiptap input[type="checkbox"]').length,
    alerts: document.querySelectorAll('.tiptap [data-type="alert"], .tiptap .alert').length,
    codeBlocks: document.querySelectorAll('.tiptap pre').length,
    mermaidRendered: document.querySelectorAll('.mermaid-preview[data-rendered="true"]').length,
    mermaidErrors: document.querySelectorAll('.mermaid-err-msg').length,
    mermaidStuck: document.querySelectorAll('.mermaid-loading').length,
    // Did the plugin ever get as far as SCHEDULING a render? It sets
    // data-mermaid-src inside a requestAnimationFrame callback, and Chromium
    // does not run rAF for a window it considers not visible. Scheduled but
    // not rendered means slow; not even scheduled means the callback never
    // ran, which no timeout can fix (#112).
    mermaidScheduled: document.querySelectorAll('.mermaid-preview[data-mermaid-src]').length,
    hidden: document.hidden,
    visibility: document.visibilityState,
    metadataPanel: !!document.querySelector('#metadata-panel'),
    toolbar: !!document.querySelector('.editor-toolbar, #toolbar'),
    bodyClass: document.body.className.slice(0, 80),
    // --- 2.17 surfaces. Structure only; the drive phase below operates them.
    // An image with a width is an Image NODE since #120, not a raw-HTML badge,
    // so an img[width] selector finding it is the whole claim of that issue.
    // A raw-html-block counting it instead would be the regression.
    images: document.querySelectorAll('.tiptap img').length,
    sizedImages: document.querySelectorAll('.tiptap img[width]').length,
    rawHtmlBadges: document.querySelectorAll('.tiptap .raw-html-block').length,
    headingAnchors: document.querySelectorAll('.tiptap .heading-anchor-btn').length,
    wordCountText: document.getElementById('word-count')?.textContent ?? null,
    searchReplaceToggle: !!document.getElementById('search-toggle-replace'),
    lightboxOverlay: !!document.getElementById('lightbox-overlay')
  })`;
  for (const context of session.contexts) {
    try {
      const result = await session.send("Runtime.evaluate", {
        expression,
        contextId: context.id,
        returnByValue: true,
      });
      const value = JSON.parse(result.result.value);
      if (value.editorMounted) return { ...value, contextId: context.id };
    } catch {
      /* context went away, or belongs to another frame */
    }
  }
  return null;
}

/**
 * Type one character and remove it again inside a single debounce window,
 * then leave the document alone (#111).
 *
 * What this pins: a round trip through the editor that ends where it started
 * must not reach the file. The webview posts `editor.getMarkdown()`, not the
 * text it was given, and `sample.md` is deliberately not a fixed point under
 * that serializer, so ANY transaction arriving after the load guard drops
 * rewrites the user's file with normalizations they never asked for. #111 is
 * that, fired by something during load; this is the same defect driven on
 * purpose, which makes it deterministic instead of a coin flip.
 *
 * Both keystrokes must land inside one 300 ms debounce window, so that one
 * `edit` is posted and its content is the round-tripped document. If they
 * drift apart the first post has already gone and the check fails on
 * unpatched code AND patched code: a false red, never a false green, and the
 * measured gap is in the detail so the next reader can see that is what
 * happened.
 *
 * It proves the guard exists. It does NOT prove the load-time transaction
 * that #111 actually observed is covered; nothing here fires that.
 */
async function driveTransientKeystroke(base, session, contextId) {
  const marker = path.join(base, "phase-transient");
  const donePath = path.join(base, "phase-transient-done");
  const finish = (detail) => {
    try {
      fs.writeFileSync(donePath, detail, "utf8");
    } catch {
      /* the base is gone; the run is over anyway */
    }
    return detail;
  };

  if (!session || contextId == null) return finish("FAIL no webview context to drive");

  const deadline = Date.now() + 45000;
  while (!fs.existsSync(marker) && Date.now() < deadline) await sleep(500);
  if (!fs.existsSync(marker)) return "FAIL extension host never signalled phase-transient";

  const evaluate = async (expression) => {
    const result = await session.send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate threw");
    return result.result.value;
  };

  try {
    // Caret at the end of the first paragraph, the same placement the
    // FLOORPROBE phase uses.
    const before = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      if (!root) return null;
      const target = root.querySelector('p');
      if (!target) return null;
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return target.textContent;
    })()`);
    if (before === null) return finish("FAIL could not place the caret");

    const started = Date.now();
    await session.send("Input.insertText", { text: TRANSIENT_CHAR });
    // A real Backspace, not a DOM mutation: ProseMirror's own key handling and
    // its DOM observer are part of what is being exercised.
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type,
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8,
      });
    }
    const gap = Date.now() - started;

    await sleep(1200); // 300ms debounce, the host's WorkspaceEdit, and slack
    // The TARGET PARAGRAPH's text, not the whole `.tiptap`: that also carries
    // the text inside the rendered mermaid SVG and the code-block language
    // badge, which the plugins rebuild whenever the document is replaced. On
    // unpatched code this phase provokes exactly such a replacement, the very
    // bug being measured, so comparing the whole subtree would report the
    // symptom as a broken probe. Re-queried rather than held: a `setContent`
    // discards the old element.
    const after = await evaluate(
      `document.querySelector('.tiptap')?.querySelector('p')?.textContent ?? null`,
    );
    if (after !== before) {
      let at = 0;
      while (at < before.length && at < after.length && before[at] === after[at]) at++;
      return finish(
        `FAIL the editor did not return to its starting text (gap ${gap}ms); ` +
          `len ${before.length}->${String(after).length}, first difference at ${at}: ` +
          `${JSON.stringify(before.slice(Math.max(0, at - 20), at + 20))} -> ` +
          `${JSON.stringify(String(after).slice(Math.max(0, at - 20), at + 20))}`,
      );
    }
    return finish(`typed and removed ${JSON.stringify(TRANSIENT_CHAR)} ${gap}ms apart, debounce 300ms`);
  } catch (err) {
    return finish(`FAIL threw: ${err.message}`);
  }
}

/**
 * Operate each 2.17 editing surface in the live webview and report one result
 * per surface (#84).
 *
 * These exist because the wave that built those surfaces could add none of
 * them: four branches editing this file at once is the collision the wave was
 * organised to avoid, so the coordinator took the checks. Until they landed,
 * nothing automated touched the slash menu, the bubble menu, the link popover,
 * the lightbox's focus handling or the table menu's keyboard path, and the
 * acceptance for all of them read "verify by hand", which nobody had done.
 *
 * Every probe here drives the REAL element, through a real event, and asserts
 * on what the page then looks like. None of them reaches into module state:
 * the webview deliberately does not publish its internals on `window`, and
 * adding a hook to the shipped bundle to make testing easier would put test
 * scaffolding in production.
 *
 * The document is a per-run temp copy, so these are free to modify it. They
 * run AFTER the read-only phase has recorded its checks, for the same reason
 * the typing probe does.
 */
async function driveSurfaces(evaluate, session) {
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });

  const sleepShort = () => sleep(400);

  // --- Table context menu, keyboard path (#118) -----------------------------
  // Runs FIRST among the surfaces, because it is the only one that needs the
  // editor to still hold real focus: the plugin bails unless the ProseMirror
  // SELECTION is in a table, and ProseMirror only syncs its selection from the
  // DOM while its view has focus. Every later probe moves focus somewhere else.
  //
  // Three earlier versions of this probe failed for three different reasons and
  // all three reported a working menu as broken. Scripted range without a
  // selectionchange: never synced. A DevTools click at the cell's coordinates:
  // those are the webview IFRAME's viewport coordinates, and Input events are
  // dispatched in the top-level page's, so the click landed elsewhere. And
  // reading `defaultPrevented` as proof the plugin ran: the VS Code webview
  // cancels contextmenu itself, so that bit is true either way. Hence the
  // explicit `selectionInCell` precondition below; if it is false the detail
  // says so instead of blaming the menu.
  try {
    const placed = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const cell = root?.querySelector('table td, table th');
      if (!cell) return 'no table cell';
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return 'ok';
    })()`);
    if (placed !== "ok") throw new Error(placed);
    await sleep(600);

    const fired = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const cell = root?.querySelector('table td, table th');
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      const anchorEl = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
      const selectionInCell = !!anchorEl?.closest?.('td, th');
      const rect = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      }));
      return {
        selectionInCell,
        focusInEditor: !!document.activeElement?.closest?.('.tiptap'),
        // Read in the same turn: showContextMenu appends synchronously.
        openedImmediately: !!document.querySelector('.table-context-menu'),
      };
    })()`);
    await sleep(300);

    const menu = await evaluate(`(() => {
      const el = document.querySelector('.table-context-menu');
      if (!el) return { open: false };
      const items = el.querySelectorAll('button.table-ctx-item');
      return {
        open: true,
        items: items.length,
        alignEntries: Array.from(items).filter((b) => /align/i.test(b.textContent ?? '')).length,
        focusInside: !!(document.activeElement && el.contains(document.activeElement)),
        focusLabel: document.activeElement?.textContent?.trim()?.slice(0, 24) ?? null,
      };
    })()`);
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
      });
    }
    await sleep(300);
    const moved = await evaluate(
      `document.activeElement?.textContent?.trim()?.slice(0, 24) ?? null`,
    );
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
    await sleep(400);
    const closed = await evaluate(`!document.querySelector('.table-context-menu')`);
    add(
      "table context menu is operable from the keyboard and offers alignment",
      fired.selectionInCell && menu.open && menu.alignEntries >= 3 && menu.focusInside &&
        moved !== menu.focusLabel && closed,
      `selectionInCell=${fired.selectionInCell} focusInEditor=${fired.focusInEditor} ` +
        `openedImmediately=${fired.openedImmediately} open=${menu.open} items=${menu.items ?? 0} ` +
        `alignEntries=${menu.alignEntries ?? 0} focusInside=${menu.focusInside} ` +
        `focus=${JSON.stringify(menu.focusLabel ?? null)} afterArrowDown=${JSON.stringify(moved)} ` +
        `closedOnEscape=${closed}`,
    );
  } catch (err) {
    add("table context menu is operable from the keyboard and offers alignment", false, `threw: ${err.message}`);
  }

  // --- Slash command (#114) -------------------------------------------------
  // Typed into a NEW empty paragraph at the end, because the plugin only fires
  // at the start of an empty one. `Input.insertText` rather than a DOM write:
  // the suggestion plugin watches ProseMirror transactions, not the DOM.
  try {
    const placed = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      if (!root) return 'no .tiptap';
      const last = root.lastElementChild;
      if (!last) return 'empty doc';
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return 'ok';
    })()`);
    if (placed !== "ok") throw new Error(`caret: ${placed}`);
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
    }
    await sleepShort();
    await session.send("Input.insertText", { text: "/" });
    await sleepShort();
    const menu = await evaluate(`(() => {
      const popup = document.querySelector('.slash-command-popup');
      if (!popup) return { open: false, items: 0, inContainer: false };
      return {
        open: true,
        items: popup.querySelectorAll('.slash-command-item').length,
        // AGENTS.md: popups attach to #editor-container, never .tiptap, because
        // CSS zoom on .tiptap is transparent to the JS coordinate APIs.
        inContainer: !!popup.closest('#editor-container') && !popup.closest('.tiptap'),
      };
    })()`);
    add(
      "slash command opens a filtered block menu",
      menu.open && menu.items >= 10 && menu.inContainer,
      `open=${menu.open} items=${menu.items} attachedToEditorContainer=${menu.inContainer}`,
    );
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
    await sleepShort();
  } catch (err) {
    add("slash command opens a filtered block menu", false, `threw: ${err.message}`);
  }

  // --- Bubble menu (#116) ---------------------------------------------------
  try {
    const selected = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const strong = root?.querySelector('strong');
      if (!strong) return 'no bold text to select';
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(strong);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return 'ok';
    })()`);
    if (selected !== "ok") throw new Error(selected);
    await sleep(900);
    const bubble = await evaluate(`(() => {
      const menu = document.querySelector('.bubble-menu');
      if (!menu) return { present: false };
      const style = getComputedStyle(menu);
      return {
        present: true,
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        buttons: menu.querySelectorAll('.bubble-menu-btn').length,
        commands: Array.from(menu.querySelectorAll('.bubble-menu-btn')).map((b) => b.dataset.command).join(','),
        inContainer: !!menu.closest('#editor-container') && !menu.closest('.tiptap'),
      };
    })()`);
    add(
      "bubble menu appears on a text selection",
      bubble.present && bubble.visible && bubble.buttons === 5 && bubble.inContainer,
      `present=${bubble.present} visible=${bubble.visible} buttons=${bubble.buttons} [${bubble.commands ?? ""}] attachedToEditorContainer=${bubble.inContainer}`,
    );
  } catch (err) {
    add("bubble menu appears on a text selection", false, `threw: ${err.message}`);
  }

  // --- Inline link popover (#117) ------------------------------------------
  // Opened from the TOOLBAR button, not the bubble menu one, so this probe
  // does not fail merely because the bubble menu did.
  try {
    const opened = await evaluate(`(() => {
      const btn = document.querySelector('.toolbar-btn[data-command="link"]');
      if (!btn) return 'no toolbar link button';
      btn.click();
      return 'ok';
    })()`);
    if (opened !== "ok") throw new Error(opened);
    await sleep(600);
    const popover = await evaluate(`(() => {
      const el = document.getElementById('link-popover');
      if (!el) return { present: false };
      return {
        present: true,
        open: !el.classList.contains('hidden'),
        hasInput: !!document.getElementById('link-url-input'),
        focusInside: !!(document.activeElement && el.contains(document.activeElement)),
      };
    })()`);
    add(
      "link editor opens as a popover at the caret",
      popover.present && popover.open && popover.hasInput,
      `present=${popover.present} open=${popover.open} input=${popover.hasInput} focusInside=${popover.focusInside}`,
    );
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
    await sleepShort();
  } catch (err) {
    add("link editor opens as a popover at the caret", false, `threw: ${err.message}`);
  }

  // --- Image is an Image node, not a raw-HTML badge (#120) ------------------
  // The one combination no single worker ever saw: the resize NodeView was
  // built while MarkdownImage was `inline: false`, and the link editor flipped
  // it to `inline: true` on another branch. They met only at the merge.
  try {
    // The NodeView writes the width as a CSS width on the element, not as an
    // `width=` attribute, so that is what this reads. The first version of this
    // probe looked for `img[width]`, found nothing and reported a passing
    // feature as broken.
    const img = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const imgs = Array.from(root?.querySelectorAll('img') ?? []);
      const sized = imgs.find((el) => el.style.width);
      return {
        total: imgs.length,
        // Each entry is parentTag:file, because a bare count of img elements
        // cannot tell a second image from a second element rendered for the
        // same image. Backticks are banned in here: this whole expression is a
        // template literal, and one in a comment ends it. That has now cost two
        // syntax errors.
        srcs: imgs.map((el) => (el.parentElement?.tagName?.toLowerCase() ?? '?') + ':' + ((el.getAttribute('src') || '(empty)').split('/').pop())).join(' '),
        // prosemirror-view puts its own srcless img.ProseMirror-separator next
        // to a leaf node in a real browser, so the raw count is twice the number
        // of images. That is upstream behaviour, not a duplicate node (#125);
        // what must stay true is that the document renders exactly one real
        // element per image and that nothing walks the separators.
        classes: imgs.map((el) => el.className || '(none)').join(' '),
        real: imgs.filter((el) => !el.classList.contains('ProseMirror-separator')).length,
        sizedWidth: sized?.style.width ?? null,
        // An inline image sits inside a paragraph. A direct child of .tiptap
        // would be the invalid document that stopped the editor mounting.
        sizedParent: sized?.parentElement?.tagName?.toLowerCase() ?? null,
        handles: document.querySelectorAll('.image-resize-handle').length,
        badges: root?.querySelectorAll('.raw-html-block').length ?? 0,
      };
    })()`);
    add(
      "an image with a width is an image node, not a raw-HTML badge",
      img.sizedWidth === "96px" &&
        img.badges === 0 &&
        img.sizedParent === "p" &&
        img.handles >= 1 &&
        img.real === 2 &&
        img.real === img.handles,
      `sizedImgCssWidth=${img.sizedWidth ?? "-"} parent=<${img.sizedParent ?? "-"}> imgs=${img.total} real=${img.real} [${img.srcs}] classes=[${img.classes}] rawHtmlBadges=${img.badges} resizeHandles=${img.handles}`,
    );
  } catch (err) {
    add("an image with a width is an image node, not a raw-HTML badge", false, `threw: ${err.message}`);
  }

  // --- Lightbox focus trap and restore (#119) -------------------------------
  try {
    // The expand button reads a module-level `currentHoveredImg`, which the
    // hover overlay sets. Clicking the button without the overlay having become
    // visible clicks a button that has no image to show, which is what the
    // first version of this probe did.
    // The overlay is driven by a `mousemove` on the EDITOR element whose
    // clientX/clientY fall inside an image's bounding rect, not by a mouseover
    // on the image. A synthetic event with no coordinates lands at 0,0 and
    // matches nothing, which is what the first version of this probe sent.
    const hovered = await evaluate(`(() => {
      const editorEl = document.querySelector('.tiptap');
      const img = editorEl?.querySelector('img');
      if (!img) return 'no image';
      const r = img.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return 'image has no layout box';
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      editorEl.dispatchEvent(new MouseEvent('mousemove', at));
      return 'ok';
    })()`);
    if (hovered !== "ok") throw new Error(hovered);
    await sleep(500);
    const opened = await evaluate(`(() => {
      const overlay = document.querySelector('.image-edit-overlay');
      if (!overlay) return 'no hover overlay';
      if (!overlay.classList.contains('visible')) return 'hover overlay never became visible';
      const btn = overlay.querySelector('.image-expand-btn');
      if (!btn) return 'no expand button in the overlay';
      btn.click();
      return 'ok';
    })()`);
    if (opened !== "ok") throw new Error(opened);
    await sleep(700);
    const inside = await evaluate(`(() => {
      const overlay = document.getElementById('lightbox-overlay');
      if (!overlay) return { open: false };
      return {
        open: overlay.classList.contains('active'),
        focusInside: !!(document.activeElement && overlay.contains(document.activeElement)),
        focusTag: document.activeElement?.tagName ?? null,
        focusClass: document.activeElement?.className ?? null,
        role: overlay.getAttribute('role'),
        // A covered window gets no animation frame. The focus call used to be
        // scheduled ONLY from requestAnimationFrame, so this check could fail
        // for a reason that had nothing to do with the focus trap (#112's
        // mechanism, second occurrence). Reported so the two never read alike.
        visibility: document.visibilityState,
      };
    })()`);
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
    await sleep(600);
    const after = await evaluate(`(() => {
      const overlay = document.getElementById('lightbox-overlay');
      return {
        closed: !overlay?.classList.contains('active'),
        focusLeftOverlay: !(document.activeElement && overlay?.contains(document.activeElement)),
        focusTag: document.activeElement?.tagName ?? null,
      };
    })()`);
    add(
      "lightbox takes focus on open and gives it back on Escape",
      inside.open && inside.focusInside && after.closed && after.focusLeftOverlay,
      `opened=${inside.open} focusInside=${inside.focusInside} (${inside.focusTag ?? "-"}` +
        `${inside.focusClass ? "." + String(inside.focusClass).split(" ")[0] : ""}) ` +
        `role=${inside.role ?? "-"} visibility=${inside.visibility ?? "-"}; ` +
        `afterEscape closed=${after.closed} focusLeftOverlay=${after.focusLeftOverlay} (${after.focusTag ?? "-"})`,
    );
  } catch (err) {
    add("lightbox takes focus on open and gives it back on Escape", false, `threw: ${err.message}`);
  }

  // --- Bubble menu at a zoom level other than 100% (#116) -------------------
  // AGENTS.md: CSS `zoom` on `.tiptap` is transparent to the JS coordinate
  // APIs, which is why every popup in this codebase attaches to
  // #editor-container. #116 asked for this to be checked by hand at a non-100%
  // zoom, and nobody did. The numbers are all in the detail line because the
  // interesting failure is a menu that drifts, not one that vanishes.
  try {
    await evaluate(`(() => {
      const btn = document.getElementById('btn-zoom-in');
      btn?.click(); btn?.click();
      return 'ok';
    })()`);
    await sleep(500);
    const selected = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const strong = root?.querySelector('strong');
      if (!strong) return 'no bold text to select';
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(strong);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return 'ok';
    })()`);
    if (selected !== "ok") throw new Error(selected);
    await sleep(900);
    const z = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      const menu = document.querySelector('.bubble-menu');
      const sel = window.getSelection();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const m = menu ? menu.getBoundingClientRect() : null;
      const round = (n) => (n == null ? null : Math.round(n));
      return {
        zoom: getComputedStyle(root).zoom,
        present: !!menu,
        visible: menu ? getComputedStyle(menu).display !== 'none' : false,
        selCenterX: round(r ? r.left + r.width / 2 : null),
        selTop: round(r ? r.top : null),
        menuCenterX: round(m ? m.left + m.width / 2 : null),
        menuTop: round(m ? m.top : null),
        // The whole point of attaching to #editor-container: a menu inside
        // .tiptap would itself be scaled by the zoom.
        inContainer: menu ? (!!menu.closest('#editor-container') && !menu.closest('.tiptap')) : false,
      };
    })()`);
    const dx = z.selCenterX != null && z.menuCenterX != null ? Math.abs(z.selCenterX - z.menuCenterX) : null;
    const dy = z.selTop != null && z.menuTop != null ? Math.abs(z.selTop - z.menuTop) : null;
    add(
      "bubble menu still tracks the selection at a non-100% zoom",
      z.present && z.visible && z.inContainer && dx != null && dx <= 80 && dy != null && dy <= 120,
      `zoom=${z.zoom} present=${z.present} visible=${z.visible} attachedToEditorContainer=${z.inContainer} ` +
        `selCenterX=${z.selCenterX} menuCenterX=${z.menuCenterX} dx=${dx} ` +
        `selTop=${z.selTop} menuTop=${z.menuTop} dy=${dy}`,
    );
    await evaluate(`(() => { document.getElementById('btn-zoom-reset')?.click(); return 'ok'; })()`);
    await sleep(400);
  } catch (err) {
    add("bubble menu still tracks the selection at a non-100% zoom", false, `threw: ${err.message}`);
  }

  // --- @ mention and [[ wiki link popups (#88 hand-test debt) ---------------
  // Same shape as the slash probe: both are @tiptap/suggestion consumers over
  // the shared SuggestionPopup, and both need a real transaction, so the
  // trigger goes in with Input.insertText rather than a DOM write.
  for (const [label, trigger, popupSel, itemSel] of [
    ["@ mention", "@", ".file-mention-popup", ".file-mention-item"],
    ["[[ wiki link", "[[", ".wiki-link-popup", ".wiki-link-item"],
  ]) {
    const name = `${label} popup lists workspace files`;
    try {
      const placed = await evaluate(`(() => {
        const root = document.querySelector('.tiptap');
        const last = root?.lastElementChild;
        if (!last) return 'empty doc';
        root.focus();
        const range = document.createRange();
        range.selectNodeContents(last);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return 'ok';
      })()`);
      if (placed !== "ok") throw new Error(`caret: ${placed}`);
      for (const type of ["keyDown", "keyUp"]) {
        await session.send("Input.dispatchKeyEvent", {
          type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        });
      }
      await sleepShort();
      await session.send("Input.insertText", { text: trigger });
      // The host answers this one over a message round trip, unlike the slash
      // menu, so it needs longer than sleepShort.
      await sleep(1200);
      const popup = await evaluate(`(() => {
        const el = document.querySelector('${popupSel}');
        if (!el) return {
          open: false,
          anyPopup: document.querySelectorAll('.file-mention-popup, .wiki-link-popup, .slash-command-popup').length,
          tail: (document.querySelector('.tiptap')?.lastElementChild?.textContent ?? '').slice(-12),
        };
        const items = el.querySelectorAll('${itemSel}');
        return {
          open: true,
          items: items.length,
          first: items[0]?.textContent?.trim()?.slice(0, 40) ?? null,
          inContainer: !!el.closest('#editor-container') && !el.closest('.tiptap'),
        };
      })()`);
      add(
        name,
        popup.open && popup.items >= 1 && popup.inContainer,
        `open=${popup.open} items=${popup.items ?? 0} first=${JSON.stringify(popup.first ?? null)} ` +
          `attachedToEditorContainer=${popup.inContainer ?? false}` +
          (popup.open ? "" : ` otherPopups=${popup.anyPopup} tail=${JSON.stringify(popup.tail ?? null)}`),
      );
      for (const type of ["keyDown", "keyUp"]) {
        await session.send("Input.dispatchKeyEvent", {
          type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
        });
      }
      await sleepShort();
    } catch (err) {
      add(name, false, `threw: ${err.message}`);
    }
  }

  // --- Heading anchor button (#84) ------------------------------------------
  // The risk this pins is not the clipboard, which a webview may refuse; it is
  // that a button living INSIDE contenteditable corrupts the document when
  // pressed. So the assertion is on the heading's text, before and after.
  try {
    const result = await evaluate(`(async () => {
      const heading = document.querySelector('.tiptap h1');
      const btn = heading?.querySelector('.heading-anchor-btn');
      if (!btn) return { present: false };
      const before = heading.textContent;
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 400));
      return {
        present: true,
        textUnchanged: heading.textContent === before,
        copiedClass: btn.classList.contains('is-copied'),
        title: btn.getAttribute('title'),
      };
    })()`);
    add(
      "heading anchor button does not disturb the document it lives in",
      result.present && result.textUnchanged,
      `present=${result.present} headingTextUnchanged=${result.textUnchanged} ` +
        `clipboardAccepted=${result.copiedClass} title=${JSON.stringify(result.title ?? null)}`,
    );
  } catch (err) {
    add("heading anchor button does not disturb the document it lives in", false, `threw: ${err.message}`);
  }

  return results;
}

/**
 * Drive the webview through its own UI, so the extension host's message
 * dispatch is exercised end to end.
 *
 * The webview's `acquireVsCodeApi()` handle is a module-level const in
 * `main.ts` and is deliberately not published on `window`, so there is no way
 * to post a host message from here — and adding a hook to the shipped bundle
 * to make one would be test scaffolding in production. Driving the UI is the
 * stronger pin anyway: a typed character travels the real Tiptap `onUpdate`,
 * the real 300 ms debounce and the real host `edit` case, and a click on
 * `#btn-source` travels the real `viewSource` case.
 *
 * The two processes rendezvous on marker files inside the per-run base, the
 * one directory both of them already know (the host has it as the parent of
 * `TUI_FLOOR_RESULT`). The host writes `phase-interact` once its read-only
 * checks are done; this drives; this writes `phase-driven`; the host then
 * asserts. Putting this between the probe loop and the exit race matters:
 * the race SIGKILLs the host 60 s later, and the DOM checks above read a
 * snapshot taken during the probe loop, so modifying the document now cannot
 * corrupt them.
 */
async function driveInteractions(base, session, contextId) {
  const interactMarker = path.join(base, "phase-interact");
  const drivenMarker = path.join(base, "phase-driven");
  const steps = [];
  /** One entry per 2.17 surface; surfaced as its own check by main(). */
  const surfaces = [];

  // Release the host on every path out of here, including the two early ones.
  // Without it the host waits out its own 60 s timeout while the exit race is
  // also counting 60 s, and a run that merely failed to mount the webview
  // reports "no result file" instead of the reason.
  const release = () => {
    try {
      fs.writeFileSync(drivenMarker, "done", "utf8");
    } catch {
      /* the base is gone; the run is over anyway */
    }
  };

  if (!session || contextId == null) {
    release();
    return { ok: false, detail: "no webview context to drive; earlier checks say why", surfaces };
  }

  const evaluate = async (expression) => {
    const result = await session.send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate threw");
    return result.result.value;
  };

  const deadline = Date.now() + 45000;
  while (!fs.existsSync(interactMarker) && Date.now() < deadline) await sleep(500);
  if (!fs.existsSync(interactMarker)) {
    // Nothing to release here: the host never reached the rendezvous, so it is
    // not waiting on `phase-driven`.
    return { ok: false, detail: "extension host never signalled phase-interact", surfaces };
  }

  try {
    // 1. Type into the first paragraph. `Input.insertText` is what a real
    //    keystroke's text insertion looks like to the page, so ProseMirror
    //    handles it through its own beforeinput path.
    const focused = await evaluate(`(() => {
      const root = document.querySelector('.tiptap');
      if (!root) return 'no .tiptap';
      const target = root.querySelector('p');
      if (!target) return 'no paragraph';
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return 'ok';
    })()`);
    if (focused !== "ok") return { ok: false, detail: `could not place the caret: ${focused}`, surfaces };

    await session.send("Input.insertText", { text: EDIT_SENTINEL });
    steps.push(`typed ${EDIT_SENTINEL}`);

    // The webview debounces the `edit` message by 300 ms and the host then
    // applies a WorkspaceEdit; 2 s is that with room to spare, and it is also
    // long enough for an edit LOOP to show itself in the host's version count.
    await sleep(2000);

    const typed = await evaluate(
      `document.querySelector('.tiptap')?.textContent?.includes(${JSON.stringify(EDIT_SENTINEL)}) ?? false`,
    );
    if (!typed) return { ok: false, detail: "the sentinel never appeared in the editor DOM", surfaces };
    steps.push("sentinel present in the editor DOM");

    // 2. Operate each 2.17 surface. These report as their own checks rather
    //    than folding into this one, so a broken lightbox does not read as a
    //    broken slash menu.
    surfaces.push(...(await driveSurfaces(evaluate, session)));

    // 3. Click the view-source button, the cheapest host dispatch there is.
    const clicked = await evaluate(`(() => {
      const button = document.getElementById('btn-source');
      if (!button) return 'no #btn-source';
      button.click();
      return 'ok';
    })()`);
    if (clicked !== "ok") return { ok: false, detail: `could not click view source: ${clicked}`, surfaces };
    steps.push("clicked #btn-source");
    await sleep(1500);
  } catch (err) {
    return { ok: false, detail: `${steps.join("; ")}${steps.length ? "; " : ""}threw: ${err.message}`, surfaces };
  } finally {
    // Always release the host, even on failure: without this it waits out its
    // own timeout and the run takes a minute longer to report the same thing.
    try {
      fs.writeFileSync(drivenMarker, steps.join("\n"), "utf8");
    } catch {
      release();
    }
  }

  return { ok: true, detail: steps.join("; "), surfaces };
}

/** Attach to every page/iframe target the browser endpoint reports. */
async function attachAll(port, sessions) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  for (const target of targets) {
    if (!target.webSocketDebuggerUrl) continue;
    if (sessions.has(target.id)) continue;
    const session = new DevToolsSession(target.webSocketDebuggerUrl);
    sessions.set(target.id, session);
    try {
      await session.opened;
      await session.send("Runtime.enable");
      await session.send("Log.enable");
      await session.send("Page.enable");
    } catch {
      sessions.delete(target.id);
      session.close();
    }
  }
}

function tick(ok) {
  return ok ? "PASS" : "FAIL";
}

async function main() {
  const version = floorVersion();
  console.log(`VS Code floor check — target version ${version}`);

  if (!fs.existsSync(TESTS_ENTRY)) {
    console.error(`missing ${path.relative(REPO, TESTS_ENTRY)} — run: npm run build:floor-tests`);
    return 1;
  }

  const executable = await ensureVsCode(version);
  const debugPort = await freePort();
  // No rmSync here: mkdtemp hands back a directory that did not exist a
  // moment ago, and wiping a shared parent is what #110 was.
  const base = perRunBase();
  const workspace = path.join(base, "ws");
  const userData = path.join(base, "ud");
  const extensions = path.join(base, "ext");
  const resultFile = path.join(base, "result.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(extensions, { recursive: true });
  const sample = path.join(workspace, "sample.md");
  fs.copyFileSync(SAMPLE, sample);
  // sample.md references media/icon.png twice, once with a width and once
  // without, so the image checks have a file that actually resolves through
  // the webview's localResourceRoots rather than a broken <img>.
  fs.mkdirSync(path.join(workspace, "media"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "media", "icon.png"), path.join(workspace, "media", "icon.png"));

  const child = spawn(
    executable,
    [
      `--extensionDevelopmentPath=${REPO}`,
      `--extensionTestsPath=${TESTS_ENTRY}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
      "--disable-workspace-trust",
      "--skip-release-notes",
      "--skip-welcome",
      "--disable-updates",
      `--remote-debugging-port=${debugPort}`,
      workspace,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv({
        TUI_FLOOR_RESULT: resultFile,
        TUI_FLOOR_SAMPLE: sample,
        TUI_FLOOR_SENTINEL: EDIT_SENTINEL,
      }),
    },
  );

  const hostOutput = [];
  child.stdout.on("data", (data) => hostOutput.push(String(data)));
  child.stderr.on("data", (data) => hostOutput.push(String(data)));

  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));

  // Keep probing after the editor mounts: the mermaid artifact is fetched
  // lazily and renders a few hundred ms later, so the first successful probe
  // would report a diagram that is merely still loading.
  const sessions = new Map();
  let webview = null;
  let webviewSession = null;
  const probeStart = Date.now();
  let mountedAt = null;
  let mermaidReadyAt = null;
  // Two conditions, two budgets (#112). The mount is fast and MOUNT_TIMEOUT_MS
  // is generous for it; the mermaid artifact is a separate lazily-fetched
  // bundle carrying mermaid plus ELK, and its budget starts when the editor
  // mounts rather than sharing the mount's.
  let deadline = probeStart + MOUNT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      await attachAll(debugPort, sessions);
      for (const session of sessions.values()) {
        const probe = await probeWebview(session);
        if (probe) {
          webview = probe;
          webviewSession = session;
          break;
        }
      }
    } catch {
      /* endpoint not up yet */
    }
    if (webview && mountedAt === null) {
      mountedAt = Date.now();
      deadline = mountedAt + MERMAID_TIMEOUT_MS;
    }
    if (webview && webview.mermaidRendered >= 1 && webview.mermaidStuck === 0) {
      mermaidReadyAt = Date.now();
      break;
    }
  }

  // Captured here, not where the checks are built: by then `driveInteractions`
  // and the 60s exit race have run, and a "still loading after Xms" detail
  // would report their time as the diagram's.
  const probeEnd = Date.now();

  // Phase two: drive the live webview, then let the extension host assert
  // what the driving produced. Everything above only READS; from here on the
  // document is deliberately modified, which is why this runs after the
  // in-host `document still unmodified after the hold` check and never before.
  // Strictly before the FLOORPROBE phase: that one posts a real edit, after
  // which the document is dirty for a legitimate reason and this could not
  // tell the two apart.
  await driveTransientKeystroke(base, webviewSession, webview?.contextId);

  const driven = await driveInteractions(base, webviewSession, webview?.contextId);

  const consoleEntries = [...sessions.values()].flatMap((s) => s.consoleEntries);
  for (const session of sessions.values()) session.close();

  const exitCode = await Promise.race([exited, sleep(60000).then(() => null)]);
  if (exitCode === null) child.kill("SIGKILL");

  const checks = [];
  // Reported first, and separately: when the build never launches, every
  // later check fails for a reason that has nothing to do with the extension.
  checks.push({
    name: "floor VS Code build launched",
    ok: sessions.size > 0,
    detail:
      sessions.size > 0
        ? `${sessions.size} debug target(s)`
        : "no debug target ever appeared; see the host output below",
  });
  if (fs.existsSync(resultFile)) {
    checks.push(...JSON.parse(fs.readFileSync(resultFile, "utf8")));
  } else {
    checks.push({
      name: "extension host checks ran",
      ok: false,
      detail: "no result file; see the host output below",
    });
  }

  const violations = consoleEntries.filter((entry) =>
    /content security policy|refused to|csp/i.test(entry),
  );

  checks.push({
    name: "webview mounts the editor",
    ok: !!webview,
    detail: webview
      ? `${webview.href}, mounted ${mountedAt - probeStart}ms into the probe`
      : // "no .tiptap appeared" on its own says nothing about WHY, and a
        // failure that says nothing costs a wave the time it takes to guess.
        // The console is where an exception thrown while the editor is being
        // built ends up, so print it here rather than only for CSP.
        `no frame reported a .tiptap element within ${MOUNT_TIMEOUT_MS}ms; ` +
        (consoleEntries.length
          ? `console: ${consoleEntries.slice(-6).map((e) => e.slice(0, 220)).join(" | ")}`
          : "the console said nothing either"),
  });
  if (webview) {
    checks.push({
      name: "document content rendered in the webview",
      // The heading text carries the collapse arrow and the level badge
      // that heading-collapse-plugin / heading-level-plugin render inside it.
      ok:
        (webview.heading ?? "").includes("Heading One") &&
        webview.tableRows >= 3 &&
        webview.boldText &&
        webview.taskItems >= 2 &&
        webview.codeBlocks >= 1,
      detail: `heading=${JSON.stringify(webview.heading)} tableRows=${webview.tableRows} bold=${webview.boldText} codeBlocks=${webview.codeBlocks} taskItems=${webview.taskItems} checkboxes=${webview.taskCheckboxes} alerts=${webview.alerts}`,
    });
    // `stuckPlaceholders>0 errors=0` means the diagram was STILL LOADING when
    // the budget ran out, which is a different failure from one that rendered
    // nothing or rendered an error. `scheduled=` then separates the two ways
    // of being still loading, and #112 turned out to be the second: a render
    // that was slow, versus a render that was NEVER SCHEDULED because the
    // window was hidden and got no animation frame. Only the first is about
    // the budget. Say which, and how long it took, since the budget below is
    // only defensible next to a measurement.
    const counts =
    `rendered=${webview.mermaidRendered} errors=${webview.mermaidErrors} ` +
    `stuckPlaceholders=${webview.mermaidStuck} scheduled=${webview.mermaidScheduled} ` +
    `visibility=${webview.visibility}`;
    const sinceMount = (mermaidReadyAt ?? probeEnd) - mountedAt;
    checks.push({
      name: "lazy mermaid artifact loads and renders",
      ok: webview.mermaidRendered >= 1 && webview.mermaidErrors === 0 && webview.mermaidStuck === 0,
      detail: mermaidReadyAt
        ? `${counts}; ${sinceMount}ms after mount, budget ${MERMAID_TIMEOUT_MS}ms`
        : webview.mermaidStuck > 0 && webview.mermaidErrors === 0
          ? `${counts}; STILL LOADING after ${sinceMount}ms, budget ${MERMAID_TIMEOUT_MS}ms exhausted; ` +
            (webview.mermaidScheduled === 0
              ? `nothing was ever scheduled, so this is not the budget (see #112: a hidden window gets no animation frame)`
              : `scheduled but unfinished, so this one really is about the budget`)
          : `${counts}; ${sinceMount}ms after mount, nothing left loading, so the artifact did not render`,
    });
    checks.push({
      name: "toolbar and metadata panel present",
      ok: webview.toolbar && webview.metadataPanel,
      detail: `toolbar=${webview.toolbar} metadataPanel=${webview.metadataPanel} bodyClass=${webview.bodyClass}`,
    });
  }
  checks.push({
    name: "webview interactions could be driven",
    ok: driven.ok,
    detail: driven.detail,
  });
  // One check per 2.17 surface. If the drive phase died before reaching them,
  // say so once rather than reporting seven silent passes.
  if (driven.surfaces?.length) {
    checks.push(...driven.surfaces);
  } else {
    checks.push({
      name: "2.17 editing surfaces were driven",
      ok: false,
      detail: "the drive phase never reached them; the check above says why",
    });
  }
  checks.push({
    name: "no CSP violation in the console",
    ok: violations.length === 0,
    detail: violations.length ? violations.slice(0, 3).join(" | ") : `${consoleEntries.length} console entries, none CSP`,
  });

  console.log("");
  for (const check of checks) {
    console.log(`${tick(check.ok).padEnd(5)} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(`${checks.length} checks: ${checks.length - failed.length} passed, ${failed.length} failed`);

  if (failed.length > 0) {
    console.log("");
    console.log("--- VS Code output ---");
    console.log(hostOutput.join("").slice(-4000));
  }

  // A passing run leaves nothing behind; a failing one keeps its directory,
  // because `ws/sample.md`, `ud/logs/` and `result.json` are the evidence.
  if (keep || failed.length > 0) console.log(`kept: ${base}`);
  else fs.rmSync(base, { recursive: true, force: true });

  return failed.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
