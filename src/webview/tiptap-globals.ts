/**
 * Publishes the main bundle's Tiptap and ProseMirror modules on `window` so a
 * lazy artifact can reuse them instead of bundling its own.
 *
 * Why this exists: mermaid is a standalone library, so its artifact can be
 * self-contained. A lazy Tiptap EXTENSION cannot. It plugs into the live
 * editor, and a second copy of `prosemirror-state` gives the artifact its own
 * PluginKey identities and its own `EditorState` class, so `instanceof` checks
 * inside ProseMirror fail at runtime with nothing failing at compile time.
 * `esbuild.config.js` resolves `@tiptap/core` and `@tiptap/pm/*` inside every
 * lazy artifact to these globals (see `tiptapGlobalsPlugin`), which keeps
 * exactly one ProseMirror in the page.
 *
 * Measured before it was written: with the shim in place a drag-handle
 * artifact registers through `editor.registerPlugin()` and
 * `editor.view.state instanceof EditorState` stays true.
 */
import * as core from "@tiptap/core";
import * as pmState from "@tiptap/pm/state";
import * as pmView from "@tiptap/pm/view";
import * as pmModel from "@tiptap/pm/model";
import * as pmTransform from "@tiptap/pm/transform";

export type TiptapGlobals = {
  core: typeof core;
  pmState: typeof pmState;
  pmView: typeof pmView;
  pmModel: typeof pmModel;
  pmTransform: typeof pmTransform;
};

declare global {
  interface Window {
    __tuiTiptap?: TiptapGlobals;
  }
}

/** Call once, before any artifact is injected. Idempotent. */
export function publishTiptapGlobals(): void {
  window.__tuiTiptap = { core, pmState, pmView, pmModel, pmTransform };
}
