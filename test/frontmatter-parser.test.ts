import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseContent,
  reconstructContent,
  isBlankOrCommentOnly,
} from "../src/utils/frontmatter-parser";
import { MAX_FILE_SIZE } from "../src/constants";

describe("frontmatter-parser", () => {
  describe("1. standard frontmatter", () => {
    it("parses valid standard frontmatter", () => {
      const input = "---\ntitle: Test Doc\ntags:\n  - a\n  - b\ndraft: false\n---\n\n# Heading\n\nBody paragraph.\n";
      const result = parseContent(input);

      assert.equal(result.format, "standard");
      assert.equal(result.isValid, true);
      assert.equal(result.error, undefined);
      assert.equal(result.frontmatter, "title: Test Doc\ntags:\n  - a\n  - b\ndraft: false");
      assert.equal(result.body, "\n# Heading\n\nBody paragraph.\n");
      assert.ok(result.rawBlock);
      assert.ok(result.rawBlock.startsWith("---\n"));
    });

    it("parses standard frontmatter with invalid YAML as isValid: false", () => {
      const input = "---\ntitle: Valid\ntags: [unclosed\n---\n\n# Heading\n";
      const result = parseContent(input);

      assert.equal(result.format, "standard");
      assert.equal(result.isValid, false);
      assert.ok(result.error);
      assert.equal(result.frontmatter, "title: Valid\ntags: [unclosed");
      assert.equal(result.body, "\n# Heading\n");
    });

    it("reconstructs standard frontmatter to exact input when unchanged", () => {
      const input = "---\ntitle: Reconstructed\nauthor: Antigravity\n---\n\nContent here.\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });
  });

  describe("2. implicit frontmatter", () => {
    it("parses valid implicit frontmatter with known keys", () => {
      const input = "title: Implicit Title\ndate: 2026-03-30\n---\n\n# Body\n\nBody text.\n";
      const result = parseContent(input);

      assert.equal(result.format, "implicit");
      assert.equal(result.isValid, true);
      assert.equal(result.frontmatter, "title: Implicit Title\ndate: 2026-03-30");
      assert.equal(result.body, "\n# Body\n\nBody text.\n");
      assert.ok(result.rawBlock);
    });

    it("does not treat markdown without known keys or <2 keys as implicit frontmatter", () => {
      const input = "customKey: 123\n---\n\nBody text.\n";
      const result = parseContent(input);

      assert.equal(result.format, "none");
      assert.equal(result.frontmatter, null);
      assert.equal(result.body, input);
    });

    it("reconstructs implicit frontmatter verbatim when unchanged", () => {
      const input = "title: Note\ntags:\n  - guide\n---\n\nContent\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });

    it("falls back to canonical implicit template when edited", () => {
      const input = "title: Original\ntags:\n  - guide\n---\n\nContent\n";
      const parsed = parseContent(input);
      const editedFrontmatter = "title: Modified\ntags:\n  - guide";
      const output = reconstructContent(
        editedFrontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, "title: Modified\ntags:\n  - guide\n---\n\nContent\n");
    });
  });

  describe("3. empty frontmatter", () => {
    it("parses empty delimiters (---\\n---)", () => {
      const input = "---\n---\n\n# Body\n";
      const result = parseContent(input);

      assert.equal(result.format, "standard");
      assert.equal(result.frontmatter, "");
      assert.equal(result.isValid, true);
      assert.equal(result.body, "\n# Body\n");
    });

    it("replays empty delimiters verbatim when unchanged", () => {
      const input = "---\n---\n\n# Empty Frontmatter Body\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });

    it("returns safeBody when frontmatter is trimmed empty and rawBlock does not match", () => {
      const output = reconstructContent("", "Just body", "standard", null);
      assert.equal(output, "Just body");
    });
  });

  describe("4. comment-only frontmatter", () => {
    it("parses comment-only standard frontmatter as valid", () => {
      const input = "---\n# only a comment\n# second comment\n---\n\n# Body\n";
      const result = parseContent(input);

      assert.equal(result.format, "standard");
      assert.equal(result.isValid, true);
      assert.equal(result.frontmatter, "# only a comment\n# second comment");
      assert.equal(result.body, "\n# Body\n");
    });

    it("parses blank-line-only standard frontmatter as valid", () => {
      const input = "---\n\n---\n\n# Body\n";
      const result = parseContent(input);

      assert.equal(result.format, "standard");
      assert.equal(result.isValid, true);
      assert.equal(result.frontmatter, "");
    });

    it("verifies isBlankOrCommentOnly helper correctly identifies comment/blank lines", () => {
      assert.equal(isBlankOrCommentOnly(""), true);
      assert.equal(isBlankOrCommentOnly("# comment"), true);
      assert.equal(isBlankOrCommentOnly("   # comment\n   \n# another"), true);
      assert.equal(isBlankOrCommentOnly("title: Hello\n# comment"), false);
      assert.equal(isBlankOrCommentOnly("key: value"), false);
    });
  });

  describe("5. rawBlock replay", () => {
    it("preserves trailing whitespace on delimiter lines", () => {
      const input = "--- \ntitle: Trailing\n--- \n\n# Body\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });

    it("preserves zero blank lines between closing delimiter and body", () => {
      const input = "---\ntitle: No Gap\n---\n# Body immediately\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });

    it("preserves multiple blank lines between closing delimiter and body", () => {
      const input = "---\ntitle: Two Blank Lines\n---\n\n\n# Body after 2 blank lines\n";
      const parsed = parseContent(input);
      const output = reconstructContent(
        parsed.frontmatter,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      assert.equal(output, input);
    });

    it("discards rawBlock and falls back to canonical template when frontmatter is edited", () => {
      const input = "--- \ntitle: Original\n--- \n\n# Body\n";
      const parsed = parseContent(input);
      const edited = "title: Changed";
      const output = reconstructContent(
        edited,
        parsed.body,
        parsed.format,
        parsed.rawBlock,
      );
      // Canonical format strips trailing space on delimiters
      assert.equal(output, "---\ntitle: Changed\n---\n\n# Body\n");
    });

    it("returns unmodified body when frontmatter is null", () => {
      const output = reconstructContent(null, "# Just body\n", "none", null);
      assert.equal(output, "# Just body\n");
    });

    it("handles inputs exceeding MAX_FILE_SIZE gracefully", () => {
      const hugeInput = "---\ntitle: Huge\n---\n" + "x".repeat(MAX_FILE_SIZE + 10);
      const result = parseContent(hugeInput);
      assert.equal(result.format, "none");
      assert.equal(result.isValid, false);
      assert.equal(result.error, "Content too large for frontmatter parsing");
      assert.equal(result.frontmatter, null);
    });

    it("handles empty and non-string inputs safely", () => {
      const emptyResult = parseContent("");
      assert.equal(emptyResult.format, "none");
      assert.equal(emptyResult.frontmatter, null);
      assert.equal(emptyResult.body, "");

      // Non-string input
      // @ts-expect-error test non-string runtime safety
      const invalidResult = parseContent(null);
      assert.equal(invalidResult.format, "none");
      assert.equal(invalidResult.frontmatter, null);
    });
  });
});
