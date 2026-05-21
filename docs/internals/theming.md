# Theming

Theme system, fonts, typography, micro-interactions, font selector.

## Theme System

CSS variables loaded from `src/webview/themes/`, scoped by body class (e.g., `.theme-frame .tiptap`). Dark theme overrides use `body.dark-theme` selector (set by `applyTheme()`).

## Font Strategy

* Default font (`--crepe-font-default`): All themes use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif` — picks the OS's native reading font (SF Pro on macOS, Segoe UI on Windows). No external font download needed.
* Crepe themes use `ui-serif, "Source Serif 4", ..., Georgia, serif` — `ui-serif` resolves to New York on macOS, excellent for long-form reading.
* Code font (`--crepe-font-code`): All themes prioritize `"Cascadia Code"` (bundled with VS Code, always available), then per-theme fallbacks (`"JetBrains Mono"` for Frame/Nord, `"Fira Code"` for Crepe/Catppuccin).
* Nord Dark uses the official Nord palette (Polar Night / Snow Storm / Frost / Aurora) — visually distinct from Frame Dark.

## Typography & Spacing

* Content max-width: 100% with fluid padding `clamp(24px, 5vw, 80px)`
* Body line-height: 1.625 (26px/16px) for optimal readability
* Heading scale: Perfect Fourth ratio (1.333) — H1:32, H2:24, H3:20, H4:16, H5:14, H6:13
* Heading margins: generous top (48-16px) for section grouping, tight bottom (16-6px) to pull toward content
* Modern CSS: `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, `font-feature-settings: "liga"`, `font-optical-sizing: auto`
* Tables can overflow content width with horizontal scroll
* `prefers-reduced-motion` disables all transitions/animations

## Micro-interactions

* Toolbar buttons: 0.15s ease-out transitions
* Code blocks: hover border, focus ring on edit
* Images: 6px border-radius, hover shadow, accent outline on selection (`ProseMirror-selectednode`)
* Links: underline slide-in via `background-size` transition
* Table rows: hover highlight, zebra striping
* Blockquotes: border thickens on hover (3px→4px)
* Heading badges: opacity increases on hover (0.5→0.8)
* Line highlight: subtle 0.04/0.05 opacity (light/dark)

## Font Selector

**Module** (`src/webview/font-selector.ts`):

* Searchable combobox component: text input + dropdown with all system fonts
* `sanitizeFontName()`: Strips `";\{}` characters to prevent CSS injection
* Search ranking: prefix matches first, then contains matches, max 80 displayed
* Each dropdown item previewed in its own font face
* Keyboard: Arrow keys navigate, Enter selects, Escape closes
* API: `setFonts()`, `setSelected()`, `getSelected()`, `destroy()`

**System Font Enumeration** (`src/markdownEditorProvider.ts`):

* macOS: `NSFontManager` via JXA (`osascript -l JavaScript`)
* Windows: PowerShell `InstalledFontCollection` with UTF-8 encoding
* Linux: `fc-list : family`
* Cached as `static cachedFonts` — enumerated once per VSCode session

**Data Flow**:

1. Webview `ready` → Extension sends `savedFont` (from `globalState`) + async `systemFonts`
2. User selects font → Webview overrides `--crepe-font-default` CSS var on `.tiptap` element
3. Webview persists via `vscode.setState({ fontFamily })` + sends `fontChange` message
4. Extension saves to `context.globalState` key `"markdownEditorFont"`
5. "Default" option removes CSS override, restoring theme's built-in font

**Key details**:

* Only overrides `--crepe-font-default` — never touches `--crepe-font-code`
* Font override survives theme changes (inline style > CSS class)
* `try/catch` around async `postMessage` to handle webview disposed during font enum
