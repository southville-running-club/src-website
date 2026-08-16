# The club's brand

> **Superseded in part, 16 August 2026.** The colour, neutral and type tokens this document
> describes below were replaced by `bindalshah/src-race-timing`'s own palette — see
> [`race-timing-brand-guidelines.md`](race-timing-brand-guidelines.md) for the adopted
> document and `tokens.css` for the derived values. This page is kept rather than rewritten,
> per this repository's rule against silently editing an accepted decision: the reasoning
> below for why the club's own green was confirmed, and why the timing app's palette was
> originally refused, is still true history — it explains what changed and why. **The
> wordmark, the favicon, and the 8px/12px radii were not touched** and remain exactly as
> this document describes them.

Where the site's colours, wordmark and typeface come from, what the club has confirmed,
and what is still a proposal. Written to be read alongside
[`packages/shared/styles/tokens.css`](../../platform/packages/shared/styles/tokens.css),
which is the value this document exists to explain rather than duplicate — see
[issue #33](https://github.com/southville-running-club/src-website/issues/33) for how this
was scoped.

**Nightingale Nightmare keeps its own design.**
[`nn-theme.css`](../../platform/packages/shared/styles/nn-theme.css) is a campaign,
deliberately unlike the club, and nothing here changes it.

---

## Source of truth

**`tokens.css` is canonical.** It is reviewed in a pull request, is diffable, and is what
ships — a colour cannot drift from production because it *is* production.
[`design-tokens.json`](../../platform/packages/shared/design-tokens.json) mirrors it in the
W3C design-token format, and `packages/shared/tests/unit/brand.test.ts` fails if the two
disagree. The JSON exists for two things: diffing this palette against
`bindalshah/src-race-timing`'s own `design-tokens.json`, which uses the same format, and
importing into Figma (Tokens Studio) without anybody retyping a hex code.

**A Figma file mirrors the tokens and decides nothing.** Two volunteers cannot keep a
second source of truth in sync with a first, and a design tool that silently disagrees with
production is worse than no design tool. If a Figma library exists for this brand, it is a
picture of `tokens.css`, generated or updated *from* it — never the other way round.

[`/brand/`](../../platform/apps/main/src/pages/brand.astro) renders the live palette with
every contrast ratio computed at build time, using
[`packages/shared/src/contrast.ts`](../../platform/packages/shared/src/contrast.ts). It is
`noindex` and linked from nowhere — it is for the two volunteers and the committee, not for
a runner.

---

## What is confirmed

- **`#4C9B58`, as the brand green.** Confirmed **16 August 2026** from the club's own
  downloaded brand assets — `SRC_GREEN.png` and `logo_src.svg`, real green artwork rather
  than a colour sampled off a rendered page. It replaces `#209D50`, which this document
  carried as a provisional stand-in; see "What changed" below for why that value existed
  and what it was superseded by.
- **Corrected once, then genuinely confirmed, both on 16 August 2026.** This bullet
  originally claimed a traced "SRC" monogram existed when the file that had actually
  shipped at `apps/main/public/favicon.svg` was the full two-line wordmark's geometry
  scaled into a 100x100 box — illegible at tab size, not a monogram. That was corrected to
  three letters set in Inter, honestly not-traced. **Superseded again the same day**: the
  club supplied `logo_src.pdf`, real vector artwork for an "SRC" monogram. Both the
  wordmark and the favicon now use it — see the next bullet.
- **The wordmark's geometry, replaced — and then split in two, later the same day.** The
  monogram is `logo_src.pdf`'s own three paths (S, R, C) at its own page size,
  `0 0 412.236 215.679`, extracted directly from that PDF's vector drawing operators rather
  than hand-traced from a rendered image. It was briefly the mark on *every* surface: the
  site banner, the masthead and the favicon. **It is the favicon's alone now**, and the
  two-line "SOUTHVILLE RUNNING CLUB" lockup — `0 0 876 267`, matching
  `blacktransparantlogo-removebg-preview.png` pixel for pixel — is back everywhere else.
  See "Two marks, split by size" below for why. Both live in
  [`packages/shared/src/brand.ts`](../../platform/packages/shared/src/brand.ts), as
  `CLUB_LOGO` and `CLUB_MONOGRAM`.
- **Inter and JetBrains Mono as the typefaces.** Both are already vendored at
  `apps/main/public/fonts` with their OFL licences, having arrived for Nightingale
  Nightmare. `bindalshah/src-race-timing`'s `design-tokens.json` independently names the
  same two faces as its de facto choice — a convergence rather than a decision made here.
- **8px and 12px as the button and card radii.** The same values `nn-theme.css` already
  carries as `--nn-r-btn` and `--nn-r-card`, and the same ones `bindalshah/src-race-timing`
  carries as `radius.button` and `radius.card`. Three codebases had already agreed; this is
  the first file to say so out loud.

## Two marks, split by size

**The lockup is the mark; the monogram is the favicon.** Both are the club's own artwork and
neither is a compromise — what the split records is that they are good at different sizes,
which is a fact about typography rather than a preference.

| | |
| --- | --- |
| `CLUB_LOGO` — "SOUTHVILLE RUNNING CLUB", `0 0 876 267` | The site banner on `/`, `/nn` and `/timing`, and the Nightingale Nightmare masthead. Also the standalone `apps/main/public/logo.svg` |
| `CLUB_MONOGRAM` — "SRC", `0 0 412.236 215.679` | `apps/main/public/favicon.svg`, and nothing else |

For a few hours on 16 August 2026 the monogram was both. The argument that put it there is
sound and is unchanged — three words shrunk into a 16px tab strip are an illegible smear —
but it is an argument about the favicon, and it was applied to every surface at once. A
header is the opposite case: it has room for the club's name, and most people who reach
`/nn` arrive from a shared link having never seen the club's initials before. A monogram is
recognised; a wordmark is *read*. A site nobody has visited yet needs the second.

`packages/shared/tests/unit/brand.test.ts` asserts each mark matches its own file, and that
the pair has not been crossed — the negative case, because a swap renders fine, keeps the
right accessible name, and is invisible in a diff of two path strings.
`apps/main/tests/e2e/site.spec.ts` asserts the same thing about the rendered pages, by
viewBox, on all three paths.

## What changed, and why the earlier value was only provisional

**`#209D50` was read off the computed style of the header band on
`https://www.southvillerunningclub.co.uk/`** on 16 August 2026 — not an asset, a colour
sampled from a rendered page. It was used provisionally rather than blocked on, because:

- it was what the club visibly looked like at the time, which was closer to "official" than
  a placeholder chosen for legibility;
- every value derived from it held its hue and saturation and moved only lightness, so a
  corrected green was one edit to `tokens.css` rather than a re-derivation;
- `/brand/` and this document both said plainly that it awaited confirmation, so nobody
  downstream could mistake it for settled.

That confirmation arrived the same day, as real green artwork rather than a second sample
of the page: `SRC_GREEN.png` and `logo_src.svg`, downloaded from the club. `#4C9B58` is a
visibly different green from `#209D50` — less saturated, a few degrees further round the
hue wheel — which is the point of the distinction this section exists to make: a Squarespace
theme's rendering of the club's colour is not the same fact as the club's own asset file.

## What was measured and what follows from it

Three things fall out of the measurement, each a decision rather than a detail:

**The wordmark itself still carries no colour of its own.** This repository's `logo.svg`
(inline in `apps/main/src/components/ClubLogo.astro`, `apps/timing/app/club-logo.tsx`) is
filled with `currentColor`: one piece of artwork, coloured by whichever stylesheet is in
charge, rather than a black file and a hand-made green variant that can drift apart. See
[`packages/shared/src/brand.ts`](../../platform/packages/shared/src/brand.ts). The
standalone `apps/main/public/logo.svg` and the favicon are the exception, and for the same
reason as each other now: both are static files that cannot read a CSS custom property, so
both bake in the confirmed brand green directly.

**`#4C9B58` cannot be a text colour.** On the page background it measures **3.36:1** —
above the 3:1 floor for large text and non-text UI, below the 4.5:1 body-text floor. Black
on it is **6.14:1**, close to how the live club site uses the colour today: a *surface*,
with dark text, never green words. This repository targets AAA (7:1) rather than the AA
floor, so two derived greens exist for text — see below — and the undiluted brand green is
reserved for surfaces and the logotype, which WCAG exempts from any contrast requirement at
all (1.4.3, "text that is part of a logo or brand name").

**Halyard Display, the live site's actual typeface, could not be adopted.** It is served to
`southvillerunningclub.co.uk` under an Adobe Fonts kit tied to that domain, and cannot be
used from Cloudflare without its own licence. `bindalshah/src-race-timing` hit the same
constraint and records it the same way — Halyard listed as "aspirational, pending a
licence," with Inter as the substitute. If the club buys a Halyard licence, this is the one
value in `tokens.css` that changes as a result.

## The two derived greens

Both hold the brand green's hue and saturation and move only lightness, so all three read
as the same colour at different weights.

| Token | Value | Surface | Ratio |
| --- | --- | --- | --- |
| `--src-green` | `#4C9B58` | Page | 3.36:1 |
| `--src-green` | `#4C9B58` | Banner band | 3.07:1 |
| `--src-green-text` | `#29532F` | Page | 8.69:1 |
| `--src-green-text` | `#29532F` | Banner band | 7.94:1 |
| `--src-green-text-dark` | `#98CDA0` | Dark page | 9.93:1 |
| `--src-green-text-dark` | `#98CDA0` | Dark banner band | 8.16:1 |

Both derived values *at least match* the invented greens they originally replaced
(`#16543f` at 8.69:1/7.94:1, `#6fd3a8` at 9.93:1/8.15:1) — adopting the real brand cost
nothing in contrast anywhere, in either its provisional or its confirmed form.
`packages/shared/tests/unit/brand.test.ts` asserts this directly, so a future change to
either value cannot regress it silently.

## Adopted from, and refused from, `bindalshah/src-race-timing`

That repository — the club's own race-timing app — already had a full brand system in this
same token format, independently of this one, naming `southvillerunningclub.co.uk` as its
"source of inspiration." Where its values measured better than this repository's, they were
taken; where they measured worse, they were not, regardless of which repository felt more
authoritative.

**Adopted:** `color.slate` (`#4A5568`) as `--src-slate`, an upgrade from this repository's
previous `#58585D` — 7.39:1 against 6.95:1 on the page, AAA against AA.

**Refused:** `color.danger` (`#E53935`). On this repository's page background it measures
**4.15:1** — large-text-only — where the value it would have replaced, `#A4231A`, measures
**7.28:1**. Adopting it would have put failing error text on the form that asks people for
money, so `--src-error` was kept. Both figures are asserted in
`packages/shared/tests/unit/brand.test.ts`, so the refusal cannot be silently reversed by a
future "let's just match the other repo" edit.

**Not compared, at the time:** `color.primary` (`#00C85A`), the timing app's own green. It
was 1.53:1 from `#4C9B58` — close enough to read as a mistake side by side, far enough to
not be the same colour — and was that app's own brand rather than the club's, so no attempt
was made to reconcile the two. **This was superseded on 16 August 2026**: `#00C85A` is now
`apps/main`'s `--src-green`, by explicit decision rather than by drift. See
[`race-timing-brand-guidelines.md`](race-timing-brand-guidelines.md) for the adopted
document. It carries the same limitation this section already found: 2.19:1 on white, under
even the 3:1 non-text floor, so it remains a surface-and-logo colour only, never text —
`--src-green-text` (`#00672F`, 7.04:1) is what a link or an accent actually renders as, the
same two-layer shape this document describes for the colour it replaced.

---

## Open questions for the committee

None of the following can be inferred, and a plausible placeholder in markup is worse than
a blank. Recorded here rather than in code, per
[`principles.md`](../architecture/principles.md)'s stop-and-ask rule for unconfirmed facts.

- [x] **Is `#4C9B58` the club's official green?** — confirmed 16 August 2026, from the
      club's own downloaded `SRC_GREEN.png` and `logo_src.svg`. Superseded `#209D50`, which
      was read off a Squarespace theme's rendering rather than an asset. **`#4C9B58` itself
      was then superseded the same day** by `#00C85A`, the race-timing app's brand green —
      see the note at the top of this document and
      [`race-timing-brand-guidelines.md`](race-timing-brand-guidelines.md). This row is kept
      to record that the club's own asset colour genuinely was confirmed at the time; it is
      not what `--src-green` currently is.
- [x] **Does an official green wordmark exist?** — not the full lockup, which is still a
      black PNG (see above).
- [x] **Does an official "SRC" monogram exist?** — confirmed 16 August 2026: `logo_src.pdf`,
      real vector artwork, supplied directly. It is the favicon; the wordmark went back to
      the full lockup the same day — see "Two marks, split by size".
- [ ] **A secondary and neutral palette**, if the club has one beyond the single green.
- [ ] **The typeface** — licence Halyard, or accept Inter as the substitute.
- [ ] **What the brand should look like in dark mode.** The live club site has none; this
      one does, and `#4C9B58` behaves differently on a dark background (5.27:1) than on
      white (3.36:1).
