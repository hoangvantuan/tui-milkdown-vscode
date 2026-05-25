# Premium Editor Design System

**Date:** 2026-05-25
**Status:** Draft, pending user review
**Scope:** Research-backed redesign of the Tiptap-based markdown editor for tui-milkdown-vscode. Establishes a token-driven design system, upgrades 11 component areas, refreshes 12 legacy themes, and adds a flagship "Soft Modular" theme (light + dark).

## 0. Context & Locked Decisions

### Brand direction

Hybrid premium aesthetic blending three references:

- **Bear / Ulysses** — Apple-native typography, paper-warm surfaces, generous breathing room.
- **Craft / Notion** — soft modular blocks, friendly micro-interactions, tinted accent palette.
- **Linear / Arc** — utility-premium motion, hairline borders, dark-first sophistication.

Soft Modular (Craft x Notion bias) is the flagship. Other references inform tokens but do not get their own dedicated themes.

### Three pillars

1. **Typography** — premium font stacks, optical sizing, perfect-fourth scale, prose-width constraint.
2. **Motion** — 4 easing tokens, 4 duration tokens, composed motion primitives.
3. **Material** — 5 elevation levels, tinted shadows, glass restricted to popover and modal layers.

### Locked decisions (open questions resolved)

| Question | Decision |
|---|---|
| Default theme after migration | **Keep Frame** as default. Soft Modular is opt-in. |
| CSS bundle size increase | **OK up to ~20KB** (token primitives + flagship theme). |
| Inter font delivery | **System stack only.** No local bundling. Fallback to `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`. |
| Light + dark in one file | **Keep 2 files per theme.** Honors current convention. Both files import shared semantic from `_semantic/`. |
| Legacy theme refresh phase | **Phase 1.5** (between Foundation and Flagship). Mandatory, not optional. |

### Out of scope

- Command palette UX, focus mode, distraction-free mode (deferred to a future spec).
- Sound, haptics, iconography overhaul.
- New theme variants beyond Soft Modular (Tokyo Night, Gruvbox, Rosé Pine, etc.) — can ship later as standalone themes.

## 1. Research Foundation

### Pillar 1: Typography is the kingdom

Premium editors invest most heavily in typography. Reference patterns:

- **Bear / Ulysses** — serif body for long-form reading, sans-serif for chrome. Perfect-fourth heading scale (1.333 ratio).
- **Craft** — Inter / SF Pro with `font-feature-settings: "ss01", "cv11"`. Heading letter-spacing slightly negative for visual tightness.
- **Linear** — Inter Tight, tight line-height (1.5), `font-variant-numeric: tabular-nums` for UI consistency.

**Decisions:**

- Body uses sans (`Inter`, falling back to system) with `font-optical-sizing: auto`.
- Prose width capped at 72ch with a Wide-mode toggle.
- Heading scale follows perfect-fourth with hierarchy-specific letter-spacing and line-height (see §3.1).

### Pillar 2: Motion needs a vocabulary

Premium motion is consistent: every transition draws from a small token set. Reference patterns:

- **Craft** — `cubic-bezier(0.2, 0, 0, 1)` for entry, ease-in for exit, 150–250ms.
- **Linear** — `cubic-bezier(0.4, 0, 0.2, 1)` snap, 120ms hover, 200ms panels.
- **Apple HIG** — spring physics, never linear.

**Decisions:**

- 4 easing tokens: `--ease-emphasized`, `--ease-standard`, `--ease-decelerate`, `--ease-accelerate`.
- 4 duration tokens: `--duration-instant` (80ms), `--duration-fast` (120ms), `--duration-base` (200ms), `--duration-slow` (300ms).
- 3 composed motion primitives: `--motion-hover`, `--motion-press`, `--motion-panel`.
- `prefers-reduced-motion` disables all transitions globally.

### Pillar 3: Material is more than glass

Premium UIs separate z-axis through layered surface + shadow + (optional) blur, not glass everywhere. Reference patterns:

- **Craft** — accent-tinted shadows (e.g. `0 4px 12px rgba(99, 102, 241, 0.08)`).
- **Linear** — gradient hairline borders, inner shadows for inset feel.
- Glass is reserved for popover and modal layers only; surfaces and cards stay solid.

**Decisions:**

- 5 elevation tokens: `flat`, `raised`, `overlay`, `popover`, `modal`.
- Shadows tint with accent at `--elevation-accent` (signature move).
- Glass applies only to `popover` and `modal` materials, with `@supports` solid fallback.

### "Sufficiently premium" verification criteria

1. First 5 seconds in the editor reveal no cheap-feeling elements: heavy shadows, 1px black borders, default fonts, linear motion.
2. Every transition uses a token from the same family. No stray durations like 50ms or 500ms.
3. Light and dark modes feel equally polished. Neither feels like a placeholder.
4. Toolbar, editor surface, and popover layers read as distinct z-axis tiers via material, not shadow alone.

## 2. Token Architecture

### File structure

```
src/webview/themes/
├── index.css                    # Import all
├── _tokens/                     # NEW: primitives (never consumed directly by components)
│   ├── palette.css              # Raw color palette
│   ├── typography.css           # Font stacks, type scale primitives
│   ├── motion.css               # Easing + duration tokens
│   ├── elevation.css            # Shadow primitives per z-level
│   └── radius.css               # Border-radius scale
├── _semantic/                   # NEW: semantic mapping (consumed by components)
│   ├── light.css                # Default light semantics
│   └── dark.css                 # Default dark semantics
├── _adapter/                    # NEW: backwards-compat layer
│   └── legacy-aliases.css       # Map --crepe-* → semantic tokens
├── soft-modular.css             # NEW: flagship light theme
├── soft-modular-dark.css        # NEW: flagship dark theme
└── (12 existing theme files)    # Refreshed in Phase 1.5
```

### Three-tier token model

**Tier 1 — Primitive (raw values):** `_tokens/*`. Never referenced by component CSS.

```css
:root {
  --slate-50: #F8FAFC;  --slate-900: #0F172A;
  --indigo-500: #6366F1;
  --space-1: 4px;  --space-12: 48px;
  --radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 12px;
}
```

**Tier 2 — Semantic (role-based):** scoped to a theme class.

```css
.theme-soft-modular {
  --surface-base: var(--cream-50);
  --surface-raised: #FFFFFF;
  --text-primary: var(--slate-900);
  --accent-primary: var(--indigo-500);
}
```

**Tier 3 — Component:** components only reference semantic tokens.

```css
.toolbar-btn { background: var(--surface-raised); color: var(--text-primary); }
.toolbar-btn:hover { background: var(--accent-soft); }
```

### Naming convention

| Prefix | Purpose | Examples |
|---|---|---|
| `--surface-*` | Background layers | `surface-base`, `surface-raised`, `surface-sunken`, `surface-overlay`, `surface-scrim` |
| `--text-*` | Foreground roles | `text-primary`, `text-secondary`, `text-muted`, `text-inverse`, `text-accent` |
| `--accent-*` | Accent | `accent-primary`, `accent-soft`, `accent-strong` |
| `--border-*` | Outlines | `border-subtle`, `border-strong`, `border-focus` |
| `--state-*` | Feedback colors | `state-success`, `state-warning`, `state-danger`, `state-info` |
| `--motion-*` | Easing + duration tokens | `motion-fast`, `motion-easing-emphasized` |
| `--elevation-*` | Shadow stacks | `elevation-raised`, `elevation-popover` |
| `--radius-*` | Border-radius | `radius-sm`, `radius-md`, `radius-lg` |
| `--font-*` | Type stacks | `font-prose`, `font-display`, `font-mono` |

Rules:

- Never include color names in semantic tokens (`--blue-button` is wrong; `--accent-primary` is right).
- Never use numbered tiers for shadows (`--shadow-1`); use z-axis names (`--elevation-raised`).
- All tokens are kebab-case.

### Light/dark strategy

The flagship theme keeps light and dark as 2 separate files (per user's locked decision and existing convention). Both files share the same theme class and override semantics:

```css
/* soft-modular.css */
.theme-soft-modular { /* light semantic tokens */ }

/* soft-modular-dark.css */
.theme-soft-modular-dark { /* dark semantic tokens */ }
```

Primitive tokens (palette) remain shared and untouched.

### Backwards-compatibility adapter

`_adapter/legacy-aliases.css` maps legacy `--crepe-color-*` variables to the new semantic tokens, allowing the 12 existing themes to keep working without modification:

```css
:root {
  --surface-base: var(--crepe-color-background, white);
  --surface-sunken: var(--crepe-color-surface, #f5f5f5);
  --text-primary: var(--crepe-color-on-background, black);
  --accent-primary: var(--crepe-color-primary, #0066cc);
  --border-subtle: var(--crepe-color-outline, #e0e0e0);
}
```

New components consume semantic tokens; legacy themes provide them through the adapter without changing their files.

### Verification

| Check | How |
|---|---|
| No primitive leakage | `grep` component CSS — must not match `--slate-*`, `--indigo-*` outside `_tokens/` |
| Light/dark parity | Screenshot both, compare contrast ratios |
| Adapter live | Load Frame theme, DevTools check `--surface-base` resolves |
| Naming consistency | Lint rule: variables must start with one of the 9 prefixes |

## 3. Detailed Tokens

### 3.1 Typography

**Font stacks:**

```css
--font-prose:    "Inter", -apple-system, "SF Pro Text", BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
--font-display:  "Inter Display", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-serif:    ui-serif, "Source Serif 4", "New York", Georgia, serif;
--font-mono:     "Cascadia Code", "JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Menlo, monospace;
```

Inter features: `"ss01", "cv11", "calt", "liga"` (straight `i`, single-storey `a`, programming ligatures). Optical sizing auto on display headings.

**Scale (perfect-fourth, with hierarchy-specific tracking and leading):**

| Token | Size | Line-height | Letter-spacing | Weight |
|---|---|---|---|---|
| `--text-display` | 40px | 1.15 | -0.025em | 700 |
| `--text-h1` | 32px | 1.2 | -0.02em | 700 |
| `--text-h2` | 26px | 1.25 | -0.015em | 650 |
| `--text-h3` | 21px | 1.3 | -0.01em | 600 |
| `--text-h4` | 18px | 1.4 | -0.005em | 600 |
| `--text-h5` | 16px | 1.45 | 0 | 600 |
| `--text-h6` | 14px | 1.5 | 0.01em | 600 |
| `--text-body` | 16px | 1.625 | 0 | 400 |
| `--text-small` | 14px | 1.5 | 0.005em | 400 |
| `--text-micro` | 12px | 1.4 | 0.015em | 500 |
| `--text-code` | 14px | 1.55 | 0 | 450 |

**Prose constraints:**

```css
--prose-width: 72ch;
--prose-padding-x: clamp(24px, 5vw, 80px);
--prose-padding-y: clamp(32px, 6vh, 64px);
```

**Heading rhythm (top : bottom margin):**

- H1: 64px / 16px
- H2: 48px / 14px
- H3: 36px / 12px
- H4–H6: 24px / 10px

Paragraphs use `text-wrap: pretty`. Headings use `text-wrap: balance`.

### 3.2 Color (Soft Modular)

**Primitive palette:**

```css
/* Slate (neutral) */
--slate-50:  #F8FAFC;  --slate-100: #F1F5F9;  --slate-200: #E2E8F0;
--slate-300: #CBD5E1;  --slate-400: #94A3B8;  --slate-500: #64748B;
--slate-600: #475569;  --slate-700: #334155;  --slate-800: #1E293B;
--slate-900: #0F172A;  --slate-950: #020617;

/* Cream (warm surfaces) */
--cream-50:  #FDFCF8;  --cream-100: #FAF7F0;  --cream-200: #F4EFE3;

/* Accent palette */
--indigo-500: #6366F1;   --indigo-600: #4F46E5;
--peach-400:  #FB923C;   --peach-500:  #F97316;
--sage-500:   #10B981;   --sage-600:   #059669;
--rose-500:   #F43F5E;   --rose-600:   #E11D48;
```

**Semantic — Light (`.theme-soft-modular`):**

```css
--surface-base:    var(--cream-50);
--surface-raised:  #FFFFFF;
--surface-sunken:  var(--slate-100);
--surface-overlay: rgba(255,255,255,0.78);
--surface-scrim:   rgba(15,23,42,0.4);

--text-primary:    var(--slate-900);
--text-secondary:  var(--slate-600);
--text-muted:      var(--slate-400);
--text-inverse:    var(--cream-50);
--text-accent:     var(--indigo-600);

--accent-primary:  var(--indigo-500);
--accent-soft:     color-mix(in oklch, var(--indigo-500) 12%, transparent);
--accent-strong:   var(--indigo-600);

--border-subtle:   var(--slate-200);
--border-strong:   var(--slate-300);
--border-focus:    var(--indigo-500);

--state-success:   var(--sage-500);
--state-warning:   var(--peach-500);
--state-danger:    var(--rose-500);
--state-info:      var(--indigo-500);
```

**Semantic — Dark (`.theme-soft-modular-dark`):**

```css
--surface-base:    var(--slate-950);
--surface-raised:  var(--slate-900);
--surface-sunken:  #000308;
--surface-overlay: rgba(15,23,42,0.78);
--surface-scrim:   rgba(0,0,0,0.6);

--text-primary:    #F8FAFC;
--text-secondary:  var(--slate-300);
--text-muted:      var(--slate-500);
--text-inverse:    var(--slate-900);
--text-accent:     #818CF8;

--accent-primary:  #818CF8;
--accent-soft:     color-mix(in oklch, #818CF8 18%, transparent);
--accent-strong:   var(--indigo-500);

--border-subtle:   rgba(255,255,255,0.08);
--border-strong:   rgba(255,255,255,0.14);
--border-focus:    #818CF8;
```

**Contrast targets:** every text-on-surface pair meets WCAG AA (4.5:1). Body text targets AAA (7:1).

### 3.3 Motion

**Easing tokens:**

```css
--ease-emphasized:  cubic-bezier(0.2, 0, 0, 1);
--ease-standard:    cubic-bezier(0.4, 0, 0.2, 1);
--ease-decelerate:  cubic-bezier(0, 0, 0.2, 1);
--ease-accelerate:  cubic-bezier(0.4, 0, 1, 1);
```

**Duration tokens:**

```css
--duration-instant: 80ms;
--duration-fast:    120ms;
--duration-base:    200ms;
--duration-slow:    300ms;
```

**Composed primitives:**

```css
--motion-hover: color    var(--duration-instant) var(--ease-standard),
                background-color var(--duration-instant) var(--ease-standard);
--motion-press: transform var(--duration-fast) var(--ease-emphasized);
--motion-panel: opacity   var(--duration-base) var(--ease-decelerate),
                transform var(--duration-base) var(--ease-decelerate);
```

**Rules:**

1. Hover changes only color/background. Never transform.
2. Press uses `transform: scale(0.97)`. Never opacity.
3. Panel entry uses opacity 0→1 + translateY 4px→0.
4. All transitions must reference a token. No inline durations.

**Reduce-motion override:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 3.4 Material & elevation

**Radius:**

```css
--radius-xs:   4px;
--radius-sm:   6px;
--radius-md:   8px;
--radius-lg:   12px;
--radius-xl:   16px;
--radius-full: 9999px;
```

**Elevation:**

```css
--elevation-flat:    none;
--elevation-raised:  0 1px 2px  rgba(15,23,42,0.04),
                     0 2px 4px  rgba(15,23,42,0.04);
--elevation-overlay: 0 4px 8px  rgba(15,23,42,0.06),
                     0 8px 16px rgba(15,23,42,0.06);
--elevation-popover: 0 8px 16px rgba(15,23,42,0.08),
                     0 16px 32px rgba(15,23,42,0.08),
                     0 0 0 1px  rgba(15,23,42,0.04);
--elevation-modal:   0 16px 32px rgba(15,23,42,0.12),
                     0 32px 64px rgba(15,23,42,0.16),
                     0 0 0 1px   rgba(15,23,42,0.06);
```

**Accent-tinted shadow:**

```css
--elevation-accent: 0 4px 12px  color-mix(in oklch, var(--accent-primary) 24%, transparent),
                    0 8px 24px  color-mix(in oklch, var(--accent-primary) 12%, transparent);
```

**Glass material:**

```css
.glass {
  background: var(--surface-overlay);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--border-subtle);
}
@supports not (backdrop-filter: blur(16px)) {
  .glass { background: var(--surface-raised); }
}
```

**Gradient hairline border:**

```css
.gradient-border {
  position: relative;
  background: var(--surface-raised);
}
.gradient-border::before {
  content: "";
  position: absolute; inset: 0;
  padding: 1px; border-radius: inherit;
  background: linear-gradient(135deg, var(--accent-primary), transparent);
  -webkit-mask: linear-gradient(white, white) content-box, linear-gradient(white, white);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none;
}
```

## 4. Component Upgrades

### 4.1 Toolbar

- Background: `var(--surface-overlay)` + `backdrop-filter: blur(16px) saturate(180%)`.
- Bottom border: hairline `var(--border-subtle)`.
- Button group separators: 1px vertical, 18px tall (not full height).
- Idle button: transparent, `color: var(--text-secondary)`.
- Hover: `background: var(--accent-soft)`, `color: var(--text-primary)`, transition `--motion-hover`.
- Active (`.is-active`): `background: var(--accent-soft)`, `color: var(--accent-strong)`, no scale.
- Press: `transform: scale(0.94)` with `--ease-emphasized`.
- Icon stroke width: 1.75px (down from 2px).
- Select dropdowns: `--radius-sm`, chevron icon replaces text arrow.

**Files:** `src/markdownEditorProvider.ts` (HTML + CSS), `src/webview/main.ts` (state class).

### 4.2 Editor surface

- `max-width: var(--prose-width)` default; Wide-mode toggle removes the cap.
- Padding-x: `var(--prose-padding-x)`. Padding-top: `var(--prose-padding-y)`.
- Background: `var(--surface-base)`.
- Caret: `caret-color: var(--accent-primary)`, 2px width.
- Selection: `::selection { background: var(--accent-soft); color: var(--text-primary); }`.

**Files:** `src/markdownEditorProvider.ts` (CSS).

### 4.3 Block-level elements

- **Paragraph:** uses `--text-body`, `text-wrap: pretty`.
- **Heading:** applies §3.1 scale; level badges (H1–H6) appear on hover only, opacity 0 → 0.4 via `--motion-hover`.
- **Blockquote:** 3px left border `var(--border-subtle)`; on hover thickens to 4px and shifts to `var(--accent-primary)` via `--motion-hover`. Padding-left 20px, color `var(--text-secondary)`.
- **Lists:** bullets outside the prose column, color `var(--accent-primary)` at 0.6 opacity. Task list checkboxes custom-rendered with `var(--radius-xs)`, border `var(--border-strong)`, and an SVG check icon.
- **Page break (`---`):** keeps current "✦ PAGE BREAK ✦" treatment but recolored to `var(--text-muted)` over dashed `var(--border-subtle)`.

**Files:** `src/markdownEditorProvider.ts` (CSS).

### 4.4 Code block

- Container: `var(--surface-sunken)` background, `1px solid var(--border-subtle)`, `var(--radius-md)`, padding 16px 20px.
- Header (language badge + copy button): transparent background; language badge in `--text-micro`, `var(--text-muted)`, uppercase, letter-spacing 0.05em; copy button icon-only with `var(--accent-soft)` hover.
- Inline `code` (outside `pre`): `background: var(--accent-soft)`, `color: var(--text-accent)`, padding 2px 6px, `var(--radius-xs)`, `font: var(--font-mono)`, size 0.9em.

**Files:** `src/webview/code-block-plugin.ts`, `src/markdownEditorProvider.ts` (CSS).

### 4.5 Image

- `border-radius: var(--radius-md)` (8px).
- Hover: elevation flat → raised via `--motion-panel`.
- Selected (`ProseMirror-selectednode`): `outline: 2px solid var(--border-focus)` with 4px offset.
- Expand button: icon-only on `var(--surface-overlay)` with 8px blur.
- Lightbox backdrop: `var(--surface-scrim)` + `backdrop-filter: blur(8px)`.

**Files:** `src/webview/image-edit-plugin.ts`, `src/webview/image-lightbox-plugin.ts`, CSS in provider.

### 4.6 Table

- Outer border: `1px solid var(--border-subtle)`, `var(--radius-md)`, `overflow: hidden` to clip rounded corners.
- Header row: `background: var(--surface-sunken)`, `color: var(--text-secondary)`, `--text-micro`, uppercase, letter-spacing 0.05em.
- Row hover: `background: var(--accent-soft)`, transition `--motion-hover`.
- Zebra striping removed (row hover replaces it; revisit if users miss it).
- Cell padding: 12px 16px.
- Resize handle: visible only on column boundary hover, color `var(--accent-primary)`.

**Files:** `src/markdownEditorProvider.ts` (CSS).

### 4.7 Popover (unified `.glass-popover`)

```css
.glass-popover {
  background: var(--surface-overlay);
  backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-popover);
  padding: 8px;
}
```

- Entry animation: opacity 0→1 + translateY(-4px)→0 via `--motion-panel`.
- Item hover: `var(--accent-soft)`, `var(--radius-sm)`, padding 8px 12px.
- Active item: `var(--accent-soft)` + `color: var(--accent-strong)`.

**Files:** `src/webview/file-mention-plugin.ts`, `src/webview/wiki-link-plugin.ts`, `src/webview/table-context-menu.ts`, appearance popover CSS in provider.

### 4.8 Alerts

Background `color-mix(in oklch, var(--state-*) 8%, var(--surface-base))`, 3px `--state-*` left border, `var(--radius-md)`, outline icon, title in `--text-small` weight 600.

| Alert type | State token |
|---|---|
| `[!NOTE]` | `--state-info` |
| `[!TIP]` | `--state-success` |
| `[!IMPORTANT]` | `--state-info` (strong) |
| `[!WARNING]` | `--state-warning` |
| `[!CAUTION]` | `--state-danger` |

**Files:** `src/webview/alert-extension.ts`, CSS in provider.

### 4.9 Search bar (Cmd+F)

- Material aligned with toolbar (`.glass`).
- Input: `var(--surface-sunken)`, focus ring `var(--border-focus)` 2px offset.
- Match highlight: `var(--accent-soft)`.
- Active match: `color-mix(in oklch, var(--accent-primary) 35%, transparent)`.

**Files:** CSS in provider.

### 4.10 TOC sidebar + Metadata panel

- Background: `var(--surface-raised)`.
- Hairline border at editor edge: `var(--border-subtle)`.
- TOC items: hover `var(--accent-soft)` + `var(--radius-sm)`.
- TOC active item: left bullet `var(--accent-primary)` 2px wide, slide-in via `--motion-panel`.
- Metadata inputs: `var(--surface-sunken)` + focus ring `var(--border-focus)`.

**Files:** `src/webview/toc-sidebar.ts`, CSS in provider.

### 4.11 File impact summary

| File | Change |
|---|---|
| `src/markdownEditorProvider.ts` (CSS section) | **Large** — most component CSS lives here |
| `src/webview/themes/index.css` | Add imports for `_tokens/`, `_semantic/`, `_adapter/` |
| `src/webview/themes/_tokens/*` | **New** — 5 primitive files |
| `src/webview/themes/_semantic/*` | **New** — light + dark defaults |
| `src/webview/themes/_adapter/legacy-aliases.css` | **New** — backwards-compat layer |
| `src/webview/themes/soft-modular.css` + `soft-modular-dark.css` | **New** — flagship theme |
| 12 existing theme files | **Refreshed in Phase 1.5** (see §6) |
| `code-block-plugin.ts`, `image-*.ts`, suggestion plugins, `alert-extension.ts` | CSS-only tweaks |
| `font-selector.ts`, `main.ts` | No logic changes |

## 5. Migration Strategy (5 Phases)

### Phase 1 — Foundation (week 1)

**Output:** Token system live, no user-visible change.

- Create `_tokens/palette.css`, `typography.css`, `motion.css`, `elevation.css`, `radius.css`.
- Create `_semantic/light.css`, `_semantic/dark.css`.
- Create `_adapter/legacy-aliases.css`.
- Import all into `themes/index.css`.

**Verify:**

- `npm run lint && npm run build` pass.
- Each existing theme renders pixel-identical before/after.
- DevTools confirms `--surface-base` resolves via adapter for every legacy theme.

**Risk:** Low. No consumers of the new tokens yet.

### Phase 1.5 — Legacy theme refresh (week 1.5)

**Output:** 12 existing themes adopt the new token tier (text hierarchy, surface tiers, state colors) and ship critical fixes.

Scope detailed in §6. Each theme commit reviewed independently.

**Verify:**

- `npm run build` pass.
- Visual smoke against each theme using `docs/test-fixtures/premium-showcase.md`.
- WCAG AA contrast for each text/surface pair.

**Risk:** Medium. 12 files touched. Bound the scope by limiting changes to critical fixes + new token additions; defer deeper rewrites.

### Phase 2 — Flagship theme (week 2)

**Output:** `Soft Modular` and `Soft Modular Dark` selectable from the Appearance popover; Frame remains default.

- Create `themes/soft-modular.css` and `soft-modular-dark.css` against semantic tokens.
- Register both in `markdownEditorProvider.ts` and the `package.json` config enum.
- Component CSS still uses `--crepe-color-*`; the flagship theme exercises tokens through the adapter.

**Verify:**

- Selecting Soft Modular updates background, font, color per spec.
- Light ↔ dark toggle is smooth (no flash).
- All 12 legacy themes continue to render correctly.

**Risk:** Low. Additive only.

### Phase 3 — Component sweep (weeks 3–4)

**Output:** Toolbar, popovers, blocks, code, images, tables, alerts, search, and sidebar consume semantic tokens directly.

Per-component subtasks, each committed independently:

1. Toolbar + Search bar (shared material).
2. Unified `.glass-popover` (appearance, file mention, wiki link, table context).
3. Editor surface + selection + caret.
4. Headings, paragraphs, lists, blockquotes.
5. Code block + inline code.
6. Image (display, edit URL, lightbox).
7. Table.
8. Alerts (5 types).
9. TOC sidebar + Metadata panel.

**Verify per subtask:**

- Legacy themes still look correct via adapter.
- Soft Modular fully expresses the new design language.
- Hover, focus, active states match spec.
- No layout shift on real content.

**Risk:** Medium. Highest file churn. Sequencing reduces blast radius.

### Phase 4 — Polish & docs (week 5)

**Output:** Final WCAG passes, screenshot baseline, documentation.

- Audit every theme/text-surface pair against WCAG AA via Lighthouse.
- Capture screenshots into `docs/screenshots/premium-{theme}.png` for the test fixture.
- Update `CHANGELOG.md`, `README.md`, `docs/internals/theming.md`.
- Add `docs/internals/design-system.md` covering the token system, motion vocabulary, elevation stack, type scale. Reference from `CLAUDE.md` Feature Docs table.

**Risk:** Low.

## 6. Legacy Theme Refresh (Phase 1.5 details)

This phase applies four classes of improvement to the 12 existing themes. Each class is independent and gated on independent visual verification.

### 6.A Critical fixes

#### 6.A.1 Add missing `--crepe-color-highlight`

Light themes that lack a highlight token currently fall back to default browser yellow, breaking palette cohesion.

| Theme | New highlight value |
|---|---|
| Frame Light | `#FEF3C7` (amber-100) |
| Nord Light | `#EBCB8B` (Aurora yellow soft) |
| Crepe Light | `#FFF3D6` (warm cream-yellow) |
| Catppuccin Latte | `#E6D28A` (catppuccin yellow tinted) |

#### 6.A.2 Fix inverted surface/background relationship

- **Catppuccin Latte:** change `--crepe-color-surface` from `#CCD0DA` (too heavy) to `#DCE0E8` (`surface0`).
- **Crepe Light:** change `--crepe-color-surface` from `#FFF8F4` (invisible vs background) to `#F5EDE4` (warm sunken).
- **Crepe Dark:** change `--crepe-color-surface` from `#18120B` (darker than background) to `#2A241D` (lighter than background). On dark themes the convention is that `--crepe-color-surface` sits one tier above the base (raised), matching code blocks in Macchiato/Mocha/Frame Dark.

#### 6.A.3 Reduce outline (border) contrast

- **Crepe Light:** outline `#817567` → `#E5DDD2` (warm hairline).
- **Nord Light:** outline `#73777f` → `#D8DEE9` (Snow Storm 0).

#### 6.A.4 Differentiate Catppuccin variant accents

The 4 Catppuccin variants currently share near-identical lavender accents.

| Variant | Current accent | New accent | Source |
|---|---|---|---|
| Latte | `#7287FD` (lavender) | `#7287FD` — keep | catppuccin "lavender" |
| Frappe | `#BABBF1` (lavender) | `#85C1DC` (sky) | catppuccin "sky" |
| Macchiato | `#B7BDF8` (lavender) | `#F5A97F` (peach) | catppuccin "peach" |
| Mocha | `#B4BEFE` (lavender) | `#B4BEFE` — keep as flagship | catppuccin "lavender" |

### 6.B Token additions (all 12 themes)

Each theme adds 8 new tokens:

**Text hierarchy (2 new):**

```css
--crepe-color-on-background-muted:  /* secondary text, ~70% lightness */
--crepe-color-on-background-subtle: /* tertiary text, ~50% lightness */
```

**Surface tier (2 new):**

```css
--crepe-color-surface-raised:  /* card, popover background */
--crepe-color-surface-overlay: /* glass surface (rgba with alpha) */
```

**Semantic state (4 new):**

```css
--crepe-color-state-info:    /* alerts: NOTE, IMPORTANT */
--crepe-color-state-success: /* alerts: TIP */
--crepe-color-state-warning: /* alerts: WARNING */
--crepe-color-state-danger:  /* alerts: CAUTION */
```

State color choices are tuned per theme so that alerts blend with the palette (e.g. Paper uses muted earth tones; Midnight uses GitHub-style alert colors).

### 6.C Per-theme polish

| Theme | Polish |
|---|---|
| Frame Light | Inline-code `#C4432B` → `#B84A35` (reduce saturation vs blue accent). |
| Frame Dark | Highlight `#3D3520` → `#2C3E50` (align with blue accent tone). |
| Nord Light | Inline-code `#BA1A1A` → `#A04848` (Aurora red dimmed). |
| Nord Dark | Already WCAG-fixed; no change. |
| Crepe Light | Add `--font-display: "Newsreader", ui-serif, Georgia, serif` for headings; keep body Source Serif. |
| Crepe Dark | Surface fix in §6.A.2. |
| Catppuccin Latte | Split roles: `--accent-primary` lavender (UI), `--crepe-color-primary` mauve (content/links). |
| Catppuccin Frappe | Highlight `#4A4230` → `#5A5640` (yellow-tinted neutral). |
| Catppuccin Macchiato | Same role split as Latte: accent peach, primary mauve `#C6A0F6`. |
| Catppuccin Mocha | `--noise-opacity` 0.45 → 0.55. |
| Paper | Split: `--accent-primary` mustard `#8B6914`, `--crepe-color-primary` `#6B4E12` (darker for links/inline code). |
| Midnight | Inline-code `#FFA657` → `#E8C690` (peach muted). |

### 6.D Standardization

- **Naming roles:** document in each theme file header: `--accent-primary` = UI accent; `--crepe-color-primary` = content accent.
- **Centralize mono stack:** every theme's `--crepe-font-code` references the primitive `--font-mono` from `_tokens/typography.css` (see §3.1) instead of duplicating the stack.

### 6.E Phase 1.5 verification

Per theme, run through the smoke checklist before committing:

1. Open `docs/test-fixtures/premium-showcase.md` with the theme selected.
2. Verify markdown highlight (`==text==`) uses the new highlight color.
3. Verify code blocks visibly separate from body (surface contrast OK).
4. Verify all 5 alert types render with palette-aware state colors.
5. Run Chrome Lighthouse contrast checker; all text/surface pairs ≥ 4.5:1.
6. Compare against Phase 1 baseline screenshot — confirm intended changes only.

## 7. Verification Plan (project-wide)

### Layer 1 — Build & lint

- `npm run lint` passes (tsc --noEmit).
- `npm run build` succeeds; bundle size delta < 20KB (matches locked decision).

### Layer 2 — Visual smoke

Test fixture `docs/test-fixtures/premium-showcase.md` covers: H1–H6, ul/ol, task list, blockquote, inline code, code blocks in 3 languages, table 5x3, 2 images, all 5 alert types, mermaid diagram, footnote, horizontal rule, link, mention, wiki link.

Capture screenshots for 4 representative themes (Frame light/dark, Soft Modular light/dark) into `docs/screenshots/premium-{theme}.png`. Compare against baseline.

### Layer 3 — Interaction smoke (manual checklist)

- Hover toolbar button → background fades in over `--duration-instant`.
- Click button → scales to 0.94 on press.
- Cmd+F → search bar slides down.
- Click gear → appearance popover slides in.
- Double-click image → URL edit popover.
- Type `@` → file mention popover.
- Type `[[` → wiki link popover.
- Hover code block → copy button visible.
- Right-click in table → context menu.
- Theme switch → smooth, no flash.
- Font selector → font changes, scale preserved.
- Zoom in/out → content scales, toolbar fixed.

### Layer 4 — Accessibility

- WCAG AA contrast for every text/surface pair (Lighthouse).
- `prefers-reduced-motion` disables all transitions.
- Tab navigation works through toolbar; Enter activates.
- Focus rings visible on every interactive element (inputs, buttons, links).

### Layer 5 — Regression

- Open 5 real-world markdown files (READMEs, CHANGELOGs, >500-line docs).
- Verify rendering correctness, scroll smoothness, no jank.
- Run `gitnexus_detect_changes()` before each commit to validate change scope.

## 8. Rollback Plan

- Each phase, and each subtask within Phase 3 and Phase 1.5, is its own commit. Revertable individually.
- The adapter layer means legacy themes never depend on new semantic tokens. Reverting the flagship theme or token system leaves them intact.
- If Phase 3 introduces a regression in one component, revert that subtask only. The Soft Modular theme keeps working through the adapter.

## 9. Documentation Updates

| File | Change |
|---|---|
| `CHANGELOG.md` | Every phase logs its visible changes. |
| `README.md` | Add Soft Modular and Soft Modular Dark to the theme list. |
| `docs/internals/theming.md` | Rewrite to describe the 3-tier token system and the adapter. |
| `docs/internals/design-system.md` | **New.** Single source of truth for tokens, motion vocabulary, elevation, type scale. |
| `CLAUDE.md` | Add `design-system.md` to the Feature Docs table; note token files under File Structure. |

## 10. Next Step

This spec graduates to `writing-plans` to produce a phase-by-phase implementation plan with checkpoints and validation commands.
