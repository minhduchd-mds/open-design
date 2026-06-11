---
name: fs-bold-signal
description: "Bold Signal deck theme: a vibrant #FF5722 orange card floating on a #1a1a1a charcoal gradient, giant section numbers, breadcrumb navigation, grid-precise alignment, Archivo Black display type. Single-file HTML on a fixed 1920x1080 stage."
triggers:
  - "bold signal"
  - "orange dark deck"
  - "橙色信号"
  - "high impact slides"
  - "dark presentation"
od:
  mode: deck
  surface: web
  category: slides
  upstream: "https://github.com/zarazhangrui/frontend-slides"
  preview:
    type: html
    entry: example.html
  example_prompt: "Use the Bold Signal theme to turn my content into a high-impact dark single-file HTML deck: an #FF5722 orange focal card on a charcoal gradient, giant section numbers top-left, breadcrumbs top-right, Archivo Black display type, staggered reveals, keyboard navigation, and hash routing. Start from example.html and replace only the content — keep the design system."
  example_prompt_i18n:
    zh-CN: "用「橙色信号」主题把我的内容做成高冲击暗调单文件 HTML 幻灯片：#FF5722 橙色卡片浮于深灰渐变、左上巨型章节号、右上面包屑导航、Archivo Black 显示字、错峰入场动画、键盘导航和 hash 路由。从 example.html 出发只替换内容，保留设计系统。"
---

# Bold Signal（橙色信号）

A locked, single-theme deck plugin ported from the MIT-licensed
[zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides)
`bold-signal` style preset (STYLE_PRESETS.md section 1). Confident, bold,
modern, high-impact: one vibrant orange card commanding a dark charcoal stage.

**Start from `example.html` in this plugin folder. It is the proven seed: copy
its `:root` tokens, stage CSS, slide-shell chrome, and the entire navigation
controller script verbatim, then replace only the slide content. Do not rewrite
the design system, and do not introduce any color or font outside this spec.**

## Design tokens (locked — list verbatim in `:root`)

```css
:root {
    /* Colors */
    --stage-bg: #0d0d0d;                                  /* letterbox behind the stage */
    --slide-bg: #1a1a1a;                                  /* base slide ground */
    --bg-gradient: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%);
    --card-bg: #FF5722;                                   /* THE orange — focal cards & accents */
    --card-bg-soft: rgba(255, 87, 34, 0.12);              /* orange tint fills */
    --text-primary: #ffffff;
    --text-secondary: rgba(255, 255, 255, 0.62);
    --text-faint: rgba(255, 255, 255, 0.34);
    --text-on-card: #1a1a1a;                              /* dark ink on the orange card */
    --line: rgba(255, 255, 255, 0.14);                    /* hairlines & card borders */

    /* Typography — authored at the 1920x1080 stage size */
    --font-display: 'Archivo Black', sans-serif;          /* 900, uppercase, line-height ~0.98 */
    --font-body: 'Space Grotesk', sans-serif;             /* 400/500/700 */
    --title-size: 128px;
    --h2-size: 84px;
    --subtitle-size: 34px;
    --body-size: 28px;

    /* Spacing */
    --slide-pad: 96px;

    /* Motion */
    --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);       /* the only easing in the deck */
    --duration-normal: 0.7s;
}
```

Fonts come from Google Fonts: `Archivo Black` + `Space Grotesk` (400/500/700).
No other typefaces. No other hues — no blues, greens, purples, or secondary
accents; orange `#FF5722` is the single voice. Sharp rectangles only: **no
border-radius on cards or bars**.

## Fixed 16:9 stage — NON-NEGOTIABLE

- Author every slide on a fixed **1920x1080** canvas: `.deck-viewport` (fills
  the window) wraps `.deck-stage` (1920x1080, `transform-origin: 0 0`).
- JavaScript scales the whole stage uniformly:
  `factor = Math.min(innerWidth / 1920, innerHeight / 1080)`, then
  `transform: translate(x, y) scale(factor)` to center with
  letterbox/pillarbox. Re-run on `resize`.
- Never reflow slide content per device. No responsive breakpoints inside
  slides; all measurements are fixed px at the design size.
- Embed the FULL viewport-base.css block (the seed already does): slide
  stacking, print one-slide-per-page, `prefers-reduced-motion` fallback.

## Slide structure & navigation

- Each page is one `<section class="slide">` directly inside `.deck-stage`.
  8-11 slides for a standard deck; split content into more slides instead of
  shrinking type. No scrolling, no overflow, no overlapping panels.
- Slide switching toggles `.active` / `.visible` classes driving
  `visibility` / `opacity` / `pointer-events` — **never `display: none`**.
- Keyboard: `←`/`→`, `↑`/`↓`, `Space`, `PageUp`/`PageDown`, `Home`/`End`.
  Mouse wheel debounced ~650ms; touch swipe with a 40px threshold.
- Hash routing: current slide mirrored to `#/<index>`; deep links and
  `hashchange` restore the slide.
- Page counter lives in `.deck-controls`, fixed **outside** the scaled stage.

## Signature chrome (every content slide)

1. **Giant section number top-left** — `01`, `02`, ... in `--font-display`,
   colored `--card-bg`. Dividers escalate it to a ~460px outline numeral via
   `color: transparent; -webkit-text-stroke: 3px var(--card-bg)`.
2. **Breadcrumb nav top-right** — uppercase, letterspaced `Space Grotesk`
   sections; the active one at `--text-primary`, the rest at `--text-faint`.
3. **Baseline rule bottom** — a 1px `--line` rule spanning the padded width
   with uppercase letterspaced captions on both ends (section name left,
   `NN / total` right).
4. **Grid-precise alignment** — everything hangs off the 96px `--slide-pad`
   frame; hairline `--line` borders divide lists and cards.

## Layout masters (compose decks from these — all present in example.html)

| Master | Recipe |
| ------ | ------ |
| `title card` (cover) | Solid `--card-bg` rectangle ~1300px wide, `--text-on-card` ink, display title + uppercase meta row |
| `agenda` | Numbered editorial list, hairline rules between rows, orange index numerals, faint right-aligned hints |
| `section divider` | Giant outline-stroked number + display heading, vertically centered |
| `bullets` | Square 56px ticks (`--card-bg-soft` fill, 2px orange border, inline SVG check) + heading + support line, max 3-4 |
| `big stat` | Oversized orange numeral (~380px Archivo Black) beside a compact heading + note column |
| `quote` | 200px orange quotation mark, 66px statement, uppercase attribution with orange dash |
| `comparison` | Two hairline-bordered columns; the highlighted column is a solid orange card with dark ink |
| `principle grid` | 2x2 hairline cards with orange letter indices |
| `bar chart` | Pure-CSS bars (orange tint + 2px border; the hero bar solid orange), `scaleY` from `transform-origin: bottom` on `.visible` |
| `closing` | Display statement with one word wrapped in an orange `<span>`, inline-SVG contact row |

## Motion

- Entrances via `.reveal` elements that transition when the slide gains
  `.visible`; stagger with `transition-delay` steps of ~0.1s.
- One easing only: `var(--ease-out-expo)`. Animate only `transform` and
  `opacity`. Chart bars scale in with the same curve.
- `prefers-reduced-motion` support is mandatory (in the embedded base CSS).

## Output contract

- Single self-contained `.html` file: all CSS and JS inline, zero build step,
  zero external JS libraries or CDN scripts. Only the Google Fonts stylesheet
  link is permitted.
- Icons are inline SVG (stroke `#FF5722` or `currentColor`). All visuals are
  CSS/SVG-generated — no remote images, no Chart.js, no mermaid.
- Comment every section: `/* === SECTION NAME === */`.
- CSS gotcha: never negate CSS functions directly (`-clamp()` is silently
  ignored) — use `calc(-1 * clamp(...))`.

## Attribution

Theme, tokens, and fixed-stage model come from the upstream MIT-licensed
[zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides)
(© 2025 Zara Zhang), `bold-signal` preset.
