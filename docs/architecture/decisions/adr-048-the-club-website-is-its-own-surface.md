# ADR-048: The club website is its own surface

**Status:** Accepted
**Date:** 19 September 2026
**Supersedes:** nothing

## Context

The club website — `/`, and the pages being built beside it — has been a holding page since
the platform started. It is now being built properly, in a design the club has approved
("Direction A: Community and warmth"), whose palette is built on **`#209D50`**, the accent
from the club's current Squarespace site.

That palette is not the one this repository ships. On 16 August 2026 the club adopted
`docs/foundations/race-timing-brand-guidelines.md` — `bindalshah/src-race-timing`'s own tokens
— for `apps/main`, superseding the club's own green. Those values live in
`packages/shared/styles/tokens.css`, are mirrored in `packages/shared/design-tokens.json`, and
are mapped onto semantic names in `packages/shared/styles/base.css`.

**`base.css` is rendered by every page that takes or handles money.** `/nn/*`, `/account/*`,
`/admin/*`, `/events/<slug>/`, and the whole of `apps/timing` import it, directly or through
`account.css` and `nn-admin.css`.

And the timing of this work is the problem. Nightingale Nightmare is **1 November 2026**. The
entry window opened on 1 September and closes at 17:00 on 30 October; 110 of 250 places were
sold as at 7 September. `docs/delivery/phases.md` schedules the new website for Phase 5, *from
November*, and declares a change freeze from the week before the race. This work is arriving
six weeks early, while the race is selling.

So the obvious implementation — replace the values in `tokens.css`, update the ratios in
`base.css`'s comments, update `design-tokens.json` and the tests that recompute it — would
repaint the entry form, the admin tables and the race-night console in the same commit that
repaints the home page. Every `color-mix` wash in `nn-admin.css` would be re-measured against
new values. The change would be reviewed by two volunteers with day jobs, in the fortnight
before the race their club puts on.

## Decision

**The club website is a surface of its own, with its own stylesheet.**

`packages/shared/styles/club.css` carries Direction A: its own reset, its own focus ring, its
own skip link and its own `--club-*` tokens. It **imports nothing** — not `base.css`, not
`tokens.css`. A club page loads it through `ClubBase.astro` and loads nothing else; a money
page loads `base.css` through `Base.astro` and never sees this one.

The chrome is the same split. `CLUB_NAV` and `CLUB_BANNER` live in
`packages/shared/src/club-nav.ts` rather than as new exports in `brand.ts`, and
`ClubHeader.astro`, `ClubMenu.astro` and `ClubFooter.astro` are new components rather than
edits to `SiteBanner.astro`, `SiteNav.astro`, `SiteFooter.astro` or `worker/site-chrome.ts`.

**This supersedes nothing.** The timing brand remains what `apps/timing`, `/admin/` and the
race pages are drawn in, and the 16 August decision stands exactly as recorded. The club now
has two surfaces where it had one, and this ADR is the record that the second one exists
deliberately.

### What is deliberately duplicated

Roughly 120 lines: `box-sizing`, `body`, `img`, the heading scale, the focus ring, the skip
link, the visually-hidden helper. Each has a near twin in `base.css`.

The alternative — importing `base.css` into `ClubBase.astro` and overriding it — was rejected
for two reasons. It would couple every club rule to a token whose value lives in a file nobody
may edit until November, so a club colour would resolve through the money pages' palette; and
it would ship both stylesheets to every club page, for the benefit of the half-dozen rules
that are genuinely shared.

### The floors are AA, not AAA

`base.css` and `nn-theme.css` aim at 7:1. **This surface aims at WCAG 2.2 AA**, and that is a
consequence of the palette rather than a relaxation of standards: `#209D50` is the club's own
published accent, the darkest ink that reads on it is 5.07:1, and the link green on the
alternate band is 5.68:1. Holding Direction A to AAA means choosing a different green, which
is a decision the club has not been asked for.

Two rules follow from `#209D50` and are enforced by
`packages/shared/tests/unit/club-contrast.test.ts`:

- **Never white text on it.** 3.50:1, which fails AA. Button labels, the facts strip and the
  footer use `--club-on-brand` (`#0D1B12`, 5.07:1).
- **Never it as text on the light surfaces.** 3.22:1 on the page. Links use `--club-link`
  (`#236A33`, 6.06:1). ⚠️ In the **dark** scheme the same green is 4.89:1 and does read; the
  rule is scoped to the light surfaces because that is where it is true, and the design uses
  it as text nowhere.

It is legitimate as a non-text graphic, where WCAG asks 3:1. ⚠️ **On `--club-surface-alt` it
measures 3.01:1** — one hundredth above the floor — which is why that pairing is asserted by
name.

## Consequences

### The money pages are provably untouched

`apps/main/tests/e2e/club-chrome.spec.ts` carries a describe block that asserts the *absence*
of the new chrome on `/nn/`, `/nn/2026/`, `/events/christmas-party-2026/`,
`/account/sign-in/` and `/privacy/`, that the old banner sentence and the old four-item bar
still render, and that neither palette resolves on the other's pages. Without it the failure
mode is silent: somebody adds `ClubHeader` to `Base.astro` to be helpful, and the entry form
grows a second navigation with every existing test still green.

### Two navigations and two banner sentences coexist

The money pages keep **Home · Nightingale Nightmare · Events · Account** and *"We just have
Nightingale Nightmare for now"*. The club pages get **Run with us · Races and events ·
Membership · News · About · Account** and *"Some pages are still on the old site while we move
across."*

A member clicking "Events" in the old bar therefore lands on a page headed "Races and events"
in the new chrome. That seam is visible, temporary, and very much cheaper than the
alternative.

### A cost that recurs until it is paid

Every shared rule now has two homes, and a change to one is a change somebody has to remember
to make twice. **This is a debt with a due date rather than an arrangement**: after the race, a
separate change moves the money pages onto this chrome, reconciles the two stylesheets, deletes
`club-nav.ts`'s duplication of `brand.ts`, and removes the fence in `club-chrome.spec.ts` and
the two limited tests in `site.spec.ts`. That change is the one this ADR exists to make
possible, and leaving it undone is how the duplication stops being deliberate.

### `formatPence()` gains a sibling rather than a branch

`formatPriceWords()` joins `packages/shared/src/money.ts`: `Free` / `50p` / `£4` / `£2.50`.
The club's own pages say *"Run for 50p. Join for £4."*, which through `formatPence()` reads
*"Run for £0.50. Join for £4.00."* — a different sentence, not a formatting preference.

`money.ts` is on the money path — `NnEntryForm.astro` imports `formatPence` into the entry
form's **browser bundle** — so the addition was measured rather than reasoned about, per this
repository's own record of an import that cost 5,969 unshaken bytes. Before and after a
production build, `/nn/2026/`'s script is **76,075 bytes with an identical SHA-256 and an
identical content hash in its filename**. The new function shakes out completely and that page
is served a byte-identical file.

## Alternatives considered

**Edit the tokens and repaint everything.** The honest reading of the brief, and what would
have happened outside an entry window. Rejected on timing alone; it is what the post-race
change does.

**A `theme` prop on `Base.astro`, like `theme="nn"`.** Cheaper in lines and wrong in kind: it
puts the club's palette inside the file the entry form renders through, so every club change
is a diff on a money-path file, which is the thing being avoided.

**A parallel `--club-*` layer inside `base.css`.** Same objection, plus it ships the club's
palette to `/admin/` and `apps/timing`.

## References

- `packages/shared/styles/club.css` — the stylesheet, and the full argument at its head
- `packages/shared/tests/unit/club-contrast.test.ts` — the ratios, recomputed from the file
- `apps/main/tests/e2e/club-chrome.spec.ts` — the fence
- [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md) — why the club bar is not on a
  campaign page, which is why `/nn/*` keeps `NnNav` after the move as well as before it
- [ADR-033](adr-033-a-ticket-is-not-an-entry.md) — why the label says "Events" and the schema
  says `social`
- `docs/design/direction-a.md` — the tokens, the ratios and the component list
- `docs/delivery/phases.md` — Phase 5, and the change freeze this work precedes
