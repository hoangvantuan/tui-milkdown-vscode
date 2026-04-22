import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Export markdown content to PDF file.
 * Uses pdfmake (PdfPrinter) with Roboto fonts.
 *
 * Bundled separately as out/export-pdf.js (lazy-loaded on demand).
 */

// ── System font detection ──

/** Font variant paths for pdfmake */
interface FontVariants {
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
}

/**
 * Search for a font family in system font directories (macOS / Linux).
 * Returns font variant paths if found, null otherwise.
 */
function findSystemFont(fontFamily: string): FontVariants | null {
  const home = require("os").homedir();
  const fontDirs = [
    // macOS
    "/System/Library/Fonts",
    "/Library/Fonts",
    path.join(home, "Library", "Fonts"),
    // Linux
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path.join(home, ".local", "share", "fonts"),
    path.join(home, ".fonts"),
  ];

  // Normalize font name for filename matching: "JetBrains Mono" → "JetBrainsMono"
  const nameNoSpaces = fontFamily.replace(/\s+/g, "");
  const nameDashed = fontFamily.replace(/\s+/g, "-");

  // Common variant suffixes
  const variantPatterns: Record<keyof FontVariants, string[]> = {
    normal: ["-Regular", "-Normal", "-Book", ""],
    bold: ["-Bold", "-SemiBold", "-Medium"],
    italics: ["-Italic", "-RegularItalic", "-It"],
    bolditalics: ["-BoldItalic", "-BoldIt", "-SemiBoldItalic"],
  };

  const extensions = [".ttf", ".otf"];

  function findVariant(dirs: string[], basenames: string[], suffixes: string[]): string | null {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const base of basenames) {
        for (const suffix of suffixes) {
          for (const ext of extensions) {
            const filePath = path.join(dir, `${base}${suffix}${ext}`);
            if (fs.existsSync(filePath)) return filePath;
          }
        }
      }
      // Also try scanning directory for partial matches
      try {
        const files = fs.readdirSync(dir);
        const lowerFamily = fontFamily.toLowerCase().replace(/\s+/g, "");
        for (const suffix of suffixes) {
          const lowerSuffix = suffix.toLowerCase();
          const match = files.find((f) => {
            const lf = f.toLowerCase().replace(/\s+/g, "");
            return lf.includes(lowerFamily) && lf.includes(lowerSuffix) && extensions.some((e) => lf.endsWith(e));
          });
          if (match) return path.join(dir, match);
        }
      } catch { /* dir not readable */ }
    }
    return null;
  }

  const basenames = [nameNoSpaces, nameDashed, fontFamily];

  // 1. Try to find variable font first (single file for all weights)
  // Patterns: "Inter-VariableFont_opsz,wght.ttf", "JetBrainsMono[wght].ttf"
  for (const dir of fontDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      const lowerFamily = fontFamily.toLowerCase().replace(/\s+/g, "");
      // Find non-italic variable font
      const varFont = files.find((f) => {
        const lf = f.toLowerCase().replace(/\s+/g, "");
        return lf.includes(lowerFamily)
          && !lf.includes("italic")
          && (lf.includes("variablefont") || lf.includes("[wght]"))
          && extensions.some((e) => lf.endsWith(e));
      });
      if (varFont) {
        const varPath = path.join(dir, varFont);
        // Try to find italic variable font too
        const italicVarFont = files.find((f) => {
          const lf = f.toLowerCase().replace(/\s+/g, "");
          return lf.includes(lowerFamily)
            && lf.includes("italic")
            && (lf.includes("variablefont") || lf.includes("[wght]"))
            && extensions.some((e) => lf.endsWith(e));
        });
        const italicPath = italicVarFont ? path.join(dir, italicVarFont) : varPath;
        return { normal: varPath, bold: varPath, italics: italicPath, bolditalics: italicPath };
      }
    } catch { /* dir not readable */ }
  }

  // 2. Fall back to static font variants
  const normalPath = findVariant(fontDirs, basenames, variantPatterns.normal);
  if (!normalPath) return null;

  const boldPath = findVariant(fontDirs, basenames, variantPatterns.bold) || normalPath;
  const italicPath = findVariant(fontDirs, basenames, variantPatterns.italics) || normalPath;
  const boldItalicPath = findVariant(fontDirs, basenames, variantPatterns.bolditalics) || boldPath;

  return {
    normal: normalPath,
    bold: boldPath,
    italics: italicPath,
    bolditalics: boldItalicPath,
  };
}


interface PdfContent {
  text?: string | PdfContent[];
  style?: string;
  bold?: boolean;
  italics?: boolean;
  fontSize?: number;
  font?: string;
  margin?: number[];
  ul?: PdfContent[];
  ol?: PdfContent[];
  table?: { headerRows?: number; widths?: (string | number)[]; body: PdfContent[][] };
  layout?: string;
  image?: string;
  width?: number;
  color?: string;
  decoration?: string;
  fillColor?: string;
  alignment?: string;
  lineHeight?: number;
  preserveLeadingSpaces?: boolean;
  [key: string]: unknown;
}

/** Parse simple markdown to pdfmake document content array. */
function markdownToPdfContent(md: string): PdfContent[] {
  const lines = md.split("\n");
  const content: PdfContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = [22, 18, 16, 14, 13, 12];
      content.push({
        text: parseInline(headingMatch[2]),
        fontSize: sizes[level - 1],
        bold: true,
        margin: [0, level <= 2 ? 16 : 10, 0, 6],
        color: "#1a1a1a",
      });
      i++; continue;
    }

    // Image (standalone)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const src = imgMatch[2];
      if (src.startsWith("data:")) {
        content.push({ image: src, width: 450, margin: [0, 8, 0, 8], alignment: "center" });
      }
      i++; continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      content.push({
        text: codeLines.join("\n"),
        fontSize: 9,
        color: "#2d2d2d",
        fillColor: "#f5f5f5",
        margin: [0, 4, 0, 8],
        lineHeight: 1.4,
        preserveLeadingSpaces: true,
      });
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1]?.match(/^\|?\s*[-:]+/)) {
      const tableContent = parseTable(lines, i);
      if (tableContent) {
        content.push(tableContent.node);
        i = tableContent.endIndex;
        continue;
      }
    }

    // Unordered list
    if (line.match(/^\s*[-*+]\s/)) {
      const items: PdfContent[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*+]\s/)) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, "");
        // Task list
        if (text.startsWith("[ ] ") || text.startsWith("[x] ")) {
          const checked = text.startsWith("[x] ");
          const label = text.slice(4);
          items.push({
            text: [
              { text: checked ? "☑ " : "☐ ", bold: true },
              ...parseInline(label),
            ],
          });
        } else {
          items.push({ text: parseInline(text) });
        }
        i++;
      }
      content.push({ ul: items, margin: [0, 4, 0, 8] });
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s/)) {
      const items: PdfContent[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push({ text: parseInline(text) });
        i++;
      }
      content.push({ ol: items, margin: [0, 4, 0, 8] });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      content.push({
        text: parseInline(quoteLines.join(" ")),
        italics: true,
        color: "#555",
        margin: [20, 4, 0, 8],
      });
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      content.push({
        text: "",
        margin: [0, 8, 0, 8],
      });
      // Simple separator via canvas would be ideal but keep it simple
      i++; continue;
    }

    // Normal paragraph
    content.push({
      text: parseInline(line),
      margin: [0, 0, 0, 6],
      lineHeight: 1.5,
    });
    i++;
  }

  return content;
}

/** Parse inline markdown (bold, italic, code, links). */
function parseInline(text: string): PdfContent[] {
  const parts: PdfContent[] = [];
  // Pattern: **bold**, *italic*, `code`, [text](url), ~~strike~~
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|~~(.+?)~~)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[2]) { // **bold**
      parts.push({ text: match[2], bold: true });
    } else if (match[3]) { // *italic*
      parts.push({ text: match[3], italics: true });
    } else if (match[4]) { // `code`
      parts.push({ text: match[4], fontSize: 10, color: "#c7254e", fillColor: "#f9f2f4" });
    } else if (match[5] && match[6]) { // [text](url)
      parts.push({ text: match[5], color: "#2563eb", decoration: "underline" });
    } else if (match[7]) { // ~~strike~~
      parts.push({ text: match[7], decoration: "lineThrough" });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ text }];
}

/** Parse markdown table starting at line index. */
function parseTable(lines: string[], startIndex: number): { node: PdfContent; endIndex: number } | null {
  const parseRow = (line: string): string[] =>
    line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headerCells = parseRow(lines[startIndex]);
  if (headerCells.length === 0) return null;

  // Skip separator line
  let i = startIndex + 2;
  const bodyRows: string[][] = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    bodyRows.push(parseRow(lines[i]));
    i++;
  }

  const widths = headerCells.map(() => "*" as string | number);
  const headerRow: PdfContent[] = headerCells.map(c => ({ text: c, bold: true, fillColor: "#f0f0f0" }));
  const body: PdfContent[][] = [headerRow];
  for (const row of bodyRows) {
    body.push(row.map(c => ({ text: c })));
  }

  return {
    node: {
      table: { headerRows: 1, widths, body },
      layout: "lightHorizontalLines",
      margin: [0, 8, 0, 12],
    },
    endIndex: i,
  };
}

// ── Export function ──

export async function exportToPdf(
  markdown: string,
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

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting PDF…",
        cancellable: false,
      },
      async () => {
        const pm = require("pdfmake");

        // Bundled Roboto as fallback
        const bundledFontsDir = path.join(__dirname, "fonts");
        const robotoFonts = {
          Roboto: {
            normal: path.join(bundledFontsDir, "Roboto-Regular.ttf"),
            bold: path.join(bundledFontsDir, "Roboto-Medium.ttf"),
            italics: path.join(bundledFontsDir, "Roboto-Italic.ttf"),
            bolditalics: path.join(bundledFontsDir, "Roboto-MediumItalic.ttf"),
          },
        };

        // Try to find user's preferred font on the system
        let activeFontName = "Roboto";
        const systemFont = fontFamily ? findSystemFont(fontFamily) : null;

        if (systemFont) {
          activeFontName = fontFamily!;
          pm.setFonts({
            ...robotoFonts,
            [fontFamily!]: systemFont,
          });
        } else {
          pm.setFonts(robotoFonts);
        }

        const pdfContent = markdownToPdfContent(markdown);

        const docDefinition = {
          content: pdfContent,
          defaultStyle: {
            font: activeFontName,
            fontSize: 11,
            lineHeight: 1.4,
            color: "#333",
          },
          pageSize: "A4" as const,
          pageMargins: [50, 50, 50, 50] as [number, number, number, number],
          info: {
            title: docName,
            creator: "TUI Markdown Editor",
          },
        };

        const doc = pm.createPdf(docDefinition);

        // pdfmake 0.3.x doc.write() writes to a file path
        const tmpFile = path.join(
          require("os").tmpdir(),
          `tui-export-${Date.now()}.pdf`,
        );
        await doc.write(tmpFile);
        const pdfBuffer = fs.readFileSync(tmpFile);
        await vscode.workspace.fs.writeFile(saveUri, pdfBuffer);
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
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
      const folder = vscode.Uri.joinPath(saveUri, "..");
      vscode.env.openExternal(folder);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Export PDF failed: ${message}`);
    console.error("[Export PDF]", err);
  }
}
