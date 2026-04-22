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
    .use(remarkFrontmatter, ["yaml"])
    .parse(markdown) as Root;
}

/**
 * Serialize MDAST back to markdown (Stage 4 bridge for PDF while
 * the legacy string-based PDF parser is still in place).
 * GFM plugin required so tables and task lists survive roundtrip.
 */
export async function mdastToMarkdown(mdast: Root): Promise<string> {
  const [{ unified }, { default: remarkStringify }, { default: remarkGfm }] = await Promise.all([
    import("unified"),
    import("remark-stringify"),
    import("remark-gfm"),
  ]);

  return unified().use(remarkStringify).use(remarkGfm).stringify(mdast) as string;
}

/**
 * djb2 hash (32-bit unsigned, hex).
 * Used to correlate mermaid code blocks with pre-rendered images
 * sent from the webview. Both sides must trim the code identically.
 */
export function hashMermaidCode(code: string): string {
  let h = 5381;
  const trimmed = code.trim();
  for (let i = 0; i < trimmed.length; i++) {
    h = (h << 5) + h + trimmed.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/**
 * Walk the tree and swap `code` nodes with lang="mermaid" for
 * `image` nodes pointing at the matching base64 data URL.
 * Mutates in place.
 *
 * Mermaid blocks without a matching rendered image stay as code
 * blocks (graceful degradation for parse errors in the webview).
 */
export async function replaceMermaidBlocks(
  mdast: Root,
  imageMap: Map<string, string>,
): Promise<void> {
  if (imageMap.size === 0) return;

  const { visit, SKIP } = await import("unist-util-visit");

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
    return SKIP;
  });
}
