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

/**
 * Normalize a webview resource URL so two spellings of the same file compare equal.
 *
 * The host builds an image's URL with `webview.asWebviewUri()` and hands it to
 * the webview in `imageMap`. The DOM then reports a DIFFERENT STRING for the
 * same image: the browser percent-encodes it, so the host's
 * `https://file+.vscode-resource...` comes back as `https://file%2B...`, and a
 * cache-busting query can be appended. An `===` between the two therefore fails
 * for every image, which is how editing a pasted image's path wrote the whole
 * webview URL into the user's markdown instead of the relative path.
 */
export function normalizeResourceUrl(url: string): string {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* a malformed escape is still worth comparing raw */
  }
  return decoded.split("?")[0].split("#")[0];
}

/**
 * Do two URLs point at the same webview resource?
 *
 * Tries the normalized strings first, then the local path each one carries, so
 * a `vscode-webview://<id>/path` and an `https://file+.vscode-resource.../path`
 * for the same file still match.
 */
export function sameResource(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeResourceUrl(a);
  const nb = normalizeResourceUrl(b);
  if (na === nb) return true;
  const pa = extractVscodeResourcePath(na);
  const pb = extractVscodeResourcePath(nb);
  return pa !== null && pa === pb;
}
