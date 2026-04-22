/**
 * Detect VS Code webview resource URLs and extract the local file path.
 *
 * The webview rewrites local paths like `/Users/foo/img.png` into URLs such as
 * `https://file+.vscode-resource.vscode-cdn.net/Users/foo/img.png` (or the
 * percent-encoded variant `file%2B`). These are NOT fetchable over HTTP so we
 * need to read the file directly from disk.
 *
 * Returns the decoded local path, or `null` if the URL is not a vscode-resource URL.
 */
export function extractVscodeResourcePath(src: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    decoded = src;
  }
  const match = /^https?:\/\/file\+\.vscode-resource\.vscode-(?:cdn|webview)\.net(\/.*)/i.exec(decoded);
  return match ? match[1] : null;
}
