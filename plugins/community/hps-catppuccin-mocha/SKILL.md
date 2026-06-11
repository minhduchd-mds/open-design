---
name: hps-catppuccin-mocha
description: Catppuccin Mocha deck theme — the community-favorite soothing dark palette (ink-purple #1e1e2e base, lavender #cdd6f4 text, mauve/blue/pink pastel accents, mauve→blue→teal gradient, 14px radii, soft shadows) locked onto the html-ppt-studio single-file deck system. Use when the user wants a dark developer-friendly presentation, tech-sharing deck, engineering review, or any slides in the Catppuccin / pastel-on-dark aesthetic.
triggers:
  - "catppuccin"
  - "mocha"
  - "dark deck"
  - "developer presentation"
  - "tech sharing"
  - "pastel dark"
  - "暗色幻灯片"
  - "技术分享"
  - "摩卡"
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
  example_prompt: "Use the Catppuccin Mocha deck theme to turn my content into a single-file HTML presentation. Confirm topic, audience and page count first, then start from the seed example.html — keep its locked Catppuccin Mocha token sheet, scroll-snap slide scaffold and keyboard runtime exactly as-is, replace slide content only, and use real content with no lorem ipsum."
  example_prompt_i18n:
    zh-CN: "用 Catppuccin 摩卡夜主题把我的内容做成单文件 HTML 幻灯片。先确认主题、观众和页数，然后从种子 example.html 出发——完整保留锁定的 Catppuccin Mocha token 表、滚动吸附骨架和键盘运行时，只替换幻灯片内容，使用真实内容，不要 lorem ipsum。"
---

# Catppuccin Mocha · deck theme (locked)

A single-theme cut of the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
deck system, locked to its `catppuccin-mocha` theme — the community's
best-known soothing dark palette: ink-purple `#1e1e2e` ground, lavender
`#cdd6f4` text, and mauve / blue / pink pastel accents. Built for developers
reading dark screens for long stretches.

**Start from `example.html`. Replace content only. Never rewrite the design
system or the runtime script. Do not introduce any color or font outside
this specification.**

## Locked token sheet (do not change any value)

```css
:root{
  --bg:#1e1e2e; --bg-soft:#181825; --surface:#313244; --surface-2:#45475a;
  --border:rgba(205,214,244,.12); --border-strong:rgba(205,214,244,.24);
  --text-1:#cdd6f4; --text-2:#a6adc8; --text-3:#7f849c;
  --accent:#cba6f7;   /* mauve  */
  --accent-2:#89b4fa; /* blue   */
  --accent-3:#f5c2e7; /* pink   */
  --good:#a6e3a1; --warn:#f9e2af; --bad:#f38ba8;
  --grad:linear-gradient(135deg,#cba6f7,#89b4fa 50%,#94e2d5); /* mauve→blue→teal */
  --grad-soft:linear-gradient(135deg,#313244,#45475a);
  --radius:14px; --radius-sm:10px; --radius-lg:22px;
  --shadow:0 10px 30px rgba(0,0,0,.35);
  --shadow-lg:0 24px 60px rgba(0,0,0,.5);
  --font-sans:'Inter','Noto Sans SC',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;
  --font-serif:'Playfair Display','Noto Serif SC',Georgia,serif;
  --font-mono:'JetBrains Mono',SFMono-Regular,Menlo,monospace;
  --font-display:var(--font-sans);
  --letter-tight:-.03em; --letter-normal:-.01em;
  --ease:cubic-bezier(.4,0,.2,1);
}
```

This is exactly the upstream `assets/themes/catppuccin-mocha.css` token set
on top of the upstream `base.css` contract. Slides reference **tokens only**
— never hard-code a hex value in slide markup. Theme cycling is removed:
this plugin ships exactly one theme; do not add other `data-theme` blocks.

### Fonts (three slots)

- **Display / body**: `Inter` + `Noto Sans SC` (weights 200–900)
- **Serif (quotes only)**: `Playfair Display` + `Noto Serif SC`
- **Mono (terminal, code, chips)**: `JetBrains Mono`

Google Fonts via `@import url('https://fonts.googleapis.com/...')` is the
only allowed remote resource. No other external CSS, JS, or images.

## Signature decorative devices

1. **The Mocha glow** — every `.slide::before` paints two whisper-quiet
   radial glows: mauve `rgba(203,166,247,.07)` top-left and blue
   `rgba(137,180,250,.06)` bottom-right over the `#1e1e2e` ink. Keep
   opacities at or below these values; the glow must stay subliminal.
2. **The terminal card** (`.terminal`) — `--bg-soft` panel with three
   traffic-light dots colored by `--bad/--warn/--good`, a mono `<pre>` body,
   and token-colored spans (`.tk-a/.tk-b/.tk-p/.tk-g/.tk-w/.tk-r`). This is
   the theme's developer signature; use it for code, CLI output, traces, logs.
3. **Gradient ink** — `.gradient-text`, `.divider-accent`, progress bar and
   chart bars all run the mauve→blue→teal `--grad`. Reserve it for one
   emphasis per slide.
4. **Soft geometry** — 14px card radius, pill chips, soft black shadows
   (`--shadow`/`--shadow-lg`). No hard borders, no pure white, no pure black.

## Slide system (upstream layout architecture)

- One self-contained HTML file: inline `<style>` + inline `<script>`,
  zero build, zero external JS. Charts are pure CSS or inline SVG —
  never Chart.js / mermaid. Icons are inline SVG only.
- Every page is `<section class="slide" data-title="...">` inside
  `<div class="deck" id="deck">` — a **horizontal scroll-snap strip**;
  each slide is exactly `100vw × 100vh` (`flex:0 0 100vw`), designed at a
  16:9 / 1280×720 baseline, fluid via `clamp()` type scales. One screen per
  slide; no vertical scrolling inside a slide — split into more slides
  instead of shrinking type. Slide padding baseline `72px 96px`.
- Fixed chrome: `.deck-header` (deck title + `catppuccin-mocha` theme chip),
  `.deck-footer` (attribution + `N / total` counter), gradient
  `.progress-bar`.
- Speaker notes: one hidden `<div class="notes">…</div>` per slide
  (1–3 sentences), never visible on the slide.

### Runtime contract (keep the seed script verbatim)

- `←` / `→` / `Space` / `PageUp` / `PageDown` / `Home` / `End` navigate.
- Hash routing `#/N` (1-based) deep-links a slide; kept in sync via
  `history.replaceState` wrapped in try/catch (srcdoc-safe).
- The script dedupes the dual window/document capture-phase key listeners
  by Event identity and auto-focuses `<body>` so keys work without a click.
  These solve real iframe-host bugs — do not "simplify" them away.

### Layout masters (upstream catalog, 31 layouts shared family-wide)

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
pages) × N → `cta`/`thanks`. The seed demonstrates 11: cover, toc,
section-divider, two-column + terminal, kpi-grid, stat-highlight, chart-bar,
process-steps, comparison, big-quote, thanks.

### Class vocabulary (replace content, not classes)

Typography: `.eyebrow .kicker .h1 .h2 .h3 .h4 .lede .dim .dim2 .mono .serif .gradient-text`
Layout: `.row .row.wrap .grid .g2 .g3 .g4 .center .mt-s/.mt-m/.mt-l`
Components: `.card .card-soft .card-accent .pill .pill-accent .divider-accent .section-num .kpi .stat-big .bar-chart .steps .quote .check .terminal`

### Animations (restraint rule)

Inlined subset: `anim-rise-in`, `anim-fade-up`, `anim-stagger-list`.
At most one hero animation (title) plus one stagger list per slide. Port
others from upstream `assets/animations/animations.css` only if needed.

## Authoring checklist

1. Copy `example.html`; keep all `<style>` blocks and the `<script>` verbatim.
2. Replace the 11 demo slides with the planned layout sequence — real
   content, real numbers, no lorem ipsum, no placeholder images.
3. Use the terminal card whenever the content has code/CLI/log material —
   it is the theme's identity.
4. Write 1–3 sentence speaker notes per slide in `.notes`.
5. Verify: arrows + Space navigate, `#/5` deep-links, no slide overflows
   vertically, no color or font outside the locked spec.

## Attribution

Palette, token vocabulary, layout taxonomy, and animation names come from
the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(© lewis &lt;sudolewis@gmail.com&gt;), theme `catppuccin-mocha`; the color
system itself originates from the Catppuccin project's Mocha flavor. The
LICENSE file ships alongside this skill — keep it in place when
redistributing.
