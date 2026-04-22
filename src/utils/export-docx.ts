import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import type { Root } from "mdast";

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

        const imageResolver = createNodeImageResolver(baseDir, imageSize);

        const docxProps: Record<string, unknown> = { title: docName };
        if (fontFamily) {
          docxProps.styles = {
            default: {
              document: {
                run: { font: fontFamily },
              },
            },
          };
        }

        const result = await toDocx(
          mdast,
          docxProps,
          {
            plugins: [
              htmlPlugin(),
              imagePlugin({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                imageResolver: imageResolver as any,
                cacheConfig: { cacheMode: "memory" },
              }),
              tablePlugin(),
              listPlugin(),
            ],
          },
          "uint8array",
        );

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
      const folder = vscode.Uri.joinPath(saveUri, "..");
      vscode.env.openExternal(folder);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
    console.error("[Export DOCX]", err);
  }
}

type ImageResolver = (
  src: string,
  options: unknown,
) => Promise<{
  data: string | Buffer;
  type: string;
  transformation: { width: number; height: number };
}>;

function createNodeImageResolver(
  baseDir: string,
  imageSize: (input: Uint8Array) => { width?: number; height?: number },
): ImageResolver {
  return async (src) => {
    let buffer: Buffer;
    let type: string;
    let dataForDocx: string | Buffer;

    if (src.startsWith("data:")) {
      const match = /^data:image\/([\w+-]+);base64,(.+)$/.exec(src);
      if (!match) throw new Error(`Invalid data URL: ${src.slice(0, 40)}…`);
      type = normalizeImageType(match[1]);
      buffer = Buffer.from(match[2], "base64");
      dataForDocx = src;
    } else if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Fetch ${res.status} for ${src}`);
      buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "";
      const ext = contentType.split("/")[1]?.split(";")[0] ?? "png";
      type = normalizeImageType(ext);
      dataForDocx = buffer;
    } else {
      const cleaned = src.replace(/^file:\/\//, "");
      const resolved = path.isAbsolute(cleaned)
        ? cleaned
        : path.resolve(baseDir, decodeURIComponent(cleaned));
      buffer = await fs.readFile(resolved);
      type = normalizeImageType(path.extname(resolved).slice(1) || "png");
      dataForDocx = buffer;
    }

    if (type === "svg") {
      throw new Error(`SVG images are not supported in DOCX export: ${src.slice(0, 60)}`);
    }

    let width = 600;
    let height = 400;
    try {
      const probed = imageSize(buffer);
      if (probed.width && probed.height) {
        width = probed.width;
        height = probed.height;
      }
    } catch {
      // keep defaults
    }

    return {
      data: dataForDocx,
      type,
      transformation: { width, height },
    };
  };
}

function normalizeImageType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "jpeg") return "jpg";
  if (lower === "svg+xml") return "svg";
  return lower;
}
