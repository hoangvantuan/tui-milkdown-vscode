const esbuild = require('esbuild');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');
const isProduction = !isDev && !isWatch;

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

// Separate bundle for the shared MDAST pipeline (lazy-loaded on demand).
// Holds unified + remark-* so extension.js stays small.
const markdownAstConfig = {
  entryPoints: ['src/utils/markdown-ast.ts'],
  bundle: true,
  outfile: 'out/markdown-ast.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

// Separate bundle for export-docx (lazy-loaded on demand)
// Keeps the main extension.js small; this file is only loaded when user exports.
const exportDocxConfig = {
  entryPoints: ['src/utils/export-docx.ts'],
  bundle: true,
  outfile: 'out/export-docx.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

// Separate bundle for export-pdf (lazy-loaded on demand)
const exportPdfConfig = {
  entryPoints: ['src/utils/export-pdf.ts'],
  bundle: true,
  outfile: 'out/export-pdf.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

// Lazy mermaid artifact: separate IIFE entry so the heavy mermaid + ELK
// code is NOT part of out/webview/main.js. Injected at render time by
// src/webview/mermaid-bridge.ts (nonce-bearing <script>), so documents
// without diagrams never load it. Must stay `format: 'iife'`-compatible:
// no code splitting, the bundle self-registers on window.
const mermaidLoaderConfig = {
  entryPoints: ['src/webview/mermaid-loader.ts'],
  bundle: true,
  outfile: 'out/webview/mermaid-loader.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
};

// Lazy Tiptap-extension artifacts (3.0). Unlike mermaid, these artifacts plug
// into a LIVE editor, so they must not bundle their own copy of Tiptap or
// ProseMirror: a second prosemirror-state makes plugin keys and
// `instanceof EditorState` fail at runtime with no compile error. esbuild has
// no "external as global" for scoped package names, so the bare specifiers are
// resolved to the globals src/webview/tiptap-globals.ts publishes on `window`.
// Measured: with this shim the drag-handle artifact registers through
// editor.registerPlugin() and editor.view.state stays instanceof the main
// bundle's EditorState.
const TIPTAP_GLOBALS = {
  '@tiptap/core': 'window.__tuiTiptap.core',
  '@tiptap/pm/state': 'window.__tuiTiptap.pmState',
  '@tiptap/pm/view': 'window.__tuiTiptap.pmView',
  '@tiptap/pm/model': 'window.__tuiTiptap.pmModel',
  '@tiptap/pm/transform': 'window.__tuiTiptap.pmTransform',
};

const tiptapGlobalsPlugin = {
  name: 'tiptap-globals',
  setup(build) {
    const names = Object.keys(TIPTAP_GLOBALS).map((k) =>
      k.replace(/[/@]/g, (m) => '\\' + m),
    );
    const filter = new RegExp('^(' + names.join('|') + ')$');
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: 'tiptap-global',
    }));
    build.onLoad({ filter: /.*/, namespace: 'tiptap-global' }, (args) => ({
      contents: 'module.exports = ' + TIPTAP_GLOBALS[args.path] + ';',
      loader: 'js',
    }));
  },
};

/** One lazy webview artifact: IIFE, self-registering on window, Tiptap external. */
function lazyArtifactConfig(entry, outfile) {
  return {
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    sourcemap: !isProduction,
    minify: isProduction,
    treeShaking: true,
    plugins: [tiptapGlobalsPlugin],
    define: {
      'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    },
  };
}

// KaTeX (267 KB minified plus 1.1 MB of fonts), the drag handle (pulls yjs and
// y-prosemirror through @tiptap/extension-collaboration) and the emoji data
// (emojibase-data does not tree-shake) are each far larger than the whole
// startup budget allows, so all three load on demand.
const katexLoaderConfig = lazyArtifactConfig(
  'src/webview/katex-loader.ts',
  'out/webview/katex-loader.js',
);
const dragHandleLoaderConfig = lazyArtifactConfig(
  'src/webview/drag-handle-loader.ts',
  'out/webview/drag-handle-loader.js',
);
const emojiLoaderConfig = lazyArtifactConfig(
  'src/webview/emoji-loader.ts',
  'out/webview/emoji-loader.js',
);

// Main webview bundle: compiles src/webview/main.ts into an IIFE.
// Also bundles all imported CSS (editor.css and themes/index.css) via the
// CSS loader into out/webview/main.css in import order (editor styles first,
// theme overrides second).
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'out/webview/main.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
  loader: {
    '.css': 'css',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
  },
};

// The startup budget for the webview bundle. #85 set it at 1,100,000 B for
// 3.0: the 2.15 mermaid split left main.js at 933,347 B, 2.17 shipped it at
// 983,969 B, and the 3.0 rendering features add markdown nodes eagerly while
// every heavy renderer loads on demand. A build past this number is a build
// that silently undid a lazy split, so it fails rather than warns.
const WEBVIEW_BUDGET_BYTES = 1_100_000;

function assertWebviewBudget() {
  const file = 'out/webview/main.js';
  const size = fs.statSync(file).size;
  if (size > WEBVIEW_BUDGET_BYTES) {
    throw new Error(
      `${file} is ${size} B, over the ${WEBVIEW_BUDGET_BYTES} B startup budget ` +
        `by ${size - WEBVIEW_BUDGET_BYTES} B. Load the new code as a lazy ` +
        `artifact (see lazyArtifactConfig) or raise the budget deliberately.`,
    );
  }
  console.log(`webview bundle: ${size} B / ${WEBVIEW_BUDGET_BYTES} B budget`);
}

// KaTeX ships its stylesheet and font files as separate assets; the lazy
// artifact holds only the JS. The CSS references fonts/ by relative URL, so
// the two must keep this layout under out/webview/katex/ for the webview
// resource URI to resolve them. `.vscodeignore` does not exclude out/webview,
// so they are packaged.
function copyKatexAssets() {
  const dest = 'out/webview/katex';
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync('node_modules/katex/dist/katex.min.css', `${dest}/katex.min.css`);
  fs.cpSync('node_modules/katex/dist/fonts', `${dest}/fonts`, { recursive: true });
}

function ensureOutDir() {
  const outDir = 'out/webview';
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
}

async function build() {
  console.log(`Building (${isProduction ? 'production' : 'development'})...`);
  ensureOutDir();

  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const markdownAstCtx = await esbuild.context(markdownAstConfig);
    const exportDocxCtx = await esbuild.context(exportDocxConfig);
    const exportPdfCtx = await esbuild.context(exportPdfConfig);
    const mermaidLoaderCtx = await esbuild.context(mermaidLoaderConfig);
    const katexLoaderCtx = await esbuild.context(katexLoaderConfig);
    const dragHandleLoaderCtx = await esbuild.context(dragHandleLoaderConfig);
    const emojiLoaderCtx = await esbuild.context(emojiLoaderConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([
      extCtx.watch(),
      markdownAstCtx.watch(),
      exportDocxCtx.watch(),
      exportPdfCtx.watch(),
      mermaidLoaderCtx.watch(),
      katexLoaderCtx.watch(),
      dragHandleLoaderCtx.watch(),
      emojiLoaderCtx.watch(),
      webCtx.watch(),
    ]);
    copyKatexAssets();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(markdownAstConfig);
    await esbuild.build(exportDocxConfig);
    await esbuild.build(exportPdfConfig);
    await esbuild.build(mermaidLoaderConfig);
    await esbuild.build(katexLoaderConfig);
    await esbuild.build(dragHandleLoaderConfig);
    await esbuild.build(emojiLoaderConfig);
    await esbuild.build(webviewConfig);
    copyKatexAssets();
    console.log(`Build complete (${isProduction ? 'production' : 'development'})`);
    // Production only: build:dev is unminified and always over the budget.
    if (isProduction) {
      assertWebviewBudget();
    }
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
