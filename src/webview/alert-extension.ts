/**
 * GitHub-style Alert extension for Tiptap.
 *
 * Renders `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`
 * as styled alert blocks instead of plain blockquotes.
 *
 * Integration strategy:
 *   - AlertNode defines the `alert` node type in the ProseMirror schema
 *   - The Blockquote extension from StarterKit is extended (in main.ts) to
 *     override its `parseMarkdown` so it detects `[!TYPE]` and creates an
 *     alert node instead of a blockquote.
 *
 * Markdown syntax:
 *   > [!NOTE]
 *   > Content here
 *
 *   > [!NOTE] Custom title
 *   > Content here
 *
 * The text after the marker on its own line is a title (the Obsidian and
 * GitLab form). It is held as a raw markdown string in the `title` attribute,
 * like math holds its LaTeX, so it is written back byte for byte and the text
 * escaper never sees it. Before it was an attribute, the marker was stripped
 * and the title fell through into the body, so the first save turned
 * `> [!NOTE] Title` into `> [!NOTE]` followed by a body line `Title`.
 * The label is drawn by CSS from `data-alert-title`, falling back to the type
 * name; it is not editable in the view.
 *
 * DOM output:
 *   <div data-alert-type="note" data-alert-title="..." class="alert alert-note">...</div>
 */
import { Node } from "@tiptap/core";

export const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_REGEX = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/** The marker plus the spaces after it, but never the newline: what follows
 *  on the same line is the title. */
const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i;

/**
 * Split the title off the first paragraph's inline tokens.
 *
 * The first line can span several tokens (`[!NOTE] A **bold** title\nbody`
 * is text, strong, text), so tokens are consumed up to the first newline and
 * their `raw` is concatenated: the title is kept as written, markup included.
 * A `br` token also ends the line.
 */
function splitTitle(inline: any[]): { title: string | null; rest: any[] } {
    let title = "";
    const rest: any[] = [];
    let ended = false;

    inline.forEach((tok: any, i: number) => {
        if (ended) {
            rest.push(tok);
            return;
        }
        if (tok.type === "br") {
            ended = true;
            return;
        }
        let raw: string = typeof tok.raw === "string" ? tok.raw : (tok.text ?? "");
        if (i === 0) raw = raw.replace(ALERT_MARKER, "");
        if (tok.type === "text" && raw.includes("\n")) {
            const nl = raw.indexOf("\n");
            title += raw.slice(0, nl);
            const after = raw.slice(nl + 1);
            if (after !== "") rest.push({ ...tok, raw: after, text: after });
            ended = true;
            return;
        }
        title += raw;
    });

    const trimmed = title.trim();
    return { title: trimmed === "" ? null : trimmed, rest };
}

/**
 * Walk blockquote token children to find the first text content.
 * marked produces:
 *   blockquote.tokens = [
 *     { type: "paragraph", tokens: [{ type: "text", text: "[!NOTE]\nrest..." }, ...] }
 *   ]
 */
export function getFirstText(token: any): string | null {
    if (!token.tokens || token.tokens.length === 0) return null;

    for (const child of token.tokens) {
        if (child.type === "paragraph" && child.tokens && child.tokens.length > 0) {
            const first = child.tokens[0];
            if (first.type === "text" && typeof first.text === "string") {
                return first.text;
            }
        }
    }
    return null;
}

/**
 * Return a deep-ish clone of blockquote child tokens with the `[!TYPE]` line
 * removed from the first paragraph, and the title that line carried.
 */
export function stripAlertPrefix(tokens: any[]): { tokens: any[]; title: string | null } {
    if (!tokens || tokens.length === 0) return { tokens, title: null };

    const result: any[] = [];
    let title: string | null = null;
    let stripped = false;

    for (const t of tokens) {
        if (!stripped && t.type === "paragraph" && t.tokens && t.tokens.length > 0) {
            stripped = true;
            const split = splitTitle(t.tokens);
            title = split.title;
            if (split.rest.length === 0) continue; // the paragraph was only the marker line

            const clonedP = { ...t, tokens: split.rest };
            clonedP.text = split.rest.map((tk: any) => tk.text || "").join("");
            clonedP.raw = split.rest.map((tk: any) => tk.raw || tk.text || "").join("");
            result.push(clonedP);
        } else {
            result.push(t);
        }
    }

    return { tokens: result, title };
}

/**
 * AlertNode — a block-level node for GitHub-style alerts.
 * Does NOT register for markdown tokens — see main.ts where the Blockquote
 * extension is extended to handle alert detection.
 */
export const AlertNode = Node.create({
    name: "alert",
    group: "block",
    content: "block+",
    defining: true,

    addAttributes() {
        return {
            type: {
                default: "NOTE",
                parseHTML: (el: HTMLElement) =>
                    (el.getAttribute("data-alert-type") || "NOTE").toUpperCase(),
                rendered: false, // We handle rendering in the main renderHTML
            },
            title: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute("data-alert-title"),
                rendered: false,
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: "div[data-alert-type]",
                getAttrs: (node: HTMLElement) => ({
                    type: (node.getAttribute("data-alert-type") || "NOTE").toUpperCase(),
                    title: node.getAttribute("data-alert-title"),
                }),
            },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        const alertType = ((node.attrs.type as string) || "NOTE").toLowerCase();
        const title = node.attrs.title as string | null;
        return [
            "div",
            {
                ...HTMLAttributes,
                "data-alert-type": alertType,
                ...(title ? { "data-alert-title": title } : {}),
                class: `alert alert-${alertType}`,
            },
            0,
        ];
    },

    // Serialize: > [!TYPE] title\n> content
    renderMarkdown(node: any, h: any) {
        const type = ((node.attrs?.type as string) || "NOTE").toUpperCase();
        const title = node.attrs?.title as string | null;
        const prefix = ">";
        const header = title ? `${prefix} [!${type}] ${title}` : `${prefix} [!${type}]`;

        const children = Array.isArray(node.content) ? node.content : [];
        // A title-only alert holds the placeholder paragraph the parser gave
        // it (the schema wants block+); it writes nothing but the header.
        const onlyEmpty =
            children.length === 1 && children[0].type === "paragraph" && !children[0].content?.length;
        if (children.length === 0 || onlyEmpty) return header;

        const result: string[] = [];
        children.forEach((child: any, i: number) => {
            const childContent = h.renderChildren([child]);
            const lines = childContent.split("\n");
            const linesWithPrefix = lines.map((line: string) => {
                if (line.trim() === "") return prefix;
                return `${prefix} ${line}`;
            });
            if (i === 0) result.push(header);
            result.push(linesWithPrefix.join("\n"));
        });

        return result.join(`\n${prefix}\n`);
    },
});
