/**
 * Placeholder rendering seam for the dependency-verification harness.
 *
 * Why this seam exists: issue #67 carries an acceptance box for "the
 * placeholder no longer flickers while typing in a large document", and that
 * box was previously deferred to a human on the grounds that flicker is a
 * temporal rendering behaviour. Flicker is temporal, but it is not
 * unobservable: a placeholder that flickers is a placeholder whose DOM is
 * being written more often than its state actually changes. That is exactly
 * what a MutationObserver counts, and it counts it without a layout engine,
 * so jsdom is enough.
 *
 * What is observed, per keystroke, on the editor's own DOM subtree:
 *   - how many nodes OTHER than the one being typed into get rewritten
 *     (a placeholder implementation that rebuilds decorations across the
 *     whole document makes ProseMirror re-render untouched paragraphs;
 *     that is the visible flicker in a long document), and
 *   - how many times the `data-placeholder` / `is-empty` markers are
 *     added or removed (a placeholder that settles writes them once per
 *     real state change; one that flickers toggles them repeatedly while
 *     the state stands still).
 *
 * Both numbers are recorded, not judged: the golden pins today's behaviour
 * and a future dependency bump that reintroduces whole-document rewrites
 * shows up as a diff. The counts are DOM facts, not plugin state.
 *
 * The Placeholder extension is configured exactly as `initEditor()` in
 * src/webview/main.ts configures it; it is passed in as an extra extension
 * because the markdown corpus deliberately leaves UI-only extensions out.
 */
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextSelection } from "@tiptap/pm/state";
import { createHarnessEditor } from "./editor";

/** Paragraph count of the "large document" cases. */
const LARGE_DOC_PARAGRAPHS = 300;
/** Characters typed per case, one transaction each, as real typing would. */
const KEYSTROKES = 12;

function largeDocument(options: { emptyParagraphInTheMiddle?: boolean } = {}): string {
  const paragraphs: string[] = ["# Large Document"];
  const middle = Math.floor(LARGE_DOC_PARAGRAPHS / 2);
  for (let i = 1; i <= LARGE_DOC_PARAGRAPHS; i++) {
    paragraphs.push(
      `Paragraph ${i}: filler prose that exists only to give the document ` +
        "enough block nodes for a whole-document re-render to be visible.",
    );
    // A blank line between two blank lines parses (via BlankLineHandler) into
    // an empty paragraph — the node a placeholder attaches to.
    if (options.emptyParagraphInTheMiddle && i === middle) paragraphs.push("");
  }
  return paragraphs.join("\n\n") + "\n";
}

interface KeystrokeCounts {
  /** childList/characterData writes inside the paragraph being typed into. */
  typedNode: number;
  /** Same, anywhere else in the document. This is the flicker signal. */
  otherNodes: number;
  /** `data-placeholder` attribute writes. */
  placeholderAttr: number;
  /** class writes that add or drop the `is-empty` marker. */
  emptyClass: number;
}

function emptyCounts(): KeystrokeCounts {
  return { typedNode: 0, otherNodes: 0, placeholderAttr: 0, emptyClass: 0 };
}

/** The block-level element a mutation happened inside, if any. */
function owningBlock(node: Node | null, root: HTMLElement): Element | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === 1) {
      const element = current as Element;
      if (element.parentElement === root) return element;
    }
    current = current.parentNode;
  }
  return null;
}

function classify(
  records: MutationRecord[],
  root: HTMLElement,
  typedBlock: Element | null,
): KeystrokeCounts {
  const counts = emptyCounts();
  for (const record of records) {
    if (record.type === "attributes") {
      if (record.attributeName === "data-placeholder") {
        counts.placeholderAttr++;
        continue;
      }
      if (record.attributeName === "class") {
        const had = (record.oldValue ?? "").includes("is-empty");
        const has = (record.target as Element).classList.contains("is-empty");
        if (had !== has) counts.emptyClass++;
        continue;
      }
    }
    const block = owningBlock(record.target, root);
    if (typedBlock && block === typedBlock) counts.typedNode++;
    else counts.otherNodes++;
  }
  return counts;
}

interface CaseResult {
  label: string;
  note: string;
  perKeystroke: KeystrokeCounts[];
  placeholderVisibleBefore: boolean;
  placeholderVisibleAfter: boolean;
}

/**
 * Type `KEYSTROKES` characters, one transaction each, at `positionOf(doc)`
 * and record what the DOM did between each one.
 */
function runTypingCase(
  label: string,
  note: string,
  content: string,
  positionOf: (editor: any) => number,
): CaseResult {
  const { editor, host, dispose } = createHarnessEditor({
    content,
    contentType: "markdown",
    // Same configuration as initEditor() in src/webview/main.ts.
    extraExtensions: [Placeholder.configure({ placeholder: "Type something..." })],
  });

  try {
    const root = host.querySelector(".ProseMirror") as HTMLElement | null;
    if (!root) throw new Error("editor DOM not mounted");

    const placeholderVisible = () => !!root.querySelector("[data-placeholder]");

    let pos = positionOf(editor);
    // Place the cursor first: Placeholder's default `showOnlyCurrent` renders
    // the placeholder on the node holding the selection, so measuring without
    // moving the cursor would measure a node that never had one.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos),
      ),
    );
    const placeholderVisibleBefore = placeholderVisible();
    const typedBlock = owningBlock(
      editor.view.domAtPos(pos).node as Node,
      root,
    );

    const observer = new MutationObserver(() => {});
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeOldValue: true,
    });

    const perKeystroke: KeystrokeCounts[] = [];
    for (let i = 0; i < KEYSTROKES; i++) {
      const { state, dispatch } = editor.view;
      dispatch(state.tr.insertText("a", pos));
      pos += 1;
      perKeystroke.push(classify(observer.takeRecords(), root, typedBlock));
    }
    observer.disconnect();

    return {
      label,
      note,
      perKeystroke,
      placeholderVisibleBefore,
      placeholderVisibleAfter: placeholderVisible(),
    };
  } finally {
    dispose();
  }
}

function summarize(result: CaseResult): string[] {
  const lines: string[] = [];
  const total = result.perKeystroke.reduce(
    (acc, k) => ({
      typedNode: acc.typedNode + k.typedNode,
      otherNodes: acc.otherNodes + k.otherNodes,
      placeholderAttr: acc.placeholderAttr + k.placeholderAttr,
      emptyClass: acc.emptyClass + k.emptyClass,
    }),
    emptyCounts(),
  );
  const max = result.perKeystroke.reduce(
    (acc, k) => ({
      typedNode: Math.max(acc.typedNode, k.typedNode),
      otherNodes: Math.max(acc.otherNodes, k.otherNodes),
      placeholderAttr: Math.max(acc.placeholderAttr, k.placeholderAttr),
      emptyClass: Math.max(acc.emptyClass, k.emptyClass),
    }),
    emptyCounts(),
  );

  lines.push(`[${result.label}] ${result.note}`);
  lines.push(
    `  placeholder rendered: before=${result.placeholderVisibleBefore} after=${result.placeholderVisibleAfter}`,
  );
  lines.push(`  keystrokes: ${result.perKeystroke.length}`);
  lines.push(
    `  DOM writes in the typed paragraph:  total=${total.typedNode} max-per-keystroke=${max.typedNode}`,
  );
  lines.push(
    `  DOM writes in OTHER paragraphs:     total=${total.otherNodes} max-per-keystroke=${max.otherNodes}`,
  );
  lines.push(
    `  data-placeholder attribute writes:  total=${total.placeholderAttr} max-per-keystroke=${max.placeholderAttr}`,
  );
  lines.push(
    `  is-empty class transitions:         total=${total.emptyClass} max-per-keystroke=${max.emptyClass}`,
  );
  return lines;
}

export function runPlaceholderSeam(): string {
  const large = largeDocument();

  const cases: CaseResult[] = [
    runTypingCase(
      "large-doc-typing-at-end",
      `typing into the last paragraph of a ${LARGE_DOC_PARAGRAPHS}-paragraph document`,
      large,
      (editor) => editor.state.doc.content.size - 1,
    ),
    runTypingCase(
      "large-doc-typing-into-empty-paragraph",
      "typing into an empty paragraph in the middle of a large document (the placeholder-bearing node)",
      largeDocument({ emptyParagraphInTheMiddle: true }),
      (editor) => {
        let target: number | null = null;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (target === null && node.type.name === "paragraph" && node.content.size === 0) {
            target = pos + 1;
          }
        });
        if (target === null) {
          throw new Error("fixture no longer contains an empty paragraph");
        }
        return target;
      },
    ),
    runTypingCase(
      "empty-document-typing",
      "typing the first characters into an empty document (placeholder must disappear once and stay gone)",
      "",
      () => 1,
    ),
  ];

  const out: string[] = [];
  out.push("# placeholder rendering seam");
  out.push("");
  out.push("Per-keystroke DOM writes observed with a MutationObserver on the");
  out.push("editor element. Flicker signature: writes in OTHER paragraphs, or");
  out.push("placeholder markers toggling more than the state actually changes.");
  out.push("");
  for (const result of cases) {
    out.push(...summarize(result));
    out.push("");
  }
  return out.join("\n");
}
