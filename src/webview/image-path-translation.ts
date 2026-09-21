/**
 * Image path translation: bridges relative image paths in Markdown files
 * with webview resource URIs displayed in the rich text editor.
 *
 * Translates relative paths to webview URIs for display, and webview URIs
 * back to relative paths on save. Owns the current image map, version counter,
 * cached reverse map, and DOM-independent ProseMirror image node updates.
 *
 * Node-safe: does not touch browser globals or VS Code webview API.
 */
import type { Editor } from "@tiptap/core";
import {
  normalizeResourceUrl,
  extractVscodeResourcePath,
  sameResource,
} from "../utils/vscode-resource";

// Node types that represent images in Tiptap
export const IMAGE_NODE_TYPES = ["image"];

let currentImageMap: Record<string, string> = {};
let imageMapVersion = 0;

let cachedReverseImageMap: Map<string, string> | null = null;
let cachedReverseImageMapVersion = -1;

/**
 * Normalize a webview URI or resource URL into a canonical reverse-lookup key.
 * If the URL is a vscode-resource URL, the local filesystem path is extracted,
 * matching sameResource semantics in O(1) Map lookups without scanning entries.
 */
function toResourceKey(url: string): string {
  const norm = normalizeResourceUrl(url);
  const vscPath = extractVscodeResourcePath(norm);
  return vscPath !== null ? "vsc:" + vscPath : "raw:" + norm;
}

/**
 * Build or retrieve the cached reverse map (webview URI -> relative path).
 * Rebuilt lazily only when imageMapVersion changes.
 */
function getReverseMap(): Map<string, string> {
  if (cachedReverseImageMapVersion !== imageMapVersion || cachedReverseImageMap === null) {
    const reverseMap = new Map<string, string>();
    for (const [relativePath, uri] of Object.entries(currentImageMap)) {
      reverseMap.set(uri, relativePath);
      reverseMap.set(toResourceKey(uri), relativePath);
    }
    cachedReverseImageMap = reverseMap;
    cachedReverseImageMapVersion = imageMapVersion;
  }
  return cachedReverseImageMap;
}

/**
 * Replace the current image map, increment the version counter,
 * and invalidate the cached reverse map.
 */
export function setImageMap(map: Record<string, string>): void {
  currentImageMap = { ...map };
  imageMapVersion++;
}

/**
 * Mutate the image map via a callback, increment the version counter,
 * and invalidate the cached reverse map.
 */
export function mutateImageMap(fn: (map: Record<string, string>) => void): void {
  fn(currentImageMap);
  imageMapVersion++;
}

/**
 * Get a snapshot of the current image map.
 */
export function getImageMap(): Record<string, string> {
  return { ...currentImageMap };
}

/**
 * Get the current version counter of the image map.
 */
export function getImageMapVersion(): number {
  return imageMapVersion;
}

/**
 * Forcibly invalidate the cached reverse map.
 */
export function _testResetReverseCache(): void {
  cachedReverseImageMap = null;
  cachedReverseImageMapVersion = -1;
}

/**
 * Reverse-lookup the original relative path from a webview URI or DOM src.
 * Uses O(1) canonical resource key matching equivalent to sameResource.
 */
export function lookupOriginalPath(url: string): string | undefined {
  const reverseMap = getReverseMap();
  const exact = reverseMap.get(url);
  if (exact !== undefined) return exact;
  return reverseMap.get(toResourceKey(url));
}

/**
 * Replace image paths within markdown images and HTML img tags.
 */
function replaceImagePaths(
  content: string,
  lookup: (url: string) => string | undefined,
): string {
  // Replace in markdown images: ![alt](url) or ![alt](url "title")
  let result = content.replace(
    /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g,
    (match, alt, url, rest) => {
      const replacement = lookup(url);
      return replacement ? `![${alt}](${replacement}${rest})` : match;
    }
  );

  // Replace in HTML img tags: <img src="url">
  result = result.replace(
    /<img(\s[^>]*?)src=(["'])([^"']+)\2([^>]*?)>/gi,
    (match, before, quote, url, after) => {
      const replacement = lookup(url);
      return replacement ? `<img${before}src=${quote}${replacement}${quote}${after}>` : match;
    }
  );

  return result;
}

/**
 * Forward translation: relative path to webview URI for display.
 */
export function transformForDisplay(
  content: string,
  map?: Record<string, string>,
): string {
  const activeMap = map ?? currentImageMap;
  if (Object.keys(activeMap).length === 0) return content;
  return replaceImagePaths(content, (url) => activeMap[url]);
}

/**
 * Reverse translation: webview URI back to relative path for save.
 * Uses cached reverse map matching with sameResource semantics.
 */
export function transformForSave(
  content: string,
  map?: Record<string, string>,
): string {
  if (map && map !== currentImageMap) {
    if (Object.keys(map).length === 0) return content;
    const tempReverse = new Map<string, string>();
    for (const [orig, uri] of Object.entries(map)) {
      tempReverse.set(uri, orig);
      tempReverse.set(toResourceKey(uri), orig);
    }
    const lookup = (url: string) => tempReverse.get(url) ?? tempReverse.get(toResourceKey(url));
    return replaceImagePaths(content, lookup);
  }

  if (Object.keys(currentImageMap).length === 0) return content;
  const reverseMap = getReverseMap();
  const lookup = (url: string) => reverseMap.get(url) ?? reverseMap.get(toResourceKey(url));
  return replaceImagePaths(content, lookup);
}

/**
 * Update all image nodes in the editor document that point to oldSrc (or match via sameResource)
 * to point to newSrc. Pure ProseMirror operation without side effects.
 */
export function updateEditorImageNodeSrc(
  editor: Editor,
  oldSrc: string,
  newSrc: string,
): boolean {
  try {
    const view = editor.view;
    if (!view) return false;

    const { state, dispatch } = view;

    const nodesToUpdate: Array<{ pos: number; node: typeof state.doc.firstChild; nodeSize: number }> = [];
    state.doc.descendants((node, pos) => {
      if (!IMAGE_NODE_TYPES.includes(node.type.name)) return;
      const src = node.attrs.src as string;
      if (src !== oldSrc && !sameResource(src, oldSrc)) return;
      nodesToUpdate.push({ pos, node, nodeSize: node.nodeSize });
    });

    if (nodesToUpdate.length === 0) return false;

    nodesToUpdate.sort((a, b) => b.pos - a.pos);

    let tr = state.tr;
    for (const { pos, node, nodeSize } of nodesToUpdate) {
      const newNode = node!.type.create(
        { ...node!.attrs, src: newSrc },
        node!.content,
        node!.marks
      );
      tr = tr.replaceWith(pos, pos + nodeSize, newNode);
    }

    dispatch(tr);
    return true;
  } catch (err) {
    console.warn("[ImageTranslation] Failed to update node:", err);
    return false;
  }
}

/**
 * Complete an image rename: update the map entry, bump version,
 * and rewrite all matching editor image nodes to the new webview URI.
 */
export function applyImageRenameTranslation(
  oldSrc: string,
  oldPath: string,
  newPath: string,
  webviewUri: string,
  editor?: Editor,
): void {
  mutateImageMap((map) => {
    if (oldPath) {
      delete map[oldPath];
    }
    map[newPath] = webviewUri;
  });

  if (editor) {
    updateEditorImageNodeSrc(editor, oldSrc, webviewUri);
  }
}
