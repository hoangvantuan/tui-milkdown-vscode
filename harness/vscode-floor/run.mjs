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
const WEBVIEW_TIMEOUT_MS = 40000;

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
    mermaidRendered: document.querySelectorAll('.mermaid-preview[data-rendered="true"] svg').length,
    mermaidErrors: document.querySelectorAll('.mermaid-err-msg').length,
    mermaidStuck: document.querySelectorAll('.mermaid-loading').length,
    metadataPanel: !!document.querySelector('#metadata-panel'),
    toolbar: !!document.querySelector('.editor-toolbar, #toolbar'),
    bodyClass: document.body.className.slice(0, 80)
  })`;
  for (const context of session.contexts) {
    try {
      const result = await session.send("Runtime.evaluate", {
        expression,
        contextId: context.id,
        returnByValue: true,
      });
      const value = JSON.parse(result.result.value);
      if (value.editorMounted) return value;
    } catch {
      /* context went away, or belongs to another frame */
    }
  }
  return null;
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
  const deadline = Date.now() + WEBVIEW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      await attachAll(debugPort, sessions);
      for (const session of sessions.values()) {
        const probe = await probeWebview(session);
        if (probe) {
          webview = probe;
          break;
        }
      }
    } catch {
      /* endpoint not up yet */
    }
    if (webview && webview.mermaidRendered >= 1 && webview.mermaidStuck === 0) break;
  }

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
    detail: webview ? webview.href : "no frame reported a .tiptap element",
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
    checks.push({
      name: "lazy mermaid artifact loads and renders",
      ok: webview.mermaidRendered >= 1 && webview.mermaidErrors === 0 && webview.mermaidStuck === 0,
      detail: `rendered=${webview.mermaidRendered} errors=${webview.mermaidErrors} stuckPlaceholders=${webview.mermaidStuck}`,
    });
    checks.push({
      name: "toolbar and metadata panel present",
      ok: webview.toolbar && webview.metadataPanel,
      detail: `toolbar=${webview.toolbar} metadataPanel=${webview.metadataPanel} bodyClass=${webview.bodyClass}`,
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
