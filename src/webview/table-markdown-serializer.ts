/**
 * Custom GFM table serializer, wired into `Table.extend({ renderMarkdown })`
 * in main.ts.
 *
 * Why not the upstream @tiptap/markdown table serializer: it flattens lists
 * inside table cells to plain text. This one keeps bullet / ordered / task
 * lists and multi-line cells (as `<br>`), and pads columns for aligned
 * output. The reverse direction (cell text -> lists / paragraphs) lives in
 * table-cell-content-parser.ts.
 *
 * Literal pipes inside cell text are escaped as `\|` so they do not split cells on subsequent roundtrips.
 *
 * Column alignment markers (`:--`, `:-:`, `--:`) are preserved. The alignment is
 * read from the cell's `align` attribute, which @tiptap/extension-table already
 * parses from the separator row and renders back as `style="text-align: ..."`;
 * this file only has to put it back into the separator row on save.
 */
import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core';

/**
 * Escape unescaped literal pipes in table cells (including inside code spans)
 * so that subsequent GFM table parsing does not split the cell.
 */
function escapeCellPipes(text: string): string {
  return text.replace(/(\\*)(\|)/g, (match, backslashes, pipe) => {
    if (backslashes && backslashes.length % 2 === 1) {
      return match;
    }
    return (backslashes || '') + '\\' + pipe;
  });
}

/** Collapse whitespace within a single inline segment */
function cleanInline(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Render inline content of a node via helpers */
function renderInline(node: JSONContent, h: MarkdownRendererHelpers): string {
  return escapeCellPipes(cleanInline(h.renderChildren(node)));
}

/**
 * Render a paragraph that may contain hardBreak nodes.
 * hardBreak (Shift+Enter = soft break) serializes as \n (newline, soft break convention for roundtrip).
 * Paragraph separation (Enter = hard break) is handled by the caller with <br>.
 */
function renderCellParagraph(para: JSONContent, h: MarkdownRendererHelpers): string {
  if (!para.content) return '';

  const hasHardBreak = para.content.some(c => c.type === 'hardBreak');
  if (!hasHardBreak) {
    return renderInline(para, h);
  }

  // Split inline content by hardBreak, join with \n (soft break for roundtrip)
  const segments: JSONContent[][] = [[]];
  for (const child of para.content) {
    if (child.type === 'hardBreak') {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(child);
    }
  }

  return segments
    .map(seg => seg.length === 0 ? '' : renderInline({ type: 'paragraph', content: seg } as JSONContent, h))
    .filter(s => s)
    .join('\\n');
}

/** Render a list item's paragraph content as inline text */
function renderListItemText(item: JSONContent, h: MarkdownRendererHelpers): string {
  if (!item.content) return '';
  return item.content
    .filter(c => c.type === 'paragraph')
    .map(c => renderInline(c, h))
    .join(' ');
}

/**
 * Render a list and its nested sub-lists into cell parts separated by <br>.
 * Supports bulletList, orderedList, and taskList at any nesting depth.
 */
function renderListToParts(listNode: JSONContent, h: MarkdownRendererHelpers, parts: string[]): void {
  if (listNode.type === 'bulletList') {
    for (const item of listNode.content || []) {
      const text = renderListItemText(item, h);
      if (text) parts.push(`- ${text}`);
      for (const sub of item.content || []) {
        if (sub.type === 'bulletList' || sub.type === 'orderedList' || sub.type === 'taskList') {
          renderListToParts(sub, h, parts);
        }
      }
    }
  } else if (listNode.type === 'orderedList') {
    let num = (listNode.attrs?.start as number) || 1;
    for (const item of listNode.content || []) {
      const text = renderListItemText(item, h);
      if (text) { parts.push(`${num}. ${text}`); num++; }
      for (const sub of item.content || []) {
        if (sub.type === 'bulletList' || sub.type === 'orderedList' || sub.type === 'taskList') {
          renderListToParts(sub, h, parts);
        }
      }
    }
  } else if (listNode.type === 'taskList') {
    for (const item of listNode.content || []) {
      const checked = item.attrs?.checked ? 'x' : ' ';
      const text = renderListItemText(item, h);
      if (text) parts.push(`[${checked}] ${text}`);
      for (const sub of item.content || []) {
        if (sub.type === 'bulletList' || sub.type === 'orderedList' || sub.type === 'taskList') {
          renderListToParts(sub, h, parts);
        }
      }
    }
  }
}

/**
 * Render a cell's content. For cells with multiple block children,
 * uses <br> tags to preserve line breaks in GFM table format.
 * Handles hardBreak nodes within paragraphs (Shift+Enter = soft break).
 */
function renderCellContent(cellNode: JSONContent, h: MarkdownRendererHelpers): string {
  if (!cellNode.content?.length) return '';

  // Single paragraph - render (may contain \n for soft breaks)
  if (cellNode.content.length === 1 && cellNode.content[0].type === 'paragraph') {
    return renderCellParagraph(cellNode.content[0], h);
  }

  // Multiple children - join with <br> (hard break = paragraph separation)
  const parts: string[] = [];

  for (const child of cellNode.content) {
    switch (child.type) {
      case 'paragraph': {
        const text = renderCellParagraph(child, h);
        if (text) parts.push(text);
        break;
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        renderListToParts(child, h, parts);
        break;
      }
      default: {
        const text = renderInline(child, h);
        if (text) parts.push(text);
        break;
      }
    }
  }

  return parts.join(' <br> ');
}

type TableCellAlignment = 'left' | 'center' | 'right';

/** Normalize cell alignment value to 'left' | 'center' | 'right' | null */
function normalizeAlignment(value: unknown): TableCellAlignment | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'left' || lower === 'center' || lower === 'right') {
    return lower;
  }
  return null;
}

/**
 * Format a separator cell with alignment markers (:--, :-:, --:, ---),
 * scaled to the column width.
 */
function formatSeparatorCell(align: TableCellAlignment | null, width: number): string {
  const w = Math.max(3, width);
  switch (align) {
    case 'left':
      return `:${'-'.repeat(w - 1)}`;
    case 'center':
      return `:${'-'.repeat(w - 2)}:`;
    case 'right':
      return `${'-'.repeat(w - 1)}:`;
    default:
      return '-'.repeat(w);
  }
}

/**
 * Custom table serializer that preserves multi-line cell content and column alignment.
 * Uses <br> tags for line breaks within GFM table cells.
 */
export function renderTableToMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  if (!node?.content?.length) return '';

  const rows: { text: string; isHeader: boolean; align: TableCellAlignment | null }[][] = [];

  for (const rowNode of node.content) {
    const cells: { text: string; isHeader: boolean; align: TableCellAlignment | null }[] = [];
    if (rowNode.content) {
      for (const cellNode of rowNode.content) {
        cells.push({
          text: renderCellContent(cellNode, h),
          isHeader: cellNode.type === 'tableHeader',
          align: normalizeAlignment(cellNode.attrs?.align),
        });
      }
    }
    rows.push(cells);
  }

  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  if (colCount === 0) return '';

  // Column widths (min 3 for separator dashes)
  const colWidths = new Array(colCount).fill(3);
  for (const r of rows) {
    for (let i = 0; i < colCount; i++) {
      const len = (r[i]?.text || '').length;
      if (len > colWidths[i]) colWidths[i] = len;
    }
  }

  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const headerRow = rows[0];
  const hasHeader = headerRow?.some(c => c.isHeader) ?? false;

  const colAlignments: Array<TableCellAlignment | null> = Array.from({ length: colCount }, (_, i) => {
    if (hasHeader && headerRow[i]?.align) {
      return headerRow[i].align;
    }
    for (const r of rows) {
      if (r[i]?.align) return r[i].align;
    }
    return null;
  });

  let out = '';

  // Header row
  const headerTexts = Array.from({ length: colCount }, (_, i) =>
    hasHeader ? (headerRow[i]?.text || '') : ''
  );
  out += `| ${headerTexts.map((t, i) => pad(t, colWidths[i])).join(' | ')} |\n`;

  // Separator
  out += `| ${colWidths.map((w, i) => formatSeparatorCell(colAlignments[i], w)).join(' | ')} |\n`;

  // Body rows
  const body = hasHeader ? rows.slice(1) : rows;
  for (const r of body) {
    out += `| ${Array.from({ length: colCount }, (_, i) =>
      pad(r[i]?.text || '', colWidths[i])
    ).join(' | ')} |\n`;
  }

  return out;
}
