# Milkdown Markdown WYSIWYG

A beautiful WYSIWYG Markdown editor for VS Code powered by Milkdown Crepe.

## Features

- **Rich Text Editing**: Edit markdown with a WYSIWYG interface
- **Theme Selection**: Choose from multiple editor themes (Nord, GitHub, Tokyo Night, etc.)
- **View Source**: Toggle between WYSIWYG and source view
- **Large File Warning**: Protection for files >500KB
- **Configurable Font Size**: Adjust editor font size (8-32px)
- **Configurable Heading Sizes**: Customize font sizes for H1-H6 headings (12-72px)
- **Configurable Line Height**: Adjust line spacing (1.0-3.0 multiplier)
- **Configurable Max Width**: Set maximum editor width (px, %, ch units)

## Usage

1. Open any `.md` or `.markdown` file
2. Editor opens automatically in WYSIWYG mode
3. Use toolbar to format text and insert elements
4. Changes save automatically to source file

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tuiMarkdown.fontSize` | 16 | Editor font size (8-32px) |
| `tuiMarkdown.headingSizes.h1` | 32 | H1 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h2` | 28 | H2 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h3` | 24 | H3 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h4` | 20 | H4 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h5` | 18 | H5 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h6` | 16 | H6 heading font size (12-72px) |
| `tuiMarkdown.lineHeight` | 1.6 | Line height multiplier (1.0-3.0) |
| `tuiMarkdown.maxWidth` | 800px | Max editor width (e.g., '800px', '90%', '65ch') |

## Requirements

- VS Code 1.85.0 or higher

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
