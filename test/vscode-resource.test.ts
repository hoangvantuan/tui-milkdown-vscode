/**
 * `src/utils/vscode-resource.ts`: matching a DOM image src against the URI the
 * extension host generated for the same file.
 *
 * The case that made this a test rather than a comment is the `+` in
 * `file+.vscode-resource`. The host writes it literally, the DOM reports it
 * percent-encoded, and the `===` that used to compare them missed every image.
 * The visible symptom was an absolute webview URL written into the user's
 * markdown when they edited a pasted image's path (found by hand, 2.17).
 */
import { test } from "node:test";
import * as assert from "node:assert";
import {
  extractVscodeResourcePath,
  normalizeResourceUrl,
  sameResource,
} from "../src/utils/vscode-resource";

const HOST = "https://file+.vscode-resource.vscode-cdn.net/tmp/ws/images/a.png";
const DOM = "https://file%2B.vscode-resource.vscode-cdn.net/tmp/ws/images/a.png";

test("extractVscodeResourcePath recovers the local path from both spellings", () => {
  assert.strictEqual(extractVscodeResourcePath(HOST), "/tmp/ws/images/a.png");
  assert.strictEqual(extractVscodeResourcePath(DOM), "/tmp/ws/images/a.png");
});

test("extractVscodeResourcePath returns null for anything else", () => {
  assert.strictEqual(extractVscodeResourcePath("images/a.png"), null);
  assert.strictEqual(extractVscodeResourcePath("https://example.com/a.png"), null);
  assert.strictEqual(extractVscodeResourcePath("data:image/png;base64,AAAA"), null);
});

test("normalizeResourceUrl decodes and drops the cache-busting query", () => {
  assert.strictEqual(normalizeResourceUrl(DOM), HOST);
  assert.strictEqual(normalizeResourceUrl(HOST + "?v=3"), HOST);
  assert.strictEqual(normalizeResourceUrl(HOST + "#frag"), HOST);
});

test("normalizeResourceUrl leaves a malformed escape alone instead of throwing", () => {
  assert.strictEqual(normalizeResourceUrl("a%zz.png"), "a%zz.png");
});

test("sameResource matches the host URI against the DOM's spelling", () => {
  // This is the defect. Before the fix the caller compared these with ===.
  assert.notStrictEqual(HOST, DOM);
  assert.ok(sameResource(HOST, DOM));
  assert.ok(sameResource(DOM, HOST));
});

test("sameResource matches across the query a reload appends", () => {
  assert.ok(sameResource(HOST, DOM + "?v=2"));
});

test("sameResource matches vscode-webview:// against file+ for the same path", () => {
  assert.ok(
    sameResource(
      "https://file+.vscode-resource.vscode-webview.net/tmp/ws/images/a.png",
      "https://file%2B.vscode-resource.vscode-cdn.net/tmp/ws/images/a.png",
    ),
  );
});

test("sameResource does NOT match two different files", () => {
  assert.ok(
    !sameResource(
      HOST,
      "https://file%2B.vscode-resource.vscode-cdn.net/tmp/ws/images/b.png",
    ),
  );
});

test("sameResource does not match unrelated strings just because both fail to parse", () => {
  assert.ok(!sameResource("images/a.png", "images/b.png"));
  assert.ok(sameResource("images/a.png", "images/a.png"));
});
