/**
 * `readClipboardImage`: pull an image off the system clipboard by shelling out.
 *
 * This is a fallback path. A webview paste event does not always carry image
 * items in `clipboardData`, so the host reads the clipboard natively instead:
 * osascript (with a TIFF -> PNG `sips` second try) on macOS, PowerShell on
 * Windows, xclip with a wl-paste fallback on Linux. Everything runs through
 * `execFile` callbacks, so this function returns as soon as the first command
 * is spawned; the reply reaches the webview later.
 *
 * `notifyError` is the provider's own reporter: it both posts the error to the
 * webview and de-duplicates the user-visible warning per reason, so a missing
 * xclip does not raise one dialog per paste.
 */
import * as path from "path";
import type { TypedWebview } from "./typedWebview";

export function handleReadClipboardImage(
  webview: TypedWebview,
  notifyError: (
    webview: TypedWebview,
    reason: string,
    warningMessage?: string,
  ) => void,
): void {
  // Read image from system clipboard via native command (fallback for webviews
  // where paste event clipboardData doesn't contain image items).
  try {
    const { execFile } = require("child_process") as typeof import("child_process");
    const os = require("os") as typeof import("os");
    const fs = require("fs") as typeof import("fs");
    const id = `clipboard-${Date.now()}`;
    const tmpPng = path.join(os.tmpdir(), `${id}.png`);
    const tmpTiff = path.join(os.tmpdir(), `${id}.tiff`);
    const cleanup = () => {
      try { fs.unlinkSync(tmpPng); } catch { /* ok */ }
      try { fs.unlinkSync(tmpTiff); } catch { /* ok */ }
    };

    const finalize = () => {
      try {
        const buffer = fs.readFileSync(tmpPng);
        webview.postMessage({
          type: "clipboardImage",
          data: `data:image/png;base64,${buffer.toString("base64")}`,
        });
      } catch (readErr) {
        notifyError(
          webview,
          "clipboard-file-read-failed",
          `Failed to read clipboard image: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
      }
      cleanup();
    };

    if (process.platform === "darwin") {
      // macOS: try PNG first via osascript, fall back to TIFF + sips convert
      const script = `
        try
          set theImage to the clipboard as «class PNGf»
          set theFile to open for access POSIX file "${tmpPng}" with write permission
          write theImage to theFile
          close access theFile
          return "png"
        on error
          try
            set theImage to the clipboard as «class TIFF»
            set theFile to open for access POSIX file "${tmpTiff}" with write permission
            write theImage to theFile
            close access theFile
            return "tiff"
          on error
            return "none"
          end try
        end try
      `;
      execFile("osascript", ["-e", script], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          cleanup();
          notifyError(
            webview,
            "macos-clipboard-failed",
            `Failed to read clipboard image: ${err.message}`,
          );
          return;
        }
        const fmt = (stdout || "").trim();
        if (fmt === "none") {
          cleanup();
          return;
        }

        if (fmt === "tiff") {
          // Convert TIFF → PNG via sips
          execFile("sips", ["-s", "format", "png", tmpTiff, "--out", tmpPng],
            { timeout: 5000 }, (sipsErr) => {
              if (sipsErr) {
                cleanup();
                notifyError(
                  webview,
                  "sips-convert-failed",
                  `Failed to convert clipboard image: ${sipsErr.message}`,
                );
                return;
              }
              finalize();
            });
        } else {
          finalize();
        }
      });
    } else if (process.platform === "win32") {
      const psCmd = `$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${tmpPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' }`;
      execFile("powershell", ["-NoProfile", "-Command", psCmd],
        { timeout: 5000 }, (err, stdout) => {
          if (err) {
            cleanup();
            notifyError(
              webview,
              "windows-clipboard-failed",
              `Failed to read clipboard image: ${err.message}`,
            );
            return;
          }
          if ((stdout || "").includes("ok")) {
            finalize();
          } else {
            cleanup();
          }
        });
    } else {
      // Linux: try xclip (X11), fall back to wl-paste (Wayland)
      let xclipFailed = false;
      let wlPasteFailed = false;

      const tryCmd = (prog: string, args: string[]) => {
        execFile(prog, args, { timeout: 5000 }, (err, _stdout, stderr) => {
          if (!err) {
            finalize();
          } else if (prog === "xclip") {
            xclipFailed = true;
            // Fallback to wl-paste for Wayland
            tryCmd("sh", ["-c", `wl-paste --type image/png > "${tmpPng}"`]);
          } else {
            wlPasteFailed = true;
            cleanup();
            const errMsg = (stderr || err.message || "").toLowerCase();
            const isMissingTool =
              err.code === 127 ||
              errMsg.includes("not found") ||
              (xclipFailed && wlPasteFailed);
            if (isMissingTool) {
              notifyError(
                webview,
                "linux-missing-tools",
                "Install xclip or wl-clipboard to paste images",
              );
            } else {
              notifyError(
                webview,
                "linux-clipboard-failed",
                `Failed to read clipboard image: ${err.message}`,
              );
            }
          }
        });
      };
      tryCmd("sh", ["-c", `xclip -selection clipboard -t image/png -o > "${tmpPng}"`]);
    }
  } catch (err) {
    notifyError(
      webview,
      "clipboard-native-unavailable",
      `Failed to read clipboard image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
