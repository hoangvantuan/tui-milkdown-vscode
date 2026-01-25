# Milkdown Markdown WYSIWYG

A beautiful WYSIWYG Markdown editor for VS Code powered by Milkdown Crepe.

![Preview](media/preview.png)

## Features

- **Rich Text Editing**: Edit markdown with a WYSIWYG interface
- **Theme Selection**: 10 editor themes including Catppuccin palette
- **View Source**: Toggle between WYSIWYG and source view
- **Cursor Line Highlight**: Visual highlight of current block/paragraph
- **Metadata Panel**: Collapsible YAML frontmatter editor with validation
- **Image Upload**: Paste images from clipboard or upload via file picker
- **Image URL Editing**: Double-click on image to edit URL/path
- **Auto-link Paste URL**: Select text and paste URL to create markdown link automatically
- **Auto Rename Images**: Automatically rename image files when you change the path in markdown
- **Auto Delete Images**: Automatically delete image files when removed from markdown (moves to Trash)
- **Local Image Display**: Renders local images from document folder and workspace
- **Large File Warning**: Protection for files >500KB
- **Configurable Font Size**: Adjust editor font size (8-32px)
- **Configurable Heading Sizes**: Customize font sizes for H1-H6 headings (12-72px)

## Usage

1. Open any `.md` or `.markdown` file
2. Editor opens automatically in WYSIWYG mode
3. Use toolbar to format text and insert elements
4. Changes save automatically to source file

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tuiMarkdown.fontSize` | 16 | Editor font size (8-32px) |
| `tuiMarkdown.highlightCurrentLine` | true | Enable cursor line highlight |
| `tuiMarkdown.imageSaveFolder` | `images` | Folder to save pasted images (relative to document) |
| `tuiMarkdown.autoRenameImages` | true | Auto rename image files when path changes in markdown |
| `tuiMarkdown.autoDeleteImages` | true | Auto delete image files when removed from markdown (moves to Trash) |
| `tuiMarkdown.headingSizes.h1` | 32 | H1 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h2` | 28 | H2 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h3` | 24 | H3 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h4` | 20 | H4 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h5` | 18 | H5 heading font size (12-72px) |
| `tuiMarkdown.headingSizes.h6` | 16 | H6 heading font size (12-72px) |

## Themes

| Theme | Style |
|-------|-------|
| Frame | Light |
| Frame Dark | Dark |
| Nord | Light |
| Nord Dark | Dark |
| Crepe | Light |
| Crepe Dark | Dark |
| Catppuccin Latte | Light |
| Catppuccin Frappé | Dark |
| Catppuccin Macchiato | Dark |
| Catppuccin Mocha | Dark |

## Requirements

- VS Code 1.85.0 or higher

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
