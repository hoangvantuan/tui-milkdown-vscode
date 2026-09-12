# Link destinations that need escaping

A destination containing spaces must keep its pointy brackets, or reopening
the file turns the link into plain text.

Nguồn: [Cẩm nang Pháp luật 2026-09-09 18-03-57.mp4](<Cẩm nang Pháp luật 2026-09-09 18-03-57.mp4>)

A link with a space and a title: [spaced](<a b.md> "the title")

An image with a space in its path:

![screenshot](<images/Screenshot 2026-09-09 at 18.03.57.png>)

Destinations that do not need wrapping stay bare: [plain](docs/plain.md),
[percent-encoded](a%20b.md), [balanced parens](a(b).md).

Titles and alt text are attributes too, and were interpolated raw the same way.

A title containing a double quote: [quoted](b.md "he said \"hi\"")

Image alt text containing a bracket: ![a\]b](c.png)

An empty destination stays empty rather than gaining brackets: [empty]()