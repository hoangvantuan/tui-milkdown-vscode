import Editor from '@toast-ui/editor';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let editor: Editor | null = null;
let isUpdatingFromExtension = false;

const DEBOUNCE_MS = 500;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function initEditor(): Editor {
  const editorEl = document.getElementById('editor');
  if (!editorEl) {
    throw new Error('Editor element not found');
  }

  const instance = new Editor({
    el: editorEl,
    height: '100%',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    usageStatistics: false,
    hideModeSwitch: false,
    toolbarItems: [
      ['heading', 'bold', 'italic', 'strike'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task', 'indent', 'outdent'],
      ['table', 'link'],
      ['code', 'codeblock'],
      ['scrollSync'],
    ],
  });

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

  return instance;
}

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

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'update':
      if (typeof message.content === 'string') {
        updateEditorContent(message.content);
      }
      break;
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    editor = initEditor();
    vscode.postMessage({ type: 'ready' });
  });
} else {
  editor = initEditor();
  vscode.postMessage({ type: 'ready' });
}
