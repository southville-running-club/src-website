# ADR-014 — The navigation bar stays on screen, and the privacy notice is in it

**Accepted**, 17 August 2026. **Supersedes two sections of**
[ADR-012](adr-012-one-navigation-bar.md) — *It is not sticky, and that is the other half of this
record*, and its five-control table. Everything else ADR-012 decided stands, including the part
that matters most: the year is never in the bar.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions), [people](../../foundations/requirements.md#people) |
| **Supersedes** | [ADR-012](adr-012-one-navigation-bar.md), in part |

## Context

Two requests arrived together and they turn out to be one decision, because each makes the other
more expensive: **the navigation should be reachable from anywhere on a page**, and **the privacy
notice should be in it**.

They interact through height. A bar that stays on screen spends vertical space for the whole
page rather than merely occupying it at the top, so a sixth control is no longer just a sixth
control — and a sixth control is exactly what pushes the phone bar onto a third row. Deciding
either one alone would have got the arithmetic wrong.

### What ADR-012 actually recorded, and the one number in it that had gone stale

ADR-012 unstuck this bar and gave three defects and a height as the reason. The three defects
were real and are answered below one at a time. **The height is the part worth correcting.**

The figure it published was **207px of a 568px phone — 36% of the viewport, held permanently**.
That number belonged to a bar ADR-012 itself then deleted: two rows of *links*, the second
appearing only beneath a year. What replaced it is one row of text, and the same document
measured it at **62px on a laptop and 109px on a 320px phone**.

So the cost of sticking *this* bar was never 207px. Nothing was wrong with ADR-012 — it recorded
the cost of the thing that was in front of it — but the headline number outlived the layout it
described, which is how a document that is trusted stops being true.

### Why the notice belongs in the bar rather than the footer

The conventional home for a privacy notice is the footer, and the argument for putting it in the
navigation is specific to this site rather than general.

`/nn/privacy/` is not boilerplate here. It describes fourteen fields, a payment, a special
category of data under its own consent, and five retention periods, and it is written from the
schema rather than from the form — so it lists four things about a person that nobody types. The
person most likely to want it is standing on a page that is **about to ask for all of that**, and
a link they have to go looking for is a link that gets read after the form rather than before it.

There is a smaller, sharper reason too. `/nn/privacy/` carried the campaign masthead already and
was **the one page in the campaign whose bar linked to everywhere except where you were
standing** — six controls, none of them current, no way to tell from the header what page this
was. That was visible in the test suite as a special case: `nn-nav.test.ts` asserted "exactly one
control is current, except on `/nn/privacy/`, which has none".

## Decision

### One bar, six controls, and it stays on screen

| | |
| --- | --- |
| Race | `/nn/` |
| Course | `/nn/course/` |
| Race day | the current running's, **painted** |
| Spectators | the current running's, **painted** |
| **Privacy** | `/nn/privacy/` — **new**, and last in the list |
| **The button** | the current running itself, **painted**, and its label depends on the entry window |

`position: sticky; top: 0` on `.nn-masthead`. The cross-site banner above it is **not** sticky
and scrolls away, so what stays is the wordmark, the five links and the button.

**Privacy is last rather than beside `Course`.** The four links before it read as a set — where
the race is, what the course is, what happens on the day, where to watch — and dropping a legal
notice into the middle of that set breaks it. Last, it is the thing after the set, which is what
it is. `NnNav.astro` renders it from its own one-item list for that reason, and both the unit and
the Worker test assert the order rather than merely the membership.

**It is not painted and it names no year**, so it joins `Race` and `Course` as a literal in the
component. The rule ADR-012 exists to protect is untouched: three controls may carry a year, they
are the three the Worker paints, and `tests/unit/nn-nav.test.ts` still greps the components for a
hand-typed one.

**The address does not move, and this record does not decide that it should.**
[ADR-011](adr-011-a-race-and-its-runnings.md) flagged `/privacy/` as the notice's eventual home —
its substance is the club's rather than the race's — once the club has a second form for it to
cover. Linking it from the campaign bar is not an argument against that: whichever address it
ends up at, the bar's job is to make it reachable from the pages that collect what it describes.
When it does move, this entry changes address and nothing else about it changes.

### The three defects, each paid for

| ADR-012's defect | What pays for it |
| --- | --- |
| **1. It broke a measurement harness**, which read the bar's rectangle as the page's | The harness reads the *document*. `site.spec.ts`'s "operable at 320px" and the six other overflow checks all measure `documentElement.scrollWidth`; nothing in the suite reads the bar as the page. Nothing to fix — the harness was rewritten between the two records |
| **2. It hid arrow-keyed radios at 320px in WebKit**, and no `scroll-margin` could repair it | `scroll-padding-top` on the **scrollport**, which is the rule ADR-012 could not find. See below |
| **3. It forced a background colour** | Still true, and still the price rather than a fix. `blood-deep`, already in the theme's contrast table at 1.51:1 against the page, with every pair *on* the bar improving over the same pair on `blood` |

**Defect 2 is the one that needed a new idea, and the distinction is the whole of it.**
`scroll-margin-top: 168px` on every `[id]` was the previous attempt, and it could only ever move
a **fragment target** — nobody navigates to a radio by its id, so the rule was never capable of
helping the defect it was blamed for. `scroll-padding-top` is a property of the **scrollport**
instead, so it insets every scroll-into-view the browser performs: following a link to an id, and
following focus onto a control. One rule, at the mechanism, rather than a list of selectors that
could never be complete.

It is declared on `<html>` — this theme's one exception to scoping everything under
`body.theme-nn`, forced by the fact that the element which scrolls is `<html>` and a custom
property on `body` cannot be read by `body`'s own parent. `html:has(body.theme-nn)` keeps the
promise that nothing in the stylesheet reaches a page that has not asked for it.

**The remaining WebKit behaviour is not something this repository can fix and is not claimed to
be.** ADR-012 measured WebKit dropping focus out of the document entirely on the sixth press of a
keyboard sweep, and noted that WebKit frequently does not scroll at all when focus moves by
keyboard. A scrollport inset changes where a scroll lands, not whether WebKit performs one.

### The height, measured across the range rather than at two points

**This is the part of the slice that was got wrong twice, and both times by reasoning about label
widths instead of measuring them.** The numbers below are from the sweep, on the three engines CI
runs.

| width | bar | rows | token | inset |
| --- | --- | --- | --- | --- |
| 1280px | 62.5px | one | 64px | 72px |
| 900px | 62.5px | one | 64px | 72px |
| 768px | 62.5px | one | 112px | 120px — slack |
| 700px | 62.5px | one | 112px | 120px — slack |
| 640px | 110.9px | two | 112px | 120px |
| 560px | 110.9px | two | 112px | 120px |
| 480px | 97.3px | two (links on one row) | 136px | 144px — slack |
| 400px | 97.3px | two (links on one row) | 136px | 144px — slack |
| 320px | 134.8px | three | 136px | 144px |

**Two guesses in that table were wrong**, and a sweep is the only reason either was found:

- **The one-row bar survives to somewhere between 640px and 700px**, not the ~620px arithmetic on
  five label widths predicted. So 480px — which was measured for *four* links — is nowhere near
  where the layout stops fitting six, and there is a **160px-wide band of tablet widths** where
  the bar is 110.9px with no breakpoint of any kind involved. A token stepping straight from 64px
  to 136px at 480px would have left an inset of 72px under a 110.9px bar there: nothing visibly
  wrong, and every anchor on those screens landing behind the header.
- **The ≤480px regime has two heights, not one.** Five compact labels still fit on one row at
  400px and wrap at 320px, so the bar is 97.3px on the wider phones and 134.8px on the narrowest.
  The first attempt at this token was 116px, from arithmetic; the sweep failed it.

**The boundaries therefore sit on the safe side of values nobody controls.** Where five labels
wrap is a consequence of font metrics, not of anything this repository sets, so a boundary placed
*at* a wrap point would be wrong on whichever side the fonts moved. 768px reserves about 58px more
than the one-row bar needs between 700px and 768px, and the ≤480px token is about 47px generous at
400–480px. Both land an anchor slightly low. Being short puts it underneath the header instead —
and those are not the same size of wrong.

**A test at 1280px and 320px would have passed every version of this, including the broken ones.**
`site.spec.ts` sweeps nine widths and asserts three things: that the inset clears the bar at
*every* one, that it still tracks the bar to within 40px at the five where the bar is as tall as
its regime ever gets, and that the bar is never more than a quarter of the viewport.

### At ≤480px the bar is compact, and what that buys is not uniform

The bar's own padding drops 12/10 → 8/6 and each link's vertical padding 8 → 6. Targets stay
~30px against WCAG 2.2's 24px floor.

| | four links, loose | five links, compact |
| --- | --- | --- |
| 1280px | 62px | 62.5px |
| 480px | ~108px | **97.3px** |
| 320px | ~108px | **134.8px** |

**At 400–480px the compaction pays for itself outright** — the bar is about 10px *shorter* than
the four-link bar was, with an extra link in it. **At 320px it returns roughly two thirds of the
row it costs**: five labels will not fit one row inside the 280px that width leaves, so the bar is
27px taller than before. 24% of a 568px screen, against the 36% ADR-012 objected to.

**Shrinking the type was the other way to fit five labels on one row at 320px and was rejected.**
They are already 13px, and the arithmetic says 12px would only just do it — so the navigation
would become the smallest text anywhere on the site, to save one row at one width, on a bet about
a font metric this slice has already lost twice.

## Consequences

**Good**

- The navigation is reachable from anywhere on a page, which is what was asked for.
- The privacy notice is one tap from every page in the campaign, including the two forms that
  collect what it describes.
- **`/nn/privacy/` is no longer the page whose header cannot say where you are.** The special
  case is gone from `nn-nav.test.ts` rather than restated.
- The scrollport inset is a better rule than the one ADR-012 deleted: it covers focus as well as
  fragments, in one declaration rather than one per `[id]`.
- Three heights and eight test widths, where the previous rule had one number and no test.

**Costs, and they are real**

- **Vertical space, permanently.** 62.5px of a laptop, 97.3px of a 400px phone and 134.8px of a
  320px one. The quarter-of-the-viewport ceiling is asserted, not assumed, and a seventh control
  breaks it — which is the point of the assertion.
- **The mockup's transparent header is gone.** A bar that stays cannot be transparent or the
  page's words scroll through it, so the poster now opens with a band of the gradient's darker
  end. This is the second time that has been paid; ADR-012 got it back and this spends it again.
- **A hand-written height per breakpoint.** Three numbers that have to track a layout, which is
  the kind of coupling this repository usually avoids. The sweep is what makes it survivable, and
  it will fail loudly rather than drift.
- **A third row on a phone**, from the sixth control. Compaction returns most of it, not all.
- **`:has()` in the critical path.** One selector, in a stylesheet that already uses it for the
  entry-type cards.

**Neutral**

- The bar sticks on `/nn/<year>/entry/complete/` too, where it holds no links. One rule rather
  than an exception; what stays there is a single 62px row carrying the wordmark.
- `aria-current` is still derived from the shape of the page's own path, so `Privacy` is marked
  before anything is painted — including with the database down.

## Exit cost

**An hour, and less than ADR-012's afternoon.** Unsticking is deleting four properties, the
`html:has()` block and the middle breakpoint; the tests that assert the stuck behaviour say
exactly which they are. Removing `Privacy` is one array and three expectations. Neither touches
the painted controls, which is where the risk in this component lives.

## Revisit when

**A seventh control is proposed.** The quarter-of-the-viewport assertion will fail, and that is
deliberate: the next person to add to this bar has to argue the height rather than discover it
afterwards. The honest options at that point are a hamburger — which ADR-012 costed and rejected,
and which needs a script this site does not otherwise require — or moving the notice to the
footer after all.

**Or when a real phone says the compact bar is still too tall.** 134.8px of 568px is 24%, argued
down from 36% but not to nothing, and it is the narrowest phones that pay it — the wider ones
came out ahead. The measurement to bring is a person scrolling the entry form on a phone, not a
number from a stylesheet.
