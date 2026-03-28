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

/** Find the range of top-level nodes belonging to a heading's section. */
function getSectionRange(
  doc: Node,
  headingPos: number,
  headingLevel: number,
): { from: number; to: number } | null {
  let sectionStart = -1;
  let pastHeading = false;

  for (let i = 0, offset = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (offset === headingPos) {
      pastHeading = true;
      offset += child.nodeSize;
      continue;
    }
    if (pastHeading) {
      if (sectionStart === -1) sectionStart = offset;
      if (child.type.name === "heading" && (child.attrs.level as number) <= headingLevel) {
        return { from: sectionStart, to: offset };
      }
    }
    offset += child.nodeSize;
  }

  if (sectionStart === -1) return null;
  return { from: sectionStart, to: doc.content.size };
}

/** Single-pass: compute heading keys AND decorations together. */
function computeKeysAndDecorations(
  doc: Node,
  collapsed: Set<string>,
): { headingKeys: Map<number, string>; decorations: DecorationSet } {
  const headingKeys = new Map<number, string>();
  const decorations: Decoration[] = [];
  const seen = new Map<string, number>();

  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;

    // Compute stable key
    const level = node.attrs.level as number;
    const text = node.textContent || "(empty)";
    const base = `H${level}:${text}`;
    const idx = seen.get(base) || 0;
    seen.set(base, idx + 1);
    const key = `${base}:${idx}`;
    headingKeys.set(offset, key);

    const isCollapsed = collapsed.has(key);

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

    // Indicator on collapsed heading itself + hide section content
    if (isCollapsed) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: "heading-collapsed-indicator",
        }),
      );

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

  return { headingKeys, decorations: DecorationSet.create(doc, decorations) };
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
            const { headingKeys, decorations } = computeKeysAndDecorations(editorState.doc, collapsed);
            return { collapsed, headingKeys, decorations };
          },
          apply(tr: Transaction, value: CollapsePluginState): CollapsePluginState {
            const meta = tr.getMeta(collapsePluginKey) as CollapseMeta | undefined;

            if (meta?.type === "toggle") {
              const next = new Set(value.collapsed);
              if (next.has(meta.key)) next.delete(meta.key);
              else next.add(meta.key);
              const { headingKeys, decorations } = computeKeysAndDecorations(tr.doc, next);
              return { collapsed: next, headingKeys, decorations };
            }

            if (meta?.type === "restore") {
              const collapsed = new Set(meta.keys);
              const { headingKeys, decorations } = computeKeysAndDecorations(tr.doc, collapsed);
              return { collapsed, headingKeys, decorations };
            }

            if (!tr.docChanged) return value;
            const { headingKeys, decorations } = computeKeysAndDecorations(tr.doc, value.collapsed);
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
