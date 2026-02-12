import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
    CellSelection,
    TableMap,
    cellAround,
    isInTable,
} from "@tiptap/pm/tables";

/**
 * Right-click context menu for table operations.
 * Shows a floating menu with select/add/delete row/column/table options
 * when the user right-clicks inside a table cell.
 */

const contextMenuPluginKey = new PluginKey("tableContextMenu");

interface MenuItem {
    label: string;
    icon?: string;
    action: (editor: any) => void;
    dividerBefore?: boolean;
}

function findTableInfo(state: any) {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "table") {
            return {
                table: node,
                tableStart: $from.start(d),
                tableDepth: d,
                tablePos: $from.before(d),
            };
        }
    }
    return null;
}

function selectRow(editor: any) {
    const { state, dispatch } = editor.view;
    const { $from } = state.selection;
    const cellResolved = cellAround($from);
    if (!cellResolved) return;

    const sel = CellSelection.rowSelection(cellResolved);
    dispatch(state.tr.setSelection(sel));
}

function selectColumn(editor: any) {
    const { state, dispatch } = editor.view;
    const { $from } = state.selection;
    const cellResolved = cellAround($from);
    if (!cellResolved) return;

    const sel = CellSelection.colSelection(cellResolved);
    dispatch(state.tr.setSelection(sel));
}

function selectTable(editor: any) {
    const { state, dispatch } = editor.view;
    const info = findTableInfo(state);
    if (!info) return;

    const map = TableMap.get(info.table);
    if (map.map.length === 0) return;

    // Select from first cell to last cell
    const firstCellPos = info.tableStart + map.map[0];
    const lastCellPos = info.tableStart + map.map[map.map.length - 1];
    const $first = state.doc.resolve(firstCellPos);
    const $last = state.doc.resolve(lastCellPos);

    const sel = new CellSelection($first, $last);
    dispatch(state.tr.setSelection(sel));
}

function getMenuItems(): MenuItem[] {
    return [
        {
            label: "Select Row",
            icon: "⬌",
            action: (editor) => selectRow(editor),
        },
        {
            label: "Select Column",
            icon: "⬍",
            action: (editor) => selectColumn(editor),
        },
        {
            label: "Select Table",
            icon: "⊞",
            action: (editor) => selectTable(editor),
        },
        {
            label: "Add Row Above",
            icon: "↑+",
            dividerBefore: true,
            action: (editor) => editor.chain().focus().addRowBefore().run(),
        },
        {
            label: "Add Row Below",
            icon: "↓+",
            action: (editor) => editor.chain().focus().addRowAfter().run(),
        },
        {
            label: "Add Column Before",
            icon: "←+",
            action: (editor) => editor.chain().focus().addColumnBefore().run(),
        },
        {
            label: "Add Column After",
            icon: "→+",
            action: (editor) => editor.chain().focus().addColumnAfter().run(),
        },
        {
            label: "Delete Row",
            icon: "🗑",
            dividerBefore: true,
            action: (editor) => editor.chain().focus().deleteRow().run(),
        },
        {
            label: "Delete Column",
            icon: "🗑",
            action: (editor) => editor.chain().focus().deleteColumn().run(),
        },
        {
            label: "Delete Table",
            icon: "🗑",
            action: (editor) => editor.chain().focus().deleteTable().run(),
        },
    ];
}

let activeMenu: HTMLElement | null = null;

function removeMenu() {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
}

function createMenuElement(
    items: MenuItem[],
    editor: any,
    x: number,
    y: number,
): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "table-context-menu";
    menu.setAttribute("role", "menu");

    for (const item of items) {
        if (item.dividerBefore) {
            const divider = document.createElement("div");
            divider.className = "table-ctx-divider";
            menu.appendChild(divider);
        }

        const btn = document.createElement("button");
        btn.className = "table-ctx-item";
        btn.setAttribute("role", "menuitem");
        btn.type = "button";

        if (item.icon) {
            const iconSpan = document.createElement("span");
            iconSpan.className = "table-ctx-icon";
            iconSpan.textContent = item.icon;
            btn.appendChild(iconSpan);
        }

        const labelSpan = document.createElement("span");
        labelSpan.className = "table-ctx-label";
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeMenu();
            item.action(editor);
        });

        menu.appendChild(btn);
    }

    // Position the menu
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    return menu;
}

function showContextMenu(editor: any, event: MouseEvent) {
    removeMenu();

    // Append to the editor-container or body for proper positioning
    const container =
        document.getElementById("editor-container") || document.body;
    const containerRect = container.getBoundingClientRect();

    // Convert viewport coordinates to container-relative coordinates
    // accounting for container's position and scroll offset
    const x = event.clientX - containerRect.left + container.scrollLeft;
    const y = event.clientY - containerRect.top + container.scrollTop;

    const items = getMenuItems();
    const menu = createMenuElement(items, editor, x, y);

    container.appendChild(menu);
    activeMenu = menu;

    // Adjust position if menu overflows container
    requestAnimationFrame(() => {
        if (!activeMenu) return;
        const menuRect = activeMenu.getBoundingClientRect();

        if (menuRect.right > containerRect.right) {
            activeMenu.style.left = `${x - menuRect.width}px`;
        }
        if (menuRect.bottom > containerRect.bottom) {
            activeMenu.style.top = `${y - menuRect.height}px`;
        }
    });
}

// Store cleanup references
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let _onScroll: (() => void) | null = null;

export const TableContextMenu = Extension.create({
    name: "tableContextMenu",

    onCreate() {
        // Close menu on Escape key
        _onKeyDown = (e: KeyboardEvent) => {
            if (activeMenu && e.key === "Escape") {
                removeMenu();
            }
        };
        document.addEventListener("keydown", _onKeyDown);

        // Close menu on scroll inside editor container
        _onScroll = () => removeMenu();
        const editorContainer = document.getElementById("editor-container");
        if (editorContainer) {
            editorContainer.addEventListener("scroll", _onScroll, { passive: true });
        }
    },

    addProseMirrorPlugins() {
        const editor = this.editor;

        return [
            new Plugin({
                key: contextMenuPluginKey,
                props: {
                    handleDOMEvents: {
                        contextmenu(view, event) {
                            // Check if cursor is inside a table
                            if (!isInTable(view.state)) return false;

                            // Check if the right-click target is inside a table cell
                            const target = event.target as HTMLElement;
                            const cell = target.closest("td, th");
                            if (!cell) return false;

                            event.preventDefault();
                            showContextMenu(editor, event as MouseEvent);
                            return true;
                        },
                        mousedown(_view, event) {
                            // Close menu on click outside
                            if (activeMenu && !(event.target as HTMLElement).closest(".table-context-menu")) {
                                removeMenu();
                            }
                            return false;
                        },
                    },
                },
            }),
        ];
    },

    onDestroy() {
        removeMenu();
        if (_onKeyDown) {
            document.removeEventListener("keydown", _onKeyDown);
            _onKeyDown = null;
        }
        if (_onScroll) {
            const editorContainer = document.getElementById("editor-container");
            if (editorContainer) {
                editorContainer.removeEventListener("scroll", _onScroll);
            }
            _onScroll = null;
        }
    },
});
