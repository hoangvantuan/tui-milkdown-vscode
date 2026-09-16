/**
 * Every way an image path in the markdown is turned into something else.
 *
 * Two maps come out of here and they are NOT the same thing:
 *
 * - `buildImageMap` -> what the webview renders: relative path to a
 *   `vscode-webview://` URI, remote URLs dropped because the webview can load
 *   those itself.
 * - `buildOriginalImageMap` -> what rename detection compares against:
 *   normalized relative path to absolute fs path.
 *
 * `extractImagePaths` is regex-based rather than AST-based because it runs on
 * every keystroke's worth of content; it is bounded by MAX_FILE_SIZE so a
 * pathological document cannot make the scan the bottleneck.
 */
import * as vscode from "vscode";
import { MAX_FILE_SIZE } from "../constants";
import { cleanImagePath } from "../utils/clean-image-path";
import { normalizePath } from "../utils/image-rename-handler";

export function isRemoteUrl(url: string): boolean {
  return /^(https?:\/\/|data:)/i.test(url);
}

export function extractImagePaths(content: string): string[] {
  // Size guard to prevent regex performance issues on malicious input
  if (!content || content.length > MAX_FILE_SIZE) {
    return [];
  }

  const paths: string[] = [];

  // Markdown: ![alt](path) or ![alt](path "title") or ![alt](<path> "title")
  // Supports angle-bracket paths and paths with parentheses like path(1).png
  const mdRegex = /!\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+(?:\([^)]*\)[^)\s]*)*))\s*(?:["'][^"']*["'])?\)/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    const rawPath = match[1] ?? match[2]; // match[1] = angle-bracket path, match[2] = normal path
    const cleanPath = cleanImagePath(rawPath);
    if (cleanPath) {
      paths.push(cleanPath);
    }
  }

  // HTML: <img src="path">
  const htmlRegex = /<img\s[^>]*?src=["']([^"']+)["']/gi;
  while ((match = htmlRegex.exec(content)) !== null) {
    const cleanPath = cleanImagePath(match[1]);
    if (cleanPath) {
      paths.push(cleanPath);
    }
  }

  return [...new Set(paths)]; // Dedupe
}

export function resolveImagePath(
  imagePath: string,
  documentUri: vscode.Uri,
): vscode.Uri | null {
  if (isRemoteUrl(imagePath)) return null;

  // Handle file:// URIs
  if (imagePath.startsWith("file://")) {
    return vscode.Uri.parse(imagePath);
  }

  // Handle Windows absolute paths (e.g., C:\ or C:/)
  if (/^[a-zA-Z]:[\\/]/.test(imagePath)) {
    return vscode.Uri.file(imagePath);
  }

  const documentFolder = vscode.Uri.joinPath(documentUri, "..");

  if (imagePath.startsWith("/")) {
    // Unix absolute path - resolve from workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder) {
      return vscode.Uri.joinPath(workspaceFolder.uri, imagePath);
    }
    // Fallback: treat as file system absolute path
    return vscode.Uri.file(imagePath);
  }

  // Relative path - resolve from document folder
  return vscode.Uri.joinPath(documentFolder, imagePath);
}

export function buildImageMap(
  content: string,
  documentUri: vscode.Uri,
  webview: vscode.Webview,
): Record<string, string> {
  const imageMap: Record<string, string> = {};
  const paths = extractImagePaths(content);

  for (const path of paths) {
    if (isRemoteUrl(path)) continue;

    const resolvedUri = resolveImagePath(path, documentUri);
    if (resolvedUri) {
      imageMap[path] = webview.asWebviewUri(resolvedUri).toString();
    }
  }

  return imageMap;
}

/**
 * Build mapping of relative image paths to absolute paths for rename detection.
 * Filters out remote URLs (http/https/data).
 */
export function buildOriginalImageMap(
  content: string,
  documentUri: vscode.Uri,
): Map<string, string> {
  const map = new Map<string, string>();
  const paths = extractImagePaths(content);

  for (const imgPath of paths) {
    if (isRemoteUrl(imgPath)) continue;
    const resolved = resolveImagePath(imgPath, documentUri);
    if (resolved) {
      const normalizedPath = normalizePath(imgPath);
      map.set(normalizedPath, resolved.fsPath);
    }
  }
  return map;
}
