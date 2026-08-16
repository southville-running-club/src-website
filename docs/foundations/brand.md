# The club's brand

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

- **The wordmark's geometry.** `apps/main/public/logo.svg`'s viewBox is `0 0 876 267`,
  matching the club's own PNG pixel for pixel
  (`blacktransparantlogo-removebg-preview.png`, linked from `southvillerunningclub.co.uk`'s
  `og:image`). The trace is exact; nothing about the letterforms was invented.
- **Inter and JetBrains Mono as the typefaces.** Both are already vendored at
  `apps/main/public/fonts` with their OFL licences, having arrived for Nightingale
  Nightmare. `bindalshah/src-race-timing`'s `design-tokens.json` independently names the
  same two faces as its de facto choice — a convergence rather than a decision made here.
- **8px and 12px as the button and card radii.** The same values `nn-theme.css` already
  carries as `--nn-r-btn` and `--nn-r-card`, and the same ones `bindalshah/src-race-timing`
  carries as `radius.button` and `radius.card`. Three codebases had already agreed; this is
  the first file to say so out loud.

## What is provisional, and why it was used anyway

**`#209D50`, as the brand green.** Read off the computed style of the header band on
`https://www.southvillerunningclub.co.uk/` on **16 August 2026** — not a value anybody at
the club has confirmed. It was used provisionally rather than blocked on, because:

- it is what the club visibly looks like today, which is closer to "official" than a
  placeholder chosen for legibility;
- every value derived from it holds its hue (143°) and saturation (66%) and only moves
  lightness, so a corrected green is one edit to `tokens.css` rather than a re-derivation;
- `/brand/` and this document both say plainly that it awaits confirmation, so nobody
  downstream can mistake it for settled.

**Until the club confirms otherwise, treat `--src-green` as "what the site looks like",
not "what the club has approved".**

## What was measured and what follows from it

Three things fall out of the measurement, each a decision rather than a detail:

**There is no green logo asset.** The club's mark reads as green today because a black
wordmark (`blacktransparantlogo-removebg-preview.png`) sits on a green header — the PNG
itself has no colour information of its own beyond its own black ink. This repository's
`logo.svg` is filled with `currentColor` for the same reason: one piece of artwork, coloured
by whichever stylesheet is in charge, rather than a black file and a hand-made green
variant that can drift apart. See [`packages/shared/src/brand.ts`](../../platform/packages/shared/src/brand.ts).

**`#209D50` cannot be a text colour.** On the page background it measures **3.44:1** —
above the 3:1 floor for large text and non-text UI, below the 4.5:1 body-text floor. Black
on it is **6.00:1**, which is precisely how the live club site uses it: a *surface*, with
black text, never green words. This repository targets AAA (7:1) rather than the AA floor,
so two derived greens exist for text — see below — and the undiluted brand green is reserved
for surfaces and the logotype, which WCAG exempts from any contrast requirement at all
(1.4.3, "text that is part of a logo or brand name").

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
| `--src-green` | `#209D50` | Page | 3.44:1 |
| `--src-green` | `#209D50` | Banner band | 3.14:1 |
| `--src-green-text` | `#11552C` | Page | 8.74:1 |
| `--src-green-text` | `#11552C` | Banner band | 7.99:1 |
| `--src-green-text-dark` | `#47DA80` | Dark page | 9.97:1 |
| `--src-green-text-dark` | `#47DA80` | Dark banner band | 8.19:1 |

Both derived values *beat* the invented greens they replaced (`#16543f` at 8.69:1/7.94:1,
`#6fd3a8` at 9.93:1/8.15:1) — adopting the real brand cost nothing in contrast anywhere.
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

**Not compared:** `color.primary` (`#00C85A`), the timing app's own green. It is 1.57:1 from
`#209D50` — close enough to read as a mistake side by side, far enough to not be the same
colour — and is that app's own brand rather than the club's, so no attempt was made to
reconcile the two.

---

## Open questions for the committee

None of the following can be inferred, and a plausible placeholder in markup is worse than
a blank. Recorded here rather than in code, per
[`principles.md`](../architecture/principles.md)'s stop-and-ask rule for unconfirmed facts.

- [ ] **Is `#209D50` the club's official green?** — or is there a value the committee has
      actually approved, distinct from what a Squarespace theme happens to render.
- [ ] **Does an official green wordmark exist?** — the only public asset is the black PNG
      described above.
- [ ] **A secondary and neutral palette**, if the club has one beyond the single green.
- [ ] **The typeface** — licence Halyard, or accept Inter as the substitute.
- [ ] **What the brand should look like in dark mode.** The live club site has none; this
      one does, and `#209D50` behaves very differently on a dark background (5.16:1) than
      on white (3.50:1).
