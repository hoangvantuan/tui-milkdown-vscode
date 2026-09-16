/**
 * System font family enumeration for the font picker.
 *
 * The cache is module-level, which is the same lifetime the provider's former
 * `static cachedFonts` had: one enumeration per extension host process, shared
 * by every open editor. The shell-out is slow (a JXA/PowerShell/fc-list call),
 * so `ready` fires it without awaiting.
 */
import { exec } from "child_process";

let cachedFonts: string[] | null = null;

/** Enumerate system font families (cached after first call) */
export async function getSystemFonts(): Promise<string[]> {
  if (cachedFonts) {
    return cachedFonts;
  }

  const fonts = await new Promise<string[]>((resolve) => {
    const platform = process.platform;
    let cmd: string;

    if (platform === "darwin") {
      // macOS: use NSFontManager via JXA (fast, reliable, no dependencies)
      cmd = `osascript -l JavaScript -e 'ObjC.import("AppKit"); var fm = $.NSFontManager.sharedFontManager; var f = fm.availableFontFamilies; var r = []; for (var i = 0; i < f.count; i++) r.push(f.objectAtIndex(i).js); JSON.stringify(r);'`;
    } else if (platform === "win32") {
      cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"`;
    } else {
      cmd = `fc-list : family`;
    }

    exec(cmd, { timeout: 15000 }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }

      let result: string[];
      if (platform === "darwin") {
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          result = [];
        }
      } else {
        // fc-list may return comma-separated families per line
        result = stdout
          .split(/[\n,]/)
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
      }

      resolve([...new Set(result)].sort((a, b) => a.localeCompare(b)));
    });
  });

  cachedFonts = fonts;
  return fonts;
}
