# ADR-012 — One navigation bar, and the year is never in it

**Accepted**, 15 August 2026. **Supersedes the navigation section of**
[ADR-011](adr-011-a-race-and-its-runnings.md) — *The navigation spans two levels, and only year
pages get the second*. Everything else ADR-011 decided stands.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions), [people](../../foundations/requirements.md#people) |
| **Supersedes** | [ADR-011](adr-011-a-race-and-its-runnings.md), in part |

## Context

ADR-011 split the routes between the race and one running of it, and gave the navigation the
same shape: a race row everywhere, and a running row that appeared only beneath a year.

**That was the routes leaking into the interface.** A runner standing on the course page does
not care that race day lives inside a year directory — they care where race day is. What the
two-level bar did was make them care: the links available changed depending on which page they
happened to be on, and the page where fewest were available was the evergreen one somebody
lands on first.

The reasoning ADR-011 gave for it was real and is what this record answers: an evergreen page
**cannot know which running is current without asking**, and the two ways to give it one were
both judged worse than the gap. One of them was a year written into a component, which the
route split existed to remove. The other was a database call on every content-page view.

**The second is affordable, and ADR-011 did not price it.** `entries.current_entry_state()`
reads two small tables, returns no personal data, and the Worker already runs on every request
because `run_worker_first` is set. It is one round trip added to pages that previously made
none, resolved once and shared with whatever else the page needs it for.

## Decision

> **The control table below is superseded by
> [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md), 17 August 2026.** There are six
> controls: `Privacy` joins as the fifth link, last in the list. Everything else here stands —
> one bar, identical on every page, and the year never in it.

**One bar, five controls, identical on every Nightingale Nightmare page that carries it.** Only
the current-page marker moves.

| | |
| --- | --- |
| Race | `/nn/` |
| Course | `/nn/course/` |
| Race day | the current running's, **painted** |
| Spectators | the current running's, **painted** |
| **The button** | the current running itself, **painted**, and its label depends on the entry window |

**The year is never visible in the bar and never present in `dist/`.** The three year-bearing
controls ship `hidden` with `href=""`; `worker/nn-entry.ts` fills them in from
`entries.current_entry_state('nn')` on every page that renders the masthead — including
`/nn/course/` and `/nn/privacy/`, which this Worker previously did nothing to at all.

`tests/unit/nn-nav.test.ts` greps the two components for a year-bearing path, because a Worker
test only ever sees the painted result and could never catch a hand-typed one.

### The button, and why its label changes

| Window | Long | Short (320px) |
| --- | --- | --- |
| `open` | Enter the race | Enter |
| `pre_open` | Register interest | Interest |
| `closed` | Race details | Details |

**"Enter" on a button that does not let you enter is a small dishonesty on a site that is about
to ask for money.** Each label is exactly what the destination offers: the interest form is on
the year page before entries open, and once they have closed the page says so.

Each short label is a substring of its long one, and the `aria-label` carries the long one at
every width — WCAG 2.5.3, which asks that what somebody says out loud appears in what the
machine reads.

**The button is not in the `<ul>` and not inside `<nav>`.** Not in the list because it is the
one thing this site exists to do and a list of five equals buries it. Not inside the navigation
landmark because at 320px it shares the wordmark's row, which means it has to be the wordmark's
sibling. It is a call to action rather than a place to go, it is still inside the banner, and it
is announced immediately after the four links.

### It is not sticky, and that is the other half of this record

> **Superseded by [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md), 17 August
> 2026.** The bar is `position: sticky` again, with each of the three defects below paid for
> rather than disputed — and with **the 207px corrected**: that figure belonged to the two-row
> links bar *this* record replaced, and the one-row bar it introduced costs 62px on a laptop.
> What follows is left as it was accepted; the defects it names are the ones ADR-014 answers,
> one at a time, and the before/after keyboard-sweep numbers below are still the measurement of
> record.

ADR-011 inherited a sticky masthead. It cost three defects:

1. **It broke a measurement harness**, which read the bar's rectangle as the page's.
2. **It hid arrow-keyed radios at 320px in WebKit**, and no `scroll-margin` could repair it.
3. **It forced a background colour**, because a bar that never leaves has the page scrolling
   through it.

And it cost height. The figure written down at the time was 159px of a 568px phone; the route
split had quietly made it **207px** — 36% of that viewport, held permanently, on pages people
read and scroll.

**Measured before and after**, on the engines CI runs:

| | before | after |
| --- | --- | --- |
| Header, 1280px | 64px | 62px |
| Header, 320px, `/nn/` | 111px | 109px |
| Header, 320px, a year page | **207px** | **109px** |
| Keyboard sweep at 320px, Chromium | 6 of 6 clear | 6 of 6 |
| Keyboard sweep at 320px, WebKit | **3 of 6** | **5 of 6** |

The sweep walks the three entry-type radios with the arrow keys and then tabs on through the
next three controls. **The two arrow-key failures are fixed.** The remaining one is WebKit
dropping focus out of the document entirely on the sixth press — the same "nothing focused" it
produced before, and not something the page controls.

`scroll-margin-top: 168px` on every `[id]` in the theme is deleted with the bar it propped up.
Anchor targets land at the top of the viewport, which is where they belong.

### At 320px

> **Superseded by [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md), 17 August 2026**
> as to the row count: six controls make it three rows, and the paddings are compact at this
> width to buy the third one back. "No hamburger, no script" stands, and so does the `order`
> note below.

Two rows: the wordmark and the button on the first, the four links on the second. No hamburger,
no dropdown, no toggle, no script — five controls fit, and a menu that has to be opened is more
machinery than the thing it hides.

**One `order` at one measured breakpoint** puts the button on the wordmark's row. That is the
only reordering in the stylesheet, and it costs a real thing worth naming: focus order stays the
DOM's — mark, links, button — so at 320px somebody tabbing reaches the four links before the
button drawn above them. It is the smaller of the two available divergences; the alternative
puts it at the width where the button is the furthest thing right, which is where jumping
backwards would actually surprise somebody.

## Consequences

**Good**

- The bar is one thing to learn, and it is the same thing on every page.
- Race day and spectators are one tap from the course page, which under ADR-011 took two.
- The sticky header's three defects are gone, and a year page's header is 98px shorter on a
  phone.
- A hard-coded year in the navigation now fails a test that runs in `./dev check`, with no
  build, no database and no browser.

**Costs, and they are real**

- **One database round trip on every content-page view.** `/nn/course/` and `/nn/privacy/` had
  none. It is `entries.current_entry_state()`, resolved once per request and shared.
- **A new failure mode on those two pages.** A database this Worker cannot reach leaves the bar
  with its two evergreen links and no button. Fewer doors, never a door into a year nobody
  confirmed — the same direction every other failure here takes.
- **Focus order and visual order disagree at 320px**, by one control. Named above.
- **The button is outside the navigation landmark.** A screen-reader user jumping by landmark
  gets four links and then the button, rather than five things in one list.

**Neutral**

- The `aria-current` marker is derived from the **shape** of the page's own path, so it is right
  before anything is painted — including with the database down.

## Exit cost

**An afternoon.** The two-level bar is in this repository's history and the component is 100
lines. What would not come back cheaply is the sticky header, and nothing here wants it to.

## Revisit when

**A second race joins the site.** Five controls fit and a menu that has to be opened does not
earn its script; a bar carrying two races might. That is the width at which "no hamburger" gets
argued again, and it should be argued with a measurement rather than a preference.
