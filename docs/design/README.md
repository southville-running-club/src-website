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

The one piece of race wording the committee has settled is "Halloween weekend 2026 — exact
date to be confirmed", and it is driven by `race.date` being `null` in
`apps/main/src/content/race.json` rather than written into markup.
