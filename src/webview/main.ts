import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { theme?: string } | null;
  setState(state: unknown): void;
};

type ThemeName = "frame" | "frame-dark" | "nord" | "nord-dark";

const THEMES: ThemeName[] = ["frame", "frame-dark", "nord", "nord-dark"];
const DEBOUNCE_MS = 300;

// Theme CSS variables for each Milkdown theme
const THEME_VARIABLES: Record<ThemeName, Record<string, string>> = {
  frame: {
    "--crepe-color-background": "#ffffff",
    "--crepe-color-on-background": "#000000",
    "--crepe-color-surface": "#f7f7f7",
    "--crepe-color-surface-low": "#ededed",
    "--crepe-color-on-surface": "#1c1c1c",
    "--crepe-color-on-surface-variant": "#4d4d4d",
    "--crepe-color-outline": "#a8a8a8",
    "--crepe-color-primary": "#333333",
    "--crepe-color-secondary": "#cfcfcf",
    "--crepe-color-on-secondary": "#000000",
    "--crepe-color-inverse": "#f0f0f0",
    "--crepe-color-on-inverse": "#1a1a1a",
    "--crepe-color-inline-code": "#ba1a1a",
    "--crepe-color-error": "#ba1a1a",
    "--crepe-color-hover": "#e0e0e0",
    "--crepe-color-selected": "#d5d5d5",
    "--crepe-color-inline-area": "#cacaca",
  },
  "frame-dark": {
    "--crepe-color-background": "#1a1a1a",
    "--crepe-color-on-background": "#ffffff",
    "--crepe-color-surface": "#262626",
    "--crepe-color-surface-low": "#303030",
    "--crepe-color-on-surface": "#e0e0e0",
    "--crepe-color-on-surface-variant": "#b0b0b0",
    "--crepe-color-outline": "#6b6b6b",
    "--crepe-color-primary": "#e0e0e0",
    "--crepe-color-secondary": "#404040",
    "--crepe-color-on-secondary": "#ffffff",
    "--crepe-color-inverse": "#2a2a2a",
    "--crepe-color-on-inverse": "#e0e0e0",
    "--crepe-color-inline-code": "#ff6b6b",
    "--crepe-color-error": "#ff6b6b",
    "--crepe-color-hover": "#3a3a3a",
    "--crepe-color-selected": "#4a4a4a",
    "--crepe-color-inline-area": "#505050",
  },
  nord: {
    "--crepe-color-background": "#fdfcff",
    "--crepe-color-on-background": "#1b1c1d",
    "--crepe-color-surface": "#f8f9ff",
    "--crepe-color-surface-low": "#f2f3fa",
    "--crepe-color-on-surface": "#191c20",
    "--crepe-color-on-surface-variant": "#43474e",
    "--crepe-color-outline": "#73777f",
    "--crepe-color-primary": "#37618e",
    "--crepe-color-secondary": "#d7e3f8",
    "--crepe-color-on-secondary": "#101c2b",
    "--crepe-color-inverse": "#2e3135",
    "--crepe-color-on-inverse": "#eff0f7",
    "--crepe-color-inline-code": "#ba1a1a",
    "--crepe-color-error": "#ba1a1a",
    "--crepe-color-hover": "#eceef4",
    "--crepe-color-selected": "#e1e2e8",
    "--crepe-color-inline-area": "#d8dae0",
  },
  "nord-dark": {
    "--crepe-color-background": "#2e3440",
    "--crepe-color-on-background": "#eceff4",
    "--crepe-color-surface": "#3b4252",
    "--crepe-color-surface-low": "#434c5e",
    "--crepe-color-on-surface": "#e5e9f0",
    "--crepe-color-on-surface-variant": "#d8dee9",
    "--crepe-color-outline": "#4c566a",
    "--crepe-color-primary": "#88c0d0",
    "--crepe-color-secondary": "#434c5e",
    "--crepe-color-on-secondary": "#eceff4",
    "--crepe-color-inverse": "#3b4252",
    "--crepe-color-on-inverse": "#eceff4",
    "--crepe-color-inline-code": "#bf616a",
    "--crepe-color-error": "#bf616a",
    "--crepe-color-hover": "#434c5e",
    "--crepe-color-selected": "#4c566a",
    "--crepe-color-inline-area": "#4c566a",
  },
};

const vscode = acquireVsCodeApi();

let crepe: Crepe | null = null;
let isUpdatingFromExtension = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentTheme: ThemeName = "frame";
let globalThemeReceived: ThemeName | null = null; // Theme from extension globalState

function debouncedPostEdit(content: string): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    vscode.postMessage({ type: "edit", content });
    debounceTimer = null;
  }, DEBOUNCE_MS);
}

// DOM elements
const getEditorEl = () => document.getElementById("editor");
const getThemeSelect = () =>
  document.getElementById("theme-select") as HTMLSelectElement | null;
const getSourceBtn = () => document.getElementById("btn-source");
const getLoadingIndicator = () => document.getElementById("loading-indicator");

function hideLoading(): void {
  const loading = getLoadingIndicator();
  if (loading) {
    loading.classList.add("hidden");
  }
}

function showLoading(): void {
  const loading = getLoadingIndicator();
  if (loading) {
    loading.classList.remove("hidden");
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showError(message: string): void {
  const editorEl = getEditorEl();
  if (editorEl) {
    editorEl.innerHTML = `
      <div style="padding: 20px; color: var(--vscode-errorForeground);">
        <h3>Error</h3>
        <p>${escapeHtml(message)}</p>
        <p>Try reopening the file or reloading the window.</p>
      </div>
    `;
  }
}

// Theme management
function applyThemeVariables(themeName: ThemeName): void {
  const milkdownEl = document.querySelector(".milkdown") as HTMLElement | null;
  if (milkdownEl) {
    const variables = THEME_VARIABLES[themeName];
    for (const [prop, value] of Object.entries(variables)) {
      milkdownEl.style.setProperty(prop, value);
    }
  }
}

function setTheme(themeName: ThemeName, saveGlobal = true): void {
  currentTheme = themeName;
  applyThemeVariables(themeName);

  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${themeName}`);

  const select = getThemeSelect();
  if (select) select.value = themeName;

  // Save theme globally via extension (only source of truth)
  if (saveGlobal) {
    globalThemeReceived = themeName; // Update local cache
    vscode.postMessage({ type: "themeChange", theme: themeName });
  }
}

function initTheme(vsCodeTheme: "dark" | "light"): void {
  // Priority: globalThemeReceived > default based on VS Code theme
  if (globalThemeReceived) {
    // Global theme already applied, just ensure it's set
    applyThemeVariables(globalThemeReceived);
    return;
  }

  // No global theme yet, use default based on VS Code theme
  const defaultTheme = vsCodeTheme === "dark" ? "frame-dark" : "frame";
  currentTheme = defaultTheme;
  applyThemeVariables(defaultTheme);

  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${defaultTheme}`);

  const select = getThemeSelect();
  if (select) select.value = defaultTheme;
}

function viewSource(): void {
  // Request extension to close this editor and open with default text editor
  vscode.postMessage({ type: "viewSource" });
}

function applyFontSize(size: number): void {
  if (!Number.isFinite(size) || size < 8 || size > 32) return;
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
}

// Editor initialization
async function initEditor(initialContent: string = ""): Promise<Crepe | null> {
  console.log("[Crepe] Starting initialization...");
  const editorEl = getEditorEl();
  if (!editorEl) {
    console.error("[Crepe] Editor element not found");
    showError("Editor element not found");
    return null;
  }

  try {
    const instance = new Crepe({
      root: editorEl,
      defaultValue: initialContent,
    });

    instance.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        if (isUpdatingFromExtension) return;
        debouncedPostEdit(markdown);
      });
    });

    await instance.create();

    applyThemeVariables(currentTheme);
    hideLoading();

    console.log("[Crepe] Editor created successfully!");
    return instance;
  } catch (error) {
    console.error("[Crepe] Failed to create editor:", error);
    showError(
      `Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function updateEditorContent(content: string): Promise<void> {
  if (!crepe) return;

  isUpdatingFromExtension = true;
  showLoading();
  try {
    crepe.destroy();
    crepe = null;

    const editorEl = getEditorEl();
    if (editorEl) {
      editorEl.innerHTML = "";
      crepe = await initEditor(content);
    }
  } catch (err) {
    console.error("[Crepe] Failed to update content:", err);
    crepe = null;
    hideLoading();
  } finally {
    queueMicrotask(() => {
      isUpdatingFromExtension = false;
    });
  }
}

function applyTheme(theme: "dark" | "light"): void {
  // Only apply VS Code theme class - DO NOT save to global
  document.body.classList.remove("dark-theme", "light-theme");
  document.body.classList.add(`${theme}-theme`);
}

// Toolbar event handlers
function setupToolbarHandlers(): void {
  const themeSelect = getThemeSelect();
  themeSelect?.addEventListener("change", (e) => {
    const theme = (e.target as HTMLSelectElement).value as ThemeName;
    if (THEMES.includes(theme)) {
      setTheme(theme);
    }
  });

  getSourceBtn()?.addEventListener("click", viewSource);

  // Keyboard shortcut: Ctrl/Cmd + Shift + M to view source
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      viewSource();
    }
  });
}

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "update":
      if (typeof message.content === "string") {
        try {
          if (!crepe) {
            // First time: create editor with actual content (not empty)
            crepe = await initEditor(message.content);
          } else {
            await updateEditorContent(message.content);
          }
        } catch (err) {
          console.error("[Crepe] Update failed:", err);
          showError(
            `Failed to update content: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      break;
    case "theme":
      if (message.theme === "dark" || message.theme === "light") {
        applyTheme(message.theme);
        initTheme(message.theme);
      }
      break;
    case "config":
      if (typeof message.fontSize === "number") {
        applyFontSize(message.fontSize);
      }
      break;
    case "savedTheme":
      if (typeof message.theme === "string" && THEMES.includes(message.theme as ThemeName)) {
        globalThemeReceived = message.theme as ThemeName;
        setTheme(globalThemeReceived, false); // Apply but don't save back
      }
      break;
  }
});

function init() {
  console.log("[Crepe] init() called");

  setupToolbarHandlers();

  // Don't create editor yet - wait for content from extension
  // This prevents showing empty placeholder "Please enter..."
  console.log("[Crepe] init() complete, sending ready signal");
  vscode.postMessage({ type: "ready" });
}

console.log("[Crepe] Script loaded, readyState:", document.readyState);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
