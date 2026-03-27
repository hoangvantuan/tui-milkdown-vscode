import { Editor, Extension } from "@tiptap/core";
import { search, SearchQuery, findNext, findPrev, setSearchState, getMatchHighlights, getSearchState } from "prosemirror-search";

export interface SearchMatchInfo {
  count: number;
  activeIndex: number;
}

/**
 * Tiptap Extension wrapping prosemirror-search.
 * Provides search decorations and Mod-f intercept.
 */
export const SearchPlugin = Extension.create({
  name: "searchPlugin",

  addProseMirrorPlugins() {
    return [search()];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-f": () => {
        document.dispatchEvent(new CustomEvent("toggle-search-bar"));
        return true;
      },
    };
  },
});

/** Set or update the search query, highlighting all matches */
export function performSearch(editor: Editor, queryText: string): void {
  const query = new SearchQuery({
    search: queryText,
    caseSensitive: false,
  });
  const { dispatch, state } = editor.view;
  dispatch(setSearchState(state.tr, query));
}

/** Clear all search highlights */
export function clearSearch(editor: Editor): void {
  const query = new SearchQuery({ search: "" });
  const { dispatch, state } = editor.view;
  dispatch(setSearchState(state.tr, query));
}

/** Navigate to the next match (ProseMirror command) */
export function searchNext(editor: Editor): void {
  const { state, dispatch } = editor.view;
  findNext(state, dispatch);
}

/** Navigate to the previous match (ProseMirror command) */
export function searchPrev(editor: Editor): void {
  const { state, dispatch } = editor.view;
  findPrev(state, dispatch);
}

/** Get current match count and active match index */
export function getMatchInfo(editor: Editor): SearchMatchInfo {
  const state = editor.view.state;
  const searchState = getSearchState(state);
  if (!searchState || !searchState.query.valid) {
    return { count: 0, activeIndex: 0 };
  }
  const decos = getMatchHighlights(state);
  const allMatches = decos.find();
  const count = allMatches.length;
  if (count === 0) return { count: 0, activeIndex: 0 };

  // Find active match by checking which decoration overlaps the current selection
  const { from } = state.selection;
  let activeIndex = 0;
  for (let i = 0; i < allMatches.length; i++) {
    if (allMatches[i].from <= from && allMatches[i].to >= from) {
      activeIndex = i + 1;
      break;
    }
    if (allMatches[i].from > from) {
      activeIndex = i + 1;
      break;
    }
  }
  if (activeIndex === 0) activeIndex = count;
  return { count, activeIndex };
}
