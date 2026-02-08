import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core';

/** Collapse whitespace within a single inline segment */
function cleanInline(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Render inline content of a node via helpers */
function renderInline(node: JSONContent, h: MarkdownRendererHelpers): string {
  return cleanInline(h.renderChildren(node));
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
    .map(seg => seg.length === 0 ? '' : cleanInline(h.renderChildren({ type: 'paragraph', content: seg } as JSONContent)))
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
      case 'bulletList': {
        for (const item of child.content || []) {
          const text = renderListItemText(item, h);
          if (text) parts.push(`- ${text}`);
        }
        break;
      }
      case 'orderedList': {
        let num = (child.attrs?.start as number) || 1;
        for (const item of child.content || []) {
          const text = renderListItemText(item, h);
          if (text) { parts.push(`${num}. ${text}`); num++; }
        }
        break;
      }
      case 'taskList': {
        for (const item of child.content || []) {
          const checked = item.attrs?.checked ? 'x' : ' ';
          const text = renderListItemText(item, h);
          if (text) parts.push(`[${checked}] ${text}`);
        }
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

/**
 * Custom table serializer that preserves multi-line cell content.
 * Uses <br> tags for line breaks within GFM table cells.
 */
export function renderTableToMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  if (!node?.content?.length) return '';

  const rows: { text: string; isHeader: boolean }[][] = [];

  for (const rowNode of node.content) {
    const cells: { text: string; isHeader: boolean }[] = [];
    if (rowNode.content) {
      for (const cellNode of rowNode.content) {
        cells.push({
          text: renderCellContent(cellNode, h),
          isHeader: cellNode.type === 'tableHeader',
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

  let out = '';

  // Header row
  const headerTexts = Array.from({ length: colCount }, (_, i) =>
    hasHeader ? (headerRow[i]?.text || '') : ''
  );
  out += `| ${headerTexts.map((t, i) => pad(t, colWidths[i])).join(' | ')} |\n`;

  // Separator
  out += `| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |\n`;

  // Body rows
  const body = hasHeader ? rows.slice(1) : rows;
  for (const r of body) {
    out += `| ${Array.from({ length: colCount }, (_, i) =>
      pad(r[i]?.text || '', colWidths[i])
    ).join(' | ')} |\n`;
  }

  return out;
}
