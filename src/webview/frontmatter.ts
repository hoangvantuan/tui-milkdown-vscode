// src/webview/frontmatter.ts
import yaml from "js-yaml";

// Re-export shared logic so existing imports in main.ts keep working
export {
  parseContent,
  reconstructContent,
  type ParseResult,
  type FrontmatterFormat,
} from "../utils/frontmatter-parser";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  line?: number;
}

export function validateYaml(content: string): ValidationResult {
  if (!content || content.trim() === "") {
    return { isValid: true };
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
