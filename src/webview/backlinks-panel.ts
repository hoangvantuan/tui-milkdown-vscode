/**
 * Backlinks Panel: displays documents that link to the current one.
 *
 * Modeled after `src/webview/toc-sidebar.ts`, and placed as its mirror: the TOC
 * opens on the left of the editor, this opens on the right.
 * Renders in `#main-layout`, requests references from extension host via
 * `requestBacklinks`, and navigates to referring documents via `openLink`.
 */
import type { BacklinkItem } from "../shared/messages";
import { escapeHtml, getFileIcon } from "./file-search-utils";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): any;
  setState(state: any): void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;
let panelEl: HTMLElement | null = null;
let toggleBtnEl: HTMLElement | null = null;
let entriesEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let currentLinks: BacklinkItem[] = [];

const BACKLINK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

export function setupBacklinksPanel(vscode: ReturnType<typeof acquireVsCodeApi>): void {
  vscodeApi = vscode;
  const mainLayout = document.getElementById("main-layout");
  if (!mainLayout) return;

  // Create the toggle button. It is appended at the END of #main-layout, below.
  toggleBtnEl = document.createElement("button");
  toggleBtnEl.id = "btn-backlinks";
  toggleBtnEl.className = "backlinks-toggle-btn";
  toggleBtnEl.title = "Backlinks";
  toggleBtnEl.setAttribute("aria-label", "Toggle Backlinks");
  toggleBtnEl.innerHTML = BACKLINK_ICON_SVG;

  // Create aside panel container
  panelEl = document.createElement("aside");
  panelEl.id = "backlinks-panel";
  panelEl.className = "hidden";

  const header = document.createElement("div");
  header.className = "backlinks-header";

  const title = document.createElement("span");
  title.className = "backlinks-title";
  title.textContent = "Backlinks";
  header.appendChild(title);

  badgeEl = document.createElement("span");
  badgeEl.className = "backlinks-badge hidden";
  header.appendChild(badgeEl);

  panelEl.appendChild(header);

  entriesEl = document.createElement("div");
  entriesEl.id = "backlinks-entries";
  panelEl.appendChild(entriesEl);

  // #main-layout is a flex row, so DOM order IS left-to-right order. Appending
  // both at the end puts the panel on the right of the editor and its toggle at
  // the far right edge, mirroring #btn-toc and #toc-sidebar on the left. The
  // panel's border is therefore border-LEFT, the mirror of the TOC's.
  mainLayout.appendChild(panelEl);
  mainLayout.appendChild(toggleBtnEl);

  // Toggle button click handler
  toggleBtnEl.addEventListener("click", () => {
    const isHidden = panelEl?.classList.toggle("hidden") ?? true;
    toggleBtnEl?.classList.toggle("is-active", !isHidden);
    vscode.setState({ ...vscode.getState(), backlinksVisible: !isHidden });

    if (!isHidden) {
      requestBacklinks();
    }
  });

  // Restore visibility state
  if (vscode.getState()?.backlinksVisible) {
    panelEl.classList.remove("hidden");
    toggleBtnEl.classList.add("is-active");
    requestBacklinks();
  } else {
    renderEmpty();
  }
}

export function requestBacklinks(): void {
  vscodeApi?.postMessage({ type: "requestBacklinks" });
}

function renderEmpty(): void {
  if (!entriesEl) return;
  entriesEl.innerHTML = `<div class="backlinks-empty">No backlinks found</div>`;
  if (badgeEl) {
    badgeEl.classList.add("hidden");
    badgeEl.textContent = "0";
  }
}

export function updateBacklinks(links: BacklinkItem[]): void {
  currentLinks = links;
  if (!entriesEl) return;
  entriesEl.innerHTML = "";

  if (badgeEl) {
    if (links.length > 0) {
      badgeEl.classList.remove("hidden");
      badgeEl.textContent = String(links.length);
    } else {
      badgeEl.classList.add("hidden");
      badgeEl.textContent = "0";
    }
  }

  if (links.length === 0) {
    renderEmpty();
    return;
  }

  for (const item of links) {
    const entry = document.createElement("div");
    entry.className = "backlink-entry";
    entry.title = item.path;

    const row = document.createElement("div");
    row.className = "backlink-entry-header";

    const icon = document.createElement("span");
    icon.className = "backlink-entry-icon";
    icon.innerHTML = getFileIcon(item.label);
    row.appendChild(icon);

    const label = document.createElement("span");
    label.className = "backlink-entry-label";
    label.textContent = item.label;
    row.appendChild(label);

    if (item.count && item.count > 1) {
      const count = document.createElement("span");
      count.className = "backlink-entry-count";
      count.textContent = String(item.count);
      row.appendChild(count);
    }
    entry.appendChild(row);

    if (item.path) {
      const pathEl = document.createElement("div");
      pathEl.className = "backlink-entry-path";
      pathEl.textContent = item.path;
      entry.appendChild(pathEl);
    }

    if (item.preview) {
      const previewEl = document.createElement("div");
      previewEl.className = "backlink-entry-preview";
      previewEl.textContent = item.preview;
      entry.appendChild(previewEl);
    }

    entry.addEventListener("click", () => {
      vscodeApi?.postMessage({
        type: "openLink",
        href: item.relativePath || item.path,
      });
    });

    entriesEl.appendChild(entry);
  }
}

export function refreshBacklinksIfVisible(): void {
  if (panelEl && !panelEl.classList.contains("hidden")) {
    requestBacklinks();
  }
}
