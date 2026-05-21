# Editor Title Bar: Toggle Source / WYSIWYG

## Bối cảnh

Hiện tại nút "View Source" nằm trong webview toolbar (`#btn-source`). Khi click, gọi `vscode.openWith(uri, "default")` để mở text editor mặc định. Không có cách quay lại WYSIWYG từ text editor ngoài chuột phải "Reopen Editor With...".

## Mục tiêu

Thêm icon trên VSCode editor title bar (luôn hiển thị, không phụ thuộc webview) để toggle qua lại giữa WYSIWYG và source view.

## Thiết kế

### Hai command riêng biệt

| Command | Icon | Hiện khi | Hành động |
|---------|------|----------|-----------|
| `tuiMarkdown.viewSource` | `$(code)` | `activeCustomEditorId == 'tuiMarkdown.editor'` | `vscode.openWith(uri, "default")` |
| `tuiMarkdown.viewRichText` | `$(eye)` | `.md`/`.markdown` file đang mở trong text editor | `vscode.openWith(uri, "tuiMarkdown.editor")` |

### package.json: contributes

```json
"commands": [
  {
    "command": "tuiMarkdown.viewSource",
    "title": "View Source",
    "icon": "$(code)"
  },
  {
    "command": "tuiMarkdown.viewRichText",
    "title": "View Rich Text (WYSIWYG)",
    "icon": "$(eye)"
  }
],
"menus": {
  "editor/title": [
    {
      "command": "tuiMarkdown.viewSource",
      "when": "activeCustomEditorId == 'tuiMarkdown.editor'",
      "group": "navigation"
    },
    {
      "command": "tuiMarkdown.viewRichText",
      "when": "(resourceExtname == '.md' || resourceExtname == '.markdown') && activeCustomEditorId != 'tuiMarkdown.editor'",
      "group": "navigation"
    }
  ]
}
```

### extension.ts: đăng ký handler

Trong hàm `activate()`, đăng ký 2 command:

```ts
context.subscriptions.push(
  vscode.commands.registerCommand("tuiMarkdown.viewSource", () => {
    const uri = vscode.window.activeTextEditor?.document.uri
      ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
    if (uri) {
      vscode.commands.executeCommand("vscode.openWith", uri, "default");
    }
  }),
  vscode.commands.registerCommand("tuiMarkdown.viewRichText", () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      vscode.commands.executeCommand("vscode.openWith", uri, "tuiMarkdown.editor");
    }
  })
);
```

Lưu ý: khi đang ở custom editor, `activeTextEditor` là `undefined`. Cần lấy URI từ `activeTab.input`.

### Giữ nguyên nút cũ trong webview

Nút `#btn-source` và phím tắt `Ctrl/Cmd+Shift+M` vẫn hoạt động. Không thay đổi gì trong webview.

## Luồng hoạt động

```
[WYSIWYG active] → title bar hiện icon $(code)
  → Click → mở text editor mặc định (cùng file, cùng tab group)
  → title bar đổi sang icon $(eye)
  → Click → mở lại WYSIWYG custom editor
```

## Scope

- File thay đổi: `package.json`, `src/extension.ts`
- Không ảnh hưởng webview, không ảnh hưởng logic editor hiện tại
- Không thêm dependency mới
