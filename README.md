# Notes

A zero-build static site for hosting many markdown or HTML notes, with a
table-of-contents index and note pages styled to match
[raila.io](https://raila.io/#/writing).

No framework, no bundler, no generation step. Three static files plus vendored
copies of [marked](https://marked.js.org/) for markdown and IBM Plex Mono for
code — no CDN dependency.

```
index.html            app shell
assets/style.css      editorial stylesheet (ported from the main site)
assets/app.js         hash router + markdown rendering
assets/vendor/        marked.min.js, ibm-plex-mono.css + fonts/
content/manifest.json the list of notes + their metadata
content/*.md, *.html  the notes themselves
```

## Add a note

1. Drop a `.md` or `.html` file into `content/`.
2. Add an entry to `content/manifest.json`:

   ```json
   {
     "file": "my-note.md",
     "title": "My Note",
     "date": "2026-08-27",
     "category": "Reference",
     "excerpt": "One or two sentences for the index.",
     "tags": ["example"],
     "authorship": "self-written"
   }
   ```

Only `file` and `title` are required; `readTime` shows on the index when set,
and is estimated from the body otherwise. Markdown notes may also carry `---`
YAML frontmatter (`title`, `date`, `category`, `excerpt`, `tags`, `authorship`,
`readTime`, `slug`); it is stripped before rendering and fills in anything the
manifest omits.

## Run locally

It must be served over HTTP (the app `fetch`es the manifest and notes), not
opened as a `file://` URL.

```
cd notes
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy

Push to GitHub and enable Pages for the repository (serve from the root of the
default branch). `.nojekyll` is already present so the `assets/` folder is
published untouched. Routing is hash-based, so no SPA rewrite rules are needed.

## Routes

| URL | Page |
| --- | --- |
| `#/` | Table of contents |
| `#/note/<slug>` | One rendered note |

## Editorial conventions

- A paragraph starting with a bold `Contents:` label renders as a small, quiet
  table of contents.
- A blockquote opening with a bold `Under the hood.` label renders as a calm
  aside at a smaller scale.
- External links open in a new tab and get an `↗` marker; wide tables scroll
  horizontally on their own; a lone image becomes a captioned `<figure>`.
