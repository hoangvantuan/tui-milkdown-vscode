import * as fs from "fs";
import * as vscode from "vscode";

/**
 * Locate a Chromium-family executable for puppeteer-core.
 *
 * VS Code extension host process is an Electron helper, not a stand-alone
 * Chromium — puppeteer cannot drive it. We therefore need a real browser
 * binary on the user's machine (Chrome, Edge, Chromium, or Brave).
 *
 * Lookup order (first hit wins):
 *   1. `tuiMarkdown.chromiumPath` setting
 *   2. PUPPETEER_EXECUTABLE_PATH env var
 *   3. Well-known OS paths
 *
 * Result is cached per extension host session.
 */

let cachedPath: string | null | undefined;

export function clearChromiumCache(): void {
  cachedPath = undefined;
}

/** Strip leading/trailing whitespace and surrounding quotes. */
function cleanPath(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, "");
}

export async function findChromiumExecutable(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;

  const setting = cleanPath(
    vscode.workspace.getConfiguration("tuiMarkdown").get<string>("chromiumPath", ""),
  );
  if (setting && isExecutable(setting)) {
    cachedPath = setting;
    return cachedPath;
  }

  const envVar = cleanPath(process.env.PUPPETEER_EXECUTABLE_PATH || "");
  if (envVar && isExecutable(envVar)) {
    cachedPath = envVar;
    return cachedPath;
  }

  for (const candidate of candidatePaths()) {
    if (isExecutable(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  // Don't cache misses: user may install a browser during this session
  return null;
}

function isExecutable(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return false;
    // fs.accessSync throws if path cannot be read or executed.
    // On Windows X_OK is treated as F_OK (file exists); acceptable.
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidatePaths(): string[] {
  const platform = process.platform;
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Arc.app/Contents/MacOS/Arc",
    ];
  }
  if (platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pfx86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pfx86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${pfx86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${pf}\\Chromium\\Application\\chrome.exe`,
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
    "/opt/google/chrome/chrome",
  ];
}
