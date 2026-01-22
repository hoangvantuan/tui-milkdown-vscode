const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'out/webview/main.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.svg': 'text',
    '.css': 'css',
  },
};

function copyCss() {
  const cssFiles = [
    'node_modules/ckeditor5/dist/ckeditor5.css',
  ];

  const outDir = 'out/webview';
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  cssFiles.forEach((cssPath) => {
    if (!fs.existsSync(cssPath)) {
      throw new Error(`CSS file not found: ${cssPath}`);
    }
    const fileName = path.basename(cssPath);
    fs.copyFileSync(cssPath, path.join(outDir, fileName));
  });

  console.log('CSS files copied');
}

async function build() {
  copyCss();

  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(webviewConfig);
    console.log('Build complete');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
