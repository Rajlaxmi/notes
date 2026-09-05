---
title: MathJax and LaTeX Math Syntax
slug: mathjax-latex-syntax
date: 2026-09-02
category: Reference
excerpt: Loading MathJax on a page, the delimiters it looks for, re-typesetting content added by JS, and a lookup table of the LaTeX math syntax that actually comes up.
tags: [mathjax, latex, math, web, typesetting, reference, cheatsheet]
draft: false
authorship: ai-coauthored
---

**Contents:**

- [Loading MathJax](#loading-mathjax)
- [Delimiters](#delimiters)
- [Re-typesetting Dynamic Content](#re-typesetting-dynamic-content)
- [LaTeX Syntax That Comes Up](#latex-syntax-that-comes-up)
- [Multi-line Environments](#multi-line-environments)
- [Fonts and Accents](#fonts-and-accents)
- [Gotchas in Markdown](#gotchas-in-markdown)

MathJax renders LaTeX (and MathML / AsciiMath) math in the browser as HTML+CSS or SVG. This is the syntax that comes up in practice plus the config knobs worth knowing. \
Docs: [MathJax documentation](https://docs.mathjax.org/en/latest/) · [TeX/LaTeX support](https://docs.mathjax.org/en/latest/input/tex/index.html) · [supported macros](https://docs.mathjax.org/en/latest/input/tex/macros/index.html)

### Loading MathJax

Configure *before* loading the script; load the combined component for TeX input + CHTML output:

```html
<script>
  window.MathJax = {
    tex: {
      inlineMath: [['\\(', '\\)'], ['$', '$']],   // $…$ is OFF by default — opt in here
      displayMath: [['\\[', '\\]'], ['$$', '$$']],
      processEscapes: true,                         // so \$ is a literal dollar sign
      tags: 'ams'                                   // auto-number \begin{equation}
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      ignoreHtmlClass: 'tex2jax_ignore',
      processHtmlClass: 'tex2jax_process'
    }
  };
</script>
<script id="MathJax-script" async
        src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
```

Swap `tex-mml-chtml.js` for `tex-chtml.js` (no MathML input) or `tex-svg.js` (SVG output, better for copy-paste into other docs). v3 is a full rewrite of v2 — old `MathJax.Hub.*` calls do not exist.

### Delimiters

| Wrap | Renders as | Notes |
| --- | --- | --- |
| `\( … \)` | inline | Always on. Preferred in HTML. |
| `$ … $` | inline | Only if you added it to `inlineMath`. No space after the opening `$`. |
| `\[ … \]` | display (centered block) | Always on. |
| `$$ … $$` | display | Only if added to `displayMath`. |
| `\begin{equation} … \end{equation}` | display, numbered | Needs `tags: 'ams'` for the number. |

Inside `<pre>` and `<code>` nothing is processed, by default — see `skipHtmlTags`.

### Re-typesetting Dynamic Content

MathJax typesets once on load. Content you inject afterwards (a hash router, `innerHTML`, a fetched note) must be typeset explicitly:

```js
// after you insert the new HTML:
await MathJax.typesetPromise([containerEl]);   // scoped to one node

// before replacing a region, clear MathJax's state for it:
MathJax.typesetClear([containerEl]);
```

`typesetPromise()` with no argument re-scans the whole page. Queue it after your DOM write, not before.

### LaTeX Syntax That Comes Up

| Want | Write | Result |
| --- | --- | --- |
| Superscript / subscript | `x^2`, `x_i`, `x^{2n}`, `x_{i,j}` | grouping needs braces past one char |
| Fraction | `\frac{a}{b}`, `\tfrac`, `\dfrac` | `t`/`d` force text/display size |
| Root | `\sqrt{x}`, `\sqrt[3]{x}` | |
| Sum / product / integral | `\sum_{i=1}^{n}`, `\prod`, `\int_0^\infty` | limits go above/below in display, beside inline |
| Multi-integral | `\iint`, `\iiint`, `\oint` | |
| Greek | `\alpha \beta \gamma \Delta \Omega` | capitalize the macro for uppercase |
| Operators (upright) | `\sin \cos \log \exp \max \lim \det \ker` | use these, not `sin` |
| Custom operator | `\operatorname{softmax}` | upright, correct spacing |
| Binary / relations | `\times \cdot \pm \le \ge \ne \approx \equiv \propto` | |
| Set / logic | `\in \notin \subseteq \cup \cap \setminus \forall \exists \neg \implies \iff` | |
| Arrows | `\to \mapsto \Rightarrow \leftrightarrow \xrightarrow{f}` | |
| Dots | `\cdots \ldots \vdots \ddots` | |
| Hat/bar/vec | `\hat{x} \bar{x} \vec{x} \tilde{x} \dot{x} \ddot{x}` | |
| Wide versions | `\widehat{ABC} \overline{ABC} \overrightarrow{AB}` | |
| Over/under brace | `\underbrace{x+y}_{s}`, `\overbrace{…}^{…}` | |
| Auto-sized delimiters | `\left( \frac{a}{b} \right)`, `\left[ … \right]`, `\left\{ … \right\}` | use `\left.` / `\right.` for an invisible side |
| Manual sizes | `\big( \Big[ \bigg\{ \Bigg|` | |
| Text inside math | `\text{if } x > 0` | keeps upright font + spaces |
| Spacing | `\,` `\:` `\;` (thin→thick), `\!` (negative), `\quad` `\qquad` | |
| Color | `\color{red}{x}`, `{\color{blue} x + y}` | needs the `color` extension (in the combined build) |
| Boxed | `\boxed{E = mc^2}` | |

### Multi-line Environments

All of these go **inside** display delimiters (`\[ … \]` or `$$ … $$`), except `equation`/`align` which bring their own display mode.

```latex
% aligned equations — & marks the alignment point, \\ ends a row
\begin{aligned}
  f(x) &= (x+1)^2 \\
       &= x^2 + 2x + 1
\end{aligned}

% numbered, multi-line
\begin{align}
  a &= b + c \\
  d &= e + f
\end{align}
\begin{align*} … \end{align*}   % same, unnumbered

% piecewise
f(x) = \begin{cases}
  x^2 & x \ge 0 \\
  -x  & x < 0
\end{cases}

% matrices: pmatrix () · bmatrix [] · vmatrix || · Bmatrix {} · matrix (none)
\begin{bmatrix}
  a & b \\
  c & d
\end{bmatrix}

% array with explicit column spec
\begin{array}{c|c}
  x & f(x) \\ \hline
  0 & 1
\end{array}
```

Suppress one line's number in `align` with `\nonumber` or `\notag`; label with `\label{eq:x}` and reference via `\eqref{eq:x}` (needs `tags: 'ams'`).

### Fonts and Accents

| Macro | Use for |
| --- | --- |
| `\mathbb{R}` | blackboard bold — number sets `\mathbb{R,Z,N,Q,C}` |
| `\mathcal{L}` | calligraphic — loss, Lagrangian, sigma-algebras |
| `\mathbf{x}` | upright bold — vectors/matrices |
| `\boldsymbol{\theta}` | bold *italic*, works on Greek |
| `\mathrm{d}x` | upright roman — the differential `d` |
| `\mathfrak{g}` | fraktur — Lie algebras |
| `\mathsf{}` `\mathtt{}` | sans-serif, monospace |

Define your own once in the config so notes stay short:

```js
tex: {
  macros: {
    RR: '{\\mathbb{R}}',
    norm: ['\\left\\lVert #1 \\right\\rVert', 1],
    argmax: '{\\operatorname{arg\\,max}}'
  }
}
```

### Gotchas in Markdown

- **`_` and `*` are Markdown syntax.** `x_i` and `a_b_c` outside math delimiters get eaten as emphasis; even inside, some renderers pre-process. Prefer `\( … \)`, and if using `$…$`, keep the math on one line with no stray `*`.
- **Backslashes double up.** In a JS string, HTML attribute, or JSON, `\alpha` must be `\\alpha`; `\\` (newline) becomes `\\\\`.
- **A blank line breaks display math.** Markdown turns the blank line into a `<p>` split, so `$$` blocks and `align` must have no empty line inside.
- **`$$` needs the config opt-in** and, in many Markdown flavors, blank lines around the block to be recognized as display.
- **Fenced code is skipped by design** (`skipHtmlTags` includes `pre`, `code`) — math in ``` blocks renders as literal text.
- **Typeset after the DOM write.** Math injected by JS stays as raw source until `MathJax.typesetPromise()` runs against it.
- **`\\` at end of a line in `aligned` is a row break**, not an escape — a single `\` line-continuation does nothing useful here.

> **Under the hood.** MathJax v3 walks the DOM, pulls text between the configured delimiters, and runs it through a TeX parser that builds an internal MathML tree — not a browser render of TeX. An output jax (CHTML or SVG) then lays that tree out: CHTML positions styled spans using a web-font's metrics, SVG emits `<path>` glyphs with no font dependency. `typesetPromise` is async because font loading and layout are; `typesetClear` drops the cached MathML and DOM nodes for a region so a re-render doesn't stack. Everything is client-side — the server only ships the `.js` bundle. ([MathJax — how it works](https://docs.mathjax.org/en/latest/basic/mathjax.html))
