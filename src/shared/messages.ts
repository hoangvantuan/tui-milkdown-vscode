/**
 * Shared message types between VS Code extension host and Webview.
 *
 * This module is type-only at runtime: it exports strictly interfaces and types
 * so that importing it produces zero runtime JavaScript and adds zero bytes
 * to the webview IIFE bundle.
 */

// ============================================================================
// Webview -> Host Messages (18 types)
// ============================================================================

export interface ReadyMessage {
  type: "ready";
}

export interface EditMessage {
  type: "edit";
  content: string;
}

export interface ViewSourceMessage {
  type: "viewSource";
}

export interface ThemeChangeMessage {
  type: "themeChange";
  theme: string;
}

export interface FontChangeMessage {
  type: "fontChange";
  font: string;
}

export interface ZoomChangeMessage {
  type: "zoomChange";
  zoom: number;
}

export interface SaveImageMessage {
  type: "saveImage";
  data: string;
  filename: string;
  blobUrl: string;
}

export interface ShowWarningMessage {
  type: "showWarning";
  message: string;
}

export interface ReadClipboardImageMessage {
  type: "readClipboardImage";
}

export interface RequestImageUrlEditMessage {
  type: "requestImageUrlEdit";
  editId: string;
  currentUrl?: string;
  isLocalImage?: boolean;
  isBase64?: boolean;
}

export interface OpenLinkMessage {
  type: "openLink";
  href: string;
}

export interface OpenImageInTabMessage {
  type: "openImageInTab";
  path: string;
}

export interface RequestLinkEditMessage {
  type: "requestLinkEdit";
  editId: string;
  currentUrl?: string;
}

export interface RequestImageRenameMessage {
  type: "requestImageRename";
  renameId: string;
  oldPath: string;
  newPath: string;
}

export interface FileSearchMessage {
  type: "fileSearch";
}

export interface WikiLinkSearchMessage {
  type: "wikiLinkSearch";
}

export interface OpenWikiLinkMessage {
  type: "openWikiLink";
  filename: string;
}

export interface ExportMessage {
  type: "export";
  format: string;
  fontFamily?: string;
  mermaidImages?: Array<{ code: string; base64: string }>;
}

export type WebviewToHostMessage =
  | ReadyMessage
  | EditMessage
  | ViewSourceMessage
  | ThemeChangeMessage
  | FontChangeMessage
  | ZoomChangeMessage
  | SaveImageMessage
  | ShowWarningMessage
  | ReadClipboardImageMessage
  | RequestImageUrlEditMessage
  | OpenLinkMessage
  | OpenImageInTabMessage
  | RequestLinkEditMessage
  | RequestImageRenameMessage
  | FileSearchMessage
  | WikiLinkSearchMessage
  | OpenWikiLinkMessage
  | ExportMessage;

// ============================================================================
// Host -> Webview Messages (15 types)
// ============================================================================

export interface UpdateMessage {
  type: "update";
  content: string;
  imageMap: Record<string, string>;
}

export interface ThemeMessage {
  type: "theme";
  theme: "dark" | "light" | string;
}

export interface ConfigMessage {
  type: "config";
  fontSize: number;
  headingSizes: Record<string, number>;
  highlightCurrentLine: boolean;
  autoHideToolbar: boolean;
  listIndentation?: { style: "space" | "tab"; size: number };
  tabSize?: number;
}

export interface SavedThemeMessage {
  type: "savedTheme";
  theme: string;
}

export interface SavedFontMessage {
  type: "savedFont";
  font: string;
}

export interface SavedZoomMessage {
  type: "savedZoom";
  zoom: number;
}

export interface SystemFontsMessage {
  type: "systemFonts";
  fonts: string[];
}

export interface ImageSavedMessage {
  type: "imageSaved";
  blobUrl: string;
  savedPath: string;
  webviewUri: string;
}

export interface ClipboardImageMessage {
  type: "clipboardImage";
  data?: string;
  error?: string;
}

export interface ImageUrlEditResponseMessage {
  type: "imageUrlEditResponse";
  editId: string;
  newUrl: string | null;
}

export interface LinkEditResponseMessage {
  type: "linkEditResponse";
  editId: string;
  newUrl: string | null;
}

export interface ImageRenameResponseMessage {
  type: "imageRenameResponse";
  renameId: string;
  success: boolean;
  newPath?: string;
  webviewUri?: string;
}

export interface FileSearchResultsMessage {
  type: "fileSearchResults";
  files: Array<{ name: string; path: string }>;
  currentDocFolder: string;
}

export interface WikiLinkSearchResultsMessage {
  type: "wikiLinkSearchResults";
  files: Array<{ name: string; path: string }>;
  currentDocFolder: string;
}

export interface ExportDoneMessage {
  type: "exportDone";
  success: boolean;
  reason?: string;
}

export type HostToWebviewMessage =
  | UpdateMessage
  | ThemeMessage
  | ConfigMessage
  | SavedThemeMessage
  | SavedFontMessage
  | SavedZoomMessage
  | SystemFontsMessage
  | ImageSavedMessage
  | ClipboardImageMessage
  | ImageUrlEditResponseMessage
  | LinkEditResponseMessage
  | ImageRenameResponseMessage
  | FileSearchResultsMessage
  | WikiLinkSearchResultsMessage
  | ExportDoneMessage;
