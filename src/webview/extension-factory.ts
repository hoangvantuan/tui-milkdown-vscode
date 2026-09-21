/**
 * Extension factory: the one place that decides which Markdown rules the
 * editor knows (#143).
 *
 * Both the rich text view (src/webview/main.ts, via #145) and the roundtrip
 * harness (harness/editor.ts) build their editor from this module, so a rule
 * changed here is tested and shipped as the same rule.
 *
 * Node-safe: no browser globals, DOM access, or extension host APIs.
 * DOM-touching extensions (math, footnote, details) are imported here for
 * their parseMarkdown/renderMarkdown hooks; their addNodeView callbacks only
 * execute in a browser context at editor runtime, not at import time.
 *
 * installMarkdownTextEscape() is NOT called here: it stays in its current
 * module and is called once by each entry point (main.ts and harness/editor.ts).
 */
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  MarkdownLink,
  MarkdownImage,
  MarkdownParagraph,
  IMAGE_IS_INLINE,
} from "./markdown-destination";
import { Highlight } from "@tiptap/extension-highlight";
import { Underline } from "@tiptap/extension-underline";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
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
import { renderTableToMarkdown } from "./table-markdown-serializer";
import {
  AlertNode,
  ALERT_REGEX,
  ALERT_TYPES,
  getFirstText,
  stripAlertPrefix,
} from "./alert-extension";
import { WikiLink } from "./wiki-link-plugin";
import { RawHtmlBlock, RawHtmlInline } from "./raw-html";
import { CustomOrderedList } from "./ordered-list-extension";
import { ListKeymapExtension } from "./list-keymap-extension";
import { mathExtensions } from "./math-extension";
import { footnoteExtensions } from "./footnote-extension";
import { htmlMarkExtensions } from "./html-marks";
import { detailsExtensions } from "./details-extension";

// ---------------------------------------------------------------------------
// MarkdownManager prototype patch (#95)
//
// Side effect on first import. An idempotent guard prevents double patching
// when both main.ts and harness/editor.ts (or a future second consumer) run
// in the same process.
// ---------------------------------------------------------------------------
const PATCH_GUARD = Symbol.for("tui-markdown-manager-patched");

if (!(MarkdownManager.prototype as any)[PATCH_GUARD]) {
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

  (MarkdownManager.prototype as any)[PATCH_GUARD] = true;
}

// ---------------------------------------------------------------------------
// Standalone extensions
// ---------------------------------------------------------------------------

// Fix: @tiptap/markdown v3.19.0 drops `escape` tokens from marked parser,
// causing escaped characters like \_ to be silently lost during roundtrip.
export const EscapeToken = Extension.create({
  name: "escapeToken",
  markdownTokenName: "escape",
  parseMarkdown(token: any, helpers: any) {
    return helpers.createTextNode(token.text || "");
  },
});

// Parse marked `space` tokens (blank lines between blocks) as empty paragraphs.
// marked preserves exact newline count in space.raw:
//   "\n\n" (2) = normal paragraph break -> 0 empty paras
//   "\n\n\n" (3) = 1 blank line -> 1 empty para
//   "\n\n\n\n" (4) = 2 blank lines -> 2 empty paras
//
// Loose list normalization (#91):
// A loose list (`- a\n\n- b`) is serialized back as a tight list (`- a\n- b`).
// This behavior originates upstream in @tiptap/extension-list (bulletList /
// orderedList serializers join child items with '\n', not '\n\n') rather than
// in our own code, so it cannot be customized here.
// Per CONTEXT.md, this is an accepted Normalized change: surface syntax is
// allowed to normalize on first save as long as it reaches a fixed point and
// remains stable from the second save onward, which it does.
export const BlankLineHandler = Extension.create({
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

export const CustomUnderline = Underline.extend({
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expands leading tab indentation and tabs after list markers into spaces
 * according to 4-space tab stops, avoiding marked's list tokenizer bug where
 * `-\ta\n\tcontinuation` preserves extra leading spaces and causes
 * continuation lines to detach on subsequent saves.
 * Preserves literal tabs inside fenced code blocks.
 */
export function expandPrefixTabsInText(src: string): string {
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

export function createCustomMarked(): any {
  const m = new Marked();
  class CustomLexer extends (m.Lexer as any) {
    lex(src: string) {
      return super.lex(expandPrefixTabsInText(src));
    }
  }
  m.Lexer = CustomLexer as any;
  return m;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ExtensionFactoryConfig {
  /** List indentation style and size. Defaults to 2-space. */
  indentation?: { style: "space" | "tab"; size: number };
  /** Tab size for code blocks. Defaults to 2. */
  tabSize?: number;
  /**
   * Pre-built lowlight instance. When omitted the factory creates one with
   * the standard language set registered.
   */
  lowlight?: ReturnType<typeof createLowlight>;
}

/** The standard language set registered on a factory-created lowlight. */
const LOWLIGHT_LANGUAGES: Record<string, any> = {
  javascript, typescript, python, xml, css, json,
  bash, yaml, markdown, sql, java, cpp, go, rust,
  php, ruby, diff, shell, plaintext,
};

/**
 * Build the complete set of markdown-relevant Tiptap extensions.
 *
 * Returns an array suitable for `new Editor({ extensions: [...] })`.
 * UI-only extensions (Placeholder, LineHighlight, HeadingLevel, etc.) are
 * NOT included; each consumer adds those itself.
 */
export function buildMarkdownExtensions(config: ExtensionFactoryConfig = {}): any[] {
  const {
    indentation = { style: "space", size: 2 },
    tabSize = 2,
  } = config;

  let ll = config.lowlight;
  if (!ll) {
    ll = createLowlight();
    ll.register(LOWLIGHT_LANGUAGES);
  }

  const customMarked = createCustomMarked();

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
    // Custom Blockquote that detects GitHub-style alerts [!NOTE], [!TIP], etc.
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
    // Custom Document serializer: joins children with '\n\n', but each empty
    // paragraph only adds a single '\n' (one blank line in source).
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
    MarkdownParagraph,
    MarkdownImage.configure({
      inline: IMAGE_IS_INLINE,
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
      // Issue #92: dynamic fence length so nested code blocks (fenced with
      // 3 or more backticks) roundtrip without corruption.
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
      lowlight: ll,
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
    ...mathExtensions,
    ...footnoteExtensions,
    ...htmlMarkExtensions,
    ...detailsExtensions,
  ];
}
