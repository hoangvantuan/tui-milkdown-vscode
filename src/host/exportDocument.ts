/**
 * `export`: turn the document into DOCX or PDF.
 *
 * Everything up to the async IIFE runs SYNCHRONOUSLY on purpose, and the order
 * is preserved from the switch this came out of: the busy check, then the
 * document read, then `setExportInProgress(true)`. Reading `document.getText()`
 * later, from inside the IIFE, would export whatever the user had typed by then
 * rather than what they asked to export, and taking the lock later would let two
 * export requests both pass the busy check.
 *
 * The lock is what stops two save dialogs and two Chromium instances racing to
 * the same output path; a second request while one is running is answered with
 * `reason: "busy"`, not queued.
 *
 * The renderers are loaded with a computed `require` against `__dirname` rather
 * than a static import so that the mdast pipeline, puppeteer-core and docx stay
 * out of the extension bundle's startup cost until someone exports.
 */
import * as vscode from "vscode";
import type { ExportMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";
import { parseContent } from "../utils/frontmatter-parser";

export function handleExport(
  msg: ExportMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  withExportLock: (action: () => Promise<void>) => boolean,
): void {
  const exportMsg = msg;
  const mermaidImages = exportMsg.mermaidImages || [];
  const exportFormat = exportMsg.format || "docx";
  const fontFamily = exportMsg.fontFamily || "";
  const configuredPageSize = vscode.workspace
    .getConfiguration("tuiMarkdown")
    .get<string>("exportPageSize", "A4");
  const pageSize: "A4" | "Letter" =
    configuredPageSize === "Letter" ? "Letter" : "A4";

  const acquired = withExportLock(async () => {
    const rawText = document.getText();
    const stripped = rawText.replace(/^﻿/, "");
    const parsedFm = parseContent(stripped);
    const normalized = parsedFm.body;

    try {
      const markdownAstPath = require("path").join(__dirname, "markdown-ast.js");
      const {
        parseMarkdownToMdast,
        replaceMermaidBlocks,
        hashMermaidCode,
        countMermaidBlocks,
        stripWikiLinks,
      } = require(markdownAstPath);

      const mdast = await parseMarkdownToMdast(normalized);

      // Drop the frontmatter node so it is not rendered as content.
      if (
        mdast?.children?.[0] &&
        (mdast.children[0].type === "yaml" || mdast.children[0].type === "toml")
      ) {
        mdast.children.shift();
      }

      if (!mdast?.children || mdast.children.length === 0) {
        vscode.window.showWarningMessage(
          "Document is empty, nothing to export.",
        );
        return;
      }

      const imageMap = new Map<string, string>(
        mermaidImages.map(({ code, base64 }: { code: string; base64: string }) => [
          hashMermaidCode(code),
          base64,
        ]),
      );
      const totalMermaid = countMermaidBlocks(mdast);
      const replaced = await replaceMermaidBlocks(mdast, imageMap);
      if (replaced < totalMermaid) {
        vscode.window.showWarningMessage(
          `${totalMermaid - replaced} of ${totalMermaid} Mermaid diagram(s) could not be embedded (still rendering or parse error). They will appear as code in the export.`,
        );
      }

      stripWikiLinks(mdast);

      if (exportFormat === "pdf") {
        const exportPdfPath = require("path").join(__dirname, "export-pdf.js");
        const { exportToPdf: doExport } = require(exportPdfPath);
        await doExport(mdast, document.uri, fontFamily, pageSize);
      } else {
        const exportDocxPath = require("path").join(__dirname, "export-docx.js");
        const { exportToDocx: doExport } = require(exportDocxPath);
        await doExport(mdast, document.uri, fontFamily, pageSize);
      }

      // Notify webview on success so the button can re-enable without
      // relying on the 3-second timeout.
      try {
        webview.postMessage({ type: "exportDone", success: true });
      } catch {
        /* webview may have been disposed */
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Export failed: ${errMsg}`);
      console.error("[Export]", err);
      try {
        webview.postMessage({
          type: "exportDone",
          success: false,
          reason: errMsg,
        });
      } catch {
        /* webview may have been disposed */
      }
    }
  });

  if (!acquired) {
    webview.postMessage({
      type: "exportDone",
      success: false,
      reason: "busy",
    });
    vscode.window.showWarningMessage(
      "Export in progress, please wait for the current export to finish.",
    );
    return;
  }
}
