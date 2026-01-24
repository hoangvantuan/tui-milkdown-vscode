import matter from "gray-matter";

export interface ParsedContent {
  frontmatter: string | null;
  body: string;
  isValid: boolean;
  error?: string;
}

// Max content size for regex operations (1MB)
const MAX_CONTENT_SIZE = 1024 * 1024;

/**
 * Parse markdown content, extracting frontmatter
 */
export function parseContent(markdown: string): ParsedContent {
  // Input validation
  if (!markdown || typeof markdown !== "string") {
    return { frontmatter: null, body: "", isValid: true };
  }

  // Size guard to prevent regex performance issues
  if (markdown.length > MAX_CONTENT_SIZE) {
    return {
      frontmatter: null,
      body: markdown,
      isValid: true,
      error: "Content too large for frontmatter parsing",
    };
  }

  try {
    const parsed = matter(markdown);
    const hasFm = Object.keys(parsed.data).length > 0;

    if (!hasFm) {
      // Check for empty frontmatter (---\n---)
      const emptyMatch = markdown.match(/^---\s*\n---\s*\n?/);
      if (emptyMatch) {
        return {
          frontmatter: "",
          body: markdown.slice(emptyMatch[0].length),
          isValid: true,
        };
      }
      return { frontmatter: null, body: markdown, isValid: true };
    }

    // Extract raw YAML without delimiters
    const rawYaml = matter
      .stringify("", parsed.data)
      .replace(/^---\n/, "")
      .replace(/\n---\s*$/, "")
      .trim();

    return {
      frontmatter: rawYaml,
      body: parsed.content,
      isValid: true,
    };
  } catch (err) {
    // Invalid YAML - try to extract raw frontmatter
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
    if (match) {
      return {
        frontmatter: match[1],
        body: markdown.slice(match[0].length),
        isValid: false,
        error: err instanceof Error ? err.message : "Invalid YAML",
      };
    }
    return { frontmatter: null, body: markdown, isValid: true };
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

  const yaml = frontmatter.trim();
  const bodyTrimmed = safeBody.replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${bodyTrimmed}`;
}

/**
 * Quick check if content has frontmatter
 */
export function hasFrontmatter(markdown: string): boolean {
  if (!markdown || typeof markdown !== "string") {
    return false;
  }
  return matter.test(markdown);
}
