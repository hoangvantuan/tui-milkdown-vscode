/**
 * EOL normalization for content on its way back into the document.
 *
 * The webview always serializes with `\n`; writing that into a CRLF document
 * would rewrite every line and turn one keystroke into a whole-file diff.
 *
 * `src/markdownEditorProvider.ts` re-exports this, because `harness/crlf-seam.ts`
 * imports it from there and the harness is not ours to edit.
 */
import * as vscode from "vscode";

/**
 * Normalize line endings in markdown content to match the document's EOL sequence.
 * Converts CRLF, lone CR, and LF to the target EOL string (CRLF or LF).
 */
export function normalizeLineEndings(
  content: string,
  eol: vscode.EndOfLine | "\n" | "\r\n",
): string {
  const targetEol =
    eol === vscode.EndOfLine.CRLF || eol === "\r\n" ? "\r\n" : "\n";
  return content.replace(/\r\n|\r|\n/g, targetEol);
}
