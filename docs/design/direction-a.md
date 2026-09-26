# Direction A: Community and warmth

The club website's design, as built. The visual reference is
[`src-direction-a.html`](src-direction-a.html) in this directory — open it in a browser; the
dark bar at the top switches pages and toggles between a 1440px and a 390px layout.

⚠️ **That file is a mockup, and three things about it are not the design.** It uses container
queries, because it puts the whole site in a resizable box so one page can show both layouts;
the real pages use `em` media queries, because the real page *is* the viewport. It has a fake
page switcher. And its data is invented. What was ported is its **look, content and
behaviour** — not its JavaScript, not its class names, and not its structure.

The reasoning for the surface existing at all is
[ADR-048](../architecture/decisions/adr-048-the-club-website-is-its-own-surface.md). This page
is the reference: what the tokens are, what they measure, and what is built.

---

## Where it lives

| | |
| --- | --- |
| Stylesheet | `packages/shared/styles/club.css` — **self-contained**, imports nothing |
| Layout | `apps/main/src/layouts/ClubBase.astro` |
| Chrome | `apps/main/src/components/club/` |
| Navigation and banner copy | `packages/shared/src/club-nav.ts` |
| Content schemas | `packages/shared/src/club-content.ts` |
| Content data | `apps/main/src/content/` |
| Contrast guard | `packages/shared/tests/unit/club-contrast.test.ts` |
| Chrome and fence | `apps/main/tests/e2e/club-chrome.spec.ts` |

⚠️ **`base.css` and `tokens.css` are a different surface and are not edited by this work.**
They draw every page that takes or handles money, and those are frozen until after the race on
1 November 2026. A club page loads `club.css` and nothing else; a money page loads `base.css`
and nothing else. If you find yourself importing one into the other, read ADR-048 first.

---

## Colour

`#209D50` is the club green — the accent from the club's current Squarespace site,
`hsl(143 66% 37%)`.

### Light

| Token | Value | Use |
| --- | --- | --- |
| `--club-background` | `#F1F7EF` | The page — pale mint |
| `--club-surface` | `#FFFFFF` | Cards, inputs, tables |
| `--club-surface-alt` | `#E6F1E3` | Alternate section bands, the banner |
| `--club-text` | `#16301F` | Body text — deep green-ink |
| `--club-muted` | `#4A5C4E` | Secondary text |
| `--club-brand` | `#209D50` | Fills and non-text lines. **Never text** |
| `--club-on-brand` | `#0D1B12` | Text on the brand fill |
| `--club-link` | `#236A33` | Text links |
| `--club-logo` | `#1A7D3F` | The wordmark |
| `--club-rule` | `#D3E3CF` | Dividers |
| `--club-rule-strong` | `#76887A` | Control borders |
| `--club-highlight` | `#FFE9A8` | The pace guide's "start here" row, only |
| `--club-on-highlight` | `#16301F` | Text on that row |
| `--club-focus` | `#16301F` | The focus outline |

### Dark

Only these are redefined. Everything else falls through, **which is the point**: the brand
green, its ink, the highlight and its ink are the same in both schemes, because a fill that
inverted would stop being the club's colour and a highlight that inverted would stop being a
highlight.

| Token | Value |
| --- | --- |
| `--club-background` | `#0F1F15` |
| `--club-surface` | `#16291C` |
| `--club-surface-alt` | `#122418` |
| `--club-text` | `#EAF3E7` |
| `--club-muted` | `#A9BDAD` |
| `--club-link` | `#7FD39A` |
| `--club-logo` | `#209D50` |
| `--club-rule` | `#2A4232` |
| `--club-focus` | `#EAF3E7` |

---

## Contrast

Computed, not estimated. `club-contrast.test.ts` recomputes every one of these **out of the
stylesheet's own declarations** and fails on drift — both sides resolved, so moving a surface
recomputes the pairing rather than making the assertion vacuous.

⚠️ **The floors are WCAG 2.2 AA, not the 7:1 the other palettes here aim at.** That is a
consequence of `#209D50`: the darkest ink that reads on it is 5.07:1. Raising the bar means
choosing a different green, which is a decision the club has not been asked for. ADR-048 says
so in full.

| Pairing | Light | Dark | Floor |
| --- | --- | --- | --- |
| text on background | 13.06:1 | 15.05:1 | 4.5 |
| text on surface | 14.22:1 | 13.50:1 | 4.5 |
| text on surface-alt | 12.23:1 | 14.31:1 | 4.5 |
| muted on background | 6.58:1 | 8.61:1 | 4.5 |
| muted on surface | 7.16:1 | 7.73:1 | 4.5 |
| muted on surface-alt | 6.16:1 | 8.19:1 | 4.5 |
| link on background | 6.06:1 | 9.52:1 | 4.5 |
| link on surface | 6.60:1 | 8.54:1 | 4.5 |
| link on surface-alt | 5.68:1 | 9.05:1 | 4.5 |
| on-brand on brand | 5.07:1 | 5.07:1 | 4.5 |
| on-highlight on highlight | 11.83:1 | 11.83:1 | 4.5 |
| brand as a line on background | 3.22:1 | 4.89:1 | 3 |
| brand as a line on surface | 3.50:1 | 4.39:1 | 3 |
| **brand as a line on surface-alt** | **3.01:1** | 4.65:1 | 3 |
| rule-strong on surface | 3.77:1 | 4.07:1 | 3 |
| rule-strong on background | 3.46:1 | 4.54:1 | 3 |
| focus on background | 13.06:1 | 15.05:1 | 3 |
| logo on background | 4.76:1 | 4.89:1 | — |

### Three rules that follow, and are enforced

1. **Never white text on `#209D50`.** 3.50:1. Use `--club-on-brand` (5.07:1).
2. **Never `#209D50` as text on the light surfaces.** 3.22:1 on the page. Use `--club-link`.
   ⚠️ In the dark scheme the same green is 4.89:1 and *does* read — the rule is scoped to the
   light surfaces because that is where it is true. The design uses it as text nowhere.
3. ⚠️ **`--club-brand` on `--club-surface-alt` is 3.01:1**, one hundredth above the non-text
   floor. A one-hex nudge to the band breaks it with nothing looking wrong. That pairing is
   asserted by name.

### One defect this caught before it shipped

The highlighted pace row was originally `--club-text` on `--club-highlight`. In the dark
scheme that is near-white `#EAF3E7` on pale yellow `#FFE9A8`: **1.06:1 — not hard to read,
absent.** It is the same shape as the amber wash `admin-contrast.test.ts` caught at 1.56:1 —
a colour computed against a surface in one scheme and left to fall through in the other.
`--club-on-highlight` exists because of it, and neither token is redefined in the dark block.

---

## Type

| | |
| --- | --- |
| Headings | **Bricolage Grotesque**, 800, `letter-spacing: -0.02em`, sentence case |
| Body | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| Numerals | `.club-num` — `font-variant-numeric: tabular-nums` for times and prices |

Base 16px; lede 1.15rem. Headings 2.15 / 1.6 / 1.2rem on small screens, 3.4 / 2.1rem wide —
and 4rem for the home hero alone.

**Bricolage Grotesque is self-hosted**, at `apps/main/public/fonts/`, with
`OFL-BricolageGrotesque.txt` beside it and `font-display: swap`. Never Google's CDN, which
would send every visitor's IP address to a third party and would have to be disclosed on
`/privacy/`. `club-chrome.spec.ts` asserts that a club page fetches nothing off-origin.

⚠️ **One static instance at weight 800, not the variable font.** Measured:

| | bytes |
| --- | --- |
| variable, `opsz 12..96`, `wght 700..800` | 76,868 |
| variable, `opsz 12..96`, `wght 800` | 38,884 |
| **static, `wght 800`** | **21,820** |

The design asks for one weight, so the other 55 kB would be an axis nobody moves.

**Nunito Sans was specified for body and is deliberately not used.** A second family is
another 30–45 kB on every page for a difference most readers cannot name, against a system
face already on the device. Headings are where the voice lives.

---

## Shape and space

- Buttons: pill (`999px`), minimum height 48px, weight 800. Primary is the brand fill;
  secondary is transparent with a 2px `currentcolor` border — so it works unchanged on the
  page, on a card and on the alternate band without a variant per surface.
- Cards: `20px`. The hero photo: `28px`. **No borders, no shadows, no gradients.**
- Sections: 3rem vertical padding small, 5rem wide. Alternate bands are flat, full width,
  square-edged.
- Content: 1200px max, 1.25rem side padding. Prose measure 68ch.

**Keep it calm.** Direction A as approved is the reduced version: one hero photo, flat
sections, cards only where something is clickable, one testimonial rather than three, and
yellow only on the pace highlight. No blob shapes, no staggered cards, no extra accents.

---

## Widths

`em` media queries, not the mockup's container queries.

| | |
| --- | --- |
| `< 30em` | Single column. Header is the wordmark and Menu. Facts strip 2 columns, "Where" spanning both. Hero photo hidden, so when/where/cost is on the first screen |
| `≥ 30em` | "Come for a run" joins the header beside Menu |
| `≥ 44em` | 2-column grids |
| `≥ 62em` | Full nav, Menu hidden. 3- and 4-column grids. Two-column hero with the photo |

Nothing scrolls sideways at 320, 360, 390, 768, 1024, 1280 or 1440, or in landscape on a
phone. Tap targets ≥ 44×44px; buttons 48px tall. Wide tables scroll inside their own
focusable, labelled wrapper. `prefers-reduced-motion` is respected.

---

## Photographs

⚠️ **A photograph of identifiable people needs consent from them before it is published**, and
that is a condition of using one rather than a formality. A photograph whose consent nobody
can evidence has to come down.

The club supplies them; this repository does not source them. When one is added, record in the
same commit **who supplied it and when, and that consent was confirmed** — the page's own
header is the right place, and this table is the index.

| Photograph | Where | Supplied | Consent |
| --- | --- | --- | --- |
| `src/assets/club-evening-run.jpg` — about eighteen members on a path through a cemetery at dusk | The home page hero | A club volunteer, 20 September 2026 | Confirmed by that volunteer, 20 September 2026 |
| `src/assets/club-group-photo.jpg` — about eighty members in club vests and race numbers, with the club's wordmark burnt in | The home page's membership section | A club volunteer, 21 September 2026 | Confirmed by that volunteer, 21 September 2026 |

### A slot has a shape, and a photograph is chosen to fit it

⚠️ **Never a fixed height plus `object-fit: cover` on a photograph of people.** Cover crops
whatever does not fit, and on a group photograph what does not fit is people. Measured: the
club group shot is 1.92:1, and the hero slot's original fixed 27rem height made it about
1.35:1 at desktop — which would have cropped **30% of the width**, taking both ends off a line
of eighty members with nothing saying so.

Each slot carries an `aspect-ratio` instead, matched to what it holds:

| Class | Ratio | Holds | Cropped |
| --- | --- | --- | --- |
| `img.club-hero-photo` | 4:3 | `club-evening-run.jpg`, itself 4:3 | nothing |
| `img.club-photo-wide` | 16:9 | `club-group-photo.jpg`, 1.92:1 | ~7%, evenly off both sides |
| `img.club-photo-tall` | 4:3 | any 4:3 photograph | nothing |

**Swapping in a photograph of a very different shape means revisiting the ratio.** That is a
deliberate cost and the alternative is worse.

### Which photograph goes where

The group shot led the page for about an hour on 21 September 2026 and moved down. The
reasoning is in `index.astro`'s header; in short, the hero sells Tuesday night and that
photograph is a race, it carries the wordmark about 200px below the header's own, and eighty
faces at hero size stop being faces. Beside *"Join the club for £4 a year"* it is the argument
rather than decoration.

**Everywhere else still renders a flat `--club-photo` panel** — `aria-hidden`, no text, no
stripe pattern, no `[Photo: …]` caption. Those are replaced by real photographs the same way
this one was, not filled in.

Two technical notes that travel with any hero photograph here:

- **`<Image>` from `astro:assets`**, not `<img>`, so width, height and a modern format are
  emitted at build time. The source of the one above is a 1600×1200 phone photograph at
  382 kB; the build produces four WebP variants from 78 kB.
- ⚠️ **`loading="lazy"` even though it is above the fold.** The hero photograph is
  `display: none` below 62em, and an eager image is still *downloaded* when hidden — so 70% of
  this club's visitors would pay for a picture they never see, on the poor signal the whole
  design is built around. A lazy image that is not rendered is never fetched, and a lazy image
  inside the viewport loads immediately, so the desktop case is unaffected.

---

## Components

Built in this change:

| Component | Where |
| --- | --- |
| Header, with the banner notice | `ClubHeader.astro` |
| Menu — `<details>`, no JavaScript | `ClubMenu.astro` |
| Footer | `ClubFooter.astro` |
| Button, primary and secondary | `.club-btn` |
| Wrap | `.club-wrap` |
| Lede | `.club-lede` |

Still to build, with the pages that use them: facts strip, section band, card, event card,
step list, pill list, tick list, timeline, data table, accordion, pricing card, comparison
table, partner card, person card, document list.

---

## Behaviour

**Every page is fully usable with JavaScript disabled.** That is the primary path, and
Playwright's `no-javascript` project proves it.

| Feature | Without JS | With JS |
| --- | --- | --- |
| Menu, accordions, rules list | `<details>`, fully working | no JS needed |
| Find my group | Hidden; the pace table stands alone | Picker revealed, matching row highlighted, announced via `aria-live` |
| Partner filter, News year filter | All items shown, no buttons | Toggle buttons with `aria-pressed`, a live region stating how many are shown |

---

## Accessibility

WCAG 2.2 AA, **zero** axe violations — not "few" — on every page, at 390 and 1440, in light
and dark. One `<h1>` per page, headings in order, landmarks with distinct labels, a skip link
to `#main`. A visible 3px focus outline at 3px offset on everything. Colour is never the only
signal: the current nav item has an underline *and* `aria-current`, and the highlighted pace
row says "Start here" in text.
