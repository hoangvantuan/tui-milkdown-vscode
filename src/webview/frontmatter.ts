import yaml from "js-yaml";
import { MAX_FILE_SIZE } from "../constants";

export interface ParsedContent {
  frontmatter: string | null;
  body: string;
  isValid: boolean;
  error?: string;
}

// Regex to match frontmatter block: starts with ---, ends with ---
const FRONTMATTER_REGEX = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const EMPTY_FRONTMATTER_REGEX = /^---[ \t]*\n---[ \t]*(?:\n|$)/;


/**
 * Parse markdown content, extracting frontmatter
 */
export function parseContent(markdown: string): ParsedContent {
  // Input validation
  if (!markdown || typeof markdown !== "string") {
    return { frontmatter: null, body: "", isValid: true };
  }

  // Size guard to prevent regex performance issues
  if (markdown.length > MAX_FILE_SIZE) {
    return {
      frontmatter: null,
      body: markdown,
      isValid: true,
      error: "Content too large for frontmatter parsing",
    };
  }

  // Check for empty frontmatter (---\n---)
  const emptyMatch = markdown.match(EMPTY_FRONTMATTER_REGEX);
  if (emptyMatch) {
    return {
      frontmatter: "",
      body: markdown.slice(emptyMatch[0].length),
      isValid: true,
    };
  }

  // Check for frontmatter with content
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: null, body: markdown, isValid: true };
  }

  const rawYaml = match[1];
  const body = markdown.slice(match[0].length);

  // Validate YAML syntax
  try {
    yaml.load(rawYaml);
    return {
      frontmatter: rawYaml,
      body,
      isValid: true,
    };
  } catch (err) {
    return {
      frontmatter: rawYaml,
      body,
      isValid: false,
      error: err instanceof Error ? err.message : "Invalid YAML",
    };
  }
}

/**
 * Reconstruct markdown from frontmatter and body
 */
export function reconstructContent(
  frontmatter: string | null,
  body: string
): string {
  const safeBody = body ?? "";
  if (frontmatter === null || frontmatter.trim() === "") {
    return safeBody;
  }

  const yamlContent = frontmatter.trim();
  const bodyTrimmed = safeBody.replace(/^\n+/, "");
  return `---\n${yamlContent}\n---\n\n${bodyTrimmed}`;
}

/**
 * Quick check if content has frontmatter
 */
export function hasFrontmatter(markdown: string): boolean {
  if (!markdown || typeof markdown !== "string") {
    return false;
  }
  return FRONTMATTER_REGEX.test(markdown) || EMPTY_FRONTMATTER_REGEX.test(markdown);
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  line?: number;
}

/**
 * Validate YAML content syntax
 */
export function validateYaml(content: string): ValidationResult {
  if (!content || content.trim() === "") {
    return { isValid: true }; // Empty is valid (will remove frontmatter)
  }

  try {
    yaml.load(content);
    return { isValid: true };
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      return {
        isValid: false,
        error: err.reason || "Invalid YAML syntax",
        line: err.mark?.line,
      };
    }
    return { isValid: false, error: "Invalid YAML" };
  }
}
