# Design

Approved visual work, and the notes needed to build against it.

| | |
| --- | --- |
| [`nn-entry-mockup.html`](nn-entry-mockup.html) | The Nightingale Nightmare campaign mockup |
| [`nn-theme-fonts.md`](nn-theme-fonts.md) | Where the event theme's three faces came from, and how to fetch them again |

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
`apps/main/src/pages/nn/course.astro` and `race-day.astro`.
