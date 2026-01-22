const esbuild = require('esbuild');
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
};

async function build() {
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
