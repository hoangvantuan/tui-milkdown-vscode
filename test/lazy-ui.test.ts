import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gitHubEmojis } from "@tiptap/extension-emoji";
import {
  searchEmojis,
  setEmojiData,
} from "../src/webview/emoji-plugin";

describe("Emoji Search and Filtering (#133)", () => {
  it("fuzzy searches emojis by name, shortcode, and tags", () => {
    setEmojiData(gitHubEmojis);

    // 1. Search by exact name
    const smileResults = searchEmojis("smile", gitHubEmojis, 5);
    assert.ok(smileResults.length > 0);
    assert.equal(smileResults[0].emoji.name, "smile");
    assert.equal(smileResults[0].emoji.emoji, "😄");

    // 2. Search by shortcode
    const tadaResults = searchEmojis("tada", gitHubEmojis, 5);
    assert.ok(tadaResults.length > 0);
    assert.equal(tadaResults[0].emoji.name, "tada");
    assert.equal(tadaResults[0].emoji.emoji, "🎉");

    // 3. Search by tag
    const celebrateResults = searchEmojis("celebrate", gitHubEmojis, 5);
    assert.ok(celebrateResults.length > 0);
    assert.ok(
      celebrateResults.some((r) => r.emoji.name === "tada"),
      "search for 'celebrate' tag should include 'tada'",
    );

    // 4. Prefix search
    const fireResults = searchEmojis("fir", gitHubEmojis, 5);
    assert.ok(fireResults.length > 0);
    assert.equal(fireResults[0].emoji.name, "fire");
    assert.equal(fireResults[0].emoji.emoji, "🔥");

    // 5. Empty query returns default popular emojis
    const defaultResults = searchEmojis("", gitHubEmojis, 10);
    assert.equal(defaultResults.length, 10);
    assert.equal(defaultResults[0].emoji.name, "smile");
    assert.equal(defaultResults[1].emoji.name, "joy");
  });

  it("handles case insensitivity and whitespace gracefully", () => {
    const upper = searchEmojis("SMILE", gitHubEmojis, 3);
    const lower = searchEmojis("smile", gitHubEmojis, 3);
    assert.equal(upper[0].emoji.name, lower[0].emoji.name);

    const padded = searchEmojis("  tada   ", gitHubEmojis, 3);
    const unpadded = searchEmojis("tada", gitHubEmojis, 3);
    assert.equal(padded[0].emoji.name, unpadded[0].emoji.name);
  });
});
