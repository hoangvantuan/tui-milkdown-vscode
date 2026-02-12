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
 * DOM output:
 *   <div data-alert-type="note" class="alert alert-note">...</div>
 */
import { Node } from "@tiptap/core";

export const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_REGEX = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

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
 * Return a deep-ish clone of blockquote child tokens with the `[!TYPE]` prefix
 * stripped from the first paragraph's first text token.
 */
export function stripAlertPrefix(tokens: any[]): any[] {
    if (!tokens || tokens.length === 0) return tokens;

    const result: any[] = [];
    let stripped = false;

    for (const t of tokens) {
        if (!stripped && t.type === "paragraph" && t.tokens && t.tokens.length > 0) {
            const clonedP = { ...t, tokens: [...t.tokens] };
            const first = { ...clonedP.tokens[0] };

            if (first.type === "text" && typeof first.text === "string") {
                let text = first.text.replace(ALERT_REGEX, "");
                // If the text starts with a newline after stripping, remove it
                text = text.replace(/^\n/, "");

                if (text.trim() === "" && clonedP.tokens.length === 1) {
                    // Entire first paragraph was just the tag → skip it
                    stripped = true;
                    continue;
                } else if (text.trim() === "" && clonedP.tokens.length > 1) {
                    // Remove just the text token, keep remaining inline tokens
                    clonedP.tokens = clonedP.tokens.slice(1);
                    if (clonedP.tokens[0]?.type === "text" && typeof clonedP.tokens[0].text === "string") {
                        clonedP.tokens[0] = {
                            ...clonedP.tokens[0],
                            text: clonedP.tokens[0].text.replace(/^\n?\s*/, ""),
                        };
                    }
                } else {
                    first.text = text;
                    first.raw = text;
                    clonedP.tokens[0] = first;
                }

                clonedP.text = clonedP.tokens.map((tk: any) => tk.text || "").join("");
                clonedP.raw = clonedP.tokens.map((tk: any) => tk.raw || tk.text || "").join("");
            }

            result.push(clonedP);
            stripped = true;
        } else {
            result.push(t);
        }
    }

    return result;
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
        };
    },

    parseHTML() {
        return [
            {
                tag: "div[data-alert-type]",
                getAttrs: (node: HTMLElement) => ({
                    type: (node.getAttribute("data-alert-type") || "NOTE").toUpperCase(),
                }),
            },
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        const alertType = ((node.attrs.type as string) || "NOTE").toLowerCase();
        return [
            "div",
            {
                ...HTMLAttributes,
                "data-alert-type": alertType,
                class: `alert alert-${alertType}`,
            },
            0,
        ];
    },

    // Serialize: > [!TYPE]\n> content
    renderMarkdown(node: any, h: any) {
        const type = ((node.attrs?.type as string) || "NOTE").toUpperCase();
        if (!node.content) return "";

        const prefix = ">";
        const result: string[] = [];

        // First "child" is special — prepend "[!TYPE]\n" to it
        const children = Array.isArray(node.content) ? node.content : [];
        children.forEach((child: any, i: number) => {
            const childContent = h.renderChildren([child]);
            const lines = childContent.split("\n");
            const linesWithPrefix = lines.map((line: string) => {
                if (line.trim() === "") return prefix;
                return `${prefix} ${line}`;
            });
            if (i === 0) {
                // Prepend [!TYPE] header line
                result.push(`${prefix} [!${type}]`);
            }
            result.push(linesWithPrefix.join("\n"));
        });

        return result.join(`\n${prefix}\n`);
    },
});
