---
project_name: tui-milkdown-vscode
user_name: shun
date: 2026-04-13
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - quality_rules
  - workflow_rules
  - anti_patterns
status: complete
optimized_for_llm: true
---

# Project Context for AI Agents

_Quy tắc và pattern bắt buộc khi viết code cho dự án này. Tập trung vào chi tiết không hiển nhiên mà AI agent dễ bỏ sót._

---

## Technology Stack & Versions

**Runtime & Build**
- VSCode Extension API `^1.85.0` (target: `engines.vscode ^1.85.0`)
- TypeScript `^5.3.0` — strict mode, target `ES2020`, module `ES2020`, moduleResolution `bundler`
- esbuild `^0.20.0` — dual-bundle build (không dùng webpack/rollup)
- Node types `^25.0.10`

**Editor core**
- `@tiptap/core` + `@tiptap/starter-kit` + `@tiptap/pm` — all `^3.19.0` (Tiptap v3)
- `@tiptap/markdown ^3.19.0` (Beta, MarkedJS-based parser)
- Extensions Tiptap v3: `extension-code-block-lowlight`, `extension-highlight`, `extension-image`, `extension-link`, `extension-list`, `extension-paragraph`, `extension-placeholder`, `extension-table` — all `^3.19.0`
- `prosemirror-search ^1.1.0` (cho Cmd+F)
- `lowlight ^3.3.0` (syntax highlighting)
- `mermaid ^11.12.2` (SVG diagram preview)
- `js-yaml ^4.1.1` (frontmatter YAML)

**Quan trọng về version:**
- KHÔNG upgrade Tiptap lên version khác — API v3 khác v2 rõ rệt (ví dụ `editor.getMarkdown()`, `renderMarkdown` hook).
- Node naming Tiptap v3: **camelCase** (`listItem`, `codeBlock`, `taskList`, `taskItem`, `tableCell`, `tableHeader`) — KHÔNG phải `list_item`.
- Không thêm dependency mới mà không cân nhắc bundle size — extension phải chạy nhanh trong webview.

---

## Critical Implementation Rules

### Language-Specific Rules (TypeScript)

- **Strict mode bắt buộc** — `tsconfig.json` bật `strict: true`, không dùng `any` ngầm, không bỏ qua null check.
- **Import kiểu named** — luôn dùng `import { Image } from '@tiptap/extension-image'` thay vì import cả package. Tối ưu tree-shake.
- **Không dùng CommonJS `require`** ở webview bundle (build IIFE browser). Extension bundle (`src/extension.ts`) là CJS Node platform — khác biệt phải tôn trọng.
- **File naming**: kebab-case (ví dụ `image-edit-plugin.ts`, `toc-sidebar.ts`, `clean-image-path.ts`). Không PascalCase cho file.
- **Async message flow** thay cho `prompt()` — VSCode webview sandbox BLOCK `prompt()`, `confirm()`, `alert()`. Phải gửi message sang extension (`showInputBox`) rồi nhận phản hồi qua `onDidReceiveMessage`.
- **XSS safe**: dùng `textContent` chứ KHÔNG dùng `innerHTML` khi render dữ liệu từ doc (ví dụ TOC, heading text).
- **CSS injection safe**: khi nhận user input cho font/CSS, phải strip `` ` ; \ { } `` (xem `sanitizeFontName()`).

### Framework-Specific Rules (VSCode + Tiptap + ProseMirror)

**Extension ↔ Webview**
- Giao tiếp qua `postMessage` 2 chiều. Mọi hành động cần VSCode API (file I/O, dialog, clipboard native) phải đi qua extension side.
- `pendingEdit` flag phải set/clear đúng để tránh edit loop giữa extension và webview khi `update` message đến.
- `localResourceRoots` phải include document folder + workspace để load ảnh local.
- CSP bắt buộc dùng `nonce` cho script execution — lấy từ `getNonce()`.

**Tiptap-first**
- ƯU TIÊN extension built-in của Tiptap trước khi viết ProseMirror plugin custom. Check `@tiptap/extension-*` và `@tiptap/starter-kit` trước.
- Content update dùng `editor.commands.setContent(md, { contentType: 'markdown' })` — KHÔNG destroy/recreate editor. Lưu/khôi phục cursor quanh `setContent`.
- Custom extension dùng hook `renderMarkdown(node, helpers)` và `parseMarkdown(token, helpers)` thay vì serialize thủ công.

**ProseMirror plugin**
- Decoration-based cho visual-only features (line highlight, heading badge, heading collapse, code header, search highlight). KHÔNG thay đổi schema nếu chỉ là UI.
- Widget decoration ở `pos + 1` (inside node, before content) cho heading badge, code block header, mermaid preview.
- Selective rebuild: chỉ rebuild decoration khi `tr.docChanged` — không rebuild trên selection change (tránh flicker, giữ DOM mermaid/cached).

**State persistence**
- `vscode.setState()` PHẢI dùng spread pattern: `{ ...getState(), key: value }` — đè cả object sẽ mất theme, TOC, font.
- Các key đang dùng: `theme`, `tocVisible`, `collapsedHeadings`, `fontFamily`. Thêm mới phải theo cùng pattern.

**Task list CSS gotcha**
- Selector PHẢI dùng direct child: `ul[data-type="taskList"] > li`. Descendant combinator làm leak `display: flex` xuống list con, vỡ layout.

### Testing Rules

- **Không có test framework** trong dự án hiện tại. `npm run lint` (= `tsc --noEmit`) là cổng kiểm tra duy nhất.
- Khi thêm feature: verify bằng cách build (`npm run build:dev`), mở `.md` thực trong VSCode Extension Host, test golden path + edge case thủ công.
- Với UI change: MUST test trong browser/VSCode thực — type check không đảm bảo feature đúng. Nếu không test được UI, nói rõ thay vì claim success.
- Nếu thêm test sau này: file naming `*.test.ts` bên cạnh source, không dùng snapshot cho markdown output (fragile), luôn test markdown round-trip (parse → serialize → parse).

### Code Quality & Style Rules

- **Không viết comment giải thích WHAT** — tên biến/hàm tự nói. Chỉ comment WHY khi có ràng buộc ẩn, invariant tinh tế, workaround bug cụ thể.
- **Không viết docstring nhiều dòng** — tối đa 1 dòng ngắn.
- **Tác động tối thiểu**: chỉ sửa phần liên quan trực tiếp tới yêu cầu. KHÔNG refactor code lân cận, KHÔNG "cải thiện" style, KHÔNG dọn dead code pre-existing (chỉ dọn orphan do thay đổi của chính mình tạo ra).
- **Match style hiện tại** dù thấy không thích.
- **Theme CSS**: dùng biến `--crepe-color-*`, `--crepe-font-*`, `--accent-rgb` thay vì hard-code màu/font. Theme mới phải expose body-level vars cho toolbar (ngoài `.tiptap`).
- **Dark theme**: override qua selector `body.dark-theme` (set bởi `applyTheme()`), không tạo file CSS riêng.
- **`prefers-reduced-motion`**: mọi transition/animation mới phải tắt khi user bật reduce motion.

### Development Workflow Rules

- **Build dual-bundle** qua `esbuild.config.js`:
  - Extension: `src/extension.ts` → `out/extension.js` (CJS, Node)
  - Webview: `src/webview/main.ts` → `out/webview/main.js` (IIFE, browser)
- Lệnh: `npm run build` (prod minified), `npm run build:dev` (sourcemap), `npm run watch` (dev), `npm run lint` (tsc noEmit), `npm run package` (vsce).
- **Commit message**: imperative mood, tiếng Việt, dòng đầu ≤72 ký tự. `git add` theo file cụ thể, tránh `git add -A`.
- **Không amend** commit đã push. Hook fail → fix root cause → tạo commit MỚI.
- **Branch hiện tại**: `develop` (main branch cho PR cũng là `develop`).
- **GitNexus**: BẮT BUỘC chạy `gitnexus_impact` trước khi sửa symbol, `gitnexus_detect_changes` trước khi commit. Risk HIGH/CRITICAL phải cảnh báo user. Rename phải dùng `gitnexus_rename` (dry run trước).
- **Tài liệu sau mỗi chu kỳ**: update `CHANGELOG.md` (mọi thay đổi), `README.md` (feature user-facing), `CLAUDE.md` (kiến trúc/lesson mới).

### Critical Don't-Miss Rules

**Anti-patterns phải tránh**
- KHÔNG dùng `prompt()/confirm()/alert()` trong webview — bị sandbox block. Dùng message flow qua extension.
- KHÔNG destroy/recreate Tiptap editor khi update content — dùng `setContent()`.
- KHÔNG ghi đè `vscode.setState()` bằng object mới — luôn spread state cũ.
- KHÔNG dùng `innerHTML` với dữ liệu từ document (XSS). Dùng `textContent`.
- KHÔNG viết `ul[data-type="taskList"] li` (descendant) — phải `>` direct child.
- KHÔNG đặt tên node Tiptap snake_case (`list_item`) — v3 camelCase (`listItem`).
- KHÔNG thay thế path/URL ngoài ngữ cảnh markdown image/link syntax — workspace reference update phải skip code block (fenced + inline).
- KHÔNG xoá pre-existing dead code khi không được yêu cầu — chỉ mention.
- KHÔNG thêm error handling/validation cho kịch bản không thể xảy ra; chỉ validate ở biên (user input, external API).
- KHÔNG dùng `--no-verify` khi commit.

**Edge case phải xử lý**
- File >500KB: cảnh báo user trước khi mở.
- Image >10MB khi paste/drop: chặn và gửi `showWarning`.
- Clipboard image fallback 3 tầng: `handlePaste` → `navigator.clipboard.read()` → native (osascript/PowerShell/xclip).
- Empty paragraph round-trip: `BlankLineHandler` parse MarkedJS `space` token; `Document.extend({ renderMarkdown })` serialize `\n` single (không `\n\n`).
- Heading collapse key phải ổn định qua position shift: `"H{level}:{text}:{occurrence}"`.
- Mermaid: skip code block `language === "mermaid"` trong code-block-plugin (đã xử lý bởi mermaid-plugin).
- Auto rename image chỉ trigger khi folder không đổi; auto delete phải check reference ở `.md` khác trước khi move to Trash.
- Link click: chỉ điều hướng khi Ctrl/Cmd+Click; click thường đặt cursor.

**Security**
- CSP với nonce cho script webview. KHÔNG inline script không nonce.
- KHÔNG log/commit: `.env`, `*.key`, `credentials.json`, `*.pem`, `id_rsa`.
- KHÔNG in API key/token ra console.
- Sanitize font name trước khi inject vào CSS var.
- Không trust path từ webview — extension phải resolve và validate qua `document.uri.fsPath`.

**Performance gotchas**
- Debounce edit message: 300ms (webview → extension).
- Debounce word count: 500ms.
- Debounce search input: 150ms.
- Debounce mermaid render: 500ms/position.
- Debounce TOC rebuild: 200ms (docChanged).
- Render cache mermaid: `Map` theo source; clear khi đổi theme.
- System font enumeration: cache 1 lần/session (static `cachedFonts`).
- Reading progress: dùng `passive: true` listener.
- Selective decoration rebuild: check `tr.docChanged` trước khi rebuild.

---

## Usage Guidelines

**Cho AI agent:**
- Đọc file này TRƯỚC khi sửa code. Theo đúng từng quy tắc.
- Khi nghi ngờ: chọn phương án ít rủi ro, tác động tối thiểu.
- Phát hiện pattern mới không được ghi ở đây: đề xuất cập nhật file, không tự suy diễn.
- Mọi thay đổi Tiptap/ProseMirror phải test round-trip markdown (parse → serialize → parse).

**Cho con người:**
- Giữ file gọn, tập trung vào điều agent cần.
- Cập nhật khi đổi tech stack (đặc biệt Tiptap version).
- Review định kỳ, xoá rule đã thành hiển nhiên.
- Đồng bộ với `CLAUDE.md` nhưng KHÔNG lặp lại — file này là "rule", `CLAUDE.md` là "kiến thức kiến trúc".

_Last Updated: 2026-04-13_
