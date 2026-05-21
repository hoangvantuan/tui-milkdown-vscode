# Alerts & Code Block

GitHub-style alerts, code block enhancement.

## GitHub-Style Alerts

**Extension** (`src/webview/alert-extension.ts`):

* Custom `AlertNode` Tiptap node for `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
* **Integration**: Blockquote extension (from StarterKit) is extended in `main.ts` to override `parseMarkdown` — detects `[!TYPE]` prefix and creates `alert` node instead of `blockquote`
* **Serialization**: `renderMarkdown()` outputs `> [!TYPE]\n> content` format
* **DOM output**: `<div data-alert-type="note" class="alert alert-note">...</div>`
* **Helper functions**: `getFirstText()` walks token children, `stripAlertPrefix()` removes `[!TYPE]` from parsed tokens

**CSS**: Color-coded alert boxes with icons, dark theme support (in `markdownEditorProvider.ts`)

## Code Block Enhancement

**Plugin** (`src/webview/code-block-plugin.ts`):

* Tiptap Extension using ProseMirror `Decoration.widget` at `pos + 1` (inside codeBlock, before content)
* **Language badge**: Displays normalized language name with chevron; click opens dropdown selector (19 languages)
* **Copy button**: Clipboard icon, appears on code block hover (`opacity: 0` → `0.6`); checkmark feedback on copy (1.5s)
* **Language aliases**: Maps common abbreviations (`js`→`javascript`, `ts`→`typescript`, `py`→`python`, etc.)
* **Mermaid skip**: Ignores `language === "mermaid"` blocks (handled by mermaid-plugin)
* **Selective rebuild**: Only rebuilds decorations on `tr.docChanged` (not selection changes)

**CSS classes**: `.code-block-header`, `.code-lang-badge`, `.code-lang-dropdown`, `.code-lang-item`, `.code-copy-btn`
