/**
 * Focus Mode: distraction-free writing environment.
 *
 * Hides chrome (#toolbar, TOC sidebar, #reading-progress, backlinks),
 * keeps the active line centred in the viewport (typewriter scrolling),
 * and persists state across reloads.
 *
 * Schedulers for load-time centering MUST use the latched pair
 * `requestAnimationFrame(once)` + `setTimeout(once, 50)`, whichever wins (#112).
 */
import type { Editor } from "@tiptap/core";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): any;
  setState(state: any): void;
};

let currentEditor: Editor | null = null;
let isFocusMode = false;
let exitBtnEl: HTMLElement | null = null;
let toggleBtnEl: HTMLElement | null = null;

const FOCUS_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>`;
const EXIT_FOCUS_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;

/**
 * Center the active cursor line vertically in the editor viewport.
 */
export function centerActiveLine(editor: Editor | null, instant = false): void {
  if (!isFocusMode || !editor?.view) return;

  try {
    const scroller = document.getElementById("editor-container");
    if (!scroller) return;

    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const scrollerRect = scroller.getBoundingClientRect();

    // Calculate vertical offset relative to scroller center
    const cursorViewportY = coords.top - scrollerRect.top;
    const targetScrollTop = scroller.scrollTop + (cursorViewportY - scrollerRect.height / 2);

    scroller.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: instant ? "instant" : "smooth",
    });
  } catch {
    // Selection pos may be transiently out of bounds
  }
}

/**
 * Schedule centering with the latched rAF + setTimeout(50) pair.
 * Necessary for window restoration/unfocused webviews where rAF will not fire.
 */
export function scheduleLatchedCentering(editor: Editor | null): void {
  if (!editor) return;

  let fired = false;
  let rafId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (fired) return;
    fired = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timerId !== null) clearTimeout(timerId);
    centerActiveLine(editor, true);
  };

  rafId = requestAnimationFrame(run);
  timerId = setTimeout(run, 50);
}

/**
 * Toggle focus mode on/off.
 */
export function setFocusMode(
  active: boolean,
  vscode: ReturnType<typeof acquireVsCodeApi>,
  editor?: Editor | null,
): void {
  isFocusMode = active;
  document.body.classList.toggle("focus-mode", active);
  toggleBtnEl?.classList.toggle("is-active", active);

  if (exitBtnEl) {
    exitBtnEl.classList.toggle("hidden", !active);
  }

  vscode.setState({ ...vscode.getState(), focusMode: active });

  if (active) {
    const ed = editor || currentEditor;
    scheduleLatchedCentering(ed);
  }
}

/**
 * Check if focus mode is currently active.
 */
export function isFocusModeActive(): boolean {
  return isFocusMode;
}

/**
 * Handle editor transactions to keep active line centered.
 */
export function handleFocusModeTransaction(editor: Editor): void {
  if (!isFocusMode) return;
  centerActiveLine(editor, false);
}

/**
 * Setup focus mode UI buttons and restore saved state.
 */
export function setupFocusMode(
  editor: Editor,
  vscode: ReturnType<typeof acquireVsCodeApi>,
): void {
  currentEditor = editor;

  // 1. Add toggle button in toolbar (next to View Source or Appearance)
  const toolbarGroup = document.querySelector("#toolbar .toolbar-group:last-child");
  if (toolbarGroup) {
    toggleBtnEl = document.createElement("button");
    toggleBtnEl.id = "btn-focus";
    toggleBtnEl.className = "toolbar-btn";
    toggleBtnEl.title = "Focus Mode";
    toggleBtnEl.setAttribute("aria-label", "Focus Mode");
    toggleBtnEl.innerHTML = FOCUS_ICON_SVG;

    toggleBtnEl.addEventListener("click", () => {
      setFocusMode(!isFocusMode, vscode, currentEditor);
    });

    // Insert before btn-source or at beginning of the group
    const btnSource = document.getElementById("btn-source");
    if (btnSource) {
      toolbarGroup.insertBefore(toggleBtnEl, btnSource);
    } else {
      toolbarGroup.appendChild(toggleBtnEl);
    }
  }

  // 2. Add floating exit button (visible only in focus mode)
  exitBtnEl = document.createElement("button");
  exitBtnEl.id = "btn-focus-exit";
  exitBtnEl.className = "focus-mode-exit-btn hidden";
  exitBtnEl.title = "Exit Focus Mode";
  exitBtnEl.setAttribute("aria-label", "Exit Focus Mode");
  exitBtnEl.innerHTML = EXIT_FOCUS_ICON_SVG;

  exitBtnEl.addEventListener("click", () => {
    setFocusMode(false, vscode, currentEditor);
  });

  const editorContainer = document.getElementById("editor-container");
  if (editorContainer) {
    editorContainer.appendChild(exitBtnEl);
  } else {
    document.body.appendChild(exitBtnEl);
  }

  // 3. Restore persisted state
  const savedState = vscode.getState();
  if (savedState?.focusMode) {
    setFocusMode(true, vscode, editor);
  }
}
