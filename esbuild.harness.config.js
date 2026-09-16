// Builds the markdown roundtrip harness into out/harness/roundtrip.js.
// The banner installs the jsdom DOM globals before any bundled module body
// runs, because Tiptap and ProseMirror expect a DOM environment. jsdom is
// marked external so the bundler does not try to inline it.
const esbuild = require('esbuild');
const path = require('path');

const DOM_SHIM = `
const { JSDOM } = require("jsdom");
const __dom = new JSDOM(
  "<!DOCTYPE html><html><head></head><body><div id=\\"editor\\"></div></body></html>",
  { pretendToBeVisual: true, url: "http://localhost/" }
);
globalThis.window = __dom.window;
globalThis.document = __dom.window.document;
globalThis.navigator = __dom.window.navigator;
globalThis.Element = __dom.window.Element;
globalThis.HTMLElement = __dom.window.HTMLElement;
globalThis.Node = __dom.window.Node;
globalThis.Range = __dom.window.Range;
globalThis.CustomEvent = __dom.window.CustomEvent;
globalThis.MutationObserver = __dom.window.MutationObserver;
globalThis.getComputedStyle = __dom.window.getComputedStyle.bind(__dom.window);
globalThis.requestAnimationFrame = __dom.window.requestAnimationFrame?.bind(__dom.window) ?? ((cb) => setTimeout(cb, 16));
globalThis.cancelAnimationFrame = __dom.window.cancelAnimationFrame?.bind(__dom.window) ?? ((id) => clearTimeout(id));
`;

// The VS Code floor check (harness/vscode-floor/) runs INSIDE a real
// extension host, so it gets no jsdom banner and keeps `vscode` external —
// the host provides that module. Built only when asked for by name, so the
// ordinary `npm run roundtrip` stays a single fast build.
const floorTestsConfig = {
  entryPoints: ['harness/vscode-floor/extension-tests.ts'],
  outfile: 'out/harness/vscode-floor-tests.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  external: ['vscode'],
  logLevel: 'warning',
};

const vscodePlugin = {
  name: 'vscode-mock',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, (args) => ({
      path: args.path,
      namespace: 'vscode-mock',
    }));
    build.onLoad({ filter: /.*/, namespace: 'vscode-mock' }, () => ({
      contents:
        'module.exports = { EndOfLine: { LF: 1, CRLF: 2 }, Range: class {}, Position: class {}, WorkspaceEdit: class {}, Uri: { file: () => ({}), parse: () => ({}) }, window: {}, workspace: {}, commands: {} };',
      loader: 'js',
    }));
  },
};

const roundtripConfig = {
  entryPoints: ['harness/roundtrip.ts'],
  outfile: 'out/harness/roundtrip.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  external: ['jsdom'],
  banner: { js: DOM_SHIM },
  plugins: [vscodePlugin],
  logLevel: 'warning',
};

const vscodeTestPlugin = {
  name: 'vscode-test-stub',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({
      path: path.resolve(__dirname, 'test/vscode-stub.ts'),
    }));
  },
};

const testsConfig = {
  entryPoints: [
    'test/frontmatter-parser.test.ts',
    'test/image-rename-handler.test.ts',
  ],
  outdir: 'out/test',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  plugins: [vscodeTestPlugin],
  logLevel: 'warning',
};

const target = process.argv.includes('--test')
  ? testsConfig
  : process.argv.includes('--floor-tests')
  ? floorTestsConfig
  : roundtripConfig;

esbuild
  .build(target)
  .then(() => console.log(`harness built: ${target.outfile || target.outdir}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
