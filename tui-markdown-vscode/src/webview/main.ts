import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Strikethrough,
  Code,
  CodeBlock,
  BlockQuote,
  Link,
  List,
  TodoList,
  Table,
  TableToolbar,
  HorizontalLine,
  Autoformat,
  Indent,
  IndentBlock,
} from 'ckeditor5';
import { Markdown } from '@ckeditor/ckeditor5-markdown-gfm';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let editor: ClassicEditor | null = null;
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

async function initEditor(): Promise<ClassicEditor | null> {
  const editorEl = document.getElementById('editor');
  if (!editorEl) {
    showError('Editor element not found');
    return null;
  }

  try {
    const instance = await ClassicEditor.create(editorEl, {
      plugins: [
        Essentials,
        Paragraph,
        Heading,
        Bold,
        Italic,
        Strikethrough,
        Code,
        CodeBlock,
        BlockQuote,
        Link,
        List,
        TodoList,
        Table,
        TableToolbar,
        HorizontalLine,
        Autoformat,
        Indent,
        IndentBlock,
        Markdown,
      ],
      toolbar: [
        'heading',
        '|',
        'bold',
        'italic',
        'strikethrough',
        'code',
        '|',
        'bulletedList',
        'numberedList',
        'todoList',
        '|',
        'outdent',
        'indent',
        '|',
        'blockQuote',
        'codeBlock',
        'horizontalLine',
        '|',
        'link',
        'insertTable',
        '|',
        'undo',
        'redo',
      ],
      heading: {
        options: [
          { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
          { model: 'heading1', view: 'h1', title: 'Heading 1', class: 'ck-heading_heading1' },
          { model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
          { model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' },
          { model: 'heading4', view: 'h4', title: 'Heading 4', class: 'ck-heading_heading4' },
        ],
      },
      table: {
        contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'],
      },
      codeBlock: {
        languages: [
          { language: 'plaintext', label: 'Plain text' },
          { language: 'javascript', label: 'JavaScript' },
          { language: 'typescript', label: 'TypeScript' },
          { language: 'python', label: 'Python' },
          { language: 'html', label: 'HTML' },
          { language: 'css', label: 'CSS' },
          { language: 'json', label: 'JSON' },
          { language: 'bash', label: 'Bash' },
          { language: 'sql', label: 'SQL' },
        ],
      },
    });

    instance.model.document.on('change:data', () => {
      if (isUpdatingFromExtension) return;

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        const markdown = instance.getData();
        vscode.postMessage({ type: 'edit', content: markdown });
        debounceTimer = null;
      }, DEBOUNCE_MS);
    });

    return instance;
  } catch (error) {
    showError(`Failed to initialize editor: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function updateEditorContent(content: string): void {
  if (!editor) return;

  const currentContent = editor.getData();
  if (content === currentContent) return;

  isUpdatingFromExtension = true;
  editor.setData(content);

  queueMicrotask(() => {
    isUpdatingFromExtension = false;
  });
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.body.classList.remove('dark-theme', 'light-theme');
  document.body.classList.add(`${theme}-theme`);
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
    case 'theme':
      if (message.theme === 'dark' || message.theme === 'light') {
        applyTheme(message.theme);
      }
      break;
  }
});

async function init() {
  editor = await initEditor();
  vscode.postMessage({ type: 'ready' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
