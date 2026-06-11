---
name: html-ppt-studio
description: Token-driven HTML deck studio — 36 themes × 31 layouts × 27 animations from lewislulu/html-ppt-skill, packaged as a single-file seed. One token sheet drives every skin; press T to restyle the whole deck. Use when the user wants a presentation, PPT, slides, keynote, tech-sharing deck, or any multi-slide document with switchable visual themes.
triggers:
  - "presentation"
  - "ppt"
  - "slides"
  - "deck"
  - "keynote"
  - "slideshow"
  - "theme"
  - "幻灯片"
  - "演讲稿"
  - "分享稿"
  - "做一份 PPT"
od:
  mode: deck
  surface: web
  scenario: product
  upstream: "https://github.com/lewislulu/html-ppt-skill"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  speaker_notes: true
  animations: true
  example_prompt: "Use HTML PPT Studio to turn my content into a token-driven single-file HTML deck. Confirm three things first: (1) topic, audience and page count, (2) which of the 36 themes fits the tone, (3) which layouts each page should use. Start from the seed example.html — keep its token sheet, slide scaffold and keyboard runtime exactly as-is, replace slide content only, and use real content with no lorem ipsum."
  example_prompt_i18n:
    zh-CN: "用 HTML PPT Studio 把我的内容做成一套 token 驱动的单文件 HTML 幻灯片。先确认三件事：(1) 主题、观众和页数，(2) 36 个主题里哪个最贴合调性，(3) 每页用哪种版式。从种子 example.html 出发——完整保留它的 token 表、slide 骨架和键盘运行时，只替换幻灯片内容，使用真实内容，不要 lorem ipsum。"
---

# HTML PPT Studio

Author professional single-file HTML decks with the token system from the
upstream MIT-licensed [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(36 themes × 31 layouts × 27 animations). The plugin ships one self-contained
seed — `example.html` — that carries the token sheet, six embedded themes, the
slide scaffold, and the keyboard runtime.

**Start from `example.html`. Replace content only. Never rewrite the design
system or the runtime script.**

## Before you author anything — ALWAYS confirm three things

1. **Content & audience.** Topic, page count, who is watching (engineers /
   execs / 小红书读者 / students / VC)?
2. **Theme.** Which of the 36 themes fits the tone? If unsure, recommend 2–3:
   - Business / investor pitch → `pitch-deck-vc`, `corporate-clean`, `swiss-grid`
   - Tech sharing / engineering → `tokyo-night`, `dracula`, `catppuccin-mocha`, `terminal-green`, `blueprint`
   - 小红书图文 / lifestyle → `xiaohongshu-white`, `soft-pastel`, `rainbow-gradient`, `magazine-bold`
   - Academic / report → `academic-paper`, `editorial-serif`, `minimal-white`
   - Edgy / cyber / launch → `cyberpunk-neon`, `vaporwave`, `y2k-chrome`, `neo-brutalism`
3. **Layout plan.** Which layouts each page uses (see catalog below). Propose
   a confident default sequence instead of asking blindly.

## Locked hard spec (do not deviate)

### File shape

- **One self-contained HTML file.** Inline `<style>` + inline `<script>`.
  No build step, no external JS or CSS. The only allowed remote resource is
  Google Fonts via `@import url('https://fonts.googleapis.com/...')`.
- **No chart libraries.** Recreate bar/line/pie visuals with pure CSS or
  inline SVG (the seed's `.bar-chart` is the reference pattern).
- **No external image hosts.** Icons and illustrations are inline SVG or
  CSS gradients.

### Slide system

- Every page is `<section class="slide" data-title="...">` inside
  `<div class="deck" id="deck">`.
- The deck is a **horizontal scroll-snap strip**: each slide is exactly
  `100vw × 100vh` (`flex: 0 0 100vw`), one screen per card, designed at a
  16:9 / 1280×720 baseline and fluid to the viewport via `clamp()` type
  scales. Content must fit one screen — no vertical scrolling inside a slide.
- Slide padding baseline is `72px 96px`.
- Keep the fixed chrome: `.deck-header` (title + theme chip),
  `.deck-footer` (attribution + `N / total` counter), `.progress-bar`.

### Runtime contract (keep the seed script verbatim)

- `←` / `→` / `Space` / `PageUp` / `PageDown` / `Home` / `End` navigate.
- `T` cycles the embedded themes by swapping `data-theme` on `<html>`.
- **Hash routing**: `#/N` (1-based) deep-links a slide; navigation keeps the
  hash in sync via `history.replaceState` wrapped in try/catch (srcdoc-safe).
- The script dedupes the dual window/document capture-phase key listeners by
  Event identity, detects the `.deck` element as the scroller, and
  auto-focuses `<body>` so keys work without a click. These solve real
  iframe-host bugs — do not "simplify" them away.

### Token sheet (every theme overrides exactly this set)

```
--bg --bg-soft --surface --surface-2 --border --border-strong
--text-1 --text-2 --text-3 --accent --accent-2 --accent-3
--good --warn --bad --grad --grad-soft
--radius --radius-sm --radius-lg --shadow --shadow-lg
--font-sans --font-serif --font-mono --font-display
--letter-tight --letter-normal --ease
```

Themes are `html[data-theme="<name>"] { ... }` blocks that override tokens
(plus at most a few theme-scoped selectors, e.g. neo-brutalism's card border).
Slides reference **tokens only** — never hard-code a theme color in slide
markup.

### Class vocabulary (replace content, not classes)

Typography: `.eyebrow .kicker .h1 .h2 .h3 .h4 .lede .dim .dim2 .mono .serif .gradient-text`
Layout: `.row .row.wrap .grid .g2 .g3 .g4 .center .mt-s/.mt-m/.mt-l`
Components: `.card .card-soft .card-accent .pill .pill-accent .divider-accent .section-num .kpi .stat-big .bar-chart .steps .quote .check .token-sheet`
Speaker notes: one hidden `<div class="notes">...</div>` per slide
(`display:none` — never visible text on the slide).

## Theme catalog (36)

Six are embedded in the seed (cycle order for `T`):
`aurora → minimal-white → editorial-serif → tokyo-night → neo-brutalism → pitch-deck-vc`.

To use any other theme, add a new `html[data-theme="<name>"]` token block
(port the values from the upstream `assets/themes/<name>.css`) and append the
name to the `themes` array in the seed script.

| group | themes |
|---|---|
| Light & calm | `minimal-white` `editorial-serif` `soft-pastel` `xiaohongshu-white` `solarized-light` `catppuccin-latte` |
| Light & professional | `corporate-clean` `pitch-deck-vc` `academic-paper` `japanese-minimal` `engineering-whiteprint` |
| Bold & statement | `sharp-mono` `neo-brutalism` `bauhaus` `swiss-grid` `memphis-pop` |
| Bold & editorial | `magazine-bold` `news-broadcast` `midcentury` |
| Cool & dark | `catppuccin-mocha` `dracula` `tokyo-night` `nord` `gruvbox-dark` `rose-pine` `arctic-cool` |
| Warm & vibrant | `sunset-warm` |
| Effect-heavy | `glassmorphism` `aurora` `rainbow-gradient` `blueprint` `terminal-green` |
| Retro & cyber | `cyberpunk-neon` `y2k-chrome` `retro-tv` `vaporwave` |

## Layout catalog (31)

| group | layouts |
|---|---|
| Openers & transitions | `cover` `toc` `section-divider` |
| Text-centric | `bullets` `two-column` `three-column` `big-quote` |
| Numbers & data | `stat-highlight` `kpi-grid` `table` `chart-bar` `chart-line` `chart-pie` `chart-radar` |
| Code & terminal | `code` `diff` `terminal` |
| Diagrams & flows | `flow-diagram` `arch-diagram` `process-steps` `mindmap` |
| Plans & comparisons | `timeline` `roadmap` `gantt` `comparison` `pros-cons` `todo-checklist` |
| Visuals | `image-hero` `image-grid` |
| Closers | `cta` `thanks` |

Composition default: `cover` → `toc` → (`section-divider` → 2–4 content
pages) × N → `cta`/`thanks`. Charts in this single-file plugin are always
CSS/SVG recreations — never Chart.js.

The seed demonstrates 11 of these: cover, toc, section-divider, two-column,
kpi-grid, stat-highlight, chart-bar, process-steps, comparison, big-quote,
thanks.

## Animation catalog (27)

Apply by adding `class="anim-<name>"` (the seed inlines `rise-in`, `fade-up`,
`stagger-list`; port others from upstream `assets/animations/animations.css`
as needed):

`fade-up` `fade-down` `fade-left` `fade-right` `rise-in` `drop-in` `zoom-pop`
`blur-in` `glitch-in` `typewriter` `neon-glow` `shimmer-sweep` `gradient-flow`
`stagger-list` `counter-up` `path-draw` `morph-shape` `parallax-tilt`
`card-flip-3d` `cube-rotate-3d` `page-turn-3d` `perspective-zoom`
`marquee-scroll` `kenburns` `confetti-burst` `spotlight` `ripple-reveal`

Restraint rule: at most one hero animation (`rise-in`/`blur-in` on the title)
plus one `stagger-list` per slide. 3D and effect-heavy animations are for
dividers and closers only.

## Authoring checklist

1. Copy `example.html`, keep `<style>` blocks and `<script>` verbatim.
2. Set the agreed theme as the initial `data-theme` on `<html>` and put it
   first in the `themes` array; add token blocks for any non-embedded theme.
3. Replace the 11 demo slides with the planned layout sequence; update the
   footer counter total only via content (the script computes `N / total`).
4. Real content, real numbers — no lorem ipsum, no placeholder images.
5. Write 1–3 sentence speaker notes per slide in `.notes`.
6. Verify: arrows + Space navigate, `T` cycles every declared theme without
   broken contrast, `#/5` deep-links, no slide overflows vertically.

## Attribution

Visual system, token vocabulary, theme palettes, layout taxonomy, and
animation names come from the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(© lewis &lt;sudolewis@gmail.com&gt;). The LICENSE file ships alongside this
skill — keep it in place when redistributing.
