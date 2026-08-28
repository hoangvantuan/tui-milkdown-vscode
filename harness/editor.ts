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
 */
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Highlight } from "@tiptap/extension-highlight";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Document } from "@tiptap/extension-document";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Markdown } from "@tiptap/markdown";
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
import {
  parseContent,
  reconstructContent,
} from "../src/utils/frontmatter-parser";

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

// Mirror of BlankLineHandler in src/webview/main.ts.
const BlankLineHandler = Extension.create({
  name: "blankLineHandler",
  markdownTokenName: "space",
  parseMarkdown(token: any, helpers: any) {
    const newlines = (token.raw?.match(/\n/g) || []).length;
    const emptyCount = newlines - 2;
    if (emptyCount <= 0) return [];
    return Array.from({ length: emptyCount }, () =>
      helpers.createNode("paragraph", undefined, []),
    );
  },
});

function buildMarkdownExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      paragraph: false,
      document: false,
      blockquote: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      },
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
    Image.configure({
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
    CodeBlockLowlight.configure({
      lowlight,
      enableTabIndentation: true,
      tabSize: 2,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Markdown.configure({
      indentation: { style: "space", size: 2 },
      markedOptions: {
        gfm: true,
        breaks: false,
      },
    }),
    AlertNode,
    EscapeToken,
    BlankLineHandler,
    WikiLink,
  ];
}

/**
 * Roundtrip one markdown document through the editor, the same way the webview
 * loads and saves it: parse frontmatter out, feed the body to the editor with
 * contentType 'markdown', run the post-parse table cell transform, serialize
 * back with getMarkdown(), then reattach the untouched frontmatter.
 *
 * Returns the serialized document. Observes nothing but the resulting string.
 */
export function roundtripMarkdown(source: string): string {
  const parsed = parseContent(source);

  const host = document.createElement("div");
  document.body.appendChild(host);

  const editor = new Editor({
    element: host,
    extensions: buildMarkdownExtensions(),
    content: parsed.body,
    contentType: "markdown",
  });

  try {
    transformTableCellsAfterParse(editor);
    const body = editor.getMarkdown();
    return reconstructContent(parsed.frontmatter, body, parsed.format, parsed.rawBlock);
  } finally {
    editor.destroy();
    host.remove();
  }
}
