import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import type { Root } from "mdast";
import { findChromiumExecutable, clearChromiumCache } from "./chromium-discovery";

export { clearChromiumCache };

/**
 * Export an MDAST tree to a PDF file via puppeteer-core.
 *
 * Stage 4: replaces the hand-written pdfmake pipeline. MDAST is rendered
 * to HTML with unified, wrapped in a themed document, then Chromium
 * prints it to PDF. The extension ships no Chromium binary — we locate
 * one installed on the user's machine (see `chromium-discovery.ts`).
 *
 * Bundled as `out/export-pdf.js` (lazy-loaded on demand).
 */

export async function exportToPdf(
  mdast: Root,
  documentUri: vscode.Uri,
  fontFamily?: string,
): Promise<void> {
  const docName = path.basename(documentUri.fsPath, path.extname(documentUri.fsPath));
  const defaultUri = vscode.Uri.joinPath(
    vscode.Uri.joinPath(documentUri, ".."),
    `${docName}.pdf`,
  );

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "PDF Document": ["pdf"] },
    title: "Export as PDF",
  });

  if (!saveUri) return;

  const chromiumPath = await findChromiumExecutable();
  if (!chromiumPath) {
    const action = await vscode.window.showErrorMessage(
      "Chrome, Edge or Chromium must be installed to export PDF. Install one or configure \"tuiMarkdown.chromiumPath\" and try again.",
      "Open Settings",
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "tuiMarkdown.chromiumPath",
      );
    }
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting PDF…",
        cancellable: false,
      },
      async () => {
        const baseDir = path.dirname(documentUri.fsPath);
        const bodyHtml = await mdastToHtml(mdast, baseDir);
        const sanitizedBody = stripDangerousHtmlTags(bodyHtml);
        const fullHtml = buildHtmlDocument(sanitizedBody, docName, fontFamily);

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const puppeteer = require("puppeteer-core");
        let browser;
        try {
          browser = await puppeteer.launch({
            executablePath: chromiumPath,
            headless: true,
            args: puppeteerLaunchArgs(),
          });
        } catch (launchErr) {
          const original = launchErr instanceof Error ? launchErr.message : String(launchErr);
          throw new Error(
            `Failed to launch Chromium at "${chromiumPath}": ${original}. Check execute permission or configure tuiMarkdown.chromiumPath.`,
          );
        }

        try {
          const page = await browser.newPage();
          await page.setJavaScriptEnabled(false);
          await page.setContent(fullHtml, {
            waitUntil: "networkidle0",
            timeout: 30_000,
          });
          const pdfBuffer: Uint8Array = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: false,
            margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
          });
          await vscode.workspace.fs.writeFile(saveUri, pdfBuffer);
        } finally {
          await browser.close().catch(() => {
            /* ignore close errors */
          });
        }
      },
    );

    const openAction = await vscode.window.showInformationMessage(
      `Exported: ${path.basename(saveUri.fsPath)}`,
      "Open File",
      "Open Folder",
    );

    if (openAction === "Open File") {
      vscode.env.openExternal(saveUri);
    } else if (openAction === "Open Folder") {
      await vscode.commands.executeCommand("revealFileInOS", saveUri);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Export PDF failed: ${message}`);
    console.error("[Export PDF]", err);
  }
}

/** Only disable Chromium sandbox when we genuinely need to (Linux as root). */
function puppeteerLaunchArgs(): string[] {
  const args: string[] = [];
  const isLinux = process.platform === "linux";
  const getuid = (process as unknown as { getuid?: () => number }).getuid;
  const isRoot = typeof getuid === "function" && getuid() === 0;
  if (isLinux && isRoot) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

/**
 * Remove the HTML tags that could leak local resources or trigger navigation
 * even with JavaScript disabled in Chromium (iframes/links still fetch URLs,
 * meta refresh still navigates, object/embed can load plugins).
 *
 * This is a narrow allow-by-default strip — not a full sanitizer. Safe enough
 * paired with `page.setJavaScriptEnabled(false)` for PDF printing.
 */
function stripDangerousHtmlTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<iframe\b[^>]*\/?\s*>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "")
    .replace(/<embed\b[^>]*\/?\s*>/gi, "")
    .replace(/<link\b[^>]*\/?\s*>/gi, "")
    .replace(/<base\b[^>]*\/?\s*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=[^>]*>/gi, "")
    // Strip inline event handlers (onclick, onerror, onload, …)
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Neutralise javascript: and data: URLs in href/src attributes
    .replace(/(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1=""')
    .replace(/(href|src)\s*=\s*(?:"\s*data:text\/html[^"]*"|'\s*data:text\/html[^']*')/gi, '$1=""');
}

async function mdastToHtml(mdast: Root, baseDir: string): Promise<string> {
  const [
    { unified },
    { default: remarkRehype },
    { default: rehypeHighlight },
    { default: rehypeStringify },
  ] = await Promise.all([
    import("unified"),
    import("remark-rehype"),
    import("rehype-highlight"),
    import("rehype-stringify"),
  ]);

  const hast = await unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .run(mdast);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await inlineRelativeImages(hast as any, baseDir);

  const file = unified()
    .use(rehypeStringify, { allowDangerousHtml: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .stringify(hast as any);

  return String(file);
}

/**
 * Chromium loaded via `page.setContent` sits at `about:blank`, so relative
 * image src attributes (e.g. `./images/foo.png`) cannot be fetched. Inline
 * them as `data:` URLs from disk before the HTML reaches the browser.
 */
async function inlineRelativeImages(
  hast: { type: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] },
  baseDir: string,
): Promise<void> {
  const imgs: { properties: Record<string, unknown> }[] = [];
  collectImgNodes(hast, imgs);

  await Promise.all(
    imgs.map(async (node) => {
      const src = typeof node.properties.src === "string" ? node.properties.src : "";
      if (!src) return;
      if (/^(?:data:|https?:)/i.test(src)) return;

      try {
        const cleaned = src.replace(/^file:\/\//, "");
        const resolved = path.isAbsolute(cleaned)
          ? cleaned
          : path.resolve(baseDir, safeDecode(cleaned));
        const buf = await fs.readFile(resolved);
        const ext = (path.extname(resolved).slice(1) || "png").toLowerCase();
        const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        node.properties.src = `data:${mime};base64,${buf.toString("base64")}`;
      } catch (err) {
        console.warn(`[Export PDF] Failed to read image "${src}":`, err);
      }
    }),
  );
}

function collectImgNodes(
  node: { type: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] },
  out: { properties: Record<string, unknown> }[],
): void {
  if (node.type === "element" && node.tagName === "img" && node.properties) {
    out.push({ properties: node.properties });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectImgNodes(
        child as { type: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] },
        out,
      );
    }
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function buildHtmlDocument(
  bodyHtml: string,
  title: string,
  fontFamily?: string,
): string {
  const safeTitle = escapeHtml(title);
  const userFont = cssFontFamilyToken(fontFamily);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
${baseCss(userFont)}
${codeHighlightCss()}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>`;
}

/**
 * Produce a CSS-safe `font-family` prefix (ending with ", " for concatenation)
 * or an empty string. `escapeHtml` is wrong inside a `<style>` element because
 * CSS does not decode HTML entities; also any character outside a small
 * whitelist is stripped to keep the declaration valid.
 */
function cssFontFamilyToken(fontFamily: string | undefined): string {
  if (!fontFamily) return "";
  const sanitized = fontFamily.trim().replace(/[^A-Za-z0-9 _\-]/g, "");
  if (!sanitized) return "";
  return `"${sanitized}", `;
}

function baseCss(userFont: string): string {
  return `
:root {
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #1f2328;
  font-family: ${userFont}-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.625;
  -webkit-font-smoothing: antialiased;
}
.markdown-body {
  max-width: 100%;
  padding: 0;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.25;
  margin: 1.6em 0 0.5em;
  page-break-after: avoid;
  text-wrap: balance;
}
h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.9em; }
h6 { font-size: 0.85em; color: #57606a; }
p { margin: 0 0 0.8em; text-wrap: pretty; }
a { color: #0969da; text-decoration: underline; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.6em; }
li { margin: 0.1em 0; }
li > p { margin: 0.2em 0; }
blockquote {
  margin: 0 0 0.8em;
  padding: 0.2em 1em;
  color: #57606a;
  border-left: 0.25em solid #d0d7de;
  background: #f6f8fa;
}
hr {
  border: 0;
  border-top: 2px dashed #d0d7de;
  margin: 1.5em 0;
}
code {
  font-family: "Cascadia Code", "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: rgba(175, 184, 193, 0.2);
  border-radius: 4px;
  padding: 0.15em 0.4em;
}
pre {
  font-family: "Cascadia Code", "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  line-height: 1.5;
  background: #f6f8fa;
  border-radius: 6px;
  padding: 12px 14px;
  overflow: auto;
  page-break-inside: avoid;
}
pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 0.8em;
  page-break-inside: avoid;
}
th, td {
  border: 1px solid #d0d7de;
  padding: 6px 12px;
  text-align: left;
  vertical-align: top;
}
th { background: #f6f8fa; font-weight: 600; }
tr:nth-child(2n) td { background: #f6f8fa; }
img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  page-break-inside: avoid;
}
input[type="checkbox"] {
  margin-right: 0.3em;
  vertical-align: middle;
}
ul.contains-task-list, ol.contains-task-list { list-style: none; padding-left: 0.4em; }
li.task-list-item { list-style: none; }
`;
}

/** GitHub-like highlight.js palette, tuned for print. */
function codeHighlightCss(): string {
  return `
.hljs { color: #1f2328; background: transparent; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #d73a49; }
.hljs-string, .hljs-template-string, .hljs-attr { color: #032f62; }
.hljs-number, .hljs-variable, .hljs-template-variable { color: #005cc5; }
.hljs-title, .hljs-name, .hljs-section, .hljs-function, .hljs-class .hljs-title { color: #6f42c1; }
.hljs-tag { color: #22863a; }
.hljs-symbol, .hljs-bullet, .hljs-meta { color: #e36209; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
.hljs-link { text-decoration: underline; }
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
