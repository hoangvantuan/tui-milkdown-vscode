# TUI Markdown Editor

A VS Code custom editor that lets people edit `.md` files as rich text while the file on disk stays plain Markdown. The one promise that governs everything else: what the editor writes back must mean the same thing as what it read.

## Language

### Fidelity

**Roundtrip**:
Reading a Markdown file into the editor and writing it back out with no user edits in between.
*Avoid*: round trip, re-serialization, save cycle

**Normalized**:
A roundtrip result that differs from the input only in surface syntax (marker choice, escaping, indentation width) while meaning the same thing, and that is stable from the second roundtrip on. Normalization is accepted behaviour.
*Avoid*: reformatted, semantically equal, cosmetic diff

**Lossy**:
A roundtrip result that drops, corrupts, or changes the meaning of any part of the input. Lossy behaviour is always a defect, at the highest priority.
*Avoid*: data loss, corruption, broken roundtrip

**Golden**:
The committed expected output of a roundtrip for one corpus document. A diff against a golden must be classified as intended fix, accepted change (normalization), or regression (lossy).
*Avoid*: snapshot, baseline, expected file

**Fixture**:
A small hand-written Markdown document in the corpus that exercises one feature.
*Avoid*: sample, test file, example

**Seam**:
A harness entry point that exercises one production function directly and records its observable result, used where a roundtrip alone cannot see the behaviour.
*Avoid*: unit test, probe, hook

### Views

**Rich text view**:
The WYSIWYG editing surface provided by this extension.
*Avoid*: WYSIWYG mode, preview, editor view

**Source view**:
VS Code's built-in text editor showing the raw Markdown of the same file.
*Avoid*: text mode, raw view, code view

### Content

**Mention**:
A link to a workspace file inserted by typing `@` and picking from the popup. Saved as an ordinary Markdown link.
*Avoid*: file mention link, @-link, reference

**Wiki link**:
An Obsidian-style `[[...]]` link to another Markdown file, inserted by typing `[[` and picking from the popup. Saved in `[[...]]` syntax.
*Avoid*: internal link, wikilink, double-bracket link

**Slash command**:
A popup opened by typing `/` at the start of an empty paragraph, offering blocks to insert (heading, list, table, code, diagram, alert). It changes only what is inserted, never how it is saved.
*Avoid*: Notion menu, block menu, command palette

**Alert**:
A GitHub-style callout block (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) written as a blockquote whose first line is the marker.
*Avoid*: callout, admonition, note box

**Metadata panel**:
The collapsible YAML frontmatter editor shown above the document body.
*Avoid*: frontmatter editor, properties, header panel