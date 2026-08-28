import * as yaml from "js-yaml";
import { MAX_FILE_SIZE } from "../constants";

export type FrontmatterFormat = "standard" | "implicit" | "none";

export interface ParseResult {
  frontmatter: string | null;
  body: string;
  isValid: boolean;
  error?: string;
  format: FrontmatterFormat;
  /**
   * Exact original text of the frontmatter block (delimiters included),
   * or null when the document has no frontmatter. Reconstruction replays
   * these bytes verbatim while the frontmatter stays untouched, so empty
   * delimiters, blank-line-only blocks, implicit separators and trailing
   * whitespace on delimiter lines all survive a save round-trip.
   */
  rawBlock?: string | null;
}

const FRONTMATTER_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const EMPTY_FRONTMATTER_REGEX = /^---[ \t]*\n---[ \t]*(?:\n|$)/;
const IMPLICIT_SEPARATOR_REGEX = /\n---[ \t]*(?:\n|$)/;
const RAW_STANDARD_BLOCK_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)$/;
const RAW_EMPTY_BLOCK_REGEX = /^---[ \t]*\n---[ \t]*(?:\n|$)$/;
const RAW_IMPLICIT_SEPARATOR_REGEX = /^\n---[ \t]*(?:\n|$)$/;

/**
 * A raw block may only be replayed when it still embeds the current
 * frontmatter text; after a metadata-panel edit the stale block must be
 * ignored and reconstruction falls back to the canonical template.
 */
function rawBlockMatchesFrontmatter(
  rawBlock: string,
  frontmatter: string,
  format: FrontmatterFormat
): boolean {
  if (format === "implicit") {
    return (
      rawBlock.startsWith(frontmatter) &&
      RAW_IMPLICIT_SEPARATOR_REGEX.test(rawBlock.slice(frontmatter.length))
    );
  }
  const std = rawBlock.match(RAW_STANDARD_BLOCK_REGEX);
  if (std) return std[1] === frontmatter;
  return frontmatter === "" && RAW_EMPTY_BLOCK_REGEX.test(rawBlock);
}

export function isBlankOrCommentOnly(rawYaml: string): boolean {
  return rawYaml.split("\n").every((line) => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("#");
  });
}

const KNOWN_KEYS = new Set([
  "title",
  "type",
  "date",
  "created",
  "updated",
  "tags",
  "categories",
  "author",
  "draft",
  "slug",
  "description",
  "related",
  "sources",
  "aliases",
  "layout",
  "permalink",
  "published",
]);

function detectImplicitFrontmatter(
  markdown: string
): { rawYaml: string; body: string; raw: string } | null {
  const sepMatch = markdown.match(IMPLICIT_SEPARATOR_REGEX);
  if (!sepMatch || sepMatch.index === undefined) return null;

  const rawYaml = markdown.slice(0, sepMatch.index);
  if (!rawYaml.trim()) return null;

  try {
    const parsed = yaml.load(rawYaml);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length < 2) return null;
    if (!keys.some((k) => KNOWN_KEYS.has(k))) return null;

    const body = markdown.slice(
      sepMatch.index + sepMatch[0].length
    );
    return { rawYaml, body, raw: rawYaml + sepMatch[0] };
  } catch {
    return null;
  }
}

export function parseContent(markdown: string): ParseResult {
  if (!markdown || typeof markdown !== "string") {
    return { frontmatter: null, body: "", isValid: true, format: "none", rawBlock: null };
  }

  if (markdown.length > MAX_FILE_SIZE) {
    return {
      frontmatter: null,
      body: markdown,
      isValid: false,
      error: "Content too large for frontmatter parsing",
      format: "none",
      rawBlock: null,
    };
  }

  // 1. Empty standard frontmatter (---\n---)
  const emptyMatch = markdown.match(EMPTY_FRONTMATTER_REGEX);
  if (emptyMatch) {
    return {
      frontmatter: "",
      body: markdown.slice(emptyMatch[0].length),
      isValid: true,
      format: "standard",
      rawBlock: emptyMatch[0],
    };
  }

  // 2. Standard frontmatter (---\n...\n---)
  const stdMatch = markdown.match(FRONTMATTER_REGEX);
  if (stdMatch) {
    const rawYaml = stdMatch[1];
    const body = markdown.slice(stdMatch[0].length);
    if (isBlankOrCommentOnly(rawYaml)) {
      return { frontmatter: rawYaml, body, isValid: true, format: "standard", rawBlock: stdMatch[0] };
    }
    try {
      yaml.load(rawYaml);
      return { frontmatter: rawYaml, body, isValid: true, format: "standard", rawBlock: stdMatch[0] };
    } catch (err) {
      return {
        frontmatter: rawYaml,
        body,
        isValid: false,
        error: err instanceof Error ? err.message : "Invalid YAML",
        format: "standard",
        rawBlock: stdMatch[0],
      };
    }
  }

  // 3. Implicit frontmatter (key: value\n...\n---)
  const implicit = detectImplicitFrontmatter(markdown);
  if (implicit) {
    return {
      frontmatter: implicit.rawYaml,
      body: implicit.body,
      isValid: true,
      format: "implicit",
      rawBlock: implicit.raw,
    };
  }

  // 4. No frontmatter
  return { frontmatter: null, body: markdown, isValid: true, format: "none", rawBlock: null };
}

export function reconstructContent(
  frontmatter: string | null,
  body: unknown,
  format: FrontmatterFormat,
  rawBlock?: string | null
): string {
  const safeBody = typeof body === "string" ? body : String(body ?? "");
  if (frontmatter === null) {
    return safeBody;
  }

  // Untouched frontmatter: replay the original block bytes so every
  // delimiter variant round-trips without re-deriving it from a template.
  if (
    rawBlock !== undefined &&
    rawBlock !== null &&
    rawBlockMatchesFrontmatter(rawBlock, frontmatter, format)
  ) {
    const block = rawBlock.endsWith("\n") ? rawBlock.slice(0, -1) : rawBlock;
    return `${block}\n\n${safeBody.replace(/^\n+/, "")}`;
  }

  if (frontmatter.trim() === "") {
    return safeBody;
  }

  const yamlContent = frontmatter.trim();
  const bodyTrimmed = safeBody.replace(/^\n+/, "");

  if (format === "implicit") {
    return `${yamlContent}\n---\n\n${bodyTrimmed}`;
  }
  return `---\n${yamlContent}\n---\n\n${bodyTrimmed}`;
}
