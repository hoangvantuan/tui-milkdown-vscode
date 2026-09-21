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
 *   8. Set map then reverse translate: new map replaces state, version bumps.
 *   9. Mutate map then reverse translate: in-place modification invalidates reverse cache.
 *  10. Consecutive map replacements: version increments monotonically.
 *
 * Breaking cache invalidation (omitting imageMapVersion++ on mutation) causes
 * cases 4, 5, 6, and 9 to output raw webview URIs and fail.
 */
import { createHarnessEditor } from "./editor";
import {
  setImageMap,
  mutateImageMap,
  getImageMapVersion,
  transformForDisplay,
  transformForSave,
  applyImageRenameTranslation,
  _testResetReverseCache,
} from "../src/webview/image-path-translation";

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
    setImageMap(map);
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
    setImageMap(map);
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
    setImageMap(map1);
    const md1 = "![alt](media/icon.png)\n";
    const display1 = transformForDisplay(md1, map1);
    const { editor, dispose } = createHarnessEditor({ content: display1, contentType: "markdown" });
    try {
      const saved1 = transformForSave(editor.getMarkdown(), map1);
      lines.push(`display: ${display1.trimEnd()}`);
      lines.push(`saved: ${saved1.trimEnd()}`);

      const map2 = { "media/icon-renamed.png": WEBVIEW_URI_RENAMED };
      setImageMap(map2);
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
    setImageMap(map);
    const md = "![alt](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      // Plugin rename operation: removes old entry, adds new entry, bumps version, updates node
      applyImageRenameTranslation(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown());
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
    setImageMap(map);
    const md = "![first](media/icon.png)\n\n![second](media/icon.png)\n";
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      applyImageRenameTranslation(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown());
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
    setImageMap(map);
    const md = '<img src="media/icon.png" alt="A sized image" width="96">\n';
    const display = transformForDisplay(md, map);
    const { editor, dispose } = createHarnessEditor({ content: display, contentType: "markdown" });
    try {
      const savedBefore = transformForSave(editor.getMarkdown(), map);
      lines.push(`display: ${display.trimEnd()}`);
      lines.push(`saved: ${savedBefore.trimEnd()}`);

      applyImageRenameTranslation(WEBVIEW_URI, "media/icon.png", "media/icon-renamed.png", WEBVIEW_URI_RENAMED, editor);

      const savedAfter = transformForSave(editor.getMarkdown());
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
    setImageMap(map);
    const contentWithEncodedUri = `![alt](${WEBVIEW_URI_ENCODED})\n`;
    const saved = transformForSave(contentWithEncodedUri, map);
    lines.push(`input: ${contentWithEncodedUri.trimEnd()}`);
    lines.push(`saved: ${saved.trimEnd()}`);
    lines.push("");
  }

  // Case 8: Replace map then reverse translate
  {
    lines.push("## set-map-reverse");
    lines.push("# setImageMap replaces the map, version increments, reverse lookup uses new entries");
    const map = { "media/photo.png": "https://file+.vscode-resource.vscode-cdn.net/ws/media/photo.png" };
    setImageMap(map);
    const saved = transformForSave("![photo](https://file+.vscode-resource.vscode-cdn.net/ws/media/photo.png)\n");
    lines.push(`saved: ${saved.trimEnd()}`);
    lines.push(`version-bumped: ${getImageMapVersion() > 0}`);
    lines.push("");
  }

  // Case 9: Mutate map by function then reverse translate
  {
    lines.push("## mutate-map-reverse");
    lines.push("# mutateImageMap modifies map in place, invalidates reverse cache, new path is translated");
    setImageMap({ "media/old-pic.png": "https://file+.vscode-resource.vscode-cdn.net/ws/media/old-pic.png" });
    const primed = transformForSave("![pic](https://file+.vscode-resource.vscode-cdn.net/ws/media/old-pic.png)\n");
    lines.push(`primed: ${primed.trimEnd()}`);

    mutateImageMap((map) => {
      delete map["media/old-pic.png"];
      map["media/new-pic.png"] = "https://file+.vscode-resource.vscode-cdn.net/ws/media/new-pic.png";
    });

    const saved = transformForSave("![pic](https://file+.vscode-resource.vscode-cdn.net/ws/media/new-pic.png)\n");
    lines.push(`saved-after-mutate: ${saved.trimEnd()}`);
    lines.push("");
  }

  // Case 10: Two consecutive map replacements
  {
    lines.push("## consecutive-set-map");
    lines.push("# two consecutive setImageMap calls increment version monotonically and use latest map");
    setImageMap({ "media/first.png": "https://file+.vscode-resource.vscode-cdn.net/ws/media/first.png" });
    const v1 = getImageMapVersion();
    setImageMap({ "media/second.png": "https://file+.vscode-resource.vscode-cdn.net/ws/media/second.png" });
    const v2 = getImageMapVersion();

    const savedFirst = transformForSave("![first](https://file+.vscode-resource.vscode-cdn.net/ws/media/first.png)\n");
    const savedSecond = transformForSave("![second](https://file+.vscode-resource.vscode-cdn.net/ws/media/second.png)\n");

    lines.push(`version-increased: ${v2 > v1}`);
    lines.push(`first-entry-gone: ${savedFirst.includes("https://file+")}`);
    lines.push(`second-entry-saved: ${savedSecond.trimEnd()}`);
    lines.push("");
  }

  _testResetReverseCache();
  setImageMap({});

  return lines.join("\n") + "\n";
}
