---
name: hps-aurora-glass
description: Aurora Glass deck — near-black indigo #06091c pages under a triple mint/periwinkle/violet aurora radial glow, frosted-glass cards (blur(24px) saturate(160%)), mint→blue→violet gradient titles, 20px radii. The "aurora" theme from lewislulu/html-ppt-skill locked as a single-skin deck plugin. Use when the user wants a dark, atmospheric, glassmorphic presentation — keynotes, pitch decks, tech sharing, product launches with a premium night-sky feel.
triggers:
  - "aurora"
  - "glass"
  - "glassmorphism"
  - "frosted"
  - "dark deck"
  - "presentation"
  - "ppt"
  - "slides"
  - "deck"
  - "keynote"
  - "极光"
  - "毛玻璃"
  - "幻灯片"
  - "演讲稿"
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
  example_prompt: "Use Aurora Glass to turn my content into a dark glassmorphic single-file HTML deck. Confirm topic, audience and page count first, then start from the seed example.html — keep its aurora token sheet, triple radial glow, frosted-glass cards and keyboard runtime exactly as-is, replace slide content only, and use real content with no lorem ipsum."
  example_prompt_i18n:
    zh-CN: "用「极光玻璃」把我的内容做成一套深色毛玻璃单文件 HTML 幻灯片。先确认主题、观众和页数，然后从种子 example.html 出发——完整保留 aurora token 表、三重极光光晕、毛玻璃卡片和键盘运行时，只替换幻灯片内容，使用真实内容，不要 lorem ipsum。"
---

# Aurora Glass（极光玻璃）

A single-theme deck plugin: the **aurora** theme from the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(36 themes × 31 layouts × 27 animations), pinned and shipped as one
self-contained seed — `example.html`.

Signature combination (what makes this skin this skin):

1. **Triple aurora radial glow** — three huge `radial-gradient` washes
   (mint top-left, periwinkle top-right, violet bottom-center) over a
   near-black indigo `#06091c` page.
2. **Frosted glass cards** — translucent white surfaces with
   `backdrop-filter: blur(24px) saturate(160%)`, 1px cool borders, deep soft
   shadow with an inner top highlight.
3. **Mint→blue→violet gradient titles** — `--grad` clipped into headline and
   hero-number text.

**Start from `example.html`. Replace content only — never rewrite the design
system or the runtime script, and never introduce colors or fonts outside the
token sheet below.**

## Locked token sheet (`:root` — do not deviate)

```css
:root{
  --bg:#06091c; --bg-soft:#0a1130;
  --surface:rgba(255,255,255,.05); --surface-2:rgba(255,255,255,.08);
  --border:rgba(180,220,255,.14); --border-strong:rgba(180,220,255,.28);
  --text-1:#e8f0ff; --text-2:#b4c4e4; --text-3:#6a7a9e;
  --accent:#5ef2c6;    /* mint */
  --accent-2:#7aa2ff;  /* periwinkle blue */
  --accent-3:#c984ff;  /* violet */
  --good:#5ef2c6; --warn:#ffd27a; --bad:#ff8ab0;
  --grad:linear-gradient(135deg,#5ef2c6,#7aa2ff 50%,#c984ff);
  --grad-soft:linear-gradient(135deg,rgba(94,242,198,.2),rgba(201,132,255,.2));
  --radius:20px; --radius-sm:14px; --radius-lg:28px;
  --shadow:0 20px 60px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.08);
  --shadow-lg:0 30px 80px rgba(0,0,0,.55);
  --font-sans:'Inter','Noto Sans SC',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;
  --font-serif:'Playfair Display','Noto Serif SC',Georgia,serif;
  --font-mono:'JetBrains Mono',SFMono-Regular,Menlo,monospace;
  --font-display:'Inter','Noto Sans SC',sans-serif;
  --letter-tight:-.03em; --letter-normal:-.01em;
  --ease:cubic-bezier(.4,0,.2,1);
}
```

Signature device rules (keep verbatim):

```css
body{background:
  radial-gradient(60% 50% at 20% 10%,rgba(94,242,198,.35),transparent 70%),
  radial-gradient(55% 50% at 80% 20%,rgba(122,162,255,.32),transparent 70%),
  radial-gradient(70% 60% at 50% 100%,rgba(201,132,255,.3),transparent 70%),
  #06091c}
.card{backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%)}
.gradient-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:transparent}
```

## Fonts (three slots + serif, Google Fonts @import only)

| slot | stack | role |
|---|---|---|
| `--font-sans` / `--font-display` | Inter + Noto Sans SC | body and headlines (800–900 weight for `.h1`/`.h2`/`.stat-big`) |
| `--font-serif` | Playfair Display + Noto Serif SC | `.quote` pull quotes only, italic |
| `--font-mono` | JetBrains Mono | code cards, chart axis labels, theme chip, step counters |

The only allowed remote resources are the Google Fonts `@import url(...)`
lines already in the seed. No other CDN, no Chart.js, no icon fonts, no
external images — charts are pure CSS bars or inline SVG, icons are inline SVG.

## File shape & slide system

- One self-contained HTML file: inline `<style>` + inline `<script>`.
- Every page is `<section class="slide" data-title="...">` inside
  `<div class="deck" id="deck">` — a **horizontal scroll-snap strip**, each
  slide exactly `100vw × 100vh` (`flex:0 0 100vw`), 16:9 / 1280×720 baseline,
  fluid via `clamp()` type scales. One screen per slide, no internal scrolling.
- Slide padding baseline `72px 96px`.
- Fixed chrome: `.deck-header` (deck name + `aurora · frosted glass` chip),
  `.deck-footer` (attribution + `N / total` counter), `.progress-bar` whose
  fill uses `--grad`.
- Speaker notes: one hidden `<div class="notes">…</div>` per slide
  (`display:none` — never visible on the slide).

## Layout system (upstream 31-layout catalog, shared master categories)

Compose pages from the upstream catalog; the seed demonstrates 11 of them.

| master category | layouts |
|---|---|
| Openers & transitions | `cover` `toc` `section-divider` |
| Text-centric | `bullets` `two-column` `three-column` `big-quote` |
| Numbers & data | `stat-highlight` `kpi-grid` `table` `chart-bar` `chart-line` `chart-pie` `chart-radar` |
| Code & terminal | `code` `diff` `terminal` |
| Diagrams & flows | `flow-diagram` `arch-diagram` `process-steps` `mindmap` |
| Plans & comparisons | `timeline` `roadmap` `gantt` `comparison` `pros-cons` `todo-checklist` |
| Visuals | `image-hero` `image-grid` |
| Closers | `cta` `thanks` |

Default sequence: `cover` → `toc` → (`section-divider` → 2–4 content pages) × N
→ `cta`/`thanks`. Seed coverage: cover, toc, section-divider, stat-highlight,
two-column (with mono API card), kpi-grid, chart-bar (CSS), chart-line
(inline SVG in a glass card), process-steps, big-quote, thanks.

Aurora-specific composition rules:

- Hero numbers (`.stat-big`, `.kpi .num`) always wear `.gradient-text`.
- Charts: gradient bars are "us", `.bar.ghost` (translucent surface) is the
  baseline/competitor; SVG line charts use a `#5ef2c6→#7aa2ff→#c984ff`
  gradient stroke with a periwinkle area fade.
- Section dividers use the ghost `.section-num` numeral at
  `rgba(255,255,255,.06)`.
- At most one hero animation (`anim-rise-in` on the title) plus one
  `anim-stagger-list` per slide.

## Class vocabulary (replace content, not classes)

Typography: `.eyebrow .kicker .h1 .h2 .h3 .h4 .lede .dim .dim2 .mono .serif .gradient-text`
Layout: `.row .row.wrap .grid .g2 .g3 .g4 .center .mt-s/.mt-m/.mt-l`
Components: `.card .card-soft .card-accent .pill .pill-accent .divider-accent .section-num .kpi .stat-big .bar-chart .steps .quote .check .spark`

## Runtime contract (keep the seed script verbatim)

- `←` / `→` / `Space` / `PageUp` / `PageDown` / `Home` / `End` navigate.
- **Hash routing**: `#/N` (1-based) deep-links a slide; navigation keeps the
  hash in sync via `history.replaceState` wrapped in try/catch (srcdoc-safe).
- This variant is **theme-locked**: there is no `T` theme cycling and no
  `data-theme` switching — aurora is the only skin. Do not add other themes.
- The script dedupes the dual window/document capture-phase key listeners by
  Event identity and auto-focuses `<body>` so keys work without a click.
  These solve real iframe-host bugs — do not "simplify" them away.

## Authoring checklist

1. Copy `example.html`; keep all `<style>` blocks and the `<script>` verbatim.
2. Replace the 11 Borealis Grid demo slides with the planned sequence
   (8–11 pages typical); the footer counter total updates automatically.
3. Real content, real numbers — no lorem ipsum, no placeholder images.
4. Rebuild any chart as CSS bars or inline SVG using only the three accents.
5. Write 1–3 sentence speaker notes per slide in `.notes`.
6. Verify: arrows + Space navigate, `#/5` deep-links, every slide fits one
   screen, no color or font appears that is not in the token sheet.

## Attribution

Visual system, token vocabulary, theme palette, layout taxonomy, and animation
names come from the upstream MIT-licensed
[`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)
(© lewis &lt;sudolewis@gmail.com&gt;), theme `aurora`
(`assets/themes/aurora.css`). The LICENSE file ships alongside this skill —
keep it in place when redistributing.
