/**
 * Lazy KaTeX artifact -> out/webview/katex-loader.js (separate esbuild entry).
 *
 * KaTeX is 267 KB minified plus 1.1 MB of fonts, and most documents hold no
 * formula, so it is never part of the startup bundle. The stylesheet and the
 * fonts are copied to out/webview/katex/ by the build and linked separately;
 * this file carries only the renderer.
 */
import katex from "katex";

declare global {
  interface Window {
    __tuiKatexBundle?: { katex: typeof katex };
  }
}

window.__tuiKatexBundle = { katex };
