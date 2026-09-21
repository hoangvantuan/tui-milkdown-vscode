/**
 * Markdown roundtrip harness, editor factory.
 *
 * Builds a Tiptap editor whose markdown-relevant extension set is provided
 * by the shared extension factory (src/webview/extension-factory.ts), the
 * same module the webview uses (#143). No mirror definitions live here.
 *
 * Extensions from initEditor that are deliberately NOT loaded here because
 * they have no effect on markdown parsing or serialization:
 *   - Placeholder, LineHighlight, HeadingLevel, HeadingCollapse,
 *     CodeBlockEnhancement, TableContextMenu, SearchPlugin (UI/decoration only)
 *   - MermaidDiagram (decoration + SVG rendering only; mermaid code blocks are
 *     ordinary codeBlock nodes with language="mermaid", handled by
 *     CodeBlockLowlight)
 *   - FileMention, WikiLinkSuggestion, CodeExitHandler (typing-time behaviour;
 *     the markdown they insert round-trips as plain links / wikiLink nodes)
 */
import { Editor } from "@tiptap/core";
import { buildMarkdownExtensions } from "../src/webview/extension-factory";
import { installMarkdownTextEscape } from "../src/webview/markdown-text-escape";
import { transformTableCellsAfterParse } from "../src/webview/table-cell-content-parser";
import {
  parseContent,
  reconstructContent,
} from "../src/utils/frontmatter-parser";

// Install unified text escape overrides on MarkdownManager (#97, #99, #100, #101).
installMarkdownTextEscape();

/**
 * Detect list indentation style from markdown source text.
 * Used by harness runner to match document indentation when no explicit configuration is provided.
 */
export function detectIndentation(text: string): {
  indentation: { style: "space" | "tab"; size: number };
  tabSize: number;
} {
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBlockFence = "";
  let hasTabList = false;
  let hasTwoSpaceList = false;
  let hasFourSpaceList = false;

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)(```+|~~~+)/);
    if (fenceMatch) {
      const fence = fenceMatch[2];
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockFence = fence[0];
      } else if (fence.startsWith(codeBlockFence)) {
        inCodeBlock = false;
        codeBlockFence = "";
      }
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Tab-indented list item or tab after list marker or tab continuation line
    if (
      /^\t+([-*+]|\d+[.)])\s/.test(line) ||
      /^([-*+]|\d+[.)])\t/.test(line) ||
      /^\t+\S/.test(line)
    ) {
      hasTabList = true;
    }

    if (/^  ([-*+]|\d+[.)])\s/.test(line)) {
      hasTwoSpaceList = true;
    }
    if (/^    ([-*+]|\d+[.)])\s/.test(line)) {
      hasFourSpaceList = true;
    }
  }

  if (hasTabList) {
    return {
      indentation: { style: "tab", size: 1 },
      tabSize: 4,
    };
  }

  if (hasFourSpaceList && !hasTwoSpaceList) {
    return {
      indentation: { style: "space", size: 4 },
      tabSize: 4,
    };
  }

  return {
    indentation: { style: "space", size: 2 },
    tabSize: 2,
  };
}

export interface HarnessEditorOptions {
  /** Initial document content. */
  content: string;
  /** How to interpret `content`. Defaults to markdown, as the webview does. */
  contentType?: "json" | "html" | "markdown";
  /**
   * Extensions appended to the markdown-relevant set. Seams that need a
   * UI extension the markdown path deliberately omits (Placeholder, for
   * example) pass it here instead of widening the shared set.
   */
  extraExtensions?: unknown[];
  /** List indentation style and size. */
  indentation?: { style: "space" | "tab"; size: number };
  /** Tab size for code blocks. */
  tabSize?: number;
}

/**
 * Build an editor mounted on a throwaway host element. The caller owns the
 * lifecycle and must call the returned `dispose()`.
 *
 * Exists so seams other than the markdown string seam (see
 * ./table-colwidth-seam.ts, ./placeholder-seam.ts) can observe the same
 * extension set without duplicating the factory.
 */
export function createHarnessEditor(options: HarnessEditorOptions): {
  editor: Editor;
  host: HTMLElement;
  dispose: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const editor = new Editor({
    element: host,
    extensions: [
      ...buildMarkdownExtensions({
        indentation: options.indentation,
        tabSize: options.tabSize,
      }),
      ...((options.extraExtensions ?? []) as any[]),
    ],
    content: options.content,
    contentType: options.contentType ?? "markdown",
  });

  return {
    editor,
    host,
    dispose: () => {
      editor.destroy();
      host.remove();
    },
  };
}

/**
 * Roundtrip one markdown document through the editor, the same way the webview
 * loads and saves it: parse frontmatter out, feed the body to the editor with
 * contentType 'markdown', run the post-parse table cell transform, serialize
 * back with getMarkdown(), then reattach the untouched frontmatter.
 *
 * Returns the serialized document. Observes nothing but the resulting string.
 */
export function roundtripMarkdown(
  source: string,
  options?: {
    indentation?: { style: "space" | "tab"; size: number };
    tabSize?: number;
  },
): string {
  const parsed = parseContent(source);
  const detected = detectIndentation(parsed.body);
  const indentation = options?.indentation ?? detected.indentation;
  const tabSize = options?.tabSize ?? detected.tabSize;

  const { editor, dispose } = createHarnessEditor({
    content: parsed.body,
    contentType: "markdown",
    indentation,
    tabSize,
  });

  try {
    transformTableCellsAfterParse(editor);
    const body = editor.getMarkdown();
    return reconstructContent(parsed.frontmatter, body, parsed.format, parsed.rawBlock);
  } finally {
    dispose();
  }
}
