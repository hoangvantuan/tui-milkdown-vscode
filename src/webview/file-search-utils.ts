import fuzzysort from "fuzzysort";

// --- Types ---

export interface FileItem {
  name: string;
  path: string;
}

export interface FileSearchOptions {
  query: string;
  files: FileItem[];
  currentDocFolder?: string;
  maxResults?: number;
}

export interface FileSearchResult {
  file: FileItem;
  score: number;
  nameIndexes: readonly number[] | null;
  pathIndexes: readonly number[] | null;
}

// --- Utilities ---

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlightMatches(
  text: string,
  indexes: readonly number[] | null,
): string {
  if (!indexes || indexes.length === 0) return escapeHtml(text);
  const indexSet = new Set(indexes);
  let html = "";
  let inMark = false;
  for (let i = 0; i < text.length; i++) {
    const isMatch = indexSet.has(i);
    if (isMatch && !inMark) {
      html += "<mark>";
      inMark = true;
    }
    if (!isMatch && inMark) {
      html += "</mark>";
      inMark = false;
    }
    html += escapeHtml(text[i]);
  }
  if (inMark) html += "</mark>";
  return html;
}

export function getFolderPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : "";
}

// --- Proximity Scoring ---

function getProximityBonus(
  filePath: string,
  currentDocFolder?: string,
): number {
  if (!currentDocFolder) return 0;
  const fileFolder = getFolderPath(filePath);
  if (fileFolder === currentDocFolder) return 20;
  const parentFolder = getFolderPath(currentDocFolder);
  if (parentFolder && fileFolder === parentFolder) return 10;
  return 0;
}

// --- Normalization (diacritics-insensitive, hyphen-insensitive) ---

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/-/g, " ");
}

// --- Search ---

export function searchFiles(options: FileSearchOptions): FileSearchResult[] {
  const { query, files, currentDocFolder, maxResults = 20 } = options;

  if (!query) {
    return files
      .map((file) => ({
        file,
        score: getProximityBonus(file.path, currentDocFolder),
        nameIndexes: null as readonly number[] | null,
        pathIndexes: null as readonly number[] | null,
      }))
      .sort(
        (a, b) =>
          b.score - a.score || a.file.name.localeCompare(b.file.name),
      )
      .slice(0, maxResults);
  }

  const resultMap = new Map<string, FileSearchResult>();

  const primaryResults = fuzzysort.go(query, files, {
    keys: ["name", "path"],
    threshold: -1000,
    limit: maxResults * 3,
  });

  for (const r of primaryResults) {
    const bonus = getProximityBonus(r.obj.path, currentDocFolder);
    resultMap.set(r.obj.path, {
      file: r.obj,
      score: r.score + bonus,
      nameIndexes:
        (r[0]?.indexes as readonly number[] | undefined) ?? null,
      pathIndexes:
        (r[1]?.indexes as readonly number[] | undefined) ?? null,
    });
  }

  const normQuery = normalizeText(query);
  if (normQuery !== query.toLowerCase()) {
    const normTargets = files.map((f, i) => ({
      name: normalizeText(f.name),
      path: normalizeText(f.path),
      _idx: i,
    }));
    const normResults = fuzzysort.go(normQuery, normTargets, {
      keys: ["name", "path"],
      threshold: -1000,
      limit: maxResults * 3,
    });

    for (const r of normResults) {
      const file = files[r.obj._idx];
      if (!resultMap.has(file.path)) {
        const bonus = getProximityBonus(file.path, currentDocFolder);
        resultMap.set(file.path, {
          file,
          score: r.score + bonus,
          nameIndexes: null,
          pathIndexes: null,
        });
      }
    }
  }

  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// --- File Type Icons (10 groups) ---

const ICON_MARKDOWN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

const ICON_CODE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

const ICON_JSON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>`;

const ICON_CSS = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`;

const ICON_HTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

const ICON_IMAGE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

const ICON_CONFIG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

const ICON_DATA = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;

const ICON_PDF = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

const ICON_DEFAULT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

const EXTENSION_ICON_MAP: Record<string, string> = {
  ".md": ICON_MARKDOWN,
  ".mdx": ICON_MARKDOWN,
  ".ts": ICON_CODE,
  ".tsx": ICON_CODE,
  ".js": ICON_CODE,
  ".jsx": ICON_CODE,
  ".json": ICON_JSON,
  ".yaml": ICON_JSON,
  ".yml": ICON_JSON,
  ".toml": ICON_JSON,
  ".css": ICON_CSS,
  ".scss": ICON_CSS,
  ".less": ICON_CSS,
  ".html": ICON_HTML,
  ".htm": ICON_HTML,
  ".vue": ICON_HTML,
  ".svelte": ICON_HTML,
  ".png": ICON_IMAGE,
  ".jpg": ICON_IMAGE,
  ".jpeg": ICON_IMAGE,
  ".gif": ICON_IMAGE,
  ".svg": ICON_IMAGE,
  ".webp": ICON_IMAGE,
  ".ico": ICON_IMAGE,
  ".env": ICON_CONFIG,
  ".csv": ICON_DATA,
  ".xlsx": ICON_DATA,
  ".sql": ICON_DATA,
  ".pdf": ICON_PDF,
  ".docx": ICON_PDF,
};

const FILENAME_ICON_MAP: Record<string, string> = {
  ".gitignore": ICON_CONFIG,
  ".editorconfig": ICON_CONFIG,
  ".prettierrc": ICON_CONFIG,
  ".eslintrc": ICON_CONFIG,
};

export function getFileIcon(filename: string): string {
  const lower = filename.toLowerCase();
  if (FILENAME_ICON_MAP[lower]) return FILENAME_ICON_MAP[lower];
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex >= 0) {
    return EXTENSION_ICON_MAP[lower.substring(dotIndex)] ?? ICON_DEFAULT;
  }
  return ICON_DEFAULT;
}
