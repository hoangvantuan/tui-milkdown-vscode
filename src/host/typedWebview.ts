/**
 * The webview handle, narrowed to the host -> webview message union.
 *
 * It lives here rather than in `src/shared/messages.ts` because it mentions
 * `vscode.Webview`: that module is type-only at runtime and is also pulled in
 * by the webview bundle, which has no `vscode` module to resolve.
 */
import * as vscode from "vscode";
import type { HostToWebviewMessage } from "../shared/messages";

export interface TypedWebview extends Omit<vscode.Webview, "postMessage"> {
  postMessage(message: HostToWebviewMessage): Thenable<boolean>;
}
