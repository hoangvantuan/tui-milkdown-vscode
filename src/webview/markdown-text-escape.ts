/**
 * Markdown text escape overrides on MarkdownManager.
 *
 * Why this module exists:
 * Upstream @tiptap/markdown v3.30.1 blindly escapes all characters in [\\`*_[\]~]
 * via `escapeMarkdownSyntax` and double-encodes HTML entities via `encodeHtmlEntities`
 * in `encodeTextForMarkdown`. Furthermore, it does not escape block-starting constructs
 * (like `# ` or `1. `) at the beginning of paragraphs, causing them to change meaning
 * when reopened.
 *
 * This module installs a unified override on MarkdownManager.prototype covering:
 *   1. Footnotes (#101): do not escape `[` and `]` for footnote references `[^label]`
 *      and definition lines `[^label]:`. Unclosed brackets like `[^abc` remain escaped.
 *   2. Ordered task lists (#99): do not escape `[ ]` or `[x]` at the start of an
 *      ordered list item (`1. [ ] unchecked`).
 *      Upstream report: docs/upstream/tiptap-extension-list-99.md
 *   3. HTML entities (#97): do not double-encode `&` if it already begins a valid
 *      named, decimal or hex HTML entity reference (`&copy;`, `&#169;`, `&#xa9;`, etc.).
 *      Upstream report: docs/upstream/tiptap-core-97.md
 *   4. Block construct markers (#100): escape the construct-starting character when a
 *      paragraph, list item, or table cell begins with a block marker (`#{1,6} `,
 *      `\d{1,9}[.)] `, `[-+*] `, `>`, `---`). Mid-line `#` and `1.` are not escaped.
 *      Upstream report: docs/upstream/tiptap-markdown-100.md
 *
 * Hooking mechanism:
 * `MarkdownManager.prototype.renderNodeToMarkdown` tracks an active ancestor stack
 * so `encodeTextForMarkdown` knows the block context (whether it is at the start of
 * an ordered list item, paragraph, or table cell).
 */
import { MarkdownManager } from '@tiptap/markdown';

// Flag to guarantee idempotent installation
const INSTALLED = Symbol.for('tuiMarkdown.markdownTextEscapeInstalled');

// Matches valid named, decimal, and hex HTML entities
// Examples: &copy; &nbsp; &#169; &#xa9; &#xA9; &amp; &lt; &gt; &quot;
const VALID_HTML_ENTITY_REGEX = /&(?!([a-zA-Z][a-zA-Z0-9]*|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

// Combined regex for inline syntax escaping:
// Group 1: Task list checkbox marker at start: `^[([ xX])] `
// Group 2: Footnote reference or definition label: `[^label]` (label: no whitespace or closing bracket)
// Group 3: Default inline special markdown characters: `\`, `` ` ``, `*`, `_`, `[`, `]`, `~`
const INLINE_SYNTAX_REGEX = /(?:^\[([ xX])\](?=[ \t]))|(\[\^[^\s\]]+\])|([\\`*_[\]~])/g;

/**
 * Escapes inline markdown text syntax with special handling for footnotes
 * and ordered task checkboxes.
 */
export function escapeMarkdownSyntaxWithContext(text: string, isOrderedTaskItemStart: boolean): string {
  return text.replace(INLINE_SYNTAX_REGEX, (_match, taskCheck, footnote, special, offset) => {
    if (taskCheck !== undefined) {
      if (isOrderedTaskItemStart && offset === 0) {
        return `[${taskCheck}]`;
      }
      return `\\[${taskCheck}\\]`;
    }
    if (footnote !== undefined) {
      return footnote;
    }
    return `\\${special}`;
  });
}

/**
 * Encode text for markdown serialization according to the four rules (#97, #99, #100, #101).
 */
export function customEncodeTextForMarkdown(
  text: string,
  node: any,
  parentNode: any,
  ancestorStack: any[],
  currentNodes?: any[],
): string {
  const nodes = currentNodes || parentNode?.content || [];
  const isFirstChild = Boolean(nodes.length > 0 && nodes[0] === node);
  const hasOpeningMarks = Boolean(node.marks && node.marks.length > 0);
  const isBlockParent = Boolean(
    parentNode &&
    (parentNode.type === 'paragraph' ||
      parentNode.type === 'table' ||
      parentNode.type === 'tableCell' ||
      parentNode.type === 'tableHeader')
  );
  const isBlockStart = isFirstChild && !hasOpeningMarks && isBlockParent;

  let isOrderedTaskItemStart = false;
  if (isBlockStart && parentNode.type === 'paragraph' && ancestorStack.length >= 3) {
    const listItem = ancestorStack[ancestorStack.length - 2];
    const orderedList = ancestorStack[ancestorStack.length - 3];
    if (listItem?.type === 'listItem' && orderedList?.type === 'orderedList' && listItem.content?.[0] === parentNode) {
      isOrderedTaskItemStart = /^\[([ xX])\](?=[ \t])/.test(text);
    }
  }

  // Layer 1: HTML entity encoding (#97, docs/upstream/tiptap-core-97.md)
  // Encode & to &amp; unless it already begins a valid entity reference.
  // Encode < to &lt;.
  // Encode > to &gt;, unless at block start where it represents a blockquote marker to be escaped as \>.
  let s = text.replace(VALID_HTML_ENTITY_REGEX, '&amp;').replace(/</g, '&lt;');
  if (isBlockStart && /^>/.test(s)) {
    s = '>' + s.slice(1).replace(/>/g, '&gt;');
  } else {
    s = s.replace(/>/g, '&gt;');
  }

  // Layer 2: Inline syntax & bracket escaping (#101 footnotes, #99 ordered task list)
  s = escapeMarkdownSyntaxWithContext(s, isOrderedTaskItemStart);

  // Layer 3: Block construct markers (#100, docs/upstream/tiptap-markdown-100.md)
  if (isBlockStart) {
    s = s
      .replace(/^(#{1,6})(?=[ \t]|$)/, '\\$1')
      .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
      .replace(/^([-+])(?=[ \t]|$)/, '\\$1')
      .replace(/^>/, '\\>')
      .replace(/^---/, '\\---');
  }

  return s;
}

/**
 * Install the text escape overrides onto MarkdownManager.prototype. Idempotent.
 */
export function installMarkdownTextEscape(): void {
  const proto = MarkdownManager.prototype as any;
  if (proto[INSTALLED]) {
    return;
  }
  proto[INSTALLED] = true;

  const origRenderNodeToMarkdown = proto.renderNodeToMarkdown;
  proto.renderNodeToMarkdown = function (node: any, parentNode: any, index: any, level: any, meta: any) {
    if (!this._ancestorStack) {
      this._ancestorStack = [];
    }
    this._ancestorStack.push(node);
    try {
      return origRenderNodeToMarkdown.call(this, node, parentNode, index, level, meta);
    } finally {
      this._ancestorStack.pop();
    }
  };

  const origRenderNodesWithMarkBoundaries = proto.renderNodesWithMarkBoundaries;
  proto.renderNodesWithMarkBoundaries = function (nodes: any, parentNode: any, separator: any, level: any) {
    const prevNodes = this._currentNodes;
    this._currentNodes = nodes;
    try {
      return origRenderNodesWithMarkBoundaries.call(this, nodes, parentNode, separator, level);
    } finally {
      this._currentNodes = prevNodes;
    }
  };

  proto.encodeTextForMarkdown = function (text: string, node: any, parentNode?: any): string {
    const isInsideCode =
      (parentNode?.type != null && this.codeTypes.has(parentNode.type)) ||
      (node.marks || []).some((m: any) => this.codeTypes.has(typeof m === 'string' ? m : m.type));

    if (isInsideCode) {
      return text;
    }

    const stack = this._ancestorStack || [];
    const currentNodes = this._currentNodes;
    return customEncodeTextForMarkdown(text, node, parentNode, stack, currentNodes);
  };

  proto.escapeMarkdownSyntax = function (text: string): string {
    return escapeMarkdownSyntaxWithContext(text, false);
  };
}

