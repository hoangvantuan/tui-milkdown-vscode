/**
 * Custom OrderedList extension with corrected continuation-line indentation.
 *
 * Upstream `@tiptap/extension-list` (3.30.1) computes `contentIndent` in its
 * `markdownTokenizer` as:
 *   const contentIndent = indentLevel + marker.length + 1
 *
 * This formula forgets the separator length (e.g. '.' or ')'), so for markers
 * like '2.' or multi-digit markers like '10.', `contentIndent` is 1 less than
 * the true column width. Under-indented and aligned continuation lines retain
 * an extra space on the first markdown parse, which is subsequently stripped on
 * the second parse, preventing fixed-point convergence (#109).
 *
 * We override `markdownTokenizer` on `OrderedList.extend` with a corrected
 * `collectOrderedListItems` that includes separator length and delimiter spacing.
 */
import {
  OrderedList,
  detectMarkerType,
  markerToStart,
  ORDERED_LIST_MARKER_PATTERN,
} from '@tiptap/extension-list';

export const ORDERED_LIST_ITEM_REGEX = new RegExp(
  `^(\\s*)(${ORDERED_LIST_MARKER_PATTERN})([.)])(\\s+)(.*)$`,
);

const INDENTED_LINE_REGEX = /^\s/;

const PARAGRAPH_INTERRUPTERS = {
  heading: /^#{1,6}(?:\s|$)/,
  bulletItem: /^[-+*]\s+/,
  codeFence: /^(?:```|~~~)/,
  blockMath: /^\$\$/,
  thematicBreak: /^(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/,
};

export interface OrderedListItem {
  indent: number;
  number: number;
  type?: string;
  content: string;
  contentLines: string[];
  raw: string;
}

function isOrderedListMarkerLine(line: string): boolean {
  return ORDERED_LIST_ITEM_REGEX.test(line.trimStart());
}

function isBlockContentLine(line: string): boolean {
  const trimmedLine = line.trimStart();

  return (
    PARAGRAPH_INTERRUPTERS.bulletItem.test(trimmedLine) ||
    isOrderedListMarkerLine(trimmedLine) ||
    PARAGRAPH_INTERRUPTERS.heading.test(trimmedLine) ||
    (PARAGRAPH_INTERRUPTERS.thematicBreak.test(trimmedLine) && !trimmedLine.startsWith('-')) ||
    /^>\s?/.test(trimmedLine) ||
    PARAGRAPH_INTERRUPTERS.codeFence.test(trimmedLine) ||
    PARAGRAPH_INTERRUPTERS.blockMath.test(trimmedLine)
  );
}

function interruptsLazyContinuation(line: string): boolean {
  return Object.values(PARAGRAPH_INTERRUPTERS).some(pattern => pattern.test(line));
}

function splitItemContent(contentLines: string[]): {
  paragraphLines: string[];
  blockLines: string[];
} {
  const paragraphLines: string[] = [];
  const blockLines: string[] = [];
  let reachedBlockBoundary = false;

  contentLines.forEach(line => {
    if (reachedBlockBoundary) {
      blockLines.push(line);
      return;
    }

    if (line.trim() === '') {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }

    if (paragraphLines.length > 0 && isBlockContentLine(line)) {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }

    paragraphLines.push(line);
  });

  return {
    paragraphLines,
    blockLines,
  };
}

export function collectOrderedListItems(lines: string[]): [OrderedListItem[], number] {
  const listItems: OrderedListItem[] = [];
  let currentLineIndex = 0;
  let consumed = 0;

  while (currentLineIndex < lines.length) {
    const line = lines[currentLineIndex];
    const match = line.match(ORDERED_LIST_ITEM_REGEX);

    if (!match) {
      break;
    }

    const [, indent, marker, separator, spacing, content] = match;
    const indentLevel = indent.length;
    const number = parseInt(marker, 10);

    const markerType = isNaN(number) ? detectMarkerType(marker) : undefined;
    const itemNumber = isNaN(number) ? markerToStart(marker) : number;

    const itemContentLines = [content];
    let nextLineIndex = currentLineIndex + 1;
    const itemLines = [line];
    let sawBlankLine = false;

    // Collect continuation lines for this item (but NOT nested list items)
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex];
      const nextMatch = nextLine.match(ORDERED_LIST_ITEM_REGEX);

      // If it's another list item (nested or not), stop collecting
      if (nextMatch) {
        break;
      }

      // Check for continuation content (non-list content)
      if (nextLine.trim() === '') {
        // Empty line
        itemLines.push(nextLine);
        itemContentLines.push('');
        sawBlankLine = true;
        nextLineIndex += 1;
      } else if (nextLine.match(INDENTED_LINE_REGEX)) {
        // Indented content: part of this item (but not a list item).
        // Strip the indentation only up to the whitespace that is actually present,
        // so an under-indented line (e.g. a single leading space) keeps its first character.
        const leadingWhitespace = nextLine.length - nextLine.trimStart().length;
        // Fix #109: Include separator.length and spacing.length so multi-digit markers
        // and single-digit markers compute the exact column indent.
        const contentIndent = indentLevel + marker.length + separator.length + spacing.length;
        itemLines.push(nextLine);
        itemContentLines.push(nextLine.slice(Math.min(leadingWhitespace, contentIndent)));
        nextLineIndex += 1;
      } else {
        if (sawBlankLine || interruptsLazyContinuation(nextLine)) {
          break;
        }

        itemLines.push(nextLine);
        itemContentLines.push(nextLine);
        nextLineIndex += 1;
      }
    }

    listItems.push({
      indent: indentLevel,
      number: itemNumber,
      type: markerType,
      content: itemContentLines.join('\n').trim(),
      contentLines: itemContentLines,
      raw: itemLines.join('\n'),
    });

    consumed = nextLineIndex;
    currentLineIndex = nextLineIndex;
  }

  return [listItems, consumed];
}

export function buildNestedStructure(
  items: OrderedListItem[],
  baseIndent: number,
  lexer: any,
): unknown[] {
  const result: unknown[] = [];
  let currentIndex = 0;

  while (currentIndex < items.length) {
    const item = items[currentIndex];

    if (item.indent === baseIndent) {
      const { paragraphLines, blockLines } = splitItemContent(item.contentLines);
      const mainText = paragraphLines.join('\n').trim();

      const tokens: any[] = [];

      if (mainText) {
        tokens.push({
          type: 'paragraph',
          raw: mainText,
          tokens: lexer.inlineTokens(mainText),
        });
      }

      const additionalContent = blockLines.join('\n').trim();
      if (additionalContent) {
        const blockTokens = lexer.blockTokens(additionalContent);
        tokens.push(...blockTokens);
      }

      let lookAheadIndex = currentIndex + 1;
      const nestedItems: OrderedListItem[] = [];

      while (lookAheadIndex < items.length && items[lookAheadIndex].indent > baseIndent) {
        nestedItems.push(items[lookAheadIndex]);
        lookAheadIndex += 1;
      }

      if (nestedItems.length > 0) {
        const nextIndent = Math.min(...nestedItems.map(nestedItem => nestedItem.indent));
        const nestedListItems = buildNestedStructure(nestedItems, nextIndent, lexer);

        tokens.push({
          type: 'list',
          ordered: true,
          start: nestedItems[0].number,
          typeMarker: nestedItems[0].type,
          items: nestedListItems,
          raw: nestedItems.map(nestedItem => nestedItem.raw).join('\n'),
        });
      }

      result.push({
        type: 'list_item',
        raw: item.raw,
        tokens,
      });

      currentIndex = lookAheadIndex;
    } else {
      currentIndex += 1;
    }
  }

  return result;
}

export const CustomOrderedList = OrderedList.extend({
  markdownTokenizer: {
    name: 'orderedList',
    level: 'block',
    start: () => -1,
    tokenize: (src: string, _tokens: any, lexer: any) => {
      const lines = src.split('\n');
      const [listItems, consumed] = collectOrderedListItems(lines);

      if (listItems.length === 0) {
        return undefined;
      }

      const items = buildNestedStructure(listItems, listItems[0].indent, lexer);

      if (items.length === 0) {
        return undefined;
      }

      const startValue = listItems[0]?.number || 1;
      const typeMarker = listItems[0]?.type;

      return {
        type: 'list',
        ordered: true,
        start: startValue,
        typeMarker,
        items,
        raw: lines.slice(0, consumed).join('\n'),
      } as unknown as object;
    },
  },
});
