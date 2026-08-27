/* ===========================================================================
   Notes — a zero-build static site for markdown / HTML notes.

   How it works
   ------------
   - content/manifest.json lists every note and its metadata.
   - A note is a .md or .html file in content/.
   - Routing is hash-based so it works on GitHub Pages with no server config:
       #/            → the table of contents
       #/note/<slug> → one rendered note
   - Markdown is rendered with the vendored `marked` build, then the HTML is
     walked once to match the editorial touches from raila.io (heading anchors,
     external-link markers, figure captions, scrolling tables, the "Contents:"
     line and "Under the hood." callout).
   =========================================================================== */

'use strict';

var MANIFEST_URL = 'content/manifest.json';
var CONTENT_DIR = 'content/';
var WORDS_PER_MINUTE = 210;

var state = {
  site: { title: 'Notes', description: '' },
  notes: [],       // sorted, newest first
  loaded: false,
  error: null,
};

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function isExternal(href) {
  return /^https?:\/\//i.test(href || '');
}

/** A deliberately tiny YAML-subset frontmatter parser (flat key: value, inline
    [arrays], quoted strings, booleans) — enough for note frontmatter. */
function parseFrontmatter(source) {
  var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { data: {}, body: source.replace(/^\s+/, '') };

  var data = {};
  m[1].split(/\r?\n/).forEach(function (line) {
    var t = line.trim();
    if (!t || t[0] === '#') return;
    var i = t.indexOf(':');
    if (i === -1) return;
    var key = t.slice(0, i).trim();
    var raw = t.slice(i + 1).trim();
    if (!key) return;

    if (raw[0] === '[' && raw[raw.length - 1] === ']') {
      var inner = raw.slice(1, -1).trim();
      data[key] = inner
        ? inner.split(',').map(function (x) { return unquote(x.trim()); }).filter(Boolean)
        : [];
    } else if (raw === 'true') {
      data[key] = true;
    } else if (raw === 'false') {
      data[key] = false;
    } else {
      data[key] = unquote(raw);
    }
  });

  return { data: data, body: source.slice(m[0].length).replace(/^\s+/, '') };
}

function unquote(v) {
  if (v.length > 1 && ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function estimateReadTime(markdown) {
  var plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ');
  var words = plain.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE)) + ' min read';
}

function formatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function authorshipLabel(a) {
  if (a === 'ai-coauthored') return 'AI-Coauthored';
  if (a === 'self-written') return 'Self-Written';
  return '';
}

var ARROW_RIGHT =
  '<svg class="arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var ARROW_LEFT =
  '<svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

/* --------------------------------------------------------------------------
   Data
   -------------------------------------------------------------------------- */

function loadManifest() {
  return fetch(MANIFEST_URL, { cache: 'reload' })
    .then(function (r) {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    })
    .then(function (json) {
      var list = Array.isArray(json) ? json : json.notes || [];
      state.site = Object.assign({ title: 'Notes', description: '' }, json.site || {});

      state.notes = list.map(function (n) {
        var file = n.file || n.path;
        var base = file.replace(/^.*\//, '').replace(/\.(md|markdown|html?)$/i, '');
        var isHtml = /\.html?$/i.test(file);
        return {
          file: file,
          isHtml: isHtml,
          slug: n.slug || slugify(base),
          title: n.title || base,
          date: n.date || '',
          category: n.category || 'Notes',
          excerpt: n.excerpt || '',
          tags: n.tags || [],
          authorship: n.authorship || '',
          readTime: n.readTime || '',
          _content: null,
        };
      });

      state.notes.sort(function (a, b) {
        return String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title);
      });

      state.loaded = true;
    })
    .catch(function (err) {
      state.error = err;
      state.loaded = true;
    });
}

function fetchNote(note) {
  if (note._content != null) return Promise.resolve(note._content);
  return fetch(CONTENT_DIR + note.file, { cache: 'reload' })
    .then(function (r) {
      if (!r.ok) throw new Error(note.file + ' ' + r.status);
      return r.text();
    })
    .then(function (raw) {
      note._content = raw;
      return raw;
    });
}

function noteBySlug(slug) {
  for (var i = 0; i < state.notes.length; i++) {
    if (state.notes[i].slug === slug) return state.notes[i];
  }
  return null;
}

/* --------------------------------------------------------------------------
   Rendering markdown → enhanced HTML
   -------------------------------------------------------------------------- */

function renderMarkdown(md) {
  var html = window.marked.parse(md, { gfm: true, breaks: false, headerIds: false, mangle: false });
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  enhance(wrap);
  return wrap.innerHTML;
}

function renderRawHtml(raw) {
  var wrap = document.createElement('div');
  wrap.innerHTML = raw;
  // A note authored as .html may include its own <style>; leave it be.
  enhance(wrap);
  return wrap.innerHTML;
}

/** One pass over rendered nodes to apply the raila.io editorial touches. */
function enhance(root) {
  // Heading anchors.
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (h) {
    if (!h.id) h.id = slugify(h.textContent);
  });

  // Links: external → new tab + marker; in-page (#…) handled by delegation.
  root.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.getAttribute('href');
    if (isExternal(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (!a.querySelector('.ext')) {
        var mark = document.createElement('span');
        mark.className = 'ext';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '↗';
        a.appendChild(mark);
      }
    }
  });

  // Lone images → <figure> with the alt text as caption.
  root.querySelectorAll('img').forEach(function (img) {
    img.loading = 'lazy';
    var p = img.parentElement;
    if (p && p.tagName === 'FIGURE') return;
    if (p && p.tagName === 'P' && p.childNodes.length === 1) {
      var fig = document.createElement('figure');
      p.replaceWith(fig);
      fig.appendChild(img);
      if (img.alt) {
        var cap = document.createElement('figcaption');
        cap.textContent = img.alt;
        fig.appendChild(cap);
      }
    }
  });

  // Tables get their own horizontal scroll container.
  root.querySelectorAll('table').forEach(function (table) {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
    var box = document.createElement('div');
    box.className = 'table-scroll';
    table.replaceWith(box);
    box.appendChild(table);
  });

  // "Contents:" line runs smaller than body text.
  root.querySelectorAll('p').forEach(function (p) {
    var first = p.firstElementChild;
    if (first && first.tagName === 'STRONG' && first.textContent.trim() === 'Contents:') {
      p.classList.add('toc-line');
    }
  });

  // "Under the hood." aside is calmer and smaller.
  root.querySelectorAll('blockquote').forEach(function (q) {
    var strong = q.querySelector('strong');
    if (strong && strong.textContent.trim() === 'Under the hood.') {
      q.classList.add('callout');
    }
  });
}

/* --------------------------------------------------------------------------
   Views
   -------------------------------------------------------------------------- */

function headerHtml(active) {
  return (
    '<header class="site-header" id="siteHeader">' +
      '<div class="wrap bar">' +
        '<a class="brand" href="#/">' + escapeHtml(state.site.title) +
          '<span class="sep">/</span>index</a>' +
        '<nav aria-label="Notes">' +
          '<a href="#/"' + (active === 'index' ? ' aria-current="page"' : '') + '>all notes</a>' +
        '</nav>' +
      '</div>' +
    '</header>'
  );
}

function footerHtml() {
  var year = new Date().getFullYear();
  return (
    '<footer class="site-footer">' +
      '<div class="wrap row">' +
        '<p class="eyebrow">' + escapeHtml(state.notes.length) + ' note' +
          (state.notes.length === 1 ? '' : 's') + '</p>' +
        '<p class="eyebrow">© ' + year + ' Rajlaxmi</p>' +
      '</div>' +
    '</footer>'
  );
}

function renderIndex() {
  document.title = state.site.title;

  var rows = '';
  if (state.error) {
    rows =
      '<div class="state">' +
        '<p class="eyebrow">unavailable</p>' +
        '<h1>The note index didn’t load.</h1>' +
        '<p>Serve this folder over HTTP rather than opening the file directly ' +
        '— e.g. <code>python3 -m http.server</code> — then reload.</p>' +
      '</div>';
  } else if (!state.notes.length) {
    rows =
      '<div class="state">' +
        '<p class="eyebrow">empty</p>' +
        '<h1>No notes yet.</h1>' +
        '<p>Add a file to <code>content/</code> and list it in ' +
        '<code>content/manifest.json</code>.</p>' +
      '</div>';
  } else {
    var lastYear = null;
    rows = '<div class="toc"><div class="wrap"><ul>';
    state.notes.forEach(function (n) {
      var year = (n.date || '').slice(0, 4);
      if (year && year !== lastYear) {
        rows += '<li class="toc-year">' + year + '</li>';
        lastYear = year;
      }
      var badge = authorshipLabel(n.authorship);
      rows +=
        '<li><a class="entry" href="#/note/' + encodeURIComponent(n.slug) + '">' +
          '<div class="entry-top">' +
            '<h3 class="entry-title">' + escapeHtml(n.title) + '</h3>' +
            '<div class="entry-meta">' +
              '<span class="eyebrow">' + escapeHtml(n.category) +
                (n.date ? ' · ' + formatDate(n.date) : '') + '</span>' +
              (badge ? '<span class="eyebrow badge">' + badge + '</span>' : '') +
            '</div>' +
          '</div>' +
          (n.excerpt ? '<p class="entry-excerpt">' + escapeHtml(n.excerpt) + '</p>' : '') +
          '<p class="entry-more"><span>' + escapeHtml(n.readTime || 'note') + '</span>' +
            ARROW_RIGHT + '</p>' +
        '</a></li>';
    });
    rows += '</ul></div></div>';
  }

  return (
    headerHtml('index') +
    '<main>' +
      '<div class="wrap index-head">' +
        '<p class="eyebrow">index</p>' +
        '<h1>' + escapeHtml(state.site.title) + '</h1>' +
        (state.site.description
          ? '<p class="lede">' + escapeHtml(state.site.description) + '</p>'
          : '') +
      '</div>' +
      rows +
    '</main>' +
    footerHtml()
  );
}

function notePageShell(inner) {
  return headerHtml('') + '<main>' + inner + '</main>' + footerHtml();
}

function renderNote(note, bodyHtml) {
  document.title = note.title + ' — ' + state.site.title;

  var idx = state.notes.indexOf(note);
  var newer = idx > 0 ? state.notes[idx - 1] : null;
  var older = idx > -1 && idx < state.notes.length - 1 ? state.notes[idx + 1] : null;

  var meta = [note.category, formatDate(note.date), note.readTime]
    .filter(Boolean)
    .join(' · ');
  var badge = authorshipLabel(note.authorship);

  var tags = note.tags && note.tags.length
    ? '<ul class="tags">' + note.tags.map(function (t) {
        return '<li class="eyebrow">' + escapeHtml(t) + '</li>';
      }).join('') + '</ul>'
    : '';

  var navBlock = '';
  if (newer || older) {
    navBlock =
      '<nav class="note-nav" aria-label="More notes"><div class="wrap grid">' +
        (newer
          ? '<a class="newer" href="#/note/' + encodeURIComponent(newer.slug) + '">' +
              '<p class="eyebrow dir">' + ARROW_LEFT + 'Newer</p>' +
              '<p class="n-title">' + escapeHtml(newer.title) + '</p></a>'
          : '<span></span>') +
        (older
          ? '<a class="older" href="#/note/' + encodeURIComponent(older.slug) + '">' +
              '<p class="eyebrow dir">Older ' + ARROW_RIGHT + '</p>' +
              '<p class="n-title">' + escapeHtml(older.title) + '</p></a>'
          : '') +
      '</div></nav>';
  }

  return notePageShell(
    '<article class="wrap note">' +
      '<header class="note-head">' +
        '<p class="eyebrow">' + escapeHtml(meta) + '</p>' +
        (badge ? '<p class="eyebrow">' + badge + '</p>' : '') +
        '<h1>' + escapeHtml(note.title) + '</h1>' +
        (note.excerpt ? '<p class="lede">' + escapeHtml(note.excerpt) + '</p>' : '') +
        tags +
        '<hr />' +
      '</header>' +
      '<div class="note-body"><div class="prose">' + bodyHtml + '</div></div>' +
    '</article>' +
    navBlock +
    '<div class="note-foot"><div class="wrap">' +
      '<a class="back-link" href="#/">' + ARROW_LEFT + '<span class="eyebrow">all notes</span></a>' +
    '</div></div>'
  );
}

function renderMissing() {
  document.title = 'Not found — ' + state.site.title;
  return notePageShell(
    '<div class="wrap"><div class="state">' +
      '<p class="eyebrow">404</p>' +
      '<h1>This note doesn’t exist.</h1>' +
      '<p><a class="link-quiet" href="#/">Back to the index</a></p>' +
    '</div></div>'
  );
}

/* --------------------------------------------------------------------------
   Router
   -------------------------------------------------------------------------- */

var app = document.getElementById('app');
var progress = document.getElementById('progress');

function parseRoute() {
  var h = location.hash.replace(/^#/, '');
  if (!h || h === '/') return { name: 'index' };
  var m = /^\/note\/([^/]+)$/.exec(h);
  if (m) return { name: 'note', slug: decodeURIComponent(m[1]) };
  return { name: 'unknown' };
}

function paint(html) {
  app.innerHTML = html;
  wireHeader();
}

function route() {
  var r = parseRoute();

  if (r.name === 'note') {
    progress.hidden = false;
    var note = noteBySlug(r.slug);
    if (!note) {
      progress.hidden = true;
      paint(renderMissing());
      window.scrollTo(0, 0);
      return;
    }
    paint(
      notePageShell(
        '<div class="wrap"><div class="state"><p class="eyebrow">loading</p>' +
        '<h1>' + escapeHtml(note.title) + '</h1></div></div>'
      )
    );
    window.scrollTo(0, 0);
    fetchNote(note)
      .then(function (raw) {
        var body;
        if (note.isHtml) {
          body = renderRawHtml(raw);
        } else {
          var fm = parseFrontmatter(raw);
          if (!note.readTime) note.readTime = estimateReadTime(fm.body);
          body = renderMarkdown(fm.body);
        }
        // Guard against a fast second navigation.
        if (parseRoute().slug !== note.slug) return;
        paint(renderNote(note, body));
        updateProgress();
      })
      .catch(function () {
        if (parseRoute().slug !== note.slug) return;
        progress.hidden = true;
        paint(
          notePageShell(
            '<div class="wrap"><div class="state"><p class="eyebrow">error</p>' +
            '<h1>That note failed to load.</h1>' +
            '<p>Check that <code>content/' + escapeHtml(note.file) + '</code> exists.</p>' +
            '<p><a class="link-quiet" href="#/">Back to the index</a></p></div></div>'
          )
        );
      });
    return;
  }

  progress.hidden = true;
  if (r.name === 'unknown') {
    paint(renderMissing());
  } else {
    paint(renderIndex());
  }
  window.scrollTo(0, 0);
}

/* --------------------------------------------------------------------------
   Header scroll state + reading progress + in-page anchors
   -------------------------------------------------------------------------- */

var siteHeader = null;

function wireHeader() {
  siteHeader = document.getElementById('siteHeader');
  onScroll();
}

function onScroll() {
  if (siteHeader) siteHeader.classList.toggle('is-scrolled', window.scrollY > 24);
  updateProgress();
}

function updateProgress() {
  if (progress.hidden) return;
  var bar = progress.firstElementChild;
  var scrollable = document.documentElement.scrollHeight - window.innerHeight;
  var p = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
  bar.style.transform = 'scaleX(' + p + ')';
}

// In-page anchor links (the "Contents:" row): scroll smoothly without letting
// the hash write clobber the route.
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  var href = a.getAttribute('href');
  if (href === '#' || href.indexOf('#/') === 0) return; // route links pass through
  var target = document.getElementById(href.slice(1));
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', updateProgress);
window.addEventListener('hashchange', route);

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

app.innerHTML =
  '<div class="wrap"><div class="state"><p class="eyebrow">loading</p>' +
  '<h1>Notes</h1></div></div>';

loadManifest().then(route);
