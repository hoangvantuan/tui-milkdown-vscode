/**
 * Lazy drag-handle artifact -> out/webview/drag-handle-loader.js.
 *
 * `@tiptap/extension-drag-handle` costs 127 KB in the startup bundle, most of
 * it yjs and y-prosemirror reached through `@tiptap/extension-collaboration`,
 * which this editor does not use. It adds ProseMirror plugins only and no
 * schema node, so it can be registered on a live editor with
 * `editor.registerPlugin()` after the artifact loads.
 *
 * Tiptap and ProseMirror are resolved to `window.__tuiTiptap` by the build
 * (see `tiptapGlobalsPlugin` in esbuild.config.js), so this artifact shares the
 * page's single ProseMirror instance.
 */
import DragHandle from "@tiptap/extension-drag-handle";

declare global {
  interface Window {
    __tuiDragHandleBundle?: { DragHandle: typeof DragHandle };
  }
}

window.__tuiDragHandleBundle = { DragHandle };
