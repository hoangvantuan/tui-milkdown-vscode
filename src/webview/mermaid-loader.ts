/**
 * Entry point of the lazy mermaid artifact → out/webview/mermaid-loader.js.
 *
 * This module is bundled SEPARATELY from the webview main bundle (its own
 * esbuild entry, see esbuild.config.js) so that documents without diagrams
 * never download or execute mermaid. It eagerly imports mermaid and the ELK
 * layout package and publishes them on `window.__tuiMermaidBundle`; the
 * loader side (mermaid-bridge.ts) injects this script with the page nonce
 * when the first diagram is about to render.
 *
 * The default export exists so the module is a legitimate ES module for
 * type checking; the IIFE bundle communicates through the global only.
 */
import elkLayouts from "@mermaid-js/layout-elk";
import mermaid from "mermaid";
import type { MermaidBundle } from "./mermaid-bridge";

const bundle: MermaidBundle = { mermaid, elkLayouts };

window.__tuiMermaidBundle = bundle;

export default bundle;
