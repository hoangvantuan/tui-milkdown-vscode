/**
 * Shared suggestion popup for autocomplete plugins (@ mentions, [[ wiki links,
 * and future slash commands).
 *
 * Why not a Tiptap BubbleMenu?
 * Tiptap's BubbleMenu anchors to the current ProseMirror selection (typically a
 * cursor or a selected text block) and attaches inside or alongside the editor view.
 * In contrast, suggestion popups anchor to a text range matching a trigger query
 * (provided via clientRect by @tiptap/suggestion), not a selection. Furthermore,
 * popups must survive CSS zoom applied to .tiptap: per the convention in AGENTS.md,
 * floating overlays append to #editor-container (unzoomed parent) and compute
 * absolute positions relative to it using getBoundingClientRect and scrollTop.
 *
 * SuggestionPopup manages popup DOM creation, positioning, keyboard navigation
 * (ArrowUp, ArrowDown, Enter, Escape), selection highlighting, and scroll into view,
 * while delegating item rendering to a caller-supplied render function.
 */

import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";

export interface SuggestionPopupOptions<T> {
  popupClass: string;
  itemClass: string;
  emptyClass: string;
  emptyText: string;
  renderItem: (
    item: T,
    index: number,
    row: HTMLElement,
  ) => HTMLElement | DocumentFragment | void;
}

export class SuggestionPopup<T> {
  private options: SuggestionPopupOptions<T>;
  private popup: HTMLDivElement | null = null;
  private _items: T[] = [];
  private _selectedIndex = 0;
  private _query = "";
  private _clientRect?: (() => DOMRect | null) | null;
  private commandFn: ((props: T) => void) | null = null;

  constructor(options: SuggestionPopupOptions<T>) {
    this.options = options;
  }

  public get element(): HTMLDivElement | null {
    return this.popup;
  }

  public get isOpen(): boolean {
    return this.popup !== null;
  }

  public get items(): T[] {
    return this._items;
  }

  public get selectedIndex(): number {
    return this._selectedIndex;
  }

  public get query(): string {
    return this._query;
  }

  private createPopup(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = this.options.popupClass;
    const container = document.getElementById("editor-container");
    if (container) {
      container.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
    return el;
  }

  public position(
    clientRect?: (() => DOMRect | null) | null,
  ): void {
    if (!this.popup || !clientRect) return;
    const rect = clientRect();
    if (!rect) return;

    const container = document.getElementById("editor-container");
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    this.popup.style.position = "absolute";
    this.popup.style.left = `${rect.left - containerRect.left}px`;
    this.popup.style.top = `${rect.bottom - containerRect.top + container.scrollTop}px`;
  }

  public renderItems(): void {
    if (!this.popup) return;
    this.popup.innerHTML = "";

    if (this._items.length === 0) {
      const empty = document.createElement("div");
      empty.className = this.options.emptyClass;
      empty.textContent = this.options.emptyText;
      this.popup.appendChild(empty);
      return;
    }

    this._items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = this.options.itemClass;
      if (index === this._selectedIndex) {
        row.classList.add("is-selected");
      }

      const content = this.options.renderItem(item, index, row);
      if (content) {
        row.appendChild(content);
      }

      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.commandFn?.(item);
      });

      row.addEventListener("mouseenter", () => {
        this._selectedIndex = index;
        this.updateSelected();
      });

      this.popup!.appendChild(row);
    });

    this.scrollSelectedIntoView();
  }

  private updateSelected(): void {
    if (!this.popup) return;
    const rows = this.popup.querySelectorAll(`.${this.options.itemClass}`);
    rows.forEach((row, i) => {
      row.classList.toggle("is-selected", i === this._selectedIndex);
    });
    this.scrollSelectedIntoView();
  }

  private scrollSelectedIntoView(): void {
    if (!this.popup) return;
    const selected = this.popup.querySelector(
      `.${this.options.itemClass}.is-selected`,
    );
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  public onStart(
    props: SuggestionProps<T, any>,
  ): void {
    this.commandFn = props.command;
    this._items = props.items;
    this._selectedIndex = 0;
    this._query = props.query;
    this._clientRect = props.clientRect;

    this.popup = this.createPopup();
    this.position(props.clientRect);
    this.renderItems();
  }

  public onUpdate(
    props: SuggestionProps<T, any>,
  ): void {
    this.commandFn = props.command;
    this._query = props.query;
    this._items = props.items;
    this._clientRect = props.clientRect;
    if (this._selectedIndex >= this._items.length) {
      this._selectedIndex = Math.max(0, this._items.length - 1);
    }

    this.position(props.clientRect);
    this.renderItems();
  }

  public setItems(items: T[]): void {
    this._items = items;
    this._selectedIndex = 0;
    this.renderItems();
  }

  public onKeyDown(props: SuggestionKeyDownProps): boolean {
    const { event } = props;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (this._items.length > 0) {
        this._selectedIndex = (this._selectedIndex + 1) % this._items.length;
        this.updateSelected();
      }
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (this._items.length > 0) {
        this._selectedIndex =
          (this._selectedIndex - 1 + this._items.length) % this._items.length;
        this.updateSelected();
      }
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (this._items.length > 0 && this._items[this._selectedIndex]) {
        this.commandFn?.(this._items[this._selectedIndex]);
      }
      return true;
    }

    if (event.key === "Escape") {
      return false;
    }

    return false;
  }

  public onExit(): void {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }

    this.commandFn = null;
    this._items = [];
    this._selectedIndex = 0;
    this._query = "";
    this._clientRect = null;
  }
}
