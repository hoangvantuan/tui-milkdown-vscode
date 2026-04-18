/**
 * Searchable font selector combobox for the toolbar.
 * Renders a text input with dropdown list of system fonts,
 * each previewed in its own font face.
 */

const DEFAULT_FONT_VALUE = "";
const DEFAULT_FONT_LABEL = "Default";
const MAX_FILTERED_DISPLAY = 80;

/** Strip characters that break CSS string context */
export function sanitizeFontName(name: string): string {
  return name.replace(/[\\";{}]/g, "");
}

interface FontSelectorState {
  fonts: string[];
  selected: string;
  filtered: string[];
  highlightIndex: number;
  isOpen: boolean;
}

type FontChangeCallback = (fontFamily: string) => void;

export interface FontSelectorAPI {
  setFonts: (fonts: string[]) => void;
  setSelected: (fontFamily: string) => void;
  getSelected: () => string;
  destroy: () => void;
}

/**
 * Initialize a searchable font selector inside the given container element.
 * Returns an API object to control the selector programmatically.
 */
export function initFontSelector(
  container: HTMLElement,
  onFontChange: FontChangeCallback,
): FontSelectorAPI {
  const state: FontSelectorState = {
    fonts: [],
    selected: DEFAULT_FONT_VALUE,
    filtered: [],
    highlightIndex: -1,
    isOpen: false,
  };

  // Build DOM structure
  const wrapper = document.createElement("div");
  wrapper.className = "font-selector";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "font-selector-input";
  input.placeholder = DEFAULT_FONT_LABEL;
  input.setAttribute("aria-label", "Font family");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.spellcheck = false;
  input.autocomplete = "off";

  const dropdown = document.createElement("div");
  dropdown.className = "font-selector-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);
  container.appendChild(wrapper);

  // --- Helpers ---

  function getDisplayName(fontFamily: string): string {
    return fontFamily || DEFAULT_FONT_LABEL;
  }

  function updateFiltered(query: string): void {
    const q = query.toLowerCase().trim();
    if (!q) {
      state.filtered = [DEFAULT_FONT_VALUE, ...state.fonts];
    } else {
      // Prefix matches first, then contains matches
      const prefix: string[] = [];
      const contains: string[] = [];
      for (const f of state.fonts) {
        const lower = f.toLowerCase();
        if (lower.startsWith(q)) prefix.push(f);
        else if (lower.includes(q)) contains.push(f);
      }
      state.filtered = [...prefix, ...contains].slice(0, MAX_FILTERED_DISPLAY);
      // Include "Default" option if it matches
      if (DEFAULT_FONT_LABEL.toLowerCase().includes(q)) {
        state.filtered.unshift(DEFAULT_FONT_VALUE);
      }
    }
    state.highlightIndex = -1;
  }

  function renderDropdown(): void {
    dropdown.innerHTML = "";

    if (state.filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "font-selector-empty";
      empty.textContent = "No fonts found";
      dropdown.appendChild(empty);
      return;
    }

    for (let i = 0; i < state.filtered.length; i++) {
      const fontValue = state.filtered[i];
      const item = document.createElement("div");
      item.className = "font-selector-item";
      item.setAttribute("role", "option");
      item.textContent = getDisplayName(fontValue);

      // Preview font in its own typeface (skip for Default)
      if (fontValue) {
        item.style.fontFamily = `"${sanitizeFontName(fontValue)}", sans-serif`;
      }

      if (fontValue === state.selected) {
        item.classList.add("selected");
      }
      if (i === state.highlightIndex) {
        item.classList.add("highlighted");
      }

      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent input blur
        selectFont(fontValue);
      });

      dropdown.appendChild(item);
    }
  }

  function openDropdown(): void {
    if (state.isOpen) return;
    state.isOpen = true;
    dropdown.style.display = "block";
    input.setAttribute("aria-expanded", "true");
    updateFiltered(input.value);
    renderDropdown();
    scrollToSelected();
  }

  function closeDropdown(): void {
    if (!state.isOpen) return;
    state.isOpen = false;
    dropdown.style.display = "none";
    input.setAttribute("aria-expanded", "false");
    state.highlightIndex = -1;
  }

  function selectFont(fontFamily: string): void {
    state.selected = fontFamily;
    input.value = "";
    input.placeholder = getDisplayName(fontFamily);

    // Preview selected font in the input
    if (fontFamily) {
      input.style.fontFamily = `"${sanitizeFontName(fontFamily)}", sans-serif`;
    } else {
      input.style.fontFamily = "";
    }

    closeDropdown();
    onFontChange(fontFamily);
  }

  function scrollToSelected(): void {
    const idx = state.filtered.indexOf(state.selected);
    if (idx >= 0) {
      const items = dropdown.querySelectorAll(".font-selector-item");
      (items[idx] as HTMLElement)?.scrollIntoView({ block: "center" });
    }
  }

  function scrollToHighlight(): void {
    if (state.highlightIndex < 0) return;
    const items = dropdown.querySelectorAll(".font-selector-item");
    const item = items[state.highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }

  // --- Event Handlers ---

  function onInput(): void {
    updateFiltered(input.value);
    renderDropdown();
    if (!state.isOpen) openDropdown();
  }

  function onFocus(): void {
    updateFiltered(input.value);
    openDropdown();
    input.select();
  }

  function onBlur(): void {
    // Delay to allow mousedown on dropdown item
    setTimeout(() => {
      closeDropdown();
      // Reset input to show selected font name
      input.value = "";
    }, 150);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!state.isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      openDropdown();
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        state.highlightIndex = Math.min(
          state.highlightIndex + 1,
          state.filtered.length - 1,
        );
        renderDropdown();
        scrollToHighlight();
        break;
      case "ArrowUp":
        e.preventDefault();
        state.highlightIndex = Math.max(state.highlightIndex - 1, 0);
        renderDropdown();
        scrollToHighlight();
        break;
      case "Enter":
        e.preventDefault();
        if (state.highlightIndex >= 0 && state.highlightIndex < state.filtered.length) {
          selectFont(state.filtered[state.highlightIndex]);
        } else if (state.filtered.length > 0) {
          selectFont(state.filtered[0]);
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        input.value = "";
        input.blur();
        break;
    }
  }

  // Close dropdown when clicking outside
  function onDocumentClick(e: MouseEvent): void {
    if (!wrapper.contains(e.target as Node)) {
      closeDropdown();
      input.value = "";
    }
  }

  input.addEventListener("input", onInput);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);

  // --- Public API ---

  return {
    setFonts(fonts: string[]) {
      state.fonts = fonts;
      updateFiltered("");
    },

    setSelected(fontFamily: string) {
      state.selected = fontFamily;
      input.value = "";
      input.placeholder = getDisplayName(fontFamily);
      if (fontFamily) {
        input.style.fontFamily = `"${sanitizeFontName(fontFamily)}", sans-serif`;
      } else {
        input.style.fontFamily = "";
      }
    },

    getSelected() {
      return state.selected;
    },

    destroy() {
      input.removeEventListener("input", onInput);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onDocumentClick);
      wrapper.remove();
    },
  };
}
