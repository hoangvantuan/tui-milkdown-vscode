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
   * Exact original text from the start of the document up to the first body
   * character: the frontmatter block (delimiters included) plus whatever
   * blank-line gap followed it (none, one, or several). Null when the
   * document has no frontmatter. Reconstruction replays these bytes verbatim
   * while the frontmatter stays untouched, so empty delimiters,
   * blank-line-only blocks, implicit separators, trailing whitespace on
   * delimiter lines and the original block-to-body gap all survive a save
   * round-trip. The gap is folded in here (not left in `body`) because a
   * body re-serialized by the editor loses its leading newlines.
   */
  rawBlock?: string | null;
}

const FRONTMATTER_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const EMPTY_FRONTMATTER_REGEX = /^---[ \t]*\n---[ \t]*(?:\n|$)/;
const IMPLICIT_SEPARATOR_REGEX = /\n---[ \t]*(?:\n|$)/;
// Like the parse regexes, but anchored on both ends and tolerant of the
// trailing blank-line gap rawBlock carries after the closing delimiter.
const RAW_STANDARD_BLOCK_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n*$/;
const RAW_EMPTY_BLOCK_REGEX = /^---[ \t]*\n---[ \t]*\n*$/;
const RAW_IMPLICIT_SEPARATOR_REGEX = /^\n---[ \t]*\n*$/;

function leadingNewlines(text: string): string {
  return text.match(/^\n*/)![0];
}

/**
 * A raw block may only be replayed when it still embeds the current
 * frontmatter text; after a metadata-panel edit the stale block must be
 * ignored and reconstruction falls back to the canonical template. The
 * YAML-interior comparison below is that guard; the trailing `\n*`
 * tolerance in the structural regexes only absorbs the blank-line gap the
 * block owns and lets no additional stale shape through.
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
    return {
      rawYaml,
      body,
      raw: rawYaml + sepMatch[0] + leadingNewlines(body),
    };
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
    const body = markdown.slice(emptyMatch[0].length);
    return {
      frontmatter: "",
      body,
      isValid: true,
      format: "standard",
      rawBlock: emptyMatch[0] + leadingNewlines(body),
    };
  }

  // 2. Standard frontmatter (---\n...\n---)
  const stdMatch = markdown.match(FRONTMATTER_REGEX);
  if (stdMatch) {
    const rawYaml = stdMatch[1];
    const body = markdown.slice(stdMatch[0].length);
    const rawBlock = stdMatch[0] + leadingNewlines(body);
    if (isBlankOrCommentOnly(rawYaml)) {
      return { frontmatter: rawYaml, body, isValid: true, format: "standard", rawBlock };
    }
    try {
      yaml.load(rawYaml);
      return { frontmatter: rawYaml, body, isValid: true, format: "standard", rawBlock };
    } catch (err) {
      return {
        frontmatter: rawYaml,
        body,
        isValid: false,
        error: err instanceof Error ? err.message : "Invalid YAML",
        format: "standard",
        rawBlock,
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

  // Untouched frontmatter: replay the original block bytes — including the
  // exact blank-line gap the file had between block and body (none, one, or
  // several) — so every delimiter variant round-trips without re-deriving
  // it from a template. Leading newlines on the body are editor-serialization
  // noise; the authoritative gap is the one rawBlock carries.
  if (
    rawBlock !== undefined &&
    rawBlock !== null &&
    rawBlockMatchesFrontmatter(rawBlock, frontmatter, format)
  ) {
    return rawBlock + safeBody.replace(/^\n+/, "");
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
