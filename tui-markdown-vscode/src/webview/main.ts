import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let crepe: Crepe | null = null;
let isUpdatingFromExtension = false;

const DEBOUNCE_MS = 500;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message: string): void {
  const editorEl = document.getElementById('editor');
  if (editorEl) {
    editorEl.innerHTML = `
      <div style="padding: 20px; color: var(--vscode-errorForeground);">
        <h3>Error</h3>
        <p>${escapeHtml(message)}</p>
        <p>Try reopening the file or reloading the window.</p>
      </div>
    `;
  }
}

async function initEditor(initialContent: string = ''): Promise<Crepe | null> {
  console.log('[Crepe] Starting initialization...');
  const editorEl = document.getElementById('editor');
  if (!editorEl) {
    console.error('[Crepe] Editor element not found');
    showError('Editor element not found');
    return null;
  }
  console.log('[Crepe] Editor element found:', editorEl);

  try {
    console.log('[Crepe] Creating Crepe editor...');
    const instance = new Crepe({
      root: editorEl,
      defaultValue: initialContent,
    });

    instance.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        if (isUpdatingFromExtension) return;

        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          vscode.postMessage({ type: 'edit', content: markdown });
          debounceTimer = null;
        }, DEBOUNCE_MS);
      });
    });

    await instance.create();
    console.log('[Crepe] Editor created successfully!');
    return instance;
  } catch (error) {
    console.error('[Crepe] Failed to create editor:', error);
    showError(`Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function updateEditorContent(content: string): Promise<void> {
  if (!crepe) return;

  isUpdatingFromExtension = true;
  crepe.destroy();

  const editorEl = document.getElementById('editor');
  if (editorEl) {
    editorEl.innerHTML = '';
    crepe = await initEditor(content);
  }

  queueMicrotask(() => {
    isUpdatingFromExtension = false;
  });
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.body.classList.remove('dark-theme', 'light-theme');
  document.body.classList.add(`${theme}-theme`);
}

let pendingContent: string | null = null;

window.addEventListener('message', async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'update':
      if (typeof message.content === 'string') {
        if (!crepe) {
          pendingContent = message.content;
        } else {
          await updateEditorContent(message.content);
        }
      }
      break;
    case 'theme':
      if (message.theme === 'dark' || message.theme === 'light') {
        applyTheme(message.theme);
      }
      break;
  }
});

async function init() {
  console.log('[Crepe] init() called');
  crepe = await initEditor(pendingContent || '');
  pendingContent = null;
  console.log('[Crepe] init() complete, editor:', crepe ? 'created' : 'null');
  vscode.postMessage({ type: 'ready' });
}

console.log('[Crepe] Script loaded, readyState:', document.readyState);
if (document.readyState === 'loading') {
  console.log('[Crepe] Adding DOMContentLoaded listener');
  document.addEventListener('DOMContentLoaded', init);
} else {
  console.log('[Crepe] DOM already ready, calling init()');
  init();
}
