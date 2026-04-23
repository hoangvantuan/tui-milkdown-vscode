import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import type { Root } from "mdast";
import { extractVscodeResourcePath } from "./vscode-resource";

export type PageSize = "A4" | "Letter";

/**
 * Export an MDAST tree to a DOCX file.
 *
 * Stage 3: MDAST is parsed once in the extension host (markdown-ast.ts)
 * and shared between DOCX and PDF exporters, so mermaid substitution
 * happens on the tree instead of by regex on markdown text.
 *
 * Bundled as a separate file (out/export-docx.js) and lazy-loaded on demand.
 */
export async function exportToDocx(
  mdast: Root,
  documentUri: vscode.Uri,
  fontFamily?: string,
  pageSize?: PageSize,
): Promise<void> {
  const docName = path.basename(documentUri.fsPath, path.extname(documentUri.fsPath));
  const defaultUri = vscode.Uri.joinPath(
    vscode.Uri.joinPath(documentUri, ".."),
    `${docName}.docx`,
  );

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Word Document": ["docx"] },
    title: "Export as DOCX",
  });

  if (!saveUri) return;

  const baseDir = path.dirname(documentUri.fsPath);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting DOCX…",
        cancellable: false,
      },
      async () => {
        const [
          { toDocx },
          { htmlPlugin },
          { imagePlugin },
          { tablePlugin },
          { listPlugin },
          { imageSize },
        ] = await Promise.all([
          import("mdast2docx"),
          import("@m2d/html"),
          import("@m2d/image"),
          import("@m2d/table"),
          import("@m2d/list"),
          import("image-size"),
        ]);

        const imageResolver = createNodeImageResolver(baseDir, imageSize, pageSize);

        const docxProps = buildDocxProps(docName, fontFamily);
        const sectionProps = buildSectionProps(pageSize, [
          blockquotePlugin(),
          tableSpacingPlugin(),
          htmlPlugin(),
          imagePlugin({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            imageResolver: imageResolver as any,
            cacheConfig: { cacheMode: "memory" },
          }),
          tablePlugin(),
          listPlugin(),
        ]);

        const result = await toDocx(mdast, docxProps, sectionProps, "uint8array");

        const buffer = Buffer.from(result as Uint8Array);
        await vscode.workspace.fs.writeFile(saveUri, buffer);
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
    const message =
      err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
    console.error("[Export DOCX]", err);
  }
}

// Page size constants. DXA (twips): 1440 DXA = 1 inch.
const PAGE_SIZES = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
} as const;

const DEFAULT_MARGIN_DXA = 1134; // 20mm

function contentWidthPx(pageSize?: PageSize): number {
  const size = pageSize === "Letter" ? PAGE_SIZES.Letter : PAGE_SIZES.A4;
  const contentDxa = size.width - DEFAULT_MARGIN_DXA * 2;
  return Math.round((contentDxa / 1440) * 96);
}

function contentHeightPx(pageSize?: PageSize): number {
  const size = pageSize === "Letter" ? PAGE_SIZES.Letter : PAGE_SIZES.A4;
  const contentDxa = size.height - DEFAULT_MARGIN_DXA * 2;
  return Math.round((contentDxa / 1440) * 96);
}

/**
 * Document styles.
 *
 * Heading scale mirrors the PDF export (GitHub-like): H1=2x body, H2=1.5x,
 * H3=1.25x, H4=1.1x, H5=1x, H6=0.9x. Body is 12pt, so H1 lands at 24pt.
 * This keeps DOCX and PDF visually aligned for the same document.
 *
 * Units:
 *   - `size`: half-points (24 = 12pt).
 *   - `spacing.before/after`: twips (240 = 12pt; 1440 = 1 inch).
 *   - `spacing.line`: twips; 240 = single (1.0x), 360 = 1.5x.
 *
 * Heading IDs MUST be `Heading1..Heading6`. mdast2docx maps markdown depth N
 * directly to `Heading${N}` only when section props set `useTitle: false`
 * (see buildSectionProps). Without that, H1 falls through to built-in "Title"
 * and every level is shifted by 1.
 */
function buildDocxProps(
  title: string,
  fontFamily?: string,
): Record<string, unknown> {
  const font = fontFamily || "Arial";
  const monoFont = "Consolas";

  const headingStyles = [
    { id: "Heading1", name: "Heading 1", size: 48, spacing: { before: 480, after: 240 }, outlineLevel: 0 }, // 24pt
    { id: "Heading2", name: "Heading 2", size: 36, spacing: { before: 360, after: 180 }, outlineLevel: 1 }, // 18pt
    { id: "Heading3", name: "Heading 3", size: 30, spacing: { before: 300, after: 150 }, outlineLevel: 2 }, // 15pt
    { id: "Heading4", name: "Heading 4", size: 26, spacing: { before: 240, after: 120 }, outlineLevel: 3 }, // 13pt
    { id: "Heading5", name: "Heading 5", size: 24, spacing: { before: 240, after: 120 }, outlineLevel: 4 }, // 12pt
    { id: "Heading6", name: "Heading 6", size: 22, spacing: { before: 240, after: 120 }, outlineLevel: 5 }, // 11pt
  ];

  return {
    title,
    styles: {
      default: {
        document: {
          run: { font, size: 24 }, // 12pt body
          paragraph: {
            // mdast2docx's built-in default is `alignment: "thaiDistribute"`,
            // which Word renders as odd wide spacing for Latin/Vietnamese.
            // Force left alignment and a normal Western gap between paragraphs.
            alignment: "left",
            spacing: { before: 0, after: 120, line: 360 }, // 6pt after, 1.5x line
          },
        },
      },
      paragraphStyles: [
        ...headingStyles.map((h) => ({
          id: h.id,
          name: h.name,
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: h.size, bold: true, font },
          paragraph: {
            spacing: h.spacing,
            outlineLevel: h.outlineLevel,
            // Keep heading on the same page as the next paragraph so a
            // heading is never left dangling at the bottom of a page.
            keepNext: true,
          },
        })),
        // mdast2docx emits code blocks with `style: "blockCode"`. Define it
        // so fenced code blocks share a consistent mono font + smaller size.
        {
          id: "blockCode",
          name: "Code Block",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: false,
          run: { font: monoFont, size: 20 }, // 10pt
          paragraph: {
            spacing: { before: 120, after: 120, line: 300 }, // 1.25x line for code
            alignment: "left",
          },
        },
      ],
      characterStyles: [
        // mdast2docx emits `inlineCode` with `style: "code"` (lowercase,
        // hardcoded in @m2d/core). Match that id so the shading/color apply.
        {
          id: "code",
          name: "Inline Code",
          basedOn: "DefaultParagraphFont",
          run: {
            font: monoFont,
            size: 20, // 10pt (slightly smaller than body)
            color: "C7254E",
            shading: { type: "clear", fill: "F9F2F4" },
          },
        },
      ],
    },
  };
}

/**
 * Custom blockquote handler. mdast2docx's built-in renderer applies
 * `indent: { left: 720, hanging: 360 }` which indents wrapped lines MORE
 * than the first line (bibliography-style), and omits `spacing.before`,
 * so blockquotes sit flush against the preceding paragraph/list.
 *
 * We override both: no hanging indent (all lines align), and a 12pt top
 * gap so the quote breathes away from neighbouring blocks. Setting
 * `node.type = ""` disables the default case in @m2d/core.
 */
function blockquotePlugin(): Record<string, unknown> {
  return {
    block: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      docx: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paraProps: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockChildrenProcessor: any,
    ) => {
      if (node.type !== "blockquote") return [];

      const quoteProps = {
        ...paraProps,
        indent: { left: 720 }, // 0.5 inch left, uniform across all lines
        border: {
          ...(paraProps.border || {}),
          left: {
            style: docx.BorderStyle.SINGLE,
            size: 12,
            space: 14,
            color: "CCCCCC",
          },
        },
        spacing: {
          ...(paraProps.spacing || {}),
          before: 240, // 12pt gap above the quote
          after: 240,  // 12pt gap below
        },
      };

      const paragraphs = blockChildrenProcessor(node, quoteProps);
      node.type = ""; // Prevent @m2d/core's default blockquote branch
      return paragraphs;
    },
  };
}

/**
 * Add breathing room after tables. DOCX Table elements have no inherent
 * "spacing after" property — the gap depends entirely on the paragraph that
 * follows. When the next paragraph uses the document default
 * (spacing.before = 0) it sits flush against the table bottom, making the
 * document feel cramped.
 *
 * This plugin runs in `postprocess` (after all nodes are converted) and
 * inserts a zero-height spacer Paragraph with `spacing.before = 240`
 * (12pt) after every Table element, giving tables the same visual
 * breathing room that headings and blockquotes enjoy.
 */
function tableSpacingPlugin(): Record<string, unknown> {
  return {
    postprocess: async (sections: { children: unknown[] }[]) => {
      // Dynamic import so docx classes resolve at call-time (lazy-loaded).
      const { Paragraph, Table } = await import("docx");

      for (const section of sections) {
        const original = section.children;
        const patched: unknown[] = [];

        for (let i = 0; i < original.length; i++) {
          patched.push(original[i]);

          if (original[i] instanceof Table) {
            // Insert a spacer paragraph right after the table.
            patched.push(
              new Paragraph({
                spacing: { before: 240 }, // 12pt gap
                children: [],
              }),
            );
          }
        }

        section.children = patched;
      }
    },
  };
}

/**
 * Section props. This is the argument 3 of toDocx, NOT docxProps. Page size
 * and margins belong here because `IDocxProps = Omit<..., "sections" | ...>`.
 *
 * `useTitle: false` so markdown depth N maps directly to `Heading${N}`,
 * aligning with the paragraphStyles in buildDocxProps.
 */
function buildSectionProps(
  pageSize: PageSize | undefined,
  plugins: unknown[],
): Record<string, unknown> {
  const size = pageSize === "Letter" ? PAGE_SIZES.Letter : PAGE_SIZES.A4;
  return {
    useTitle: false,
    plugins,
    properties: {
      page: {
        size: { width: size.width, height: size.height },
        margin: {
          top: DEFAULT_MARGIN_DXA,
          right: DEFAULT_MARGIN_DXA,
          bottom: DEFAULT_MARGIN_DXA,
          left: DEFAULT_MARGIN_DXA,
        },
      },
    },
  };
}

type ImageResolver = (
  src: string,
  options: unknown,
) => Promise<{
  data: string | Buffer;
  type: string;
  transformation: { width: number; height: number };
}>;

const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const REMOTE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
// 1x1 transparent PNG — used when an image cannot be resolved so one broken
// reference does not kill the whole export.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

function placeholderImage(): {
  data: string;
  type: string;
  transformation: { width: number; height: number };
} {
  return {
    data: `data:image/png;base64,${PLACEHOLDER_PNG_BASE64}`,
    type: "png",
    transformation: { width: 1, height: 1 },
  };
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function createNodeImageResolver(
  baseDir: string,
  imageSize: (input: Uint8Array) => { width?: number; height?: number },
  pageSize?: PageSize,
): ImageResolver {
  const maxWidth = contentWidthPx(pageSize);
  const maxHeight = contentHeightPx(pageSize);
  return async (src) => {
    try {
      let buffer: Buffer;
      let type: string;
      let dataForDocx: string | Buffer;

      // VS Code webview resource URLs — extract local path and read from disk
      const vscodeLocalPath = extractVscodeResourcePath(src);

      if (src.startsWith("data:")) {
        const match = /^data:image\/([\w+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(src);
        if (!match) throw new Error(`Invalid data URL: ${src.slice(0, 40)}…`);
        type = normalizeImageType(match[1]);
        buffer = Buffer.from(match[2], "base64");
        dataForDocx = src;
      } else if (vscodeLocalPath) {
        buffer = await fs.readFile(vscodeLocalPath);
        type = normalizeImageType(path.extname(vscodeLocalPath).slice(1) || "png");
        dataForDocx = buffer;
      } else if (/^https?:\/\//i.test(src)) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(src, { signal: controller.signal });
          if (!res.ok) throw new Error(`Fetch ${res.status} for ${src}`);
          const declaredSize = Number(res.headers.get("content-length") ?? "0");
          if (Number.isFinite(declaredSize) && declaredSize > REMOTE_MAX_BYTES) {
            throw new Error(`Remote image > ${REMOTE_MAX_BYTES} bytes: ${src}`);
          }
          const arr = await res.arrayBuffer();
          if (arr.byteLength > REMOTE_MAX_BYTES) {
            throw new Error(`Remote image > ${REMOTE_MAX_BYTES} bytes: ${src}`);
          }
          buffer = Buffer.from(arr);
          const contentType = res.headers.get("content-type") ?? "";
          const ext = contentType.split("/")[1]?.split(";")[0] ?? "png";
          type = normalizeImageType(ext);
          dataForDocx = buffer;
        } finally {
          clearTimeout(timer);
        }
      } else {
        const cleaned = src.replace(/^file:\/\//, "");
        const resolved = path.isAbsolute(cleaned)
          ? cleaned
          : path.resolve(baseDir, safeDecodeURIComponent(cleaned));
        buffer = await fs.readFile(resolved);
        type = normalizeImageType(path.extname(resolved).slice(1) || "png");
        dataForDocx = buffer;
      }

      if (type === "svg") {
        console.warn(`[Export DOCX] SVG image not supported, using placeholder: ${src.slice(0, 60)}`);
        return placeholderImage();
      }

      let width = 600;
      let height = 400;
      try {
        const probed = imageSize(buffer);
        if (probed.width && probed.height) {
          width = probed.width;
          height = probed.height;
        } else {
          console.warn(`[Export DOCX] Cannot read dimensions, using 600x400 for: ${src.slice(0, 60)}`);
        }
      } catch (err) {
        console.warn(`[Export DOCX] imageSize failed for "${src.slice(0, 60)}":`, err);
      }

      return {
        data: dataForDocx,
        type,
        transformation: clampImageSize(width, height, maxWidth, maxHeight),
      };
    } catch (err) {
      console.warn(`[Export DOCX] Skip image "${src.slice(0, 60)}":`, err);
      return placeholderImage();
    }
  };
}

function normalizeImageType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "jpeg") return "jpg";
  if (lower === "svg+xml") return "svg";
  return lower;
}

/**
 * Scale image to fit within maxWidth AND maxHeight.
 * Uses the smaller scale factor to ensure the image fits both dimensions.
 * Images smaller than both limits are kept at original size.
 */
function clampImageSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) return { width, height };

  const scaleW = width > maxWidth ? maxWidth / width : 1;
  const scaleH = height > maxHeight ? maxHeight / height : 1;
  const scale = Math.min(scaleW, scaleH);

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
