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
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([
      extCtx.watch(),
      markdownAstCtx.watch(),
      exportDocxCtx.watch(),
      exportPdfCtx.watch(),
      mermaidLoaderCtx.watch(),
      webCtx.watch(),
    ]);
    console.log('Watching for files...');
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(markdownAstConfig);
    await esbuild.build(exportDocxConfig);
    await esbuild.build(exportPdfConfig);
    await esbuild.build(mermaidLoaderConfig);
    await esbuild.build(webviewConfig);
    console.log(`Build complete (${isProduction ? 'production' : 'development'})`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
