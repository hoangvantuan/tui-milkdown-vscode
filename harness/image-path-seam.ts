/**
 * Image path seam: the path written to the file for an image the rich text view displays.
 *
 * Exercises the image path translation pipeline through the harness editor:
 *   1. Plain roundtrip: relative path in, relative path out (no map).
 *   2. Roundtrip with a map: relative -> webview URI for display, webview URI
 *      -> relative for save. The cache is built fresh.
 *   3. Host sends a new map (simulates an update message): the version bumps,
 *      the cache rebuilds, the new mapping is used.
 *   4. Plugin rename (the #142 shape): old entry removed, new entry added,
 *      version bumped, node updated to new URI. transformForSave converts it back
 *      to the new relative path.
 *   5. Two nodes referencing the same image: after rename, both nodes are updated
 *      and both serialize to the new relative path.
 *   6. HTML img with width: same translation through <img src>.
 *   7. Percent-encoded URI: sameResource matching resolves percent-encoded
 *      webview URIs back to relative path.
 *
 * Breaking cache invalidation (omitting imageMapVersion++ on rename) causes
 * cases 4, 5, and 6 to output raw webview URIs and fail.
 */
import { createHarnessEditor } from "./editor";
import {
  transformForDisplay,
  transformForSave,
  setCurrentImageMap,
  applyImageRename,
  _testResetReverseCache,
} from "../src/webview/main";

const WEBVIEW_URI = "https://file+.vscode-resource.vscode-cdn.net/ws/media/icon.png";
const WEBVIEW_URI_RENAMED = "https://file+.vscode-resource.vscode-cdn.net/ws/media/icon-renamed.png";
const WEBVIEW_URI_ENCODED = "https://file%2B.vscode-resource.vscode-cdn.net/ws/media/icon.png";

export function runImagePathSeam(): string {
  const lines: string[] = [
    "# image-path-seam.ts: image path translation cases",
    "",
  ];

  _testResetReverseCache();

  // Case 1: Plain roundtrip
  {
    lines.push("## plain-roundtrip");
    lines.push("# no image map, relative path survives roundtrip unchanged");
    const map = {};
    setCurrentImageMap(map);
    const md = "![alt](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const saved = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${saved.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 2: Roundtrip with map
  {
    lines.push("## roundtrip-with-map");
    lines.push("# relative -> webview URI for display, webview URI -> relative for save");
    const map = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map);
    const md = "![alt](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const saved = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${saved.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 3: Host updates map
  {
    lines.push("## host-updates-map");
    lines.push("# host sends a new map with a renamed image: version bumps, cache rebuilds");
    const map1 = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map1);
    const md1 = "![alt](media/icon.png)\n";
    const display1 = transformForDisplay(md1, map1);
    const { editor, dispose } = createHarnessEditor({ content: display1, contentType: "markdown" });
    try {
      const saved1 = transformForSave(editor.getMarkdown(), map1);
      lines.push(`display: ${display1.trimEnd()}`);
      lines.push(`saved: ${saved1.trimEnd()}`);

      const map2 = { "media/icon-renamed.png": WEBVIEW_URI_RENAMED };
      setCurrentImageMap(map2);
      const display2 = transformForDisplay("![alt](media/icon-renamed.png)\n", map2);
      editor.commands.setContent(display2, { contentType: "markdown" });
      const saved2 = transformForSave(editor.getMarkdown(), map2);
      lines.push(`saved-after-update: ${saved2.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 4: Plugin rename (the #142 shape)
  {
    lines.push("## plugin-rename");
    lines.push("# the #142 shape: old entry removed, new entry added, node updated, relative path out");
    const map = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map);
    const md = "![alt](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      // Plugin rename operation: removes old entry, adds new entry, bumps version, updates node
      applyImageRename(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown(), map);
      lines.push(`saved-after-rename: ${savedAfter.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 5: Two nodes referencing the same image
  {
    lines.push("## two-nodes-same-image");
    lines.push("# two references to the same image: after rename, both serialize to the new name");
    const map = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map);
    const md = "![first](media/icon.png)\n\n![second](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      applyImageRename(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown(), map);
      lines.push(`saved-after-rename: ${savedAfter.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 6: HTML img rename
  {
    lines.push("## html-img-rename");
    lines.push("# HTML img with width: same translation through <img src>");
    const map = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map);
    const md = '<img src="media/icon.png" alt="A sized image" width="96">\n';
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      applyImageRename(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown(), map);
      lines.push(`saved-after-rename: ${savedAfter.trimEnd()}`);
    } finally {
      dispose();
    }
    lines.push("");
  }

  // Case 7: Percent-encoded URI
  {
    lines.push("## percent-encoded-uri");
    lines.push("# percent-encoded webview URI matches host map via sameResource");
    const map = { "media/icon.png": WEBVIEW_URI };
    setCurrentImageMap(map);
    const contentWithEncodedUri = `![alt](${WEBVIEW_URI_ENCODED})\n`;
    const saved = transformForSave(contentWithEncodedUri, map);
    lines.push(`input: ${contentWithEncodedUri.trimEnd()}`);
    lines.push(`saved: ${saved.trimEnd()}`);
    lines.push("");
  }

  _testResetReverseCache();
  setCurrentImageMap({});

  return lines.join("\n") + "\n";
}
