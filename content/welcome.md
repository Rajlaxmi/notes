---
title: About This Site
date: 2026-08-15
category: Meta
tags: [meta]
authorship: self-written
---

**Contents:** [What this is](#what-this-is) · [Adding a note](#adding-a-note) · [Frontmatter](#frontmatter) · [Markdown supported](#markdown-supported) · [HTML notes](#html-notes)

A place to keep reference sheets and working notes — written once, looked up
often. Everything is a plain file; there is no build step and no database.

### What this is

The site is three static files (`index.html`, `assets/style.css`,
`assets/app.js`), a vendored copy of [marked](https://marked.js.org/) for
markdown, and a folder of notes. It is served as-is from GitHub Pages.

### Adding a note

1. Drop a `.md` or `.html` file into `content/`.
2. Add an entry to `content/manifest.json`.

That is the whole process. The index page and the note page lay themselves out
from the manifest and the file.

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | Filename inside `content/`. |
| `title` | yes | Shown in the index and as the note's `<h1>`. |
| `date` | recommended | `YYYY-MM-DD`. Drives ordering and the year headings. |
| `category` | no | Defaults to `Notes`. |
| `excerpt` | no | One or two sentences, shown under the title in the index. |
| `tags` | no | Array of strings. |
| `authorship` | no | `self-written` or `ai-coauthored` — renders a small badge. |
| `readTime` | no | e.g. `4 min read`. Estimated from the body if omitted. |
| `slug` | no | URL slug; defaults to the filename without its extension. |

### Frontmatter

A markdown note may also carry YAML-style frontmatter between `---` fences. It
is stripped before rendering, and fills in any field the manifest leaves out:

```markdown
---
title: NumPy and PyTorch Reference Sheet
date: 2026-08-27
category: Reference
tags: [numpy, pytorch]
---

Body starts here.
```

### Markdown supported

GitHub-flavoured markdown: tables, fenced code blocks, task lists, strikethrough.
Two conventions get special styling, matched to the main site:

- A paragraph that begins with a bold `Contents:` label renders small and quiet,
  as a table of contents.
- A blockquote that opens with a bold `Under the hood.` label renders as a
  calm, small aside.

> **Under the hood.** The rendered HTML is walked once after `marked` runs:
> headings get slug ids, external links open in a new tab and pick up an
> arrow, lone images become captioned `<figure>`s, and wide tables get their
> own horizontal scroll so the page body never scrolls sideways.

### HTML notes

A note can be a `.html` file instead. Its markup is dropped straight into the
same `.prose` container, so it inherits all the typography. Useful when a note
needs a table or layout that is awkward to express in markdown. See the
[Git Quick Reference](#/note/git-quick-reference) for one.
