---
name: hps-vaporwave
description: "Vaporwave deck theme: a deep-purple→magenta sunset sky (#1a0938→#e85d9c) with a cyan glow ellipse, pink→purple→cyan gradient-clipped display type, frosted-glass cards, 4px glowing gradient dividers, and Space Grotesk. A E S T H E T I C. Locked single-theme variant of lewislulu/html-ppt-skill."
triggers:
  - "vaporwave"
  - "蒸汽波"
  - "aesthetic deck"
  - "sunset gradient slides"
  - "retro 90s deck"
  - "synth sunset"
od:
  mode: deck
  surface: web
  category: slides
  upstream: "https://github.com/lewislulu/html-ppt-skill"
  preview:
    type: html
    entry: example.html
  example_prompt: "Use the Vaporwave theme to turn my content into a single-file HTML deck: a deep-purple→magenta sunset sky with a cyan glow ellipse, gradient-clipped headlines, frosted-glass cards, glowing gradient dividers, the scanline sun mark, keyboard navigation, and #/N hash routing. Start from example.html and replace only the content — keep the design system."
  example_prompt_i18n:
    zh-CN: "用「蒸汽波美学」主题把我的内容做成单文件 HTML 幻灯片：深紫→品红落日渐变天空 + 青色光晕椭圆、粉→紫→青渐变裁切标题、毛玻璃卡片、发光渐变分隔线、扫描线太阳标记、键盘导航和 #/N 哈希路由。从 example.html 出发只替换内容，保留设计系统。"
---

# Vaporwave（蒸汽波美学）

A locked, single-theme deck plugin ported from the MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
`vaporwave` theme (`assets/themes/vaporwave.css` applied to
`templates/deck.html`). One endless sunset: deep purple fading to hot magenta,
a cyan glow rising from the horizon, neon gradient type, frosted glass.

**Start from `example.html` in this plugin folder. It is the proven seed: copy
its token sheet, base/slide CSS, deck chrome, and the entire runtime script
verbatim, then replace only the slide content. Do not rewrite the design
system, and do not introduce any color or font outside this spec.**

## Design tokens (locked — list verbatim in `:root`)

```css
:root{
  --bg:#1a0938; --bg-soft:#261050;
  --surface:rgba(255,255,255,.06); --surface-2:rgba(255,255,255,.1);
  --border:rgba(255,110,199,.28); --border-strong:rgba(0,245,255,.5);
  --text-1:#fdf0ff; --text-2:#d4a8e8; --text-3:#8a6ba8;
  --accent:#ff6ec7; --accent-2:#00f5ff; --accent-3:#ffd166;
  --good:#3ddc97; --warn:#ffd166; --bad:#ff5c8a;
  --grad:linear-gradient(135deg,#ff6ec7 0%,#c94fff 35%,#00f5ff 100%);
  --grad-soft:linear-gradient(135deg,rgba(255,110,199,.25),rgba(0,245,255,.25));
  --radius:18px; --radius-sm:10px; --radius-lg:28px;
  --shadow:0 20px 60px rgba(255,110,199,.2),0 0 1px rgba(0,245,255,.6);
  --shadow-lg:0 30px 80px rgba(255,110,199,.3),0 0 2px rgba(0,245,255,.8);
  --font-sans:'Space Grotesk','Inter','Noto Sans SC',sans-serif;
  --font-mono:'JetBrains Mono',SFMono-Regular,Menlo,monospace;
  --font-serif:'Space Grotesk','Noto Sans SC',sans-serif;
  --font-display:'Space Grotesk','Inter','Noto Sans SC',sans-serif;
  --letter-tight:-.03em; --letter-normal:-.01em;
  --ease:cubic-bezier(.4,0,.2,1);
}
```

`--accent/--accent-2/--accent-3/--grad/--grad-soft/--radius*/--shadow*` and the
font slots come verbatim from upstream `vaporwave.css`; `--good/--warn/--bad`
are the upstream base slots brightened for the dark sky. Slides reference
**tokens only** — never hard-code a hex value in slide markup.

## Fonts (Google Fonts `@import` only — the sole allowed remote resource)

- Display + body: **Space Grotesk** (Inter, Noto Sans SC fallbacks)
- Mono: **JetBrains Mono**
- No serif voice in this theme — `--font-serif` aliases to Space Grotesk.

## Signature devices (what makes it vaporwave)

1. **Sunset sky** — the `body` background, fixed for the whole deck:
   ```css
   background:
     radial-gradient(ellipse at 50% 80%,rgba(0,245,255,.3),transparent 60%),
     linear-gradient(180deg,#1a0938 0%,#3a0f5c 45%,#7a1f6b 85%,#e85d9c 100%);
   ```
   The cyan ellipse sits **on top** of the vertical purple→magenta gradient.
   `.deck` and `.slide` stay `background:transparent` so every slide shares
   the same sky.
2. **Gradient-clipped display type** — `.h1` (and `.gradient-text`,
   `.kpi .num`, `.stat-big` via class) clip `--grad` into the glyphs:
   pink → purple → cyan. Every cover/closer headline wears it.
3. **Frosted glass cards** — `.card` = `rgba(255,255,255,.06)` surface +
   `backdrop-filter:blur(18px)` + pink rgba border + the cyan-edged
   `--shadow`. Accent variants add a 3px glowing top rule.
4. **Glowing gradient divider** — `.divider-accent`: 4px tall, 120px wide,
   `--grad` fill, `box-shadow:0 0 20px var(--accent)`.
5. **Scanline sun** — the inline SVG `#vaporSun` symbol (yellow→pink→purple
   circle with horizontal mask stripes, magenta drop-shadow glow). The deck's
   mark on cover and thanks; may set onto a cyan wireframe horizon.
6. **A E S T H E T I C spacing** — `.aesthetic`: mono, uppercase,
   `letter-spacing:.6em`, cyan with neon text-shadow. Use sparingly as an
   eyebrow on cover/stat slides; key words may also be manually letter-spaced
   (`M A L L W A V E`).
7. **Outlined neon section numerals** — `.section-num`: transparent fill,
   2px cyan `-webkit-text-stroke`, cyan drop-shadow glow. Divider slides only,
   optionally with the perspective-grid SVG (`.vapor-grid`) on the horizon.

## Slide system (upstream html-ppt layout contract)

- Every page is `<section class="slide" data-title="...">` inside
  `<div class="deck" id="deck">` — a **horizontal scroll-snap strip**; each
  slide is exactly `100vw × 100vh` (`flex:0 0 100vw`), one screen per card,
  designed at a 16:9 / 1280×720 baseline with `clamp()` type scales. No
  vertical scrolling inside a slide; slide padding baseline is `72px 96px`.
- Fixed chrome: `.deck-header` (deck title + `vaporwave` theme chip),
  `.deck-footer` (attribution + `N / total` counter), `.progress-bar`
  (gradient fill with neon glow).
- Speaker notes: one hidden `<div class="notes">…</div>` per slide.

### Runtime contract (keep the seed script verbatim)

- `←` / `→` / `Space` / `PageUp` / `PageDown` / `Home` / `End` navigate;
  `T` cycles the `themes` array (this variant ships `['vaporwave']` only).
- **Hash routing**: `#/N` (1-based) deep-links a slide; navigation keeps the
  hash in sync via `history.replaceState` wrapped in try/catch (srcdoc-safe).
- The script dedupes the dual window/document capture-phase key listeners by
  Event identity, scroll-syncs the active index, and auto-focuses `<body>` so
  keys work without a click. These solve real iframe-host bugs — do not
  "simplify" them away.

## Layout catalog (upstream: 31 layouts shared across all themes)

Compose pages from the upstream master categories — openers & transitions
(`cover` `toc` `section-divider`), text-centric (`bullets` `two-column`
`three-column` `big-quote`), numbers & data (`stat-highlight` `kpi-grid`
`table` `chart-bar/line/pie/radar`), code & terminal, diagrams & flows
(`flow-diagram` `process-steps` `mindmap`), plans & comparisons (`timeline`
`roadmap` `comparison` `pros-cons`), visuals, closers (`cta` `thanks`).
Default sequence: `cover → toc → (section-divider → 2–4 content pages) × N →
thanks`. The seed demonstrates ten: cover, toc, section-divider, two-column,
kpi-grid, stat-highlight, chart-bar, process-steps, big-quote, thanks.

## Hard rules

- One self-contained HTML file: inline `<style>` + inline `<script>`, zero
  build, zero external JS. Only Google Fonts `@import` may leave the file.
- Charts are pure CSS/SVG recreations (the seed's `.bar-chart` gradient bars
  are the reference) — never Chart.js/mermaid. Icons and illustrations are
  inline SVG in token colors; no external images or image hosts.
- Restraint: at most one hero animation (`anim-rise-in` on the title) plus one
  `anim-stagger-list` per slide. The gradient clip goes on headlines and key
  numerals — body text stays `--text-1/--text-2`.
- Real content, real numbers — no lorem ipsum. 1–3 sentence speaker notes per
  slide in `.notes`.
- **Never introduce colors or fonts outside this spec, and never rewrite the
  design system or the runtime — replace content only.**

## Authoring checklist

1. Copy `example.html`; keep all `<style>` blocks and the `<script>` verbatim.
2. Replace the ten demo slides with the planned layout sequence; the script
   recomputes `N / total` automatically.
3. Keep the scanline sun on cover and closer; keep the perspective grid on
   divider slides only.
4. Verify: arrows + Space navigate, `#/5` deep-links, no slide overflows
   vertically, glass cards stay legible over both the purple top and the
   magenta bottom of the sky.

## Attribution

Theme palette, token vocabulary, layout taxonomy, and runtime behavior come
from the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(© lewis &lt;sudolewis@gmail.com&gt;) — `vaporwave` theme. The LICENSE file
ships alongside this skill — keep it in place when redistributing.
