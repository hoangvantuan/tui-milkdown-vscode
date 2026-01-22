# Phase 05: Code Syntax Plugin & Theme Sync

## Context Links
- [Main Plan](./plan.md)
- [Phase 04: Sync Logic](./phase-04-sync-logic.md)
- [TUI Integration Research](./research/researcher-02-tui-editor-integration.md)

## Overview

| Field | Value |
|-------|-------|
| Priority | P2 |
| Status | complete |
| Effort | 1h |
| Description | Add code-syntax-highlight plugin and sync theme with VS Code |

## Key Insights

- Only code-syntax-highlight plugin (minimal bundle size)
- Code syntax uses Prism.js - load 15 common languages
- Theme sync via `onDidChangeActiveColorTheme` event
- Dark theme requires separate CSS import
- TUI Editor theme via `theme` option or class manipulation

## Requirements

**Functional:**
- Code syntax highlighting plugin installed and functional
- Code blocks render with syntax colors
- Theme matches VS Code (light/dark)

**Non-functional:**
- Plugin init < 200ms additional overhead
- Theme switch < 200ms

## Architecture

```
Extension
├── onDidChangeActiveColorTheme
│   └── postMessage({ type: 'theme', isDark: boolean })

Webview
├── TUI Editor
│   └── Plugin: code-syntax-highlight (Prism.js)
└── Theme Handler
    └── Toggle editor theme + CSS class
```

## Related Code Files

**Modify:**
- `package.json` - Add plugin dependencies
- `esbuild.config.js` - Copy plugin CSS
- `src/markdownEditorProvider.ts` - Theme change detection
- `src/webview/main.ts` - Plugin initialization + theme handler

## Implementation Steps

### Step 1: Install Plugin Dependencies
```bash
npm install @toast-ui/editor-plugin-code-syntax-highlight@3.1.0
npm install prismjs@1.29.0
```

### Step 2: Update esbuild Config for Plugin CSS
```javascript
// esbuild.config.js - update copyCss function
function copyCss() {
  const cssFiles = [
    'node_modules/@toast-ui/editor/dist/toastui-editor.css',
    'node_modules/@toast-ui/editor/dist/toastui-editor-dark.css',
    'node_modules/@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight.css',
    'node_modules/prismjs/themes/prism.css',
    'node_modules/prismjs/themes/prism-tomorrow.css',
  ];

  const outDir = 'out/webview';
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  cssFiles.forEach((cssPath) => {
    if (fs.existsSync(cssPath)) {
      const fileName = path.basename(cssPath);
      fs.copyFileSync(cssPath, path.join(outDir, fileName));
    } else {
      console.warn(`CSS file not found: ${cssPath}`);
    }
  });

  console.log('CSS files copied');
}
```

### Step 3: Update MarkdownEditorProvider for Theme
```typescript
// src/markdownEditorProvider.ts - add theme detection

async resolveCustomTextEditor(
  document: vscode.TextDocument,
  webviewPanel: vscode.WebviewPanel,
  _token: vscode.CancellationToken
): Promise<void> {

  // ... existing setup code ...

  // Detect current theme
  const isDarkTheme = (): boolean => {
    const theme = vscode.window.activeColorTheme;
    // ColorThemeKind: Light = 1, Dark = 2, HighContrast = 3
    return theme.kind === vscode.ColorThemeKind.Dark ||
           theme.kind === vscode.ColorThemeKind.HighContrast;
  };

  // Send initial theme
  const sendTheme = () => {
    webviewPanel.webview.postMessage({
      type: 'theme',
      isDark: isDarkTheme(),
    });
  };

  // Listen for theme changes
  disposables.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      sendTheme();
    })
  );

  // Update ready handler to also send theme
  disposables.push(
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          updateWebview();
          sendTheme(); // Send theme on ready
          break;
        case 'edit':
          await applyEdit(message.content);
          break;
      }
    })
  );

  // ... rest of code ...
}

// Update getHtmlForWebview to include CSS files
private getHtmlForWebview(webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js')
  );

  // CSS files for editor and code-syntax-highlight plugin
  const cssFiles = [
    'toastui-editor.css',
    'toastui-editor-dark.css',
    'toastui-editor-plugin-code-syntax-highlight.css',
    'prism.css',
  ];

  const cssLinks = cssFiles.map((file) => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', file)
    );
    return `<link rel="stylesheet" href="${uri}">`;
  }).join('\n');

  const nonce = getNonce();

  const csp = `
    default-src 'none';
    img-src ${webview.cspSource} https: data:;
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource} https:;
  `.replace(/\s+/g, ' ').trim();

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <title>TUI Markdown Editor</title>
      ${cssLinks}
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }
        #editor { width: 100%; height: 100vh; }
        .toastui-editor-defaultUI { border: none; }
      </style>
    </head>
    <body>
      <div id="editor"></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>
  `.trim();
}
```

### Step 4: Update Webview Script with Code Syntax Plugin
```typescript
// src/webview/main.ts
import Editor from '@toast-ui/editor';

// Import code-syntax-highlight plugin
import codeSyntaxHighlight from '@toast-ui/editor-plugin-code-syntax-highlight';

// Import Prism for syntax highlighting
import Prism from 'prismjs';
// Import common languages
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-html';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let editor: Editor | null = null;
let isUpdatingFromExtension = false;
let currentTheme: 'light' | 'dark' = 'light';

const DEBOUNCE_MS = 300;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize TUI Editor with all plugins.
 */
function initEditor(initialTheme: 'light' | 'dark' = 'light'): Editor {
  const editorEl = document.getElementById('editor');
  if (!editorEl) {
    throw new Error('Editor element not found');
  }

  currentTheme = initialTheme;

  const instance = new Editor({
    el: editorEl,
    height: '100%',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    usageStatistics: false,
    hideModeSwitch: false,
    theme: initialTheme,
    toolbarItems: [
      ['heading', 'bold', 'italic', 'strike'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task', 'indent', 'outdent'],
      ['table', 'link'],
      ['code', 'codeblock'],
      ['scrollSync'],
    ],
    // Register code-syntax-highlight plugin
    plugins: [
      [codeSyntaxHighlight, { highlighter: Prism }],
    ],
  });

  // Debounced change handler
  instance.on('change', () => {
    if (isUpdatingFromExtension) return;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const markdown = instance.getMarkdown();
      vscode.postMessage({ type: 'edit', content: markdown });
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });

  // Apply initial theme class
  applyThemeClass(initialTheme === 'dark');

  console.log('TUI Editor initialized with plugins');
  return instance;
}

/**
 * Apply theme CSS class to editor container.
 */
function applyThemeClass(isDark: boolean): void {
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;

  if (isDark) {
    editorEl.classList.add('toastui-editor-dark');
    document.body.classList.add('dark-theme');
  } else {
    editorEl.classList.remove('toastui-editor-dark');
    document.body.classList.remove('dark-theme');
  }
}

/**
 * Handle theme change from extension.
 */
function handleThemeChange(isDark: boolean): void {
  const newTheme = isDark ? 'dark' : 'light';

  if (newTheme === currentTheme) return;

  currentTheme = newTheme;
  applyThemeClass(isDark);

  // TUI Editor theme change via options
  if (editor) {
    // Note: TUI Editor doesn't have runtime theme switching
    // We rely on CSS class toggle which works for most styling
    console.log(`Theme switched to: ${newTheme}`);
  }
}

/**
 * Update editor content from extension.
 */
function updateEditorContent(content: string): void {
  if (!editor) return;

  const currentContent = editor.getMarkdown();
  if (content === currentContent) return;

  isUpdatingFromExtension = true;
  editor.setMarkdown(content);

  queueMicrotask(() => {
    isUpdatingFromExtension = false;
  });
}

/**
 * Handle messages from extension.
 */
window.addEventListener('message', (event) => {
  const message = event.data;

  switch (message.type) {
    case 'update':
      updateEditorContent(message.content);
      break;

    case 'theme':
      handleThemeChange(message.isDark);
      break;
  }
});

// Initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    editor = initEditor();
    vscode.postMessage({ type: 'ready' });
  });
} else {
  editor = initEditor();
  vscode.postMessage({ type: 'ready' });
}
```

### Step 5: Test Plugin Functionality

Create test file `test-plugins.md`:
```markdown
# Code Syntax Highlighting Test

## JavaScript

```javascript
function hello() {
  console.log('Hello, World!');
}
```

## Python

```python
def hello():
    print("Hello, World!")
```

## TypeScript

```typescript
interface User {
  name: string;
  age: number;
}
```

## Bash

```bash
echo "Hello, World!"
```
```

## Todo List

- [x] Install code-syntax-highlight plugin + prismjs
- [x] Update esbuild to copy CSS files (5 CSS files)
- [x] Add theme detection to markdownEditorProvider.ts
- [x] Update getHtmlForWebview with CSS links
- [x] Update webview/main.ts with plugin import
- [x] Implement theme change handler (CSS-based approach)
- [x] Build and test
- [x] Test code syntax highlighting
- [x] Test theme switching (light/dark)

**Note:** Prism languages auto-loaded by plugin (deviation from plan - reduces bundle size)

## Success Criteria

- Code blocks show syntax highlighting (15 languages)
- Theme switches when VS Code theme changes
- No console errors

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bundle size | Low | Only 1 plugin + 15 Prism languages |
| Theme flicker | Low | Apply theme before editor init |
| CSS conflicts | Low | Scope styles with classes |

## Security Considerations

- Code-syntax-highlight uses Prism.js (safe, no external requests)
- No external network requests
- CSP strict mode maintained

## Next Steps

After plugins work, proceed to [Phase 06: Polish & Test](./phase-06-polish-test.md) for final testing and polish.
