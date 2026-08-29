# Design

Approved visual work, and the notes needed to build against it.

| | |
| --- | --- |
| [`nn-entry-mockup.html`](nn-entry-mockup.html) | The Nightingale Nightmare campaign mockup |
| [`nn-admin-mockup.html`](nn-admin-mockup.html) | The race admin surface — **the club brand, not the campaign theme** |
| [`nn-2026-page-demo.html`](nn-2026-page-demo.html) | The agreed layout for the consolidated `/nn/2026/` page — **behaviour, not content** |
| [`nn-theme-fonts.md`](nn-theme-fonts.md) | Where the event theme's three faces came from, and how to fetch them again |

## The page demo, and what is settled against it

[`nn-2026-page-demo.html`](nn-2026-page-demo.html) is the approved layout for consolidating
`/nn/2026/` onto one page: the anchor navigation, the accordions, the sticky header, the sticky
entry card and the mobile entry bar, all working with the script removed. **That behaviour is
what it is for.** Its content is lorem, its facts are hardcoded, and five of them are wrong in
ways that read as perfectly reasonable — which is why they are written down here rather than
left to be noticed.

**1. Its schedule is the one that was corrected away.** The demo lists four rows — 09:15
registration, 10:15 briefing, 10:30 walk, 11:00 start. `race.json`'s `schedule[]` carries six,
and the race director confirmed **10:30 briefing, 10:40 walk, 10:50 warm-up** on 26–27 August
2026 (#121). The committed array is authoritative and is not edited from this file.

The demo's start-line note repeats the error in the shape that costs somebody their race:
"We walk there together at 10:30." **10:30 is the briefing now**, so that sentence attaches the
right number to the wrong event — which is exactly the defect #121 removed from
`2026/race-day.astro`'s prose, and the reason `site.spec.ts` asserts each time against the row
it labels rather than asserting bare time strings.

**2. Its places counter is demo data and is guarded against.** "184 of 246 places left" is a
live count, which is out of scope — it needs a security-definer read nobody has asked for — and
246 is not the field size either; the race is 250. `site.spec.ts` already asserts
`not.toMatch(/\bof 250\b|places remaining/i)` on every campaign page, put there when the entry
mockup made the same offer. **How big the race is does not change during the week somebody is
deciding whether to come**; how full it is does, and a number cached at the edge on a
poster-shaped page is a claim the club would have to keep true.

**3. Its prices are in the markup, and one of them names a retired thing.** £18 and £20 are
`entries.fees.price_pence` — they are what `create_pending_purchase()` actually charges, and a
second copy in a page is how the page and the till start disagreeing, with the page being the
copy nobody notices has gone stale. The shipped facts list ships "To be confirmed" and the
Worker paints the fees over it. Separately, the demo's label reads **"EA-affiliated"**: the club
stopped asking for and holding England Athletics numbers on 29 August 2026 (decision 007,
ADR-023). The fee is `affiliated`, and what the £2 buys is ARC's Unattached Runner Levy rather
than anything to do with England Athletics.

**4. Its accordions are closed, and they ship open.** Content inside a collapsed `<details>` is
not reliably reachable by find-in-page — Chrome and Edge auto-expand, iOS Safari historically
does not — and roughly seven in ten visitors are on a phone. Somebody searching "parking" on
race morning must not get nothing on a page that holds the answer. The scroll length that
collapsing used to buy is paid for instead by the sticky entry bar, which reaches the call to
action from any position.

**5. Its address is restructured, and it drops a place.** The demo renders event HQ as four
lines and reads "Ashton Park School / Blackmoors Lane / Bristol / BS3 2JL". `race.location` is
one string and includes **Bower Ashton**, which the four-line version loses. It is used as it
stands.

Two more the build does not take, both recorded at greater length elsewhere:
`background-attachment: fixed` on the hero (already shipping, already a known iOS scroll-jank
ticket, and not to be replicated anywhere new), and `--font-display: 'Nosifer', fantasy` — a
fallback that ends outside the body stack, so with `font-display: swap` every first visit
renders headings in Impact before Nosifer arrives. See [`nn-theme-fonts.md`](nn-theme-fonts.md).

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
