/**
 * Marker-preserving Tiptap extensions.
 *
 * Each extension captures original syntax markers from MarkedJS token.raw
 * during parse, and reproduces them during serialize.
 * Fallback: getDocStyle() from document-style-detector (Layer 2).
 */
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Bold } from '@tiptap/extension-bold';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { getDocStyle } from './document-style-detector';
import { renderTableToMarkdown } from './table-markdown-serializer';

// ① BulletList — preserve '*' / '-' / '+'
export const BulletListPreserve = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), marker: { default: null, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    if (token.ordered) return;
    const raw = token.items?.[0]?.raw || '';
    const marker = raw.match(/^\s*([-*+])\s/)?.[1] || null;
    return helpers.createNode('bulletList', { marker },
      helpers.parseChildren(token.items || []));
  },
  renderMarkdown(node: any, h: any) {
    const marker = node.attrs?.marker || getDocStyle().bullet;
    const content = h.renderChildren(node);
    if (marker !== '-') {
      return content.replace(/^(\s*)- /gm, `$1${marker} `);
    }
    return content;
  },
});

// ② OrderedList — preserve delimiter '.' / ')'
export const OrderedListPreserve = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), delimiter: { default: null, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    if (!token.ordered) return;
    const raw = token.items?.[0]?.raw || '';
    const delimiter = raw.match(/^\s*\d+([.)])\s/)?.[1] || null;
    return helpers.createNode('orderedList',
      { start: token.start || 1, delimiter },
      helpers.parseChildren(token.items || []));
  },
  renderMarkdown(node: any, h: any) {
    const content = h.renderChildren(node);
    const delimiter = node.attrs?.delimiter;
    if (delimiter === ')') {
      return content.replace(/^(\s*\d+)\. /gm, '$1) ');
    }
    return content;
  },
});

// ③ Heading — preserve closing hashes (## Title ##)
export const HeadingPreserve = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), closingHashes: { default: false, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    const raw = (token.raw || '').trimEnd();
    const hasClosing = /^#+\s.+\s#+$/.test(raw);
    return helpers.createNode('heading',
      { level: token.depth, closingHashes: hasClosing },
      helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node: any, h: any) {
    const level = node.attrs?.level || 1;
    const hashes = '#'.repeat(level);
    const content = h.renderChildren(node);
    const closing = node.attrs?.closingHashes ? ` ${hashes}` : '';
    return `${hashes} ${content}${closing}`;
  },
});

// ④ HorizontalRule — preserve '---' / '***' / '___'
export const HorizontalRulePreserve = HorizontalRule.extend({
  addAttributes() {
    return { marker: { default: null, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    const raw = (token.raw || '').trim();
    return helpers.createNode('horizontalRule', { marker: raw || null });
  },
  renderMarkdown(node: any) {
    return node.attrs?.marker || getDocStyle().hr;
  },
});

// ⑤ CodeBlock — preserve fence char ('`' / '~') and fence length
export function createCodeBlockPreserve(lowlight: any, config: Record<string, any> = {}) {
  return CodeBlockLowlight.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        fenceChar: { default: null, rendered: false },
        fenceLength: { default: null, rendered: false },
      };
    },
    parseMarkdown(token: any, helpers: any) {
      const raw = token.raw || '';
      const m = raw.match(/^(`{3,}|~{3,})/);
      return helpers.createNode('codeBlock', {
        language: token.lang || '',
        fenceChar: m?.[1]?.[0] || null,
        fenceLength: m?.[1]?.length || null,
      }, [helpers.createTextNode(token.text || '')]);
    },
    renderMarkdown(node: any, h: any) {
      const char = node.attrs?.fenceChar || getDocStyle().fence;
      const len = Math.max(node.attrs?.fenceLength || 3, 3);
      const fence = char.repeat(len);
      const lang = node.attrs?.language || '';
      const code = h.renderChildren(node);
      return `${fence}${lang}\n${code}\n${fence}`;
    },
  }).configure({ lowlight, ...config });
}

// ⑥ Italic — preserve '*' / '_'
export const ItalicPreserve = Italic.extend({
  addAttributes() {
    return { marker: { default: null, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    const marker = token.raw?.[0] === '_' ? '_' : '*';
    return helpers.applyMark('italic',
      helpers.parseInline(token.tokens || []),
      { marker });
  },
  renderMarkdown(node: any, h: any) {
    const marker = node.attrs?.marker;
    if (!marker) {
      console.warn('[fidelity] Italic mark attrs.marker undefined — falling back to docStyle');
    }
    const effectiveMarker = marker || getDocStyle().emphasis;
    const content = h.renderChildren(node);
    return `${effectiveMarker}${content}${effectiveMarker}`;
  },
});

// ⑦ Bold — preserve '**' / '__'
export const BoldPreserve = Bold.extend({
  addAttributes() {
    return { marker: { default: null, rendered: false } };
  },
  parseMarkdown(token: any, helpers: any) {
    const marker = token.raw?.startsWith('__') ? '__' : '**';
    return helpers.applyMark('bold',
      helpers.parseInline(token.tokens || []),
      { marker });
  },
  renderMarkdown(node: any, h: any) {
    const marker = node.attrs?.marker;
    if (!marker) {
      console.warn('[fidelity] Bold mark attrs.marker undefined — falling back to docStyle');
    }
    const effectiveMarker = marker || getDocStyle().strong;
    const content = h.renderChildren(node);
    return `${effectiveMarker}${content}${effectiveMarker}`;
  },
});

// ⑧ Table — preserve alignment markers + compact style
export const TablePreserve = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      compact: { default: false, rendered: false },
      alignments: { default: null, rendered: false },
    };
  },
  parseMarkdown(token: any, helpers: any) {
    const raw = token.raw || '';
    const lines = raw.split('\n').filter((l: string) => l.trim());

    // Detect compact: no spaces around pipes in header row
    const compact = lines[0] ? /\|[^\s|]/.test(lines[0]) : false;

    // Detect alignment from separator row (line 2)
    const sepLine = lines[1] || '';
    const sepCells = sepLine.split('|').filter((s: string) => s.trim());
    const alignments = sepCells.map((cell: string) => {
      const t = cell.trim();
      if (t.startsWith(':') && t.endsWith(':')) return 'center';
      if (t.endsWith(':')) return 'right';
      if (t.startsWith(':')) return 'left';
      return null;
    });

    return helpers.createNode('table', { compact, alignments },
      helpers.parseChildren(token.tokens || []));
  },
  renderMarkdown(node: any, h: any) {
    let result = renderTableToMarkdown(node, h);

    const alignments = node.attrs?.alignments as (string | null)[] | null;
    const compact = node.attrs?.compact || false;

    // Apply alignment markers to separator row
    if (alignments?.some((a: string | null) => a !== null)) {
      const lines = result.split('\n');
      const sepIdx = lines.findIndex((l: string) => /^\|[\s-:]+\|/.test(l));
      if (sepIdx >= 0) {
        const parts = lines[sepIdx].split('|').slice(1, -1);
        const aligned = parts.map((cell: string, i: number) => {
          const dashes = cell.trim();
          const align = alignments[i];
          if (align === 'center') return ` :${dashes.slice(1, -1)}: `;
          if (align === 'right') return ` ${dashes.slice(0, -1)}: `;
          if (align === 'left') return ` :${dashes.slice(1)} `;
          return cell;
        });
        lines[sepIdx] = `|${aligned.join('|')}|`;
        result = lines.join('\n');
      }
    }

    // Compact mode: strip padding spaces
    if (compact) {
      result = result
        .replace(/\| +/g, '|')
        .replace(/ +\|/g, '|');
    }

    return result;
  },
}).configure({ resizable: true });
