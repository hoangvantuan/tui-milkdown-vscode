/**
 * Post-parse transformer for table cells.
 *
 * Handles two types of breaks and list patterns in GFM table cells:
 * - Hard break (Enter): `<br>` in markdown → paragraph boundary
 * - Soft break (Shift+Enter): `\n` (literal) in markdown → hardBreak node within paragraph
 * - List patterns: `- item`, `N. item`, `[x] item` → proper list nodes
 *
 * After marked parses GFM table markdown, cell content is a single paragraph
 * with hardBreak nodes (from `<br>`) and literal `\n` text (from `\n`).
 * This module transforms that into proper ProseMirror block structure.
 */
import type { Editor } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';

const BULLET_PREFIX = /^-\s+/;
const ORDERED_PREFIX = /^(\d+)\.\s+/;
const TASK_PREFIX = /^\[([ xX])\]\s+/;
/** Match literal \n (backslash + n) in text */
const SOFT_BREAK_RE = /\\n/;

type SegmentType = 'bullet' | 'ordered' | 'task' | 'text';

interface Segment {
  type: SegmentType;
  nodes: PMNode[];
  checked?: boolean;
  orderStart?: number;
}

/** Split a paragraph's inline content into groups separated by hardBreak nodes (from <br>) */
function splitByHardBreak(para: PMNode): PMNode[][] {
  const segments: PMNode[][] = [[]];
  para.forEach(child => {
    if (child.type.name === 'hardBreak') {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(child);
    }
  });
  return segments.filter(s => s.length > 0);
}

/**
 * Expand literal \n (backslash-n) in text nodes into hardBreak nodes.
 * This converts soft break markers from markdown back into ProseMirror hardBreak nodes.
 */
function expandSoftBreaks(nodes: PMNode[], schema: Schema): PMNode[] {
  const result: PMNode[] = [];
  for (const node of nodes) {
    if (!node.isText || !node.text || !SOFT_BREAK_RE.test(node.text)) {
      result.push(node);
      continue;
    }
    // Split text by literal \n and insert hardBreak between parts
    const parts = node.text.split('\\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        result.push(schema.nodes.hardBreak.create());
      }
      const trimmed = parts[i].trim();
      if (trimmed) {
        result.push(schema.text(trimmed, node.marks));
      }
    }
  }
  return result;
}

/** Strip a prefix of given length from the first text node, preserving marks */
function stripFirstNodePrefix(nodes: PMNode[], prefixLen: number, schema: Schema): PMNode[] {
  if (prefixLen === 0 || nodes.length === 0) return nodes;

  const first = nodes[0];
  if (!first.isText) return nodes;

  const remaining = (first.text || '').substring(prefixLen);
  const result = nodes.slice(1);

  if (remaining) {
    result.unshift(schema.text(remaining, first.marks));
  }
  return result;
}

/** Classify a segment of inline nodes and strip list pattern prefix if found */
function classifyAndStrip(nodes: PMNode[], schema: Schema): Segment {
  if (nodes.length === 0) return { type: 'text', nodes: [] };

  const first = nodes[0];
  if (!first.isText) return { type: 'text', nodes };

  const text = (first.text || '').trimStart();
  const leadingWS = (first.text || '').length - text.length;

  let match = text.match(BULLET_PREFIX);
  if (match) {
    return { type: 'bullet', nodes: stripFirstNodePrefix(nodes, leadingWS + match[0].length, schema) };
  }

  match = text.match(ORDERED_PREFIX);
  if (match) {
    return {
      type: 'ordered',
      nodes: stripFirstNodePrefix(nodes, leadingWS + match[0].length, schema),
      orderStart: parseInt(match[1]),
    };
  }

  match = text.match(TASK_PREFIX);
  if (match) {
    return {
      type: 'task',
      nodes: stripFirstNodePrefix(nodes, leadingWS + match[0].length, schema),
      checked: match[1].toLowerCase() === 'x',
    };
  }

  return { type: 'text', nodes };
}

/** Build a list node (bulletList/orderedList/taskList) from grouped segments */
function buildListNode(segments: Segment[], schema: Schema): PMNode | null {
  const type = segments[0].type;

  const listItems = segments.map(seg => {
    // Expand soft breaks (\n → hardBreak) within list item content
    const content = expandSoftBreaks(seg.nodes, schema);
    const para = schema.nodes.paragraph.create(null, content.length > 0 ? content : undefined);
    if (type === 'task') {
      return schema.nodes.taskItem.create({ checked: seg.checked ?? false }, para);
    }
    return schema.nodes.listItem.create(null, para);
  });

  switch (type) {
    case 'bullet': return schema.nodes.bulletList.create(null, listItems);
    case 'ordered': return schema.nodes.orderedList.create({ start: segments[0].orderStart ?? 1 }, listItems);
    case 'task': return schema.nodes.taskList.create(null, listItems);
    default: return null;
  }
}

/** Check if any text node in the cell contains literal \n or if cell has hardBreak */
function cellNeedsTransform(cell: PMNode): boolean {
  let needs = false;
  cell.descendants(node => {
    if (node.type.name === 'hardBreak') needs = true;
    if (node.isText && node.text && SOFT_BREAK_RE.test(node.text)) needs = true;
  });
  // Also check for list patterns in first text node
  if (!needs) {
    const para = cell.firstChild;
    if (para && para.type.name === 'paragraph' && para.firstChild?.isText) {
      const text = (para.firstChild.text || '').trimStart();
      if (BULLET_PREFIX.test(text) || ORDERED_PREFIX.test(text) || TASK_PREFIX.test(text)) {
        needs = true;
      }
    }
  }
  return needs;
}

/** Transform a single table cell's content */
function transformCellContent(cell: PMNode, schema: Schema): PMNode[] | null {
  // Skip cells that already have proper list nodes
  let hasExistingList = false;
  cell.forEach(child => {
    if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
      hasExistingList = true;
    }
  });
  if (hasExistingList) return null;

  if (!cellNeedsTransform(cell)) return null;

  // Only handle single-paragraph cells (how marked parses GFM table cells)
  if (cell.childCount !== 1 || cell.firstChild!.type.name !== 'paragraph') return null;

  const para = cell.firstChild!;
  const rawSegments = splitByHardBreak(para);

  // No hardBreak (no <br>) — single block, check for list pattern and soft breaks
  if (rawSegments.length <= 1) {
    const allNodes: PMNode[] = [];
    para.forEach(n => allNodes.push(n));
    const seg = classifyAndStrip(allNodes, schema);

    if (seg.type === 'text') {
      // No list pattern, but might have soft breaks (\n)
      const expanded = expandSoftBreaks(seg.nodes, schema);
      const hasExpanded = expanded.some(n => n.type.name === 'hardBreak');
      if (!hasExpanded) return null;
      return [schema.nodes.paragraph.create(null, expanded)];
    }

    // Single list item with possible soft breaks
    const content = expandSoftBreaks(seg.nodes, schema);
    const list = buildListNode([{ ...seg, nodes: content }], schema);
    return list ? [list] : null;
  }

  // Multiple segments (from <br> = hard break = paragraph boundaries)
  const classified = rawSegments.map(nodes => classifyAndStrip(nodes, schema));

  // Group consecutive same-type segments into list blocks
  const result: PMNode[] = [];
  let i = 0;

  while (i < classified.length) {
    const seg = classified[i];
    if (seg.type === 'text') {
      if (seg.nodes.length > 0) {
        // Expand soft breaks within text paragraphs
        const content = expandSoftBreaks(seg.nodes, schema);
        result.push(schema.nodes.paragraph.create(null, content));
      }
      i++;
    } else {
      const group: Segment[] = [seg];
      let j = i + 1;
      while (j < classified.length && classified[j].type === seg.type) {
        group.push(classified[j]);
        j++;
      }
      const list = buildListNode(group, schema);
      if (list) result.push(list);
      i = j;
    }
  }

  // Table cell requires at least one block child
  if (result.length === 0) {
    result.push(schema.nodes.paragraph.create());
  }

  return result;
}

/**
 * Transform all table cells after markdown parsing.
 * Converts:
 * - `<br>` (parsed as hardBreak) → paragraph boundaries (hard break)
 * - `\n` (literal text) → hardBreak nodes within paragraph (soft break)
 * - `- item`, `N. item`, `[x] item` → proper list nodes
 *
 * Should be called after setContent/initEditor while isUpdatingFromExtension is true.
 */
export function transformTableCellsAfterParse(editor: Editor): boolean {
  const { state } = editor;
  const { schema } = state;

  const transforms: { pos: number; node: PMNode; newContent: PMNode[] }[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      const newContent = transformCellContent(node, schema);
      if (newContent) {
        transforms.push({ pos, node, newContent });
      }
    }
  });

  if (transforms.length === 0) return false;

  const { tr } = state;
  for (let i = transforms.length - 1; i >= 0; i--) {
    const { pos, node, newContent } = transforms[i];
    tr.replaceWith(pos + 1, pos + node.nodeSize - 1, newContent);
  }

  editor.view.dispatch(tr);
  return true;
}
