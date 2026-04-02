# Development Roadmap

This document tracks the project's development phases, milestones, and long-term vision.

## Current Status

**Version:** 2.8.0 (just released)  
**Last Updated:** 2026-04-02  
**Branch:** develop

## Completed Phases

### Phase 1: Core Editor (v1.0 - v2.0)

- [x] Tiptap + @tiptap/markdown integration
- [x] Basic markdown parsing and serialization
- [x] Custom editor provider for VSCode
- [x] Theme system (CSS variables, multi-theme support)
- [x] Toolbar with formatting buttons
- [x] Heading selector, theme selector
- [x] View source / edit mode toggle

**Status:** ✅ Complete

### Phase 2: Advanced Features (v2.1 - v2.4)

- [x] Table support with context menu (add/delete row/col)
- [x] Code block syntax highlighting
- [x] Image handling (paste, drop, auto-rename, auto-delete)
- [x] Task lists / checkbox support
- [x] GitHub-style alert blocks (`[!NOTE]`, `[!TIP]`, etc.)
- [x] Mermaid diagram rendering with SVG preview
- [x] Search plugin (Cmd+F with highlight and navigation)
- [x] Heading collapse/expand toggles
- [x] Table of Contents sidebar
- [x] Metadata (YAML frontmatter) panel

**Status:** ✅ Complete

### Phase 3: Interaction & UX Polish (v2.5 - v2.7)

- [x] Line highlight (cursor line background)
- [x] Heading level badges (H1-H6 inline indicators)
- [x] Code block premium features (language badge, copy button)
- [x] Image lightbox (fullscreen zoom viewer)
- [x] Font selector (searchable, system fonts enumeration)
- [x] Floating editor canvas with responsive layout

**Status:** ✅ Complete

### Phase 4: Premium UI Polish (v2.8)

- [x] Paper texture & visual depth (SVG noise, vignette, progress bar)
- [x] Code block gradient accent bar + ligatures
- [x] Image lightbox with zoom controls
- [x] Toolbar auto-hide (opt-in setting)
- [x] Micro-interactions (checkbox animation, heading underline, premium alerts with SVG icons)
- [x] Paper and Midnight themes
- [x] Comprehensive accessibility (reduced motion, high contrast, print, focus indicators, word count)

**Status:** ✅ Complete

---

## Future Roadmap

### Phase 5: Collaborative Editing (v2.9-v3.0)

**Priority:** P2  
**Estimated Timeline:** Q2 2026  
**Key Features:**

- [ ] Real-time collaboration support (CRDT-based, local-first)
- [ ] Conflict resolution UI
- [ ] Presence indicators (cursor positions, active users)
- [ ] Comment/annotation system
- [ ] Edit history and time travel

**Tech Stack:** ProseMirror Collab, Yjs (optional), or custom CRDT

### Phase 6: Export & Publishing (v3.1)

**Priority:** P2  
**Estimated Timeline:** Q3 2026  
**Key Features:**

- [ ] Export to PDF (styled, respects theme)
- [ ] Export to HTML (standalone, bundled CSS)
- [ ] Export to DOCX (Microsoft Word)
- [ ] Markdown → LaTeX for academic papers
- [ ] Static site generation (Hugo, Jekyll frontmatter)

**Tech Stack:** pandoc, pptx, LaTeX, marked

### Phase 7: Performance & Scale (v3.2)

**Priority:** P3  
**Estimated Timeline:** Q4 2026  
**Key Features:**

- [ ] Large file optimization (>10MB documents)
- [ ] Virtual scrolling for massive documents
- [ ] Incremental parsing for faster saves
- [ ] Lazy-load images/resources
- [ ] Worker threads for heavy processing (markdown parsing, export)

### Phase 8: Customization & Extensibility (v3.3+)

**Priority:** P2  
**Estimated Timeline:** Beyond Q4 2026  
**Key Features:**

- [ ] Plugin system (custom extensions, themes)
- [ ] Custom markdown syntax support
- [ ] Theme editor UI (live preview)
- [ ] Keybinding customization
- [ ] CSS injection for user customization

---

## Known Limitations

1. **No real-time collaboration** — Single-editor model, no simultaneous multi-user editing
2. **No export to PDF** — Consider pandoc or weasyprint integration
3. **No large file optimization** — Documents > 10MB may feel sluggish
4. **No dark mode detection** — Manual theme switching (could auto-detect VSCode theme)
5. **Limited markdown extensions** — Only GFM + alerts; no math, footnotes, or custom syntax

## Metrics & Success Criteria

### v2.8.0 Launch Metrics

| Metric                   | Target       | Status             |
| ------------------------ | ------------ | ------------------ |
| Extension size           | < 500KB      | ✅ Pass             |
| Load time                | < 500ms      | ✅ Pass             |
| Code coverage            | > 70%        | ⏳ TBD              |
| Accessibility (WCAG)     | AA level     | ✅ Pass             |
| Theme count              | 12+          | ✅ Pass (12 themes) |
| Bug reports (first week) | < 5 critical | ⏳ TBD              |


## Dependencies & Constraints

### Major Dependencies

- **Tiptap** (v3.0+) — Core editor framework
- **@tiptap/markdown** (Beta) — Markdown parser/serializer
- **ProseMirror** (v1.3.8+) — Document model and plugins
- **Lowlight** — Code syntax highlighting
- **Mermaid** (v11+) — Diagram rendering
- **prosemirror-search** (v1.1+) — Find/replace
- **js-yaml** — YAML frontmatter parsing

### Known Issues

1. `**@tiptap/markdown` Beta:** API may change; consider freezing version
2. **Table rendering with wrapped cells:** Custom serializer needed for multi-line cells
3. **Large SVG textures:** May cause lag on scroll in weak devices
4. **Print CSS in VSCode webview:** Limited print support via `@media print`

## Lessons Learned

### Development Patterns

- **Plan before code:** Detailed phase specs reduce rework
- **CSS-first approach:** Prefer styling over JS for interactions
- **Theme variables:** Centralize colors, fonts, spacing in CSS custom properties
- **Accessibility as first-class:** Build a11y features alongside main features, not after

### Technical Debt

- `markdownEditorProvider.ts` is 2500+ lines; consider splitting CSS to modules
- Image path transformation logic could be consolidated
- ProseMirror plugin registration pattern could be abstracted

### Community Feedback

- **Requested:** Auto-save, cloud sync, collaborative editing
- **Positive:** Theme selection, markdown-first editing, no proprietary formats
- **Pain points:** Large file performance, no export options

## Release Timeline

| Version   | Release Date | Focus                   | Status         |
| --------- | ------------ | ----------------------- | -------------- |
| 2.0.0     | Jan 2026     | Core editor + themes    | ✅ Released     |
| 2.5.0     | Feb 2026     | Interaction polish      | ✅ Released     |
| 2.7.0     | Mar 2026     | Font selector, canvas   | ✅ Released     |
| **2.8.0** | **Apr 2026** | **Premium UI polish**   | **✅ Released** |
| 2.9.0     | Q2 2026      | Collaboration (planned) | 📋 Planned     |
| 3.0.0     | Q3 2026      | Export & publishing     | 📋 Planned     |
| 3.1.0     | Q4 2026      | Performance at scale    | 📋 Planned     |


---

## Contributing

For guidelines on contributing to this roadmap or reporting issues, see [CONTRIBUTING.md](../CONTRIBUTING.md) (to be created).

## Questions or Suggestions?

Open an issue on [GitHub](https://github.com/hoangvantuan/tui-milkdown-vscode/issues) with the `roadmap` label.