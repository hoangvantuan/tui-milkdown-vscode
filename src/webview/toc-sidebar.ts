import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface TocEntry {
  text: string;
  level: number;
  pos: number;
  children: TocEntry[];
}

// Extract flat list of headings from ProseMirror document
function extractHeadings(doc: ProseMirrorNode): TocEntry[] {
  const entries: TocEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      entries.push({
        text: node.textContent || "(empty)",
        level: node.attrs.level as number,
        pos,
        children: [],
      });
    }
  });
  return entries;
}

// Build nested tree from flat heading list using stack-based approach
export function buildTocTree(flat: TocEntry[]): TocEntry[] {
  const root: TocEntry[] = [];
  const stack: TocEntry[] = [];

  for (const entry of flat) {
    const item: TocEntry = { ...entry, children: [] };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    stack.push(item);
  }
  return root;
}

// Render TOC tree to DOM
function renderTree(
  container: HTMLElement,
  items: TocEntry[],
  onClickEntry: (pos: number) => void,
): void {
  for (const item of items) {
    const row = document.createElement("div");
    row.className = `toc-entry toc-level-${item.level}`;
    row.dataset.pos = String(item.pos);

    const hasChildren = item.children.length > 0;

    if (hasChildren) {
      const arrow = document.createElement("span");
      arrow.className = "toc-arrow";
      arrow.textContent = "▼";
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        const childContainer = row.nextElementSibling as HTMLElement | null;
        if (!childContainer?.classList.contains("toc-children")) return;
        const collapsed = childContainer.classList.toggle("collapsed");
        arrow.textContent = collapsed ? "▶" : "▼";
      });
      row.appendChild(arrow);
    }

    const label = document.createElement("span");
    label.className = "toc-label";
    label.textContent = item.text;
    label.title = item.text;
    row.appendChild(label);

    row.addEventListener("click", () => onClickEntry(item.pos));
    container.appendChild(row);

    if (hasChildren) {
      const childContainer = document.createElement("div");
      childContainer.className = "toc-children";
      renderTree(childContainer, item.children, onClickEntry);
      container.appendChild(childContainer);
    }
  }
}

// State
let cachedHeadings: TocEntry[] = [];
let cachedTree: TocEntry[] = [];
let tocContainer: HTMLElement | null = null;
let tocEditor: Editor | null = null;

// Click handler: focus editor at heading position, scroll to top of viewport
function scrollToHeading(pos: number): void {
  if (!tocEditor) return;
  try {
    const doc = tocEditor.state.doc;
    const docSize = doc.content.size;
    if (pos < 0 || pos >= docSize) return;

    // Verify target is still a heading node — positions may be stale after debounce window
    const node = doc.nodeAt(pos);
    if (!node || node.type.name !== "heading") return;

    const safePos = Math.min(pos + 1, docSize);
    tocEditor.commands.focus(safePos);

    // Use nodeDOM to get the actual heading block element (not an inline child)
    const headingDom = tocEditor.view.nodeDOM(pos);
    const el = headingDom instanceof HTMLElement ? headingDom : null;
    if (el) {
      // Delay to run after focus() scroll settles, offset 60px from top for breathing room
      requestAnimationFrame(() => {
        const scroller = document.getElementById("editor-container");
        if (scroller) {
          const elRect = el.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          const targetTop = elRect.top - scrollerRect.top + scroller.scrollTop - 60;
          scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        } else {
          el.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      });
    }
  } catch {
    // Position may be invalid after doc change
  }
}

function renderFullToc(): void {
  if (!tocContainer) return;
  tocContainer.innerHTML = "";

  if (cachedHeadings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "toc-empty";
    empty.textContent = "No headings";
    tocContainer.appendChild(empty);
    return;
  }

  renderTree(tocContainer, cachedTree, scrollToHeading);
}

// Update active heading highlight based on cursor position
function updateActive(cursorPos: number): void {
  if (!tocContainer) return;

  // Find closest heading before cursor
  let activePos = -1;
  for (const h of cachedHeadings) {
    if (h.pos <= cursorPos) activePos = h.pos;
    else break;
  }

  const entries = Array.from(tocContainer.querySelectorAll(".toc-entry"));
  for (const el of entries) {
    const pos = parseInt((el as HTMLElement).dataset.pos || "-1", 10);
    el.classList.toggle("active", pos === activePos);
  }

  // Scroll active entry into view within sidebar
  const activeEl = tocContainer.querySelector(".toc-entry.active");
  if (activeEl) {
    activeEl.scrollIntoView({ block: "nearest" });
  }
}

// Main setup function — called once from main.ts
export function setupTocSidebar(
  editor: Editor,
  container: HTMLElement,
): void {
  tocEditor = editor;
  tocContainer = container;

  cachedHeadings = extractHeadings(editor.state.doc);
  cachedTree = buildTocTree(cachedHeadings);
  renderFullToc();
}

// Debounce TOC rebuild to avoid full DOM rebuild on every keystroke
let tocRebuildTimer: ReturnType<typeof setTimeout> | null = null;
const TOC_REBUILD_DEBOUNCE = 200;

// Called from onTransaction — debounces rebuild, updates active immediately
export function updateTocFromEditor(editor: Editor, docChanged: boolean): void {
  tocEditor = editor;
  if (!tocContainer) return;

  if (docChanged) {
    if (tocRebuildTimer) clearTimeout(tocRebuildTimer);
    tocRebuildTimer = setTimeout(() => {
      cachedHeadings = extractHeadings(editor.state.doc);
      cachedTree = buildTocTree(cachedHeadings);
      renderFullToc();
      updateActive(editor.state.selection.from);
      tocRebuildTimer = null;
    }, TOC_REBUILD_DEBOUNCE);
  }

  const { from } = editor.state.selection;
  updateActive(from);
}

