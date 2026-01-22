declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let currentContent = '';

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener('message', (event) => {
  const message = event.data;

  switch (message.type) {
    case 'update':
      currentContent = message.content;
      const editorEl = document.getElementById('editor');
      if (editorEl) {
        editorEl.innerHTML = `<pre style="padding: 20px; white-space: pre-wrap;">${escapeHtml(currentContent)}</pre>`;
      }
      break;
  }
});

vscode.postMessage({ type: 'ready' });
console.log('TUI Markdown webview initialized');
