import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import FindAndReplace, {
  FindAndReplacePluginKey,
  findNextIndex,
} from "@tiptap/extension-find-and-replace";

export interface SearchMatchInfo {
  count: number;
  activeIndex: number;
}

// The webview CSP is nonce-only for scripts and browsers hide the nonce
// attribute from the DOM, so the page cannot recover it by itself.
// markdownEditorProvider.ts exposes it on this global before main.js runs.
declare global {
  interface Window {
    __tuiCspNonce?: string;
  }
}

/**
 * Tiptap find-and-replace extension configured for Cmd+F search.
 *
 * - injectCSS is disabled: the theme rules in markdownEditorProvider.ts style
 *   the `find-and-replace-result` / `find-and-replace-result-current`
 *   decoration classes, and the extension's fixed defaults must not override
 *   them. The nonce is still passed so any future re-enabling of injection
 *   stays compatible with the webview CSP.
 * - searchDebounceMs is 0: the search input in main.ts already debounces.
 *   This is also what lets `performSearch` read `storage.findAndReplace`
 *   immediately after `setSearchTerm` — at 0 the term is applied
 *   synchronously, while any positive value defers it to a timeout and the
 *   results read back would be the previous query's.
 * - Replace/regex/whole-word stay at the library level; no UI is exposed.
 */
export const SearchPlugin = FindAndReplace.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-f": () => {
        document.dispatchEvent(new CustomEvent("toggle-search-bar"));
        return true;
      },
      "Mod-h": () => {
        document.dispatchEvent(
          new CustomEvent("toggle-search-bar", {
            detail: { showReplace: true },
          }),
        );
        return true;
      },
    };
  },
}).configure({
  caseSensitive: false,
  searchDebounceMs: 0,
  injectCSS: false,
  injectNonce: typeof window !== "undefined" ? window.__tuiCspNonce : undefined,
});

/**
 * Set or update the search query, highlighting all matches, and select the
 * first match at or after the cursor (wrapping to the first match).
 */
export function performSearch(editor: Editor, queryText: string): void {
  editor.commands.setSearchTerm(queryText);
  if (!queryText) return;
  const { results } = editor.storage.findAndReplace;
  const index = findNextIndex(results, editor.state.selection.from);
  if (index !== null) {
    selectResult(editor, index);
  }
}

/** Set case sensitivity and update search matches. */
export function setCaseSensitivity(editor: Editor, caseSensitive: boolean): void {
  editor.commands.setCaseSensitive(caseSensitive);
  const { results, searchTerm } = editor.storage.findAndReplace;
  if (!searchTerm) return;
  const index = findNextIndex(results, editor.state.selection.from);
  if (index !== null) {
    selectResult(editor, index);
  }
}

/** Get current case sensitivity setting */
export function getCaseSensitivity(editor: Editor): boolean {
  return editor.storage.findAndReplace.caseSensitive;
}

/** Set the replace term in find-and-replace storage */
export function setReplaceTerm(editor: Editor, term: string): void {
  editor.commands.setReplaceTerm(term);
}

/**
 * Replace the currently selected match and jump to the next match.
 * If replaceText is provided, sets the replace term first.
 * Returns true if a replacement occurred.
 */
export function replaceCurrent(editor: Editor, replaceText?: string): boolean {
  if (replaceText !== undefined) {
    editor.commands.setReplaceTerm(replaceText);
  }
  const ok = editor.commands.replace();
  if (ok) {
    scrollSearchMatchIntoView(editor);
  }
  return ok;
}

/**
 * Replace all matches in the document at once.
 * If replaceText is provided, sets the replace term first.
 * Returns true if replacements occurred.
 */
export function replaceAllMatches(editor: Editor, replaceText?: string): boolean {
  if (replaceText !== undefined) {
    editor.commands.setReplaceTerm(replaceText);
  }
  return editor.commands.replaceAll();
}

/** Clear all search highlights */
export function clearSearch(editor: Editor): void {
  editor.commands.clearSearch();
}

/** Navigate to the next match */
export function searchNext(editor: Editor): void {
  if (editor.commands.goToNextResult()) {
    scrollSearchMatchIntoView(editor);
  }
}

/** Navigate to the previous match */
export function searchPrev(editor: Editor): void {
  if (editor.commands.goToPreviousResult()) {
    scrollSearchMatchIntoView(editor);
  }
}

/**
 * Move the active match (decoration + selection) without triggering
 * ProseMirror's scroll-to-selection: that path bails when DOM focus sits
 * outside the editor (prosemirror-view scrollToSelection), which is exactly
 * the state during search because focus stays in the search input. Manual
 * centring below is the only reliable scroll in that state.
 */
function selectResult(editor: Editor, index: number): void {
  const result = editor.storage.findAndReplace.results[index];
  if (!result) return;
  const { dispatch, state } = editor.view;
  const tr = state.tr;
  tr.setSelection(TextSelection.create(state.doc, result.from, result.to));
  tr.setMeta(FindAndReplacePluginKey, { currentIndex: index });
  dispatch(tr);
  scrollSearchMatchIntoView(editor);
}

function scrollSearchMatchIntoView(editor: Editor): void {
  if (typeof requestAnimationFrame === "undefined") return;
  requestAnimationFrame(() => {
    try {
      const { head } = editor.view.state.selection;
      const coords = editor.view.coordsAtPos(head);
      const container = editor.view.dom.closest("#editor-container") ??
        document.getElementById("editor-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const offset = coords.top - centerY;
      if (Math.abs(offset) > 10) {
        container.scrollTop += offset;
      }
    } catch { /* position may be invalid during concurrent edits */ }
  });
}

/**
 * Get current match count and active match index.
 * Both values come straight from the extension's plugin storage, which
 * tracks the active index itself; no position inference is done here.
 */
export function getMatchInfo(editor: Editor): SearchMatchInfo {
  const { results, currentIndex } = editor.storage.findAndReplace;
  const count = results.length;
  if (count === 0) return { count: 0, activeIndex: 0 };
  return { count, activeIndex: (currentIndex ?? 0) + 1 };
}
