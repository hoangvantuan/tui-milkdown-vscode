import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";

const codeBlockKey = new PluginKey("code-block-enhancement");

// Clipboard SVG icon (Lucide-style, stroke-based)
const CLIPBOARD_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/></svg>`;

// Checkmark SVG icon
const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// Chevron-down SVG icon
const CHEVRON_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

// Languages available in the dropdown (matches registered lowlight languages)
const LANGUAGES = [
  "text", "javascript", "typescript", "python", "html", "css", "json",
  "bash", "yaml", "markdown", "sql", "java", "cpp", "go", "rust",
  "php", "ruby", "diff", "xml",
];

// Language display name mapping (common aliases)
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  md: "markdown",
  htm: "html",
  plaintext: "text",
};

/**
 * Get display name for a language.
 */
function getLangDisplay(lang: string): string {
  if (!lang) return "text";
  const lower = lang.toLowerCase();
  return LANG_ALIASES[lower] || lower;
}

// AbortController for dropdown close listeners — ensures cleanup on rebuild
let dropdownAbort: AbortController | null = null;

/** Close any open language dropdown and clean up listeners */
function closeDropdown(): void {
  if (dropdownAbort) {
    dropdownAbort.abort();
    dropdownAbort = null;
  }
  const existing = document.querySelector(".code-lang-dropdown");
  if (existing) existing.remove();
}

/**
 * Resolve current codeBlock position from a header widget DOM element.
 * Walks up to find the code block wrapper, then uses view.posAtDOM.
 */
function resolveCodeBlockPos(header: HTMLElement, view: EditorView): number | null {
  // The header widget is inserted at pos+1 (inside codeBlock).
  // Its next sibling or parent should be the codeBlock's DOM node.
  const codeBlockDom = header.parentElement?.querySelector("pre") || header.nextElementSibling;
  if (!codeBlockDom) return null;
  try {
    const pos = view.posAtDOM(codeBlockDom, 0);
    // posAtDOM returns position inside the node; walk up to find codeBlock start
    const resolved = view.state.doc.resolve(pos);
    for (let d = resolved.depth; d >= 0; d--) {
      if (resolved.node(d).type.name === "codeBlock") {
        return resolved.before(d);
      }
    }
  } catch {
    // Position may be invalid
  }
  return null;
}

/**
 * Show language dropdown below the badge element.
 * On selection, updates the codeBlock node's language attribute.
 */
function showLangDropdown(badge: HTMLElement, header: HTMLElement, view: EditorView): void {
  closeDropdown();

  const dropdown = document.createElement("div");
  dropdown.className = "code-lang-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Select language");

  const currentLang = getLangDisplay(badge.textContent?.replace(/\s*$/, "") || "");

  for (const lang of LANGUAGES) {
    const item = document.createElement("div");
    item.className = "code-lang-item";
    item.setAttribute("role", "option");
    if (lang === currentLang) item.classList.add("active");
    item.textContent = lang;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Resolve fresh pos at click time to avoid stale reference
      const nodePos = resolveCodeBlockPos(header, view);
      if (nodePos === null) return;

      const newLang = lang === "text" ? "" : lang;
      const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
        ...view.state.doc.nodeAt(nodePos)?.attrs,
        language: newLang,
      });
      view.dispatch(tr);
      closeDropdown();
    });
    dropdown.appendChild(item);
  }

  // Position relative to badge within editor container
  const rect = badge.getBoundingClientRect();
  const container = view.dom.parentElement;
  const editorRect = container?.getBoundingClientRect() || { left: 0, top: 0 };

  dropdown.style.left = `${rect.left - editorRect.left}px`;
  dropdown.style.top = `${rect.bottom - editorRect.top + 4}px`;

  if (container) {
    (container as HTMLElement).style.position = "relative";
    container.appendChild(dropdown);
  }

  // Close on click outside or Escape — use AbortController for cleanup
  dropdownAbort = new AbortController();
  const { signal } = dropdownAbort;
  setTimeout(() => {
    document.addEventListener("mousedown", () => closeDropdown(), { signal });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeDropdown();
    }, { signal });
  }, 0);
}

/**
 * Create the header widget DOM element for a code block.
 * Contains language badge (left, clickable) and copy button (right).
 * NOTE: Does NOT capture node/pos — resolves fresh state at click time.
 */
function createHeaderWidget(
  initialLang: string,
  view: EditorView,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "code-block-header";
  el.setAttribute("contenteditable", "false");

  // Language badge — safe: textContent + appendChild for SVG (no innerHTML XSS)
  const lang = document.createElement("span");
  lang.className = "code-lang-badge";
  lang.textContent = getLangDisplay(initialLang) + " ";
  // Append chevron SVG as parsed DOM (not innerHTML on user-controlled string)
  const chevronContainer = document.createElement("span");
  chevronContainer.innerHTML = CHEVRON_SVG;
  lang.appendChild(chevronContainer);
  lang.title = "Click to change language";
  lang.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showLangDropdown(lang, el, view);
  });
  el.appendChild(lang);

  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "code-copy-btn";
  copyBtn.innerHTML = CLIPBOARD_SVG;
  copyBtn.title = "Copy code";
  copyBtn.setAttribute("aria-label", "Copy code to clipboard");
  copyBtn.tabIndex = -1;

  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Resolve fresh node content at click time (not stale closure)
    const nodePos = resolveCodeBlockPos(el, view);
    const freshNode = nodePos !== null ? view.state.doc.nodeAt(nodePos) : null;
    const text = freshNode?.textContent || "";

    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: textarea copy for restricted environments
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });

    // Visual feedback: clipboard → checkmark
    copyBtn.innerHTML = CHECK_SVG;
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.innerHTML = CLIPBOARD_SVG;
      copyBtn.classList.remove("copied");
    }, 1500);
  });

  el.appendChild(copyBtn);
  return el;
}

/**
 * Build decoration set with header widgets for all code blocks.
 * Uses stable key based on language + text hash to minimize DOM recreation.
 */
function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  view: EditorView,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      // Skip mermaid code blocks (handled by mermaid-plugin)
      if (node.attrs.language === "mermaid") return;

      const langAttr = node.attrs.language || "";
      const widget = Decoration.widget(
        pos + 1,
        () => createHeaderWidget(langAttr, view),
        { side: -1, key: `cb-header-${langAttr}-${node.textContent.length}` }
      );
      decorations.push(widget);
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Tiptap Extension that enhances code blocks with:
 * - Language badge with dropdown selector (top-left)
 * - Copy button with feedback (top-right, visible on hover)
 *
 * Uses ProseMirror Decoration.widget pattern (same as heading-level-plugin).
 * Only rebuilds decorations on document changes (not selection changes).
 */
export const CodeBlockEnhancement = Extension.create({
  name: "codeBlockEnhancement",

  addProseMirrorPlugins() {
    let viewRef: EditorView | null = null;
    return [
      new Plugin({
        key: codeBlockKey,
        view(editorView) {
          viewRef = editorView;
          return {
            destroy() {
              // Clean up any open dropdown on plugin destroy
              closeDropdown();
            },
          };
        },
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, value) {
            if (!tr.docChanged && value !== DecorationSet.empty) return value;
            if (!viewRef) return DecorationSet.empty;
            return buildDecorations(tr.doc, viewRef);
          },
        },
        props: {
          decorations(state) {
            return codeBlockKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
