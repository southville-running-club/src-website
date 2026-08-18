# Design

Approved visual work, and the notes needed to build against it.

| | |
| --- | --- |
| [`nn-entry-mockup.html`](nn-entry-mockup.html) | The Nightingale Nightmare campaign mockup |
| [`nn-admin-mockup.html`](nn-admin-mockup.html) | The race admin surface — **the club brand, not the campaign theme** |
| [`nn-theme-fonts.md`](nn-theme-fonts.md) | Where the event theme's three faces came from, and how to fetch them again |

## The admin mockup, and the four things the build did not take from it

`nn-admin-mockup.html` is the approved design for `/nn/admin`, and its central decision is the one
worth keeping: **it wears the club brand rather than the Nightingale Nightmare theme.** This is a
tool rather than a page a runner reads — all content and no frame — and it will serve Pass the Buck,
which has nothing to do with Halloween. `nn-theme.css` is not imported anywhere under `/nn/admin`
and must not be.

Its section order is the design and was followed exactly. Four things in it were not:

**1. Its colours are not the club's.** The mockup declares its own palette — `--primary-deep:#00A048`,
`--rule:#E2E6E0` against the real `#D8D8D4`, and text colours `#00733A`, `#7A4E00`, `#A81410`,
`#5C3A00`, `#3D2600`, `#7A1512` — plus a dozen `rgba()` tints. None of those is a club token, and a
literal tint is also **wrong in dark mode**, where the page behind it is not white. The build tints
with `color-mix(in srgb, <a token> N%, var(--colour-background))` instead, so every wash is derived
from the palette and re-derives itself when the scheme flips.
`packages/shared/tests/unit/admin-contrast.test.ts` reads the percentages out of the stylesheet,
mixes them, and asserts the contrast — so there is no hex value in `nn-admin.css` at all.

**2. Two of its pairs would not have passed.** Its "Sign out" link is the brand green on the dark
masthead, and its capacity bar is filled with raw `color.primary`, which measures 2.05:1 against its
track — under WCAG's 3:1 floor for non-text UI. The build underlines the link in the band's own ink
(AAA rather than AA) and fills the bar with the text-safe green (6.48:1). The amber at full is kept,
and is the one pair on the surface below a floor: 1.68:1 on a light page. It is accepted because
every quantity the bar encodes is stated in words beside it, and the test pins the number.

**3. Its event bar shows a closing time.** *"Closes Friday 23 October, 20:00"* is invented, exactly
like the entry mockup's "238 of 250 places remaining". **The 2026 entry open and close times are not
confirmed**, `entries.events.entries_close_at` is null, and the page says so in those words. This is
the same trap this file already warns about one mockup along.

**4. Its audit trail is not built.** Nothing may read `entries.admin_audit` — see
[the admin runbook](../delivery/runbooks/entries-admin.md#the-trail-is-read-here-and-not-on-the-page--on-purpose)
for why that is a decision rather than a gap.

Its "3 claimed affiliated without giving a number" **was** kept, and checked first: the state is
reachable, because `entries.create_pending_purchase()` writes `ea_number` through without
consulting `fees.requires_ea_number` and is granted to `anon`.

## Read this before taking anything out of the mockup

`nn-entry-mockup.html` is the **entries application** — the build that takes an entry and a
payment, which does not exist yet. It was drawn against confirmed race facts, and it is
full of them: a date, a start time, two prices, a capacity, a minimum age, an HQ address, a
race-morning schedule, prize categories, a transfer deadline.

**None of those facts is confirmed for this website.** They are the mockup's content, not
the club's position. Copying one into a page — even as a placeholder, even in a comment —
is the *stop and ask* trigger in [the principles](../architecture/principles.md), because a
plausible date on a race page is a promise the committee has not made and a race cannot be
re-run.

What the mockup is good for is the **visual system**: the palette, the typography, the card
and field treatment, the artwork placement, the focus and motion rules. That is what
`packages/shared/styles/nn-theme.css` takes from it, and that file records which of the
mockup's colour pairs failed a contrast check and what was changed instead.

**The date the mockup shows turned out to be the right one.** "Sunday 1st November 2026 ·
11:00" was confirmed on 12 August 2026 as the club's published campaign date, and it now
drives the site from `race.date` in `apps/main/src/content/race.json` rather than from
markup — as does the distance, the race HQ, the schedule, the prizes and the spectating
points.

**That is not licence to take the rest of the mockup at face value.** Several things on it
still read like facts and are not: the entry prices and the transfer deadline belong to the
entries application, the "238 of 250 places remaining" counter is demo data, the course
profile drawing is a sketch rather than a survey, the minimum age is inferred from the
prize categories rather than stated, and **"clocks change the night before" is simply false
for 2026** — the clocks go back on 25 October and the race is a week later. Each of those
is listed against the page that had to decide about it, in the comment at the head of
`apps/main/src/pages/nn/course.astro` and `apps/main/src/pages/nn/2026/race-day.astro`.
