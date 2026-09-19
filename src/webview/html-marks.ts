/**
 * HTML whitelist mark extensions (issue #132).
 *
 * Provides dedicated marks for <kbd>, <sub> and <sup> so they render
 * natively in the editor and serialize back to their literal HTML tags.
 */

import { Mark, mergeAttributes } from "@tiptap/core";

export const Kbd = Mark.create({
  name: "kbd",

  parseHTML() {
    return [{ tag: "kbd" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["kbd", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<kbd>${helpers.renderChildren(node)}</kbd>`;
  },
});

export const Subscript = Mark.create({
  name: "subscript",

  excludes: "superscript",

  parseHTML() {
    return [
      { tag: "sub" },
      {
        style: "vertical-align",
        getAttrs: (value: any) => (value === "sub" ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<sub>${helpers.renderChildren(node)}</sub>`;
  },
});

export const Superscript = Mark.create({
  name: "superscript",

  excludes: "subscript",

  parseHTML() {
    return [
      { tag: "sup" },
      {
        style: "vertical-align",
        getAttrs: (value: any) => (value === "super" ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown(node: any, helpers: any) {
    return `<sup>${helpers.renderChildren(node)}</sup>`;
  },
});

export const htmlMarkExtensions = [Kbd, Subscript, Superscript];
