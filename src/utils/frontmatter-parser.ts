import yaml from "js-yaml";
import { MAX_FILE_SIZE } from "../constants";

export type FrontmatterFormat = "standard" | "implicit" | "none";

export interface ParseResult {
  frontmatter: string | null;
  body: string;
  isValid: boolean;
  error?: string;
  format: FrontmatterFormat;
}

const FRONTMATTER_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const EMPTY_FRONTMATTER_REGEX = /^---[ \t]*\n---[ \t]*(?:\n|$)/;
const IMPLICIT_SEPARATOR_REGEX = /\n---[ \t]*(?:\n|$)/;

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
): { rawYaml: string; body: string } | null {
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
    return { rawYaml, body };
  } catch {
    return null;
  }
}

export function parseContent(markdown: string): ParseResult {
  if (!markdown || typeof markdown !== "string") {
    return { frontmatter: null, body: "", isValid: true, format: "none" };
  }

  if (markdown.length > MAX_FILE_SIZE) {
    return {
      frontmatter: null,
      body: markdown,
      isValid: false,
      error: "Content too large for frontmatter parsing",
      format: "none",
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
    };
  }

  // 2. Standard frontmatter (---\n...\n---)
  const stdMatch = markdown.match(FRONTMATTER_REGEX);
  if (stdMatch) {
    const rawYaml = stdMatch[1];
    const body = markdown.slice(stdMatch[0].length);
    try {
      yaml.load(rawYaml);
      return { frontmatter: rawYaml, body, isValid: true, format: "standard" };
    } catch (err) {
      return {
        frontmatter: rawYaml,
        body,
        isValid: false,
        error: err instanceof Error ? err.message : "Invalid YAML",
        format: "standard",
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
    };
  }

  // 4. No frontmatter
  return { frontmatter: null, body: markdown, isValid: true, format: "none" };
}

export function reconstructContent(
  frontmatter: string | null,
  body: unknown,
  format: FrontmatterFormat
): string {
  const safeBody = typeof body === "string" ? body : String(body ?? "");
  if (frontmatter === null || frontmatter.trim() === "") {
    return safeBody;
  }

  const yamlContent = frontmatter.trim();
  const bodyTrimmed = safeBody.replace(/^\n+/, "");

  if (format === "implicit") {
    return `${yamlContent}\n---\n\n${bodyTrimmed}`;
  }
  return `---\n${yamlContent}\n---\n\n${bodyTrimmed}`;
}
