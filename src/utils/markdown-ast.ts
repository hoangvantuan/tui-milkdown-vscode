import type { Code, Image, Paragraph, Parent, Root } from "mdast";

/**
 * Shared MDAST pipeline for DOCX/PDF export.
 *
 * Parsing once in the extension host guarantees the two exporters
 * produce the same structure (Stage 3: remove regex-replace drift
 * between webview text and export text).
 */

export async function parseMarkdownToMdast(markdown: string): Promise<Root> {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkFrontmatter }] =
    await Promise.all([
      import("unified"),
      import("remark-parse"),
      import("remark-gfm"),
      import("remark-frontmatter"),
    ]);

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .parse(markdown) as Root;
}

/**
 * djb2 hash (32-bit unsigned, hex).
 *
 * Used to correlate mermaid code blocks with pre-rendered images sent from
 * the webview. Normalizes line endings (CRLF/CR), strips zero-width and
 * bidi formatting chars, and applies Unicode NFC so ProseMirror's
 * `node.textContent` and remark-parse's `node.value` hash identically
 * regardless of platform or invisible-char pastes.
 */
export function hashMermaidCode(code: string): string {
  const normalized = code
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .normalize("NFC")
    .trim();
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = (h << 5) + h + normalized.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/**
 * Count mermaid code blocks in the tree. Used by the caller to detect
 * when some diagrams did not make it through (render race, parse error,
 * or hash mismatch) and surface a warning.
 */
export function countMermaidBlocks(mdast: Root): number {
  let count = 0;
  walkCodeNodes(mdast, (node) => {
    if (node.lang === "mermaid") count++;
  });
  return count;
}

function walkCodeNodes(root: Root, visit: (node: Code) => void): void {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop() as { type?: string; children?: unknown[] } & Partial<Code>;
    if (!node || typeof node !== "object") continue;
    if (node.type === "code") visit(node as Code);
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
}

/**
 * Walk the tree and swap `code` nodes with lang="mermaid" for
 * `image` nodes pointing at the matching base64 data URL.
 * Mutates in place. Returns the number of blocks successfully replaced.
 *
 * Mermaid blocks without a matching rendered image stay as code
 * blocks (graceful degradation for parse errors in the webview).
 */
export async function replaceMermaidBlocks(
  mdast: Root,
  imageMap: Map<string, string>,
): Promise<number> {
  if (imageMap.size === 0) return 0;

  const { visit, SKIP } = await import("unist-util-visit");

  let replaced = 0;

  visit(mdast, "code", (node: Code, index, parent: Parent | null | undefined) => {
    if (!parent || index === undefined || node.lang !== "mermaid") return;

    const url = imageMap.get(hashMermaidCode(node.value));
    if (!url) return;

    const imageNode: Image = {
      type: "image",
      url,
      alt: "Mermaid Diagram",
    };
    // Wrap in a paragraph so the tree remains schema-valid:
    // `code` is block-level, `image` is phrasing and must live inside a paragraph.
    const paragraphNode: Paragraph = {
      type: "paragraph",
      children: [imageNode],
    };
    parent.children[index] = paragraphNode;
    replaced++;
    return SKIP;
  });

  return replaced;
}
