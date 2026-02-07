# Tiptap Markdown Reference

> Package: `@tiptap/markdown` (Beta)
> Parser: MarkedJS (CommonMark compliant, extensible)
> Source: <https://tiptap.dev/docs/editor/markdown>

## Architecture

### Processing Flow

```
Parsing:   Markdown String → MarkedJS Lexer (Tokenization) → Markdown Tokens → Extension Parse Handlers → Tiptap JSON
Serialize: Tiptap JSON → Extension Render Handlers → Markdown String
```

* Tokenizer: scans raw markdown, produces tokens

* Lexer: orchestrates tokenizers sequentially, manages MarkedJS instance

* Token: plain JS object `{ type, raw, text, tokens?, ... }`

* Tiptap JSON: `{ type, attrs?, content?, text?, marks? }` - native ProseMirror format

### Key Concepts

| Term        | Description                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| Token       | JS object from parsed markdown chunk: `{ type: "heading", depth: 2, text: "Hello" }` |
| Tiptap JSON | ProseMirror document format with nodes (block) and marks (inline)                    |
| Tokenizer   | Functions that scan markdown text → tokens                                           |
| Lexer       | Orchestrator applying tokenizers to produce complete token list                      |

## Installation & Setup

```bash
npm install @tiptap/markdown
```

```typescript
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

const editor = new Editor({
  element: document.querySelector('#editor'),
  extensions: [StarterKit, Markdown],
  content: '# Hello World\n\nThis is **Markdown**!',
  contentType: 'markdown', // Required for markdown input
})
```

### Configuration Options

```typescript
Markdown.configure({
  // Indentation for nested structures (lists, etc.)
  indentation: {
    style: 'space', // 'space' | 'tab'
    size: 2,        // number of characters
  },
  // Custom MarkedJS instance
  marked: customMarkedInstance,
  // Or pass options directly
  markedOptions: {
    gfm: true,
    breaks: false,
    pedantic: false,
  },
})
```

## Editor API

### Methods

```typescript
// Get markdown string from editor content
const md = editor.getMarkdown()

// Access MarkdownManager
editor.markdown.parse('# Hello')      // → Tiptap JSON
editor.markdown.serialize(json)        // → Markdown string
editor.markdown.instance               // → MarkedJS instance
```

### Commands

```typescript
// Set content (replace all)
editor.commands.setContent('# New Content', { contentType: 'markdown' })

// Insert at cursor
editor.commands.insertContent('**Bold text**', { contentType: 'markdown' })

// Insert at specific position
editor.commands.insertContentAt(10, '## Heading', { contentType: 'markdown' })

// Replace range
editor.commands.insertContentAt({ from: 10, to: 20 }, '**replacement**', { contentType: 'markdown' })
```

### Content Type Options

```typescript
new Editor({
  content: '# Hello',
  contentType: 'markdown', // 'json' | 'html' | 'markdown' (default: 'json')
})
```

## MarkdownManager API

```typescript
const manager = new MarkdownManager({
  marked?: typeof marked,
  markedOptions?: MarkedOptions,
  indentation?: { style?: 'space' | 'tab', size?: number },
})

manager.hasMarked()                        // → boolean
manager.registerExtension(extension)       // → void
manager.parse(markdown: string)            // → Tiptap JSON document
manager.serialize(content: TiptapJSON)     // → Markdown string
manager.renderNodeToMarkdown(node, parentNode?, index?, level?) // → string
manager.renderNodes(nodes, parentNode?, separator?, level?)     // → string

// Properties
manager.instance         // MarkedJS parser instance
manager.indentCharacter  // ' ' or '\t'
manager.indentString     // e.g. '  ' (2 spaces)
```

## Extension Markdown Spec

Every Tiptap extension can define markdown support via these properties:

```typescript
Node.create({
  name: 'myNode',

  // Token name mapping (when token name differs from extension name)
  markdownTokenName: 'heading',

  // Custom tokenizer for new syntax
  markdownTokenizer: {
    name: string,                              // unique identifier
    level?: 'block' | 'inline',               // token level
    start?: (src: string) => number,           // optimization: index where match might start
    tokenize: (src, tokens, lexer) => MarkdownToken | undefined,
  },

  // Token → Tiptap JSON
  parseMarkdown: (token, helpers) => TiptapJSON | MarkdownParseResult,

  // Tiptap JSON → Markdown string
  renderMarkdown: (node, helpers, context) => string,

  // Additional options
  markdownOptions: {
    indentsContent?: boolean, // increases nesting level for children
  },
})
```

## Parse Helpers

```typescript
helpers.parseInline(tokens: MarkdownToken[])    // inline content → JSONContent[]
helpers.parseChildren(tokens: MarkdownToken[])   // block content → JSONContent[]
helpers.applyMark(markType, content, attrs?)     // apply mark to content
helpers.createTextNode(text, marks?)             // build text node
helpers.createNode(type, attrs?, content?)       // build any node
```

## Render Helpers

```typescript
helpers.renderChildren(nodes, separator?)  // nodes → markdown string
helpers.indent(content: string)            // add indentation based on context
helpers.wrapInBlock(prefix, content)       // prefix each line (e.g. blockquotes '> ')
```

## Render Context

```typescript
context: {
  index: number,     // node position among siblings
  level: number,     // nesting depth
  parentType: string,// parent node type
  metadata: object,  // custom data storage
}
```

## Utility Functions

### Block Spec Generators

```typescript
import { createBlockMarkdownSpec, createAtomBlockMarkdownSpec } from '@tiptap/markdown'

// Block with content (:::name {attrs} ... :::)
createBlockMarkdownSpec({
  nodeName: string,           // required
  name?: string,
  content?: 'block' | 'inline',
  defaultAttributes?: Object,
  allowedAttributes?: string[],
  getContent?: (token) => string,
  parseAttributes?: (str) => Object,
  serializeAttributes?: (attrs) => string,
})

// Self-closing atomic block (:::name {attrs})
createAtomBlockMarkdownSpec({
  nodeName: string,           // required
  name?: string,
  requiredAttributes?: string[],
  defaultAttributes?: Object,
  allowedAttributes?: string[],
  parseAttributes?: (str) => Object,
  serializeAttributes?: (attrs) => string,
})
```

Example markdown: `:::callout {type="warning" title="Important"}\nContent\n:::`

### Inline Spec Generator

```typescript
import { createInlineMarkdownSpec } from '@tiptap/markdown'

createInlineMarkdownSpec({
  nodeName: string,           // required
  name?: string,
  selfClosing?: boolean,
  defaultAttributes?: Object,
  allowedAttributes?: string[],
  getContent?: (node) => string,
  parseAttributes?: (str) => Object,
  serializeAttributes?: (attrs) => string,
})
```

Example: `[mention id="user123" label="John"]` or `[highlight color="yellow"]text[/highlight]`

### Attribute Parsing

```typescript
import { parseAttributes, serializeAttributes } from '@tiptap/markdown'

parseAttributes('.highlight #section-1 color="yellow" bold')
// → { class: 'highlight', id: 'section-1', color: 'yellow', bold: true }

serializeAttributes({ class: 'btn primary', id: 'submit', disabled: true })
// → '.btn.primary #submit disabled'
```

### Nested Content Rendering

```typescript
import { renderNestedMarkdownContent, parseIndentedBlocks } from '@tiptap/markdown'

renderNestedMarkdownContent(node, helpers, prefixOrGenerator, ctx?)
parseIndentedBlocks(src, { itemPattern, extractItemData, createToken, baseIndentSize? }, lexer)
```

## TypeScript Types

```typescript
// Extension configuration
type MarkdownExtensionSpec = {
  markdownTokenName?: string
  markdownTokenizer?: MarkdownTokenizer
  parseMarkdown?: (token, helpers) => MarkdownParseResult
  renderMarkdown?: (node, helpers, context) => string
  markdownOptions?: { indentsContent?: boolean }
}

// Tokenizer definition
type MarkdownTokenizer = {
  name: string
  level?: 'block' | 'inline'
  start?: (src: string) => number
  tokenize: (src: string, tokens: any[], lexer: any) => MarkdownToken | undefined
}

// Token from MarkedJS
type MarkdownToken = {
  type: string
  raw: string
  text?: string
  tokens?: MarkdownToken[]
  [key: string]: any  // custom properties
}

// Parse result
type MarkdownParseResult = JSONContent | JSONContent[] | null

// Helpers
type MarkdownParseHelpers = {
  parseInline: (tokens: MarkdownToken[]) => JSONContent[]
  parseChildren: (tokens: MarkdownToken[]) => JSONContent[]
  createTextNode: (text: string, marks?: any[]) => JSONContent
  createNode: (type: string, attrs?: object, content?: JSONContent[]) => JSONContent
  applyMark: (markType: string, content: JSONContent[], attrs?: object) => MarkdownParseResult
}

type MarkdownRendererHelpers = {
  renderChildren: (nodes: JSONContent | JSONContent[], separator?: string) => string
  wrapInBlock: (prefix: string, content: string) => string
  indent: (content: string) => string
}

type RenderContext = {
  index: number
  level: number
  parentType: string
  metadata: Record<string, any>
}

// Extension options
type MarkdownExtensionOptions = {
  indentation?: { style?: 'space' | 'tab', size?: number }
  marked?: typeof marked
  markedOptions?: MarkedOptions
}
```

## Guides: Custom Extension Patterns

### Pattern 1: Inline Mark (e.g. Highlight `==text==`)

```typescript
import { Mark } from '@tiptap/core'

export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML() { return [{ tag: 'mark' }] },
  renderHTML({ HTMLAttributes }) { return ['mark', HTMLAttributes, 0] },

  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src) => src.indexOf('=='),
    tokenize: (src, tokens, lexer) => {
      const match = /^==([^=]+)==/.exec(src)
      if (!match) return undefined
      return {
        type: 'highlight',
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      }
    },
  },

  parseMarkdown: (token, helpers) => {
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens || []))
  },

  renderMarkdown: (node, helpers) => {
    return `==${helpers.renderChildren(node.content || [])}==`
  },
})
```

### Pattern 2: Block Node (e.g. Admonition `:::type ... :::`)

```typescript
import { Node } from '@tiptap/core'

export const Admonition = Node.create({
  name: 'admonition',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-type'),
        renderHTML: (attrs) => ({ 'data-type': attrs.type }),
      },
    }
  },

  parseHTML() { return [{ tag: 'div[data-admonition]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { 'data-admonition': '', ...HTMLAttributes }, 0] },

  markdownTokenizer: {
    name: 'admonition',
    level: 'block',
    start: (src) => src.indexOf(':::'),
    tokenize: (src, tokens, lexer) => {
      const match = /^:::(\w+)\n([\s\S]*?)\n:::\n?/.exec(src)
      if (!match) return undefined
      return {
        type: 'admonition',
        raw: match[0],
        admonitionType: match[1],
        text: match[2],
        tokens: lexer.blockTokens(match[2]),
      }
    },
  },

  parseMarkdown: (token, helpers) => ({
    type: 'admonition',
    attrs: { type: token.admonitionType || 'note' },
    content: helpers.parseChildren(token.tokens || []),
  }),

  renderMarkdown: (node, helpers) => {
    const type = node.attrs?.type || 'note'
    return `:::${type}\n${helpers.renderChildren(node.content || [])}:::\n\n`
  },
})
```

### Pattern 3: Atomic Inline Node (e.g. Emoji `:name:`)

```typescript
import { Node } from '@tiptap/core'

const emojiMap: Record<string, string> = { smile: '😊', heart: '❤️', thumbsup: '👍', fire: '🔥' }

export const Emoji = Node.create({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() { return { name: { default: 'smile' } } },
  parseHTML() { return [{ tag: 'span[data-emoji]' }] },
  renderHTML({ node }) {
    return ['span', { 'data-emoji': node.attrs.name }, emojiMap[node.attrs.name] || '😊']
  },

  markdownTokenizer: {
    name: 'emoji',
    level: 'inline',
    start: (src) => src.indexOf(':'),
    tokenize: (src) => {
      const match = /^:([a-z0-9_+]+):/i.exec(src)
      if (!match) return undefined
      return { type: 'emoji', raw: match[0], emojiName: match[1] }
    },
  },

  parseMarkdown: (token) => ({
    type: 'emoji',
    attrs: { name: token.emojiName },
  }),

  renderMarkdown: (node) => `:${node.attrs?.name || 'unknown'}:`,
})
```

### Utility-Based Pattern (e.g. Callout with Pandoc syntax)

```typescript
import { Node } from '@tiptap/core'
import { createBlockMarkdownSpec } from '@tiptap/markdown'

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  addAttributes() {
    return { type: { default: 'info' }, title: { default: null } }
  },
  ...createBlockMarkdownSpec({
    nodeName: 'callout',
    defaultAttributes: { type: 'info' },
    allowedAttributes: ['type', 'title'],
  }),
})
// Markdown: :::callout {type="warning" title="Important"}\nContent\n:::
```

## Tokenizer Best Practices

1. **Always anchor regex with** **`^`** - match from string start only
2. **Return** **`undefined`** **on no match** - essential for fallback
3. **Include** **`raw`** **property** - must contain full matched string
4. **Use non-greedy quantifiers** - `+?` and `*?` over greedy
5. **Use** **`start()`** **optimization** - skip irrelevant text portions
6. **Use correct lexer method** - `lexer.inlineTokens()` for inline, `lexer.blockTokens()` for blocks
7. **Test edge cases** - empty content, nesting, unclosed syntax

## Limitations

* Comments unsupported (lost during markdown content replacement)

* Table cells allow only one child node (markdown syntax constraint)

* Beta status - API may change

