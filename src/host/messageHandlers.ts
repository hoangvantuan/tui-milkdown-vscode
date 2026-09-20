/**
 * One handler per `WebviewToHostMessage` kind, in a table keyed by the union.
 *
 * The point of the table over the `switch` it replaces is `tsc`: the key type is
 * `WebviewToHostMessage["type"]`, so adding a message kind in
 * `src/shared/messages.ts` without adding a handler here is a compile error
 * rather than a message that silently does nothing at runtime. The mapped type
 * also narrows `msg` per key, so a handler cannot read a field its own message
 * does not have.
 *
 * Await semantics are preserved case by case, because they are not uniform and
 * the difference is observable:
 *
 * - `edit`, `viewSource`, the three `*Change` kinds, `saveImage`, `fileSearch`,
 *   `wikiLinkSearch` and `openWikiLink` are awaited, so the next message from
 *   the webview waits for them.
 * - `requestImageRename`, `export` and `readClipboardImage` return as soon as
 *   they have started their own async work. They reply to the webview from
 *   inside it, later.
 *
 * `dispatch` refuses anything that is not an own key of the table. The `switch`
 * fell through on an unknown `type`; a plain object lookup would instead find
 * `Object.prototype` members such as `constructor` or `toString` and try to call
 * them.
 */
import * as path from "path";
import * as vscode from "vscode";
import type { WebviewToHostMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";
import type { EditorSession } from "./session";
import { getSystemFonts } from "./systemFonts";
import { sendSavedPreferences } from "./savedPreferences";
import { handleSaveImage } from "./saveImage";
import { handleReadClipboardImage } from "./readClipboardImage";
import { handleRequestImageRename } from "./requestImageRename";
import { openWikiLink } from "./openWikiLink";
import { handleExport } from "./exportDocument";
import { openLocalFileInEditor } from "./openLocalFile";
import { buildExcludePattern, getDocFolder } from "./workspaceFiles";
import { findBacklinks } from "./backlinks";

/** What every handler is given: the session, and the provider-level things it cannot own. */
export interface HandlerContext {
  session: EditorSession;
  document: vscode.TextDocument;
  webview: TypedWebview;
  /** Extension-global memento: the remembered theme, font and zoom live here. */
  globalState: vscode.Memento;
  /** Extension workspace memento: per-document cursor and scroll positions live here. */
  /** The PROVIDER's map, passed whole with `session.docKey`, never as the inner map. */
  originalImagePaths: Map<string, Map<string, string>>;
  /** The provider's clipboard reporter — it de-duplicates the warning per reason. */
  notifyClipboardError: (
    webview: TypedWebview,
    reason: string,
    warningMessage?: string,
  ) => void;
}

type Handler<K extends WebviewToHostMessage["type"]> = (
  msg: Extract<WebviewToHostMessage, { type: K }>,
  ctx: HandlerContext,
) => void | Promise<void>;

type HandlerTable = {
  [K in WebviewToHostMessage["type"]]: Handler<K>;
};

const handlers: HandlerTable = {
  ready: (_msg, ctx) => {
    sendSavedPreferences(ctx.webview, ctx.globalState);
    ctx.session.sendTheme();
    ctx.session.sendConfig();
    ctx.session.updateWebview();
    // Send system fonts asynchronously (non-blocking)
    getSystemFonts().then((fonts) => {
      try {
        ctx.webview.postMessage({
          type: "systemFonts",
          fonts,
        });
      } catch { /* webview disposed */ }
    });
  },

  edit: async (msg, ctx) => {
    if (typeof msg.content === "string" && !ctx.document.isClosed) {
      ctx.session.inFlightEdit = ctx.session.applyEdit(msg.content);
      await ctx.session.inFlightEdit;
    }
  },

  viewSource: async (_msg, ctx) => {
    // Open with default text editor, then close this custom editor
    const uri = ctx.document.uri;
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      "default",
    );
  },

  themeChange: async (msg, ctx) => {
    const theme = msg.theme;
    if (typeof theme === "string") {
      await ctx.globalState.update(
        "markdownEditorTheme",
        theme,
      );
    }
  },

  fontChange: async (msg, ctx) => {
    const font = msg.font;
    if (typeof font === "string") {
      await ctx.globalState.update(
        "markdownEditorFont",
        font || undefined, // Remove key when "Default"
      );
    }
  },

  zoomChange: async (msg, ctx) => {
    const zoom = msg.zoom;
    if (
      typeof zoom === "number" &&
      Number.isFinite(zoom) &&
      zoom >= 0.5 &&
      zoom <= 2.0
    ) {
      await ctx.globalState.update(
        "markdownEditorZoom",
        zoom === 1 ? undefined : zoom, // Remove key when back to 100%
      );
    }
  },

  saveImage: async (msg, ctx) => {
    await handleSaveImage(msg, ctx.document, ctx.webview);
  },

  showWarning: (msg) => {
    const warnMsg = msg.message;
    if (typeof warnMsg === "string") {
      vscode.window.showWarningMessage(warnMsg);
    }
  },

  readClipboardImage: (_msg, ctx) => {
    handleReadClipboardImage(ctx.webview, ctx.notifyClipboardError);
  },

  requestImageUrlEdit: (msg, ctx) => {
    const editMsg = msg;
    if (!editMsg.editId) return;

    let prompt: string;
    if (editMsg.isBase64) {
      prompt = "Enter image path to replace embedded base64 image";
    } else if (editMsg.isLocalImage) {
      prompt = "Enter new image path (auto-rename only works within same folder)";
    } else {
      prompt = "Enter image URL";
    }

    vscode.window
      .showInputBox({
        prompt,
        value: editMsg.currentUrl || "",
        placeHolder: "images/photo.png or https://example.com/image.png",
      })
      .then((newUrl) => {
        ctx.webview.postMessage({
          type: "imageUrlEditResponse",
          editId: editMsg.editId,
          newUrl: newUrl ?? null,
        });
      });
  },

  openLink: (msg, ctx) => {
    const linkHref = msg.href;
    if (!linkHref) return;

    if (/^https?:\/\//.test(linkHref)) {
      // External URL → open in default browser
      vscode.env.openExternal(vscode.Uri.parse(linkHref));
    } else {
      // Relative file path → resolve against document location
      openLocalFileInEditor(linkHref, ctx.document);
    }
  },

  openImageInTab: (msg, ctx) => {
    const imgPath = msg.path;
    if (!imgPath) return;
    openLocalFileInEditor(imgPath, ctx.document);
  },

  requestImageRename: (msg, ctx) => {
    handleRequestImageRename(
      msg,
      ctx.document,
      ctx.webview,
      ctx.originalImagePaths,
      ctx.session.docKey,
      (value) => {
        ctx.session.pendingEdit = value;
      },
    );
  },

  fileSearch: async (_msg, ctx) => {
    const excludePattern = buildExcludePattern();
    const currentDocFolder = getDocFolder(ctx.document.uri);

    const files = await vscode.workspace.findFiles(
      "**/*",
      excludePattern,
      5000,
    );

    const fileList = files.map((uri) => ({
      name: path.basename(uri.fsPath),
      path: vscode.workspace.asRelativePath(uri),
    }));
    ctx.webview.postMessage({
      type: "fileSearchResults",
      files: fileList,
      currentDocFolder,
    });
  },

  wikiLinkSearch: async (_msg, ctx) => {
    const excludePattern = buildExcludePattern();
    const currentDocFolder = getDocFolder(ctx.document.uri);

    const mdFiles = await vscode.workspace.findFiles(
      "**/*.md",
      excludePattern,
      5000,
    );

    const fileList = mdFiles.map((uri) => ({
      name: path.basename(uri.fsPath),
      path: vscode.workspace.asRelativePath(uri),
    }));
    ctx.webview.postMessage({
      type: "wikiLinkSearchResults",
      files: fileList,
      currentDocFolder,
    });
  },

  openWikiLink: async (msg, ctx) => {
    await openWikiLink(msg.filename, ctx.document.uri);
  },

  export: (msg, ctx) => {
    handleExport(
      msg,
      ctx.document,
      ctx.webview,
      () => ctx.session.exportInProgress,
      (value) => {
        ctx.session.exportInProgress = value;
      },
    );
  },

  requestBacklinks: async (_msg, ctx) => {
    const links = await findBacklinks(ctx.document);
    ctx.webview.postMessage({
      type: "backlinks",
      links,
    });
  },

};

/** The `onDidReceiveMessage` body: validate the envelope, look up, run. */
export async function dispatchMessage(
  message: unknown,
  ctx: HandlerContext,
): Promise<void> {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const msg = message as WebviewToHostMessage;
  if (!Object.prototype.hasOwnProperty.call(handlers, msg.type)) return;
  const handler = handlers[msg.type] as (
    m: WebviewToHostMessage,
    c: HandlerContext,
  ) => void | Promise<void>;
  await handler(msg, ctx);
}
