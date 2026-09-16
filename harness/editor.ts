/**
 * Markdown roundtrip harness — editor factory.
 *
 * Builds a Tiptap editor whose markdown-relevant extension set mirrors
 * `initEditor()` in src/webview/main.ts. The seam under test is the public
 * string-in / string-out boundary: content goes in through
 * `new Editor({ content, contentType: 'markdown' })` plus the same
 * post-parse table transform the webview applies, and comes out through
 * `editor.getMarkdown()`. Nothing here inspects editor internals, node
 * structures, decoration sets or plugin state.
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
 *
 * EscapeToken, BlankLineHandler and the Blockquote/Document/Paragraph extends
 * below are mirrors of the definitions inside src/webview/main.ts. When
 * editing those in main.ts, update the mirrors here in the same change.
 *
 * MarkdownLink and MarkdownImage are NOT mirrors: they are imported from
 * src/webview/markdown-destination.ts, the same module main.ts uses, so the
 * destination-escaping the goldens pin is the code that actually ships.
 */
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  MarkdownLink,
  MarkdownImage,
} from "../src/webview/markdown-destination";
import { Highlight } from "@tiptap/extension-highlight";
import { Underline } from "@tiptap/extension-underline";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Document } from "@tiptap/extension-document";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Markdown, MarkdownManager, extractAbsorbedBlankLines } from "@tiptap/markdown";
import { Marked } from "marked";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import diff from "highlight.js/lib/languages/diff";
import shell from "highlight.js/lib/languages/shell";
import plaintext from "highlight.js/lib/languages/plaintext";
import { renderTableToMarkdown } from "../src/webview/table-markdown-serializer";
import { transformTableCellsAfterParse } from "../src/webview/table-cell-content-parser";
import {
  AlertNode,
  ALERT_REGEX,
  ALERT_TYPES,
  getFirstText,
  stripAlertPrefix,
} from "../src/webview/alert-extension";
import { WikiLink } from "../src/webview/wiki-link-plugin";
import { RawHtmlBlock, RawHtmlInline } from "../src/webview/raw-html";
import { installMarkdownTextEscape } from "../src/webview/markdown-text-escape";
import { CustomOrderedList } from "../src/webview/ordered-list-extension";
import { ListKeymapExtension } from "../src/webview/list-keymap-extension";
import {
  parseContent,
  reconstructContent,
} from "../src/utils/frontmatter-parser";

// Install unified text escape overrides on MarkdownManager (#97, #99, #100, #101).
installMarkdownTextEscape();

const lowlight = createLowlight();
lowlight.register({
  javascript, typescript, python, xml, css, json,
  bash, yaml, markdown, sql, java, cpp, go, rust,
  php, ruby, diff, shell, plaintext,
});

// Mirror of EscapeToken in src/webview/main.ts.
const EscapeToken = Extension.create({
  name: "escapeToken",
  markdownTokenName: "escape",
  parseMarkdown(token: any, helpers: any) {
    return helpers.createTextNode(token.text || "");
  },
});

// Issue #95: Mirror of MarkdownManager prototype patch in src/webview/main.ts.
const origParseTokens = (MarkdownManager.prototype as any).parseTokens;
(MarkdownManager.prototype as any).parseTokens = function (tokens: any[], parseImplicitEmptyParagraphs = false) {
  const prevTokens = (this as any)._currentTokens;
  const normalizedTokens = parseImplicitEmptyParagraphs ? extractAbsorbedBlankLines(tokens) : tokens;
  (this as any)._currentTokens = normalizedTokens;
  try {
    return origParseTokens.call(this, tokens, parseImplicitEmptyParagraphs);
  } finally {
    (this as any)._currentTokens = prevTokens;
  }
};

(MarkdownManager.prototype as any).createImplicitEmptyParagraphsFromSpace = function (
  token: any,
  previousNonSpaceTokenIndex: number,
  nextNonSpaceTokenIndex: number,
) {
  const newlines = (token.raw?.replace(/\r\n/g, "\n").match(/\n/g) || []).length;
  if (newlines === 0) return [];
  const prevToken = previousNonSpaceTokenIndex >= 0 ? (this as any)._currentTokens?.[previousNonSpaceTokenIndex] : null;
  const prevIsTable = prevToken?.type === "table";
  let emptyCount = 0;
  if (nextNonSpaceTokenIndex === -1) {
    // EOF
    emptyCount = prevIsTable ? Math.max(0, newlines - 1) : newlines;
  } else if (previousNonSpaceTokenIndex === -1) {
    // BOF
    emptyCount = Math.max(0, newlines - 2);
  } else {
    // Between blocks
    emptyCount = prevIsTable ? Math.max(0, newlines - 3) : Math.max(0, newlines - 2);
  }
  return Array.from({ length: emptyCount }, () => ({ type: "paragraph", content: [] }));
};

// Mirror of BlankLineHandler in src/webview/main.ts.
//
// Loose list normalization (#91):
// A loose list (`- a\n\n- b`) is serialized back as a tight list (`- a\n- b`).
// This behavior originates upstream in @tiptap/extension-list (bulletList /
// orderedList serializers join child items with '\n', not '\n\n') rather than
// in our own code, so it cannot be customized here.
// Per CONTEXT.md, this is an accepted Normalized change: surface syntax is
// allowed to normalize on first save as long as it reaches a fixed point and
// remains stable from the second save onward, which it does.
const BlankLineHandler = Extension.create({
  name: "blankLineHandler",
  markdownTokenName: "space",
  parseMarkdown(token: any, helpers: any) {
    const newlines = (token.raw?.replace(/\r\n/g, "\n").match(/\n/g) || []).length;
    const emptyCount = newlines - 2;
    if (emptyCount <= 0) return [];
    return Array.from({ length: emptyCount }, () =>
      helpers.createNode("paragraph", undefined, []),
    );
  },
});

// Mirror of CustomUnderline in src/webview/main.ts.
const CustomUnderline = Underline.extend({
  parseHTML() {
    return [
      {
        tag: "ins",
      },
      {
        tag: "u",
      },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (style: any) => (style.includes("underline") ? {} : false),
      },
    ];
  },
  renderMarkdown(node: any, helpers: any) {
    return `<ins>${helpers.renderChildren(node)}</ins>`;
  },
});

// Expands leading tab indentation and tabs after list markers into spaces according
// to 4-space tab stops, avoiding marked list tokenizer bug where `-\ta\n\tcontinuation`
// preserves extra leading spaces and causes continuation lines to detach on subsequent saves.
// Preserves literal tabs inside fenced code blocks.
function expandPrefixTabsInText(src: string): string {
  const lines = src.split("\n");
  let inCodeBlock = false;
  let codeBlockFence = "";

  const result: string[] = [];

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
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    const match = line.match(/^(\s*)(?:([-*+]|\d+[.)])(\s*))?/);
    if (!match || !match[0].includes("\t")) {
      result.push(line);
      continue;
    }

    let col = 0;
    let expanded = "";
    for (let i = 0; i < match[0].length; i++) {
      const ch = match[0][i];
      if (ch === "\t") {
        const numSpaces = 4 - (col % 4);
        expanded += " ".repeat(numSpaces);
        col += numSpaces;
      } else {
        expanded += ch;
        col++;
      }
    }
    result.push(expanded + line.slice(match[0].length));
  }

  return result.join("\n");
}

function createCustomMarked(): any {
  const m = new Marked();
  class CustomLexer extends (m.Lexer as any) {
    lex(src: string) {
      return super.lex(expandPrefixTabsInText(src));
    }
  }
  m.Lexer = CustomLexer as any;
  return m;
}

const customMarked = createCustomMarked();

function buildMarkdownExtensions(
  indentation: { style: "space" | "tab"; size: number } = { style: "space", size: 2 },
  tabSize: number = 2,
) {
  return [
    StarterKit.configure({
      codeBlock: false,
      paragraph: false,
      document: false,
      blockquote: false,
      link: false,
      underline: false,
      orderedList: false, // Replaced by CustomOrderedList below (#109)
    }),
    CustomUnderline,
    MarkdownLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    // Mirror of the alert-detecting Blockquote extend in src/webview/main.ts.
    Blockquote.extend({
      parseMarkdown(token: any, helpers: any) {
        const firstText = getFirstText(token);
        if (firstText) {
          const match = firstText.match(ALERT_REGEX);
          if (match) {
            const alertType = match[1].toUpperCase();
            if ((ALERT_TYPES as readonly string[]).includes(alertType)) {
              const strippedTokens = stripAlertPrefix(token.tokens);
              const children = helpers.parseChildren(strippedTokens);
              return helpers.createNode("alert", { type: alertType }, children);
            }
          }
        }
        return helpers.createNode("blockquote", undefined, helpers.parseChildren(token.tokens || []));
      },
    }),
    // Mirror of the custom Document serializer in src/webview/main.ts.
    Document.extend({
      renderMarkdown(node: any, h: any) {
        if (!node.content) return "";
        const children = Array.isArray(node.content) ? node.content : [];
        let result = "";
        for (const child of children) {
          const isEmpty = child.type === "paragraph" && (!child.content || child.content.length === 0);
          if (isEmpty) {
            result += "\n";
          } else {
            if (result.length > 0) result += "\n\n";
            result += h.renderChildren([child]);
          }
        }
        return result;
      },
    }),
    // Mirror of the custom Paragraph serializer in src/webview/main.ts.
    Paragraph.extend({
      renderMarkdown(node: any, h: any) {
        if (!node) return "";
        const content = Array.isArray(node.content) ? node.content : [];
        if (content.length === 0) return "";
        return h.renderChildren(content);
      },
    }),
    MarkdownImage.configure({
      inline: false,
      allowBase64: true,
    }),
    Highlight,
    Table.extend({
      renderMarkdown(node: any, h: any) {
        return renderTableToMarkdown(node, h);
      },
    }).configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    CodeBlockLowlight.extend({
      // Issue #92: dynamic fence length so nested code blocks (fenced with 3 or more backticks)
      // roundtrip without corruption. Upstream hardcodes 3 backticks.
      renderMarkdown(node: any, h: any) {
        const language = node.attrs?.language || '';
        const text = node.content ? h.renderChildren(node.content) : '';
        const backtickMatches = text.match(/`+/g) || [];
        let maxBackticks = 0;
        for (const m of backtickMatches) {
          if (m.length > maxBackticks) maxBackticks = m.length;
        }
        const fenceLength = Math.max(3, maxBackticks + 1);
        const fence = '`'.repeat(fenceLength);
        return `${fence}${language}\n${text}\n${fence}`;
      },
    }).configure({
      lowlight,
      enableTabIndentation: true,
      tabSize,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CustomOrderedList,
    ListKeymapExtension,
    Markdown.configure({
      marked: customMarked,
      indentation,
      markedOptions: {
        gfm: true,
        breaks: false,
      },
    }),
    AlertNode,
    EscapeToken,
    BlankLineHandler,
    WikiLink,
    RawHtmlBlock,
    RawHtmlInline,
  ];
}

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
      ...buildMarkdownExtensions(options.indentation, options.tabSize),
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
