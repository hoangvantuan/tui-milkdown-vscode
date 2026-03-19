import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const collapsePluginKey = new PluginKey("heading-collapse");

interface CollapsePluginState {
  collapsed: Set<string>;
  headingKeys: Map<number, string>;
  decorations: DecorationSet;
}

type CollapseMeta =
  | { type: "toggle"; key: string }
  | { type: "restore"; keys: string[] };

/** Compute stable keys for headings: "H{level}:{text}:{occurrenceIndex}" */
function computeHeadingKeys(doc: Node): Map<number, string> {
  const posToKey = new Map<number, string>();
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent || "(empty)";
      const base = `H${level}:${text}`;
      const idx = seen.get(base) || 0;
      seen.set(base, idx + 1);
      posToKey.set(pos, `${base}:${idx}`);
    }
  });
  return posToKey;
}

/** Find the range of top-level nodes belonging to a heading's section. */
function getSectionRange(
  doc: Node,
  headingPos: number,
  headingLevel: number,
): { from: number; to: number } | null {
  let sectionStart = -1;
  let sectionEnd = -1;
  let pastHeading = false;

  doc.forEach((node, offset) => {
    if (sectionEnd !== -1) return; // already found boundary
    if (offset === headingPos) {
      pastHeading = true;
      return;
    }
    if (!pastHeading) return;

    if (sectionStart === -1) sectionStart = offset;

    if (node.type.name === "heading" && (node.attrs.level as number) <= headingLevel) {
      sectionEnd = offset;
      return;
    }
  });

  if (sectionStart === -1) return null;
  if (sectionEnd === -1) sectionEnd = doc.content.size;
  return sectionStart < sectionEnd ? { from: sectionStart, to: sectionEnd } : null;
}

/** Build decorations: toggle widget per heading + hiding class on collapsed content. */
function computeDecorations(doc: Node, state: Pick<CollapsePluginState, "collapsed" | "headingKeys">): DecorationSet {
  const decorations: Decoration[] = [];
  const { collapsed, headingKeys } = state;

  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;

    const key = headingKeys.get(offset);
    if (!key) return;
    const isCollapsed = collapsed.has(key);
    const level = node.attrs.level as number;

    // Toggle arrow widget (inside heading, before text)
    decorations.push(
      Decoration.widget(
        offset + 1,
        () => {
          const arrow = document.createElement("span");
          arrow.className = `heading-collapse-toggle${isCollapsed ? " collapsed" : ""}`;
          arrow.textContent = isCollapsed ? "▶" : "▼";
          arrow.setAttribute("contenteditable", "false");
          arrow.dataset.headingKey = key;
          return arrow;
        },
        { side: -2 },
      ),
    );

    // Indicator on collapsed heading itself
    if (isCollapsed) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: "heading-collapsed-indicator",
        }),
      );

      // Hide section content nodes
      const range = getSectionRange(doc, offset, level);
      if (range) {
        doc.nodesBetween(range.from, range.to, (child, childPos) => {
          if (childPos < range.from) return true; // skip doc node
          decorations.push(
            Decoration.node(childPos, childPos + child.nodeSize, {
              class: "collapsed-content",
            }),
          );
          return false;
        });
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const HeadingCollapse = Extension.create({
  name: "headingCollapse",

  addProseMirrorPlugins() {
    return [
      new Plugin<CollapsePluginState>({
        key: collapsePluginKey,
        state: {
          init(_, editorState: EditorState): CollapsePluginState {
            const collapsed = new Set<string>();
            const headingKeys = computeHeadingKeys(editorState.doc);
            const decorations = computeDecorations(editorState.doc, { collapsed, headingKeys });
            return { collapsed, headingKeys, decorations };
          },
          apply(tr: Transaction, value: CollapsePluginState): CollapsePluginState {
            const meta = tr.getMeta(collapsePluginKey) as CollapseMeta | undefined;

            if (meta?.type === "toggle") {
              const next = new Set(value.collapsed);
              if (next.has(meta.key)) next.delete(meta.key);
              else next.add(meta.key);
              const keys = tr.docChanged ? computeHeadingKeys(tr.doc) : value.headingKeys;
              const decorations = computeDecorations(tr.doc, { collapsed: next, headingKeys: keys });
              return { collapsed: next, headingKeys: keys, decorations };
            }

            if (meta?.type === "restore") {
              const keys = computeHeadingKeys(tr.doc);
              const collapsed = new Set(meta.keys);
              const decorations = computeDecorations(tr.doc, { collapsed, headingKeys: keys });
              return { collapsed, headingKeys: keys, decorations };
            }

            if (!tr.docChanged) return value;
            const headingKeys = computeHeadingKeys(tr.doc);
            const decorations = computeDecorations(tr.doc, { collapsed: value.collapsed, headingKeys });
            return { collapsed: value.collapsed, headingKeys, decorations };
          },
        },
        props: {
          decorations(state: EditorState): DecorationSet {
            return (collapsePluginKey.getState(state) as CollapsePluginState).decorations;
          },
          handleDOMEvents: {
            click(view: EditorView, event: MouseEvent): boolean {
              const target = event.target as HTMLElement;
              if (!target.classList.contains("heading-collapse-toggle")) return false;
              const key = target.dataset.headingKey;
              if (!key) return false;
              event.preventDefault();
              event.stopPropagation();
              const tr = view.state.tr.setMeta(collapsePluginKey, { type: "toggle", key });
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** Restore collapsed state from saved keys (e.g., vscode.getState). */
export function setCollapsedHeadings(view: EditorView, keys: string[]): void {
  const tr = view.state.tr.setMeta(collapsePluginKey, { type: "restore", keys });
  view.dispatch(tr);
}

/** Get currently collapsed heading keys. */
export function getCollapsedHeadings(state: EditorState): string[] {
  const pluginState = collapsePluginKey.getState(state) as CollapsePluginState | undefined;
  return pluginState ? [...pluginState.collapsed] : [];
}
