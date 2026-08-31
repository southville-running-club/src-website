# `apps/main` — the club website, and Nightingale Nightmare under `/nn`

Static Astro plus one Worker, serving `new.southvillerunningclub.co.uk`. At the Squarespace
cutover the hostname changes and nothing else does —
[ADR-007](../../../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).

A holding page saying a new site is coming, **seven Nightingale Nightmare pages** — the race
and its running, told apart by path — and a timestamp fetched from Postgres by the Worker
while it serves the request.

**A race is the recurring thing; an event is one running of it in one year, and the routes
now say so.** `/nn/` is evergreen and never names a year; `/nn/2026/` is the 2026 running and
carries the entry form. Publishing 2027 is a row in `entries.events` plus that year's content
pages, with **no edit to `/nn/`** —
[ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md).

**Both forms are on `/nn/2026/`, one shown at a time.** Interest in what — the race in
general, or this year's running? It is this year's, so the interest form sits with the entry
form on the running they are both about, and the page reads as one thing in either state. The
event row decides which, per request. See [the entry form](#the-entry-form) and
[ADR-009](../../../docs/architecture/decisions/adr-009-entries-in-apps-main.md).

## Layout

```
src/content/race.json          Every race fact, as data. See below
src/content/privacy.json       The club notice's own values. Three keys, two of them null
src/components/NnNav.astro     The two Nightingale Nightmare links
src/components/NnMasthead.astro   The header they sit in, and the button beside them
src/layouts/Base.astro         The document, the banner, and the optional `theme` prop
src/pages/index.astro          The holding page — new.<apex>/
src/pages/privacy.astro        The club's privacy notice — the account, and everything
                               that is not about a race
src/pages/404.astro
src/pages/nn/index.astro       The race — evergreen, the year panel, the course and
                               terrain, no year in it
src/pages/nn/privacy.astro     What the club does with an entry and with a sign-up
src/pages/nn/2026/index.astro  The 2026 running — the date, the facts, the entry form
src/components/NnEntryForm.astro  The entry form, and its progressive enhancement
src/pages/nn/2026/terms.astro  The entry terms and race rules — the race director's
                               copy, verbatim. Do not edit it for style
src/pages/nn/2026/race-day.astro   Race day — HQ, the morning in order, prizes
src/pages/nn/2026/spectators.astro Watching the race
src/pages/nn/2026/entry/complete.astro  Where Stripe sends somebody back to
worker/routing.ts              Which paths belong to whom, and where a year lives.
                               Pure and tested
worker/index.ts                Forward /timing locally, take the POSTs, fill in the
                               timestamp, and sweep lapsed holds on a cron
worker/nn-signup.ts            Validate a sign-up, record it, and render the outcome
worker/nn-entry.ts             Decide which form to show; take an entry to Stripe
worker/stripe.ts               One Checkout call, over fetch, with no SDK
worker/stripe-signature.ts     Prove a webhook came from Stripe. Pure and tested
worker/stripe-webhook.ts       The only thing here that records a payment
worker/nn-entry-complete.ts    Paint what the club has recorded onto the return page
```

## The routes

**The race, and one running of it.** Everything above the year is true of the race whichever
year it is run; everything below it belongs to 2026 and stays there when 2027 is published.

| | |
| --- | --- |
| `/nn/` | **The race — evergreen, and it names no year.** No form posts here; a POST gets 405 from the assets binding, as `/nn/privacy/` always has. The Worker paints on which running is current, its date and its links, from `entries.current_entry_state('nn')` — there is no year in this page's markup and there must never be one. **It carries the course and terrain in full**, one `<h2>` and three `<h3>`s inside the race director's card: where it goes, what it is like underfoot, and what is on the route |
| `/nn/course/` | **Not a page any more.** The course and terrain are on `/nn/` itself — they were always the race's rather than one running's — and what moved is the **whole** of this page's copy rather than a summary of it: the club supplied all of it as the wording `/nn/` should carry. The address **redirects**: 301 for a GET or a HEAD, 308 for anything else, because it was published and linked to. `worker/routing.ts` owns the predicate |
| `/nn/privacy/` | What the club does with an entry and with a sign-up. **Written from the schema rather than from the form** — it lists what `entries.entry_purchases`, `entries.entrants` and `entries.entrant_medical` hold, which is four rows more than a list of what somebody types. **Evergreen, and site-wide in substance** — see [ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md) for why it stays under `/nn/` for now |
| `/nn/2026/` | **The 2026 running, and the campaign's one entry point.** The hero, a sticky entry rail, the facts, the race-morning schedule in full, and a summary of each of the two pages below it — see [the consolidated page](#the-consolidated-page). **It carries no course section** — that came off in 1b15cce, and the course and terrain are on `/nn/`. It carries **both forms**: interest before entries open, entry after. Both post here, and a hidden `form` field says which |
| `/nn/2026/terms/` | **The entry terms and race rules**, and what the entry form's checkbox commits somebody to. **The race director's copy, published verbatim** — see [the entry terms](#the-entry-terms). **With the year**, because it names this running's date, permit and transfer deadline; 2027's terms are a new file beside it, not an edit to this one |
| `/nn/2026/race-day/` | Race day — race HQ, the schedule, the prizes |
| `/nn/2026/spectators/` | Watching the race — where to stand, where to park. **With the year**, because it is read alongside race day and names this year's HQ. **Nothing on the site links to it any more**: its content is on `/nn/2026/` as the `#spooktators` section, and the bar's `Spooktators` item was the last inbound link. The page is live and answers 200 to anybody holding the address — which is exactly the shape `/nn/course/` was in before it was retired with a 301, and it is a decision somebody should take rather than a side effect to leave standing |
| `/nn/2026/entry/complete/` | Where Stripe returns somebody after the payment page. **It reports what the club has recorded and never what the redirect implies** — see [the return page](#the-return-page) |
| `/nn/stripe-webhook` | **Not a page.** A POST from Stripe, handled before the assets binding; a GET 404s. The only thing in this platform that records a payment — see [the webhook](#the-webhook) |
| `/privacy/` | **The club's notice, and not the race's** — the account, its columns, the lawful basis for each purpose, who else sees it and what can be asked for. In the club's brand, with no event theme anywhere near it. Written from `identity`'s columns and Supabase Auth's own, which is a good deal more than the sign-up form asks for. Linked from the footer of every page on both front doors, and from `/nn/privacy/`, which it links back down to |
| `/_health` | **Not a page either**, and the underscore is what guarantees it never becomes one. The two database round trips, as JSON, for the smoke test — see [the health endpoints](#the-health-endpoints) |

**`/nn/<year>/` is the event `nn-<year>`**, and that convention is the whole of the coupling
between a URL and a database row. It lives in `worker/routing.ts` as two functions that are
inverses of each other, tested as such — because two halves of one convention in two places is
where a convention drifts, and the symptom would be a Stripe return URL that 404s.

**The old addresses 404 and no redirect was added.** `/nn/race-day/`, `/nn/spectators/` and
`/nn/entry/complete/` existed only on this branch, only ever carried `noindex`, and were linked
from nothing outside the repository. `tests/worker/serves.test.ts` asserts the 404s.

### The consolidated page

`/nn/2026/` is the campaign's one entry point. Its sections, in order, with the ids the
page-local jump-nav links to:

| # | Section | `id` | In the jump-nav |
| --- | --- | --- | --- |
| 1 | Hero | `top` | — |
| 2 | Entry rail | `entry` | — |
| 3 | The race, and its facts | `race` | Race |
| 4 | Race information — the schedule in full, a summary, a link out | `race-info` | Race info |
| 5 | Spooktators — a summary, and no link out | `spooktators` | Spooktators |
| 6 | Closing call to action | — | — |

**There is no course section on this page, and there is no `course` anchor.** It
summarised `/nn/course/` and linked out to it, and it came off in 1b15cce at the club's
request — with `NnRaceSummary`, whose only consumer here it was. That component now renders
on **no** page: `/nn/` dropped it too when the club supplied the course copy in full, so
the short form of the course exists nowhere and the long form is on `/nn/`. The head of
`NnRaceSummary.astro` records the open question of whether it is deleted or brought back.

**There is no page footer any more.** Its two lines — the race's privacy notice and the contact address — moved into `SiteFooter`'s race group, beside the entry terms, so the page carries one footer instead of two stacked. `SiteFooter` takes them as a `race` prop rather than naming them itself, because it renders on every page of this app including `/nn/`, which ADR-011 requires to name no year anywhere in its markup.

**One entry point rather than one page.** `/nn/2026/race-day/` and `/nn/2026/spectators/` both
stay live; sections 4 and 5 summarise them rather than absorb them. Absorbing them would
retire two URLs, which is a decision with its own record.
See [ADR-027](../../../docs/architecture/decisions/adr-027-one-entry-point-for-a-running.md).
**Only the first of the two is still reachable by a link, though** — the hero's second button
and the entries-closed notice both point at the race instructions, and nothing anywhere points
at `/nn/2026/spectators/` since the bar's `Spooktators` item came out.
**`/nn/course/` was a third and it is gone** — absorbed into `/nn/` rather than into this page,
with the address left redirecting there.

**The jump-nav is page-local and additive.** The masthead is a separate bar, carrying the same
four hrefs — the wordmark, `Race`, `Privacy` and the painted button — on six of the seven
campaign pages, with `/nn/2026/entry/complete/` keeping the wordmark alone. These three anchors
exist only here, so they point at nothing nowhere — and the jump-nav is deliberately not a
second masthead: unpinned, no band, no wordmark, no call to action, and a bone current-marker
where the bar uses `pus`.

**Below 860px this is the one page whose masthead releases.** It is the only page with a fixed
bar at the bottom, and 136px of masthead plus a 64px entry bar is 35% of a 568px phone — within
seven pixels of the figure ADR-012 unstuck the bar over. `NnMasthead` takes `sticky={false}`
here and nowhere else, so ADR-014 is narrowed at one width on one page rather than superseded.

**The enhancement script does four things and the page works without it**: condense the
masthead, reveal the entry bar when no inline call to action is on screen, mark the section in
view, and move focus to a section when its jump link is followed. That last one is invisible
until somebody needs it — a bare fragment link scrolls the page and leaves the keyboard at the
top, so the next Tab returns them to where they started, and axe passes either way.

### The navigation — one bar, three controls, and it stays on screen

```
[wordmark]  Race  Privacy      [ Enter the race ]
```

`src/components/NnNav.astro` (the two links) and `src/components/NnMasthead.astro` (the
wordmark and the button) —
[ADR-012](../../../docs/architecture/decisions/adr-012-one-navigation-bar.md), as
amended by
[ADR-014](../../../docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md),
which added `Privacy` and made the bar sticky again.

**Identical on every page that carries it; only the current-page marker moves.** Three signals,
never colour alone: `aria-current="page"`, a 2px rule under the label, and full brightness
against the 0.78 the others rest at.

**The year is never in the bar and never in `dist/`.** Neither link can name one — `/nn/` and
`/nn/privacy/` are evergreen addresses written straight into the component — so the button is
the only thing left to paint. It ships `hidden` with `href=""`, and the Worker fills it in from
`entries.current_entry_state('nn')` on **every** page that renders the masthead, including
`/nn/privacy/`, which it previously did nothing to. That is one database round trip on that
page, resolved once per request and shared. **`Race info` and `Spooktators` were the two painted
links and they came out on request**; the array they lived in is still in `NnNav.astro` and still
mapped, empty, so putting a year link back is one entry there and no Worker change.
`tests/unit/nn-nav.test.ts` greps the components for a hand-typed year, because a Worker test
only ever sees the painted result.

**The button's label is the entry window's**, because "Enter" on a button that does not let you
enter is a small dishonesty on a site that is about to ask for money:

| Window | Long | Short (320px) |
| --- | --- | --- |
| `open` | Enter the race | Enter |
| `pre_open` | Register interest | Interest |
| `closed` | Race details | Details |

Each short label is a substring of its long one and the `aria-label` carries the long one at
both widths — WCAG 2.5.3.

**Every height on this page was measured on a longer bar and none has been taken again.** At
320px it was three rows — wordmark and button, then five links over two — at 134.8px, with
the paddings compact at that width to buy back most of the row the sixth control cost, and
**97.3px at 400–480px**, about 10px shorter than the pre-ADR-014 bar. That was with `Course`
still in the list, and `Race info` and `Spooktators` have come out since, so two links and a
button is shorter than any figure written here. **Shorter is the safe direction against the
scroll inset**, which is why nothing has gone red — and the reason to re-measure rather than to
quote these. No hamburger, no dropdown, no script.

**It is sticky**, and the three defects ADR-012 gave for unsticking it are each paid for rather
than disputed — the accounting is at the head of the masthead section in
`packages/shared/styles/nn-theme.css`, and the argued version is ADR-014. Two things are worth
knowing without reading either:

- **The 207px in ADR-012 is not the cost of this bar.** It belonged to a two-row *links* bar that
  ADR-012 itself replaced. This one is 62px on a laptop.
- **The scrollport, not the targets.** `scroll-padding-top` on `<html>` is what keeps anchors and
  focus clear of the bar. It replaces the `scroll-margin-top` on every `[id]` that ADR-012
  deleted, and it is a better rule: it insets every scroll the browser performs, so it covers
  focus moving onto a radio as well as a link to an id. The height is a token with three values,
  and `site.spec.ts` sweeps nine widths to check each tracks the bar.

**`/nn/privacy/` is the last link**, added by ADR-014. It was the one page in the campaign whose
header linked everywhere except where you were standing; the notice describes fifteen fields, a
payment and a special category of data, and the person most likely to want it is filling in the
form that collects them. It stays at `/nn/privacy/`, and now links up to `/privacy/` — the
club's own notice, which arrived with member accounts. ADR-011 flagged `/privacy/` as this
page's eventual home once the club had a second form to cover; what actually happened is a
second notice rather than a move, because the race notice's retention promise is tied to
`entries.events.medical_retention` by a test and folding it into a general document would have
hidden that coupling rather than removed it.

### The year panel, on the front door

Below the hero on `/nn/`, and it is the answer to the two questions somebody arriving from a
shared link actually has, in the order they have them:

```
                    THE NEXT RACE
                  1 November 2026            ← 24px, the biggest thing in it
        11:00 · 10 km, off-road · 250 places
        ────────────────────────────────────
                [ The 2026 race ]            ← outline while entries are shut
     Entries are not open yet. Leave your…      filled, "Enter the race", once open
```

**Two states, one shape.** The layout does not move when entries open — only the action's
weight changes and the fee line appears. **The difference in prominence is the message**: there
is deliberately no badge and no banner saying "open", because the button already says it and a
page that said it twice would be shouting.

**It carries one way in, and it used to carry three.** A painted pair beneath the button —
`Race instructions` and `Spooktators` — came out on request with the bar's, so the panel is the
date, the facts and the one action now. Their `[data-nn-panel-link]` handlers are still
registered in `worker/nn-entry.ts` and match nothing, exactly as the bar's two do.

**Everything year-specific in it is painted**, from the same `entries.current_entry_state('nn')`
read the navigation uses. The date comes through `packages/shared`'s one date formatter — see
[the race-facts note](#which-of-its-keys-belong-to-the-race-and-which-to-one-running) for why
`race.json`'s date cannot be used here — and the fee line comes from `entries.fees`, dearest
first, **with a free place left out**: "Free" beside two prices reads as an offer anybody can
take, and a guide's place is not.

**It names no month for when entries open**, and that is deliberate: the entry open and close
times are unconfirmed and may not appear anywhere. When the committee settles the opening time,
the honest home for it is `entries.events.entries_open_at` — which `entry_state()` does not
return yet, for exactly that reason.

### Previous years, and why it never appears

A quiet row of pills beneath the panel, for runnings that have already happened. **It renders
nothing at all today** — no heading, no container, no empty list — because there is one running
of this race and it is the current one.

**The row is built and the data source is not.** `NnRunning.previous` is always `[]`:
`entries.current_entry_state()` answers for one running, and listing the rest needs a second
read of `entries.events`, which means another function in that schema. Adding one was outside
the slice that built this. Everything on this side of that call is finished and tested in both
directions — `tests/worker/nn-panel.test.ts` drives the paint against a fabricated list, because
proving it against real data would mean seeding a running that has already happened, and a past
running has nowhere to point until there are results.

Four slots, because the pills are markup rather than generated — assembling them from data
would need `setInnerContent(..., { html: true })`, and there is deliberately no such call
anywhere in this repository to audit. A fifth is one more `<a>` and a deploy, which is the same
trade the three fee cards make.

## The banner

Every page here opens with a bar that welcomes the visitor, says what is on this site, and
links to `southvillerunningclub.co.uk`. It is in the layout rather than on a page because it
is a statement about the whole site, and because **`/nn/` needs it more than the home page
does** — somebody arriving there from a shared link has no other route to the club.

Three parts, each earning its place:

- **The welcome.** It is the club's site, not a staging server somebody stumbled into.
- **What is here** — only the race. Somebody who came for session times or membership must
  be sent onward rather than left concluding the club's information has disappeared.
- **The link, which names the club's own domain.** Following a link to an unfamiliar address
  is the shape of the thing everybody is warned about, and half-recognising
  `southvillerunningclub.co.uk` in the link text is what answers it. It also means the link
  says where it goes when a screen reader reads it out of context, which "click here" never
  does.

**Keep it to those three.** A page explaining how domain names work is for somebody who
already knows what a domain name is; the people this is for are on a phone, in a hurry,
wondering whether a link is safe.

**It says "Nightingale Nightmare" and no longer mentions the timing app.** `/timing` is a
holding page that says it is not open yet, so listing it as something the club *has* would
send somebody to a page whose whole message is that there is nothing there.

**It is a `div`, not a `header`, and that is load-bearing.** A `<header>` outside `<main>` is
the `banner` landmark, which is what `NnMasthead` already is on five pages. A second one
would be an axe `landmark-no-duplicate-banner` violation and a screen reader offering
"banner" twice.

Each part is its own element rather than one sentence with tags inside it, because **Astro
compresses the newline between a tag and the text after it to nothing** — the mixed form
renders as `…soon.For everything else…` and reads as a typo. The parts are flex items; the
gap does the spacing, and lets each drop onto its own line on a phone.

**The page's padding lives on `main` because of this bar.** It used to be on `body`, which
would have inset the banner from both edges. `.theme-nn main` therefore sets `padding: 0`,
or every Nightingale Nightmare page would gain a gutter its full-bleed hero is built not to
have.

The banner comes down at the cutover, when its middle sentence stops being true. The
[Squarespace side of the same signpost](../../../docs/delivery/runbooks/squarespace-signposting.md)
points the other way and is done by hand, because Squarespace has no API for it.

## Where race facts live

**`src/content/race.json` holds every fact, and the pages hold none of them.** Prose is the
page's; a value is the file's — a date, a time, a distance, an address, a postcode, a count,
a schedule row, a prize category. The committee edits one file.

**It was tested by exactly the thing it was built for.** The race date was confirmed on
12 August 2026, and landing it was a one-line edit with **no change to any page**: the date
line, the facts list and three content pages all picked it up without a line of markup
moving.

### Which of its keys belong to the race, and which to one running

**The file describes the 2026 running, and it always has.** Since the routes split, that
matters: `/nn/` is about the race and may read only the keys that are true of it whichever
year it is run.

| | |
| --- | --- |
| **The race's** | `name`, `distance`, `places`, `contact`, `privacy.*` — read by `/nn/` and `/nn/privacy/`. **`privacy.*` is read by `/privacy/` too**, which is not a race page at all: the controller, the registered office, the company number and the data contact are the club's facts that happen to live in this file, and both notices lifting them from one place is what stops the two disagreeing |
| **One running's** | `date`, `dateShort`, `startTime`, `location`, `hqName`, `price`, `entriesOpen`, `entriesClose`, `transferDeadline`, `permit`, `schedule`, `prizes`, `finisherPrize`, `spectating`, `startFinish` — read only beneath `/nn/2026/` |

**`dateShort` and `hqName` are narrow forms of `date` and `location`, and the duplication is
deliberate.** `/nn/2026/terms/` publishes the race director's sentences verbatim, and hers use
the short forms — "the Race HQ at Ashton Park School", "on 1 November". Deriving either by
splitting the long form is a templating scheme cleverer than the one in use here and it fails
quietly on the first address whose first component is not the venue. Two adjacent keys are
honest about the cost instead; both are asserted against the page in `nn-terms.spec.ts`.

**Every `schedule` row carries a stable `id`.** `/nn/2026/race-day/` still renders the array in
order and ignores them; `/nn/2026/terms/` looks up `registration` by name to state when race
numbers can be collected, so `09:15` is stated once in this repository rather than twice. Every
row rather than only that one, because `resolveJsonModule` infers the element type from the
literal — a single row with an `id` makes the array a union and the lookup unreachable without a
narrowing guard.

**The file is not split in two, and that is deliberate rather than unfinished.** Separating it
into a race file and a year file is a content change with its own review, and doing it inside a
route reorganisation would put two unrelated diffs in one commit. Until then the rule is the
table above plus the tests: `site.spec.ts` asserts the date and race HQ appear on the year page
and **not** on `/nn/`, and `serves.test.ts` asserts the same about the date in the built HTML.

**`/nn/` therefore states no date**, which is the one thing a reader may notice is missing. It
cannot use this file's, because that is 2026's; it could be painted from `entry_state()`, which
returns the event date — but rendering "Sunday 1 November 2026" from a `CivilDate` means a
second date formatter in a repository whose whole timezone discipline is that there is exactly
one. The date is one tap away, on the running `/nn/` links to. Recorded as a gap in
[ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md) rather than
as a decision to leave closed.

**A `null` is a fact nobody has confirmed, and it renders as "To be confirmed"** rather than
as a blank or an invention. Two still are, and each for a different reason:

| | |
| --- | --- |
| `price`, `entriesOpen` | **The database's, not this file's.** Fees live in `entries.fees.price_pence` and the window in `entries.events`, and the Worker paints them onto the entry form. These two `race.json` keys stay `null` and render "To be confirmed": duplicating a price into a content file is how two numbers start disagreeing. The transfer deadline and live capacity are undecided and have no field at all |
| `privacy.*` | **Eight keys since 30 August 2026, and one `null`** — `emailRetention`, whether an address is kept to tell people about next year's race, which no page reads. **Seven are settled and written in**: the controller, the registered office, the company number, the one-month medical retention, the data contact, how long an entry record is kept, and the date the notice was last updated. It was nine keys and four nulls until the club had `/nn/privacy/` rewritten to reproduce the committee's privacy document word for word — that document answered `contact` and `entryRetention`, and `photographs` was **removed outright** rather than settled, because the document says nothing about photographs and there is no longer a question to leave open. **Three of the eight are read by no page.** `entryRetention` and `emailRetention` fed the per-item retention table, which came off `/nn/privacy/` with everything else that was not in the document; `medicalRetention` is kept **for the database test alone** — `packages/db/tests/entries-retention.test.ts` still ties it to `entries.events.medical_retention`, so the cron still deletes a medical note a month after the race while no published page states a period. Of the rest, `controller`, `companyNumber` and `contact` are read by both notices, `registeredOffice` by `/privacy/` alone, `lastUpdated` by `/nn/privacy/`. A wrong answer on either notice is a legal claim rather than a typo, so filling `emailRetention` in is a one-line edit here, and the two spec files count the markers |

### The ARC permit number, and why it is quoted three times

**`permit` is `ARC/26/0842`**, issued 27 August 2026. Landing it
was the second test of what this file is for: a one-line edit, and the year page's facts list
picked it up with no markup moving — exactly as the race date did on 12 August.

**It is quoted in three places, and the first two are the ones ARC ask for.** ARC print the
requirement on the permit itself — *"Please quote Permit Number on race entry forms and
advertising material."* The facts list on `/nn/2026/` is the advertising half; the foot of the
entry form, below the pay note, is the form half. **The third arrived with #142**: `/nn/2026/terms/` states it in the terms themselves, which is the race director's copy rather than this file's doing. The race page alone does not satisfy the
instruction, which is why `nn-entry.spec.ts` asserts the form's copy **visible** rather than
merely present: the form ships `hidden` and the Worker reveals it, so a permit line that only
ever reached the markup would pass a `toContain` and fail what ARC actually ask for.

**At the foot of the form rather than under its heading.** ARC ask for the number to be
quoted, not made prominent. The printed-form convention of putting it at the top exists
because paper detaches from its context; a web form does not.

**It is year-scoped, like the date.** A permit is issued for one running, so it may not reach
`/nn/` or `/nn/privacy/` — see
[ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md).
`site.spec.ts` asserts the number renders on `/nn/2026/` **and** that neither the label nor the
number appears on `/nn/`; the number half of that is new, because until there was a number
there was nothing to leak. `/nn/privacy/` still says the race is run under an ARC permit
without naming one, which is evergreen and stays.

**`/nn/` is the most advertising-shaped page on the site and structurally cannot carry the
number.** Recorded as a gap rather than accepted silently: the mitigation is that its call to
action points at `/nn/2026/`, which does carry it. Putting it on `/nn/` would mean painting it
from `current_entry_state('nn')` in the Worker, which is a larger change and a decision nobody
has taken.

**The type, the issue date and the promoting body are on the permit and are not published.**
Only the number is required, and only the number is here — the permit document is the club's
record, not this repository's.

**`src/content/privacy.json` is the club notice's own file, and it holds only what is not
already here.** `/privacy/` reads the controller, the registered office, the company number and
the contact out of `race.json`'s `privacy` key — the same values `/nn/privacy/` prints — so the
two notices cannot disagree about who the club is. What is genuinely the account's lives in the
new file:

| | |
| --- | --- |
| `lastUpdated` | Settled. The date that page was last changed, which is not the date the race notice was |
| `accountRetention` | **`null`.** How long an account is kept, and what happens when somebody stops being a member. A committee decision; there is no plausible default that would be safe to print, because whatever is printed is a promise |
| `accountDeletionAndEntries` | **`null`.** Whether deleting an account also deletes a race entry by the same person. Two schemas, `identity` and `entries`, and nothing yet joins them — so this is a decision about people rather than a lookup |

`privacy.spec.ts` counts **two** markers on `/privacy/` — those two — and
`nn-privacy.spec.ts` counts **zero** on `/nn/privacy/`. **It was three and four until 30
August 2026, and both fell to the same change.** The committee's privacy document, published
word for word on `/nn/privacy/`, answered `race.json`'s `contact` — the same open decision on
both notices — and left that page with nothing undecided to print at all; `/privacy/` lost its
third marker without being edited, because it lifts the settled facts from `race.json` rather
than retyping them. **Two counts in two files, deliberately**: one assertion covering both
pages would have to be "at least two", and that is the day the guard stops working in both
directions at once. **Zero is still worth asserting**, and it guards the opposite direction
now — if one of the four values `/nn/privacy/` interpolates ever goes `null`, that page prints
"to be confirmed by the club" in the middle of a document that says it is the committee's own
words.

**Presentation is data too, where the committee should own it.** `prizes[].highlight` is
which tile the campaign's one accent colour lands on — the fancy-dress prize, because that
is what makes this race this race rather than any other 10 km. Moving the emphasis is a
one-word edit to `race.json` and not a CSS change.

**The page copy is a draft pending committee approval.** It is written to be edited, not
decided on their behalf — see [the phases](../../../docs/delivery/phases.md#what-the-race-pages-still-need-from-the-committee)
for that and for the six questions the draft could not answer.

### The entry terms

**`/nn/2026/terms/` is the race director's copy, published verbatim on 28 August 2026**, and it
is the document the entry form's `entryTerms` checkbox commits somebody to. Until this landed
the checkbox said the terms were "still to be confirmed by the committee, and will be linked
here before entries open"; the hint is now the link, and nothing else about that control
changed.

**It must not be edited for style.** The capitalisation is inconsistent, the ordinals and the
24-hour clock disagree with the rest of the site, and one clause slips into the third person
mid-sentence. All of it is hers. This is the wording a person agrees to be bound by, so a
tidy-up here is a silent amendment to a legal instrument — suggested corrections go back to her
as a batch and return as new copy with a new version line. `terms-single-source.test.ts` pins
the provenance line; the copy itself is pinned in `nn-terms.spec.ts`.

**The committee has not ratified it**, and the page says exactly that: *"Version 1 — published
28 August 2026. Supplied by the race director."* Both tests assert the absence of a ratification
claim as hard as they assert the line itself, because a false statement of provenance on a legal
document is worse than none.

**One character on the page is not hers.** The supplied copy reads `ARC/26/ 0842` with an
internal space; the number issued on 27 August 2026 has none. It renders from `race.json` like
every other fact, so reproducing the space would have meant changing the value on `/nn/2026/`
and at the foot of the entry form too, and failing `site.spec.ts`. Confirmed as a transcription
slip.

**Every fact on it that appears anywhere else on the site is interpolated**, and the pair of
tests is what makes that a guarantee rather than an intention. `nn-terms.spec.ts` reads
`race.json` off disk and takes its expectations from it, which proves the page renders whatever
the file says; `tests/unit/terms-single-source.test.ts` reads the `.astro` source with its
comments stripped and asserts the values are **not** in it, which proves the page reads the
file. **Neither is sufficient alone** — a page with the permit number typed into its markup
passes the first one today and goes on passing the morning the number changes.

**The spec reads the file rather than importing it**, which is `entries-retention.test.ts`'s
precedent and not a style choice: Playwright loads a spec as Node ESM, where a bare JSON import
needs a `with { type: 'json' }` attribute the Vite-transformed unit suite does not want. It also
disagrees with `site.spec.ts`, which pins race facts as literals — deliberately. That file
asserts *which page* a fact may appear on, where reading the value back would be
self-referential; this one asserts that a page reads the file rather than repeating it, where a
literal is the wrong tool. The permit number has a guard in both, and they catch different
things.

**The collection time is the schedule's registration row, found by `id`.** `09:15` is stated
once in this repository. The row grew a stable `id` so this page could ask for it by name rather
than by position — the schedule was reordered once already — or by matching the prose, which a
copy edit would break silently. A missing row throws at build time rather than rendering a
sentence with a hole in it.

**`hqName` and `dateShort` are narrow forms of facts the file already states in full**, and they
exist because her sentences use the short form: "the Race HQ at Ashton Park School" rather than
the full postal address, "on 1 November" rather than "on Sunday 1 November 2026". Splitting the
long form on a comma or a weekday would be one source but a fragile one, and nothing would catch
it going wrong.

**"Entrants must be 18 or over on race day" is prose, and it is a second statement of a rule the
database enforces.** `entries.events.minimum_age` is 18 and `create_pending_purchase()` re-checks
it on every submission, so this sentence cannot make an under-age entry possible — but it can go
stale if the committee moves the age. Wiring a static page to that column would cost a database
round trip and a Worker rewriting branch it does not otherwise need. Recorded as a known
duplication rather than left to be found.

## What the event theme deliberately does not do

**No `@view-transition`.** Four lines of CSS, no JavaScript, and it breaks the sign-up form
with scripting disabled: after the POST/422 the `::view-transition` overlay swallows the
click on the error summary's link, silently. It reproduced 5 times out of 5 and **passes
with scripting on**, which is what makes it easy to ship by accident. The full note is at
the foot of `packages/shared/styles/nn-theme.css`, and
`tests/e2e/nn-signup.spec.ts`'s "links from the summary to the field it is about" is the
guard that caught it.

**The motion that is there** is a slow fog across the hero and an 18-pixel rise on content
cards as they scroll in. Both stop under `prefers-reduced-motion`; neither changes opacity,
so no text is ever at a contrast ratio nobody computed; and the rise is kept off the form
and the notices, because a moving box under a pointer is a click waiting to miss.

## The two forms, and which one arrived

**Both are on `/nn/2026/`**, one revealed at a time by the event row. That address cannot tell
them apart, so a hidden `form` field does — `interest` or `entry`, stated on **both** so that
neither is identified by the absence of something. A stale cached page with no field is read as
the interest form, which is the harmless side: it takes no money.

**Not the entry window, which would nearly work and fail at the worst moment.** The Worker
could infer "open means entry"; then somebody who opened the page a minute before entries
opened would have their name and email address read as an entry and be shown fourteen
validation errors about fields they were never asked for. What was submitted is a fact about
the submission, so it travels with it.

The field existed, was removed when the two forms briefly lived on two pages, and is back with
the ambiguity that needs it.

## The sign-up form

**One form, three fields — name, email, consent — and adding a fourth is a committee
decision.** `created_at` is the database's own default. Where the rows land, and the grant
and policy that let them, are [`packages/db`](../../packages/db/README.md)'s.

It is a real `<form method="post">` and **the whole of it works with JavaScript disabled**,
which is the primary path rather than a fallback. There is no client-side script at all.

| | |
| --- | --- |
| **Validation** | One Zod schema in `packages/shared/src/nn-signup.ts`, used by the Worker. Server-side validation is the control; anything the browser checks first is a convenience |
| **Accepted** | `303` to `/nn/?signup=ok`. POST/Redirect/GET, so a refresh does not re-post |
| **A repeated address** | **Also accepted.** The unique index on `lower(email)` raises `23505`, the person did the right thing twice, and saying "you are already on the list" would disclose membership of it to anyone who can type an address into a form |
| **Rejected** | `422`, the page re-served with messages against their fields and **everything already typed still in the boxes** |
| **Not recorded** | `503`, the same preserved input, and an honest "that could not be saved" — see the deploy-ordering note below |

**The POST is handled before `env.ASSETS.fetch`.** `run_worker_first` is what lets that
happen; the static-assets binding serves `dist/` and will not answer a POST at all, so a
submission reaching it is already lost.

**Both failure responses are the static page rewritten by `HTMLRewriter`**, the same
technique the entry form's outcomes use — so there is one copy of the page, in `dist/`, and
no second template in the Worker to drift from it.

**What no longer runs on those responses is the pair of database round trips.** They used to,
on the argument that a submission which just failed is exactly when somebody wants to know
whether the Worker can reach Postgres — right about the need, wrong about the audience. The
person reading that page is a runner whose form did not save, and a database timestamp beside
the apology helps them not at all. It is the maintainer who wants it, and the maintainer has
[`/_health`](#the-health-endpoints), which answers whatever the page says.

**User input re-enters the HTML only through `setAttribute` and text-mode
`setInnerContent`, both of which escape.** There is no `{ html: true }` call in
`worker/nn-signup.ts` and there should never be one — `"><script>alert(1)</script>` is a
legal thing to be called, and it has to come back as characters rather than as markup.
`tests/worker/nn-signup.test.ts` asserts it does.

### Deploying it in either order is safe

Nothing sequences the migration against this Worker's deploy — Workers Builds triggers on
the push, not on a green CI run. Migration first is a grant the old code never uses. **Worker
first means every insert fails `42501` until the policy lands**, and that window renders as
the 503 above: input kept, nothing lost, and never a confirmation for a row that was not
written.

### What it deliberately does not do

**There is no rate limiting.** This is an anonymous, publicly-writable endpoint, and the
only thing standing between it and a script is the unique index — which stops the *same*
address twice and nothing else. The recommendation is a **Cloudflare WAF rate-limiting
rule** on `POST /nn/`, configured in the dashboard rather than added here: it costs no code,
no dependency and no third-party script. Turnstile and a honeypot field were both considered
and neither is worth doing first. **Not a decision to take by inference** — see the pull
request that added the form.

No payment, no accounts, no admin surface, no confirmation email to the submitter.

## The entry form

**It is on `/nn/2026/`, and it posts to the page it is on.** That address is the whole of what
tells the Worker which running an entry is for — there is no hidden event field and there
should not be one, because a slug in a body is a slug somebody can change.

**Each of the two pages carries two states and reveals one.** Which one is decided by
`entries.events` — `entries_open_at` and `entries_close_at` — read through
`entries.entry_state()` on every request. **Opening entries is a row edit, not a deploy**,
which is the whole point of the event table: nobody has to be free to push a commit at seven
in the morning.

| | Entries shut | Entries open |
| --- | --- | --- |
| `/nn/` | The year panel, with a quiet outlined action | The same panel, the action filled and a fee line under it |
| `/nn/2026/` | The interest form | The entry form |

`entries_open_at` is `null` today, because the opening time has not been decided. That reads
as `pre_open`, which is the left-hand column.

**Every failure resolves to the left-hand column.** Migration not landed, database
unreachable, function returning a shape that does not parse: all of them show the state that
takes no money and makes no claim. A page that cannot tell whether entries are open must not
offer to take one, and that
matters more once a card payment is on the end of it.

### What happens to a good entry

**It holds a place and goes to Stripe.** In one database transaction,
`entries.create_pending_purchase()` checks the entry key, re-checks the window, takes a
per-event lock, counts the places already gone, prices the entry from `entries.fees`, and
writes a `pending` purchase with a **31-minute hold**. The Worker then creates a Checkout
session for exactly that amount and `303`s to it.

⚠️ **The key is first, and it is what stops this being 250 free places.** The function is
granted to `anon` — a signed-out runner reaches PostgREST as anon, so it must be — and it holds
a place *before* any money moves, with a live hold counting against the 250. Until 31 August
2026 that meant a loop with the anon key printed in every page's source took the whole field in
half a second, for nothing, never touching this Worker or the rate-limiting rule in front of it.
`ENTRIES_ENTRY_KEY` is a Worker secret; the database holds only its digest, and it ships null —
which refuses everything. See [ADR-029](../../../docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md)
and issue #178.

**Nothing on this path moves a purchase to `paid`.** The redirect back from Stripe is not proof
of payment — a person can close the tab before it fires, and the return URL is one anybody can
type. [The webhook](#the-webhook) is what confirms, and it is the only thing that may.

| | |
| --- | --- |
| **Valid** | `303` to `checkout.stripe.com`, `cache-control: no-store`, and no body at all |
| **Rejected** | `422`, messages against their fields, **every value preserved** — fifteen fields is ten times as much to retype as the interest form |
| **Entries closed** | `409`. Somebody opened the page at 6:59 and pressed the button at 7:01; the window is re-checked when the form arrives, and again inside the transaction |
| **Sold out** | `409`, and **every value still in the boxes.** This is the case where losing somebody's typing hurts most: they have filled in fifteen fields and are being told the race went while they were doing it, and they may want to ask about a waiting list |
| **Already entered** | `409`, **every value preserved**, and the only refusal here that is somebody's ordinary mistake rather than a defect or a lost race. `create_pending_purchase()` returns `already_entered` for a runner who already holds a live place — keyed on name and date of birth. **A second rule, `email_already_entered`, refuses a second live place on one purchaser's email too**, since 30 August 2026 — this reverses the entry path's original decision that one card legitimately paying for a partner ruled email out as a key; the two rules overlap deliberately and neither subsumes the other. The notice says no second charge and no second place, then points at `/account/entries/`. A signed-in person is told **before** the entry fields as well, by `data-nn-entry-entered` on the year page |
| **A free place** | `503`. A guide pays nothing and Stripe refuses a zero-total session outright — see [what it deliberately does not do](#what-the-entry-form-deliberately-does-not-do) |
| **No Stripe secret set** | `503`, **nothing stored and nothing charged**, said in those words. This is the deployed state today |
| **No entry key bound** | `503`, the same page and the same words, and checked **before** a place is held for the same reason. Without the key the database refuses to hold anything, so calling anyway would turn a known deployment state into `unauthorised` — a refusal that reads as a defect. Installing it is [step 0.8](../../../docs/delivery/runbooks/entries-open.md#08--the-entry-key-must-be-installed-and-verified) of the entries-open runbook, and it must happen **before** the window opens |
| **Anything else went wrong** | `503`, "nothing has been charged", input preserved. A place may be held, and it lapses on its own |

### Capacity, and the one race that matters

**250 places, and this race sold out in 2023.** Two people pressing the button in the same
second must not both get the last place, and counting-then-inserting is not enough on its own:
two transactions each read 249 and each insert.

| | |
| --- | --- |
| **The lock** | `pg_advisory_xact_lock` on a hash of the event id, taken **before** the count. Serialised per event; nothing else in the database waits. Released when the transaction ends however it ends |
| **What counts as taken** | Entrant rows, for purchases that are `paid` or `pending` with a hold still in the future. **Entrants rather than purchases × `entrants_per_entry`** — the entrant rows are the record of who is taking a place, and the multiplier is configuration that can change |
| **A lapsed hold** | Back in the pool the instant it lapses, because the count already excludes it. **Nothing has to sweep it first** |
| **The cron** | Every five minutes, `scheduled()` moves lapsed holds to `expired`. **Housekeeping, not the mechanism** — if it never ran again nobody would be turned away. It exists so an abandoned purchase stops reading as `pending` for the treasurer and for the webhook |

`packages/db/tests/entries-capacity.test.ts` proves the lock with real concurrent
connections — two, then eight, for one place — and proves the harness can *detect*
overselling by overselling on purpose with the lock left out. A concurrency test that never
actually overlaps passes for the wrong reason and keeps passing after somebody removes the
lock.

### The Checkout call

**No Stripe SDK.** One `POST /v1/checkout/sessions` over `fetch`, and two fields read off the
answer. The `stripe` package is several hundred kilobytes and carries its own HTTP client
that a Worker cannot use.

| | |
| --- | --- |
| **`price_data`, never a Price object** | The price lives in `entries.fees.price_pence`. A Stripe Price is a second copy of a number, and the copy that is wrong will be the one in the dashboard nobody opened |
| **`client_reference_id`** | The purchase id. It is how Slice C's webhook finds the row, and it is why the purchase has to exist before the session does |
| **`metadata`** | Two keys — the purchase id and the event slug. Stripe metadata is not a place for personal data |
| **`expires_at`** | The held place's own expiry, to the second, so the hosted page and the place die together rather than the session outliving the hold |
| **`Idempotency-Key`** | `purchase:<id>`, so a retried request cannot create a second session against one held place |
| **Adaptive pricing off** | It is **on** by default for this account. Left on, somebody paying from abroad is charged a converted amount — a second version of a price this repository keeps in one place, at a rate nobody here chose. Reversible in one line if the club would rather take an entry in a runner's own currency |

**The 31-minute hold is Stripe's doing, not a preference.** Stripe documents a floor of 30
minutes on `expires_at`, and this row is computed in Postgres and then travels — so a
30-minute hold is fractionally under the floor by the time it lands. Measured against the
test API that floor is **not currently enforced** (29 minutes was accepted), but the club's
only way of taking an entry is not the place to depend on a documented limit going
unenforced: if it were tightened, every submission would fail at once. Sixty extra seconds of
a held place is the cheaper side of that trade. The form says "30 minutes", which is the safe
direction to round.

## The webhook

`POST /nn/stripe-webhook` is **the only thing in this platform that writes `paid`**, and
[ADR-010](../../../docs/architecture/decisions/adr-010-webhook-writes-paid.md) records the three
decisions it took. It is not a page: no HTML, no rewriting, no redirect, and a GET falls through
to a 404.

**The failure direction is inverted here, and that is the thing to understand.** The sign-up and
the entry form fail *towards taking no money*, because none had been taken. By the time this
handler runs the money has already left somebody's account, so the only safe failure is one that
is **retried**.

| | |
| --- | --- |
| **200** | The question was answered, whatever the answer. A retry produces the same result, so there is nothing to gain from one — including "this is somebody else's payment" and "the amount disagreed", both of which are permanent. A stream of non-2xx gets the endpoint disabled in Stripe, which would silently stop every *future* confirmation |
| **400** | This is not Stripe, or it cannot be proved to be. The body is never parsed for meaning |
| **5xx** | **Our** configuration or **our** outage — no signing secret bound, no database key, the migration not landed. Stripe retries for roughly three days, which outlives any deploy. **A 200 here would drop a real payment on the floor** |

### Proving it came from Stripe

`worker/stripe-signature.ts`, HMAC-SHA256 over `crypto.subtle`, no SDK — the same argument
`worker/stripe.ts` makes for the outbound call, and the bundle grew by 0 bytes.

| | |
| --- | --- |
| **The raw bytes** | `await request.text()` is verified **before** anything parses it. The signature covers exactly what Stripe sent, and verifying a re-serialised copy is a classic silent failure. Stripe pretty-prints its payloads, so a round trip really does change them |
| **Constant time** | The digest comparison visits every character rather than returning at the first difference |
| **±5 minutes** | The timestamp is inside the MAC, so a captured body cannot be replayed tomorrow. A genuine Stripe retry is re-signed with a fresh `t` and is unaffected |
| **Every `v1`** | Stripe signs with both secrets during a rotation, and the correct one is not necessarily first. Taking only the first would make a rotation a coin toss |

### What it does, and what it refuses

Two events — `checkout.session.completed` and `checkout.session.expired` — and **everything
else is answered 200 and ignored**. This Stripe account may also carry the club's England
Athletics portal payments, so events arrive for sessions this code never created; an error would
make Stripe retry forever on somebody else's money.

| | |
| --- | --- |
| **Idempotency** | The state guard, not a table of event ids. One `update ... where status in ('pending','expired')` whose own `row_count` is both the change and the report. A second delivery writes nothing and says so |
| **The amount** | Checked against `amount_pence`, **and the currency against `gbp`** — which is what proves `adaptive_pricing[enabled]=false` is still doing its job. A mismatch writes nothing, flags the row, and answers 200: a retry would deliver the same wrong number forever |
| **A late payment** | Paid, never refused. If there was no room it is still `paid` and `attention = 'over_capacity'` says a human must decide. See [ADR-010](../../../docs/architecture/decisions/adr-010-webhook-writes-paid.md) for why there is no fifth status |
| **The key** | `entries.record_checkout_event()` takes `ENTRIES_WEBHOOK_KEY`. **Without it, two PostgREST calls with the published anon key would buy a free entry**: one to get a purchase id, one to confirm it as paid. The grant on the function is still `anon` and nothing else. ⚠️ **That sentence was always about two halves and only this one was built** — the call that *issues* the purchase id was unguarded until 31 August 2026, which is issue #178 and [ADR-029](../../../docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md). `create_pending_purchase()` takes `ENTRIES_ENTRY_KEY` now, a **separate** secret: one key that opened both doors would be one rotation that closed both |

### When something needs a person

There is no alerting stack and no email until Slice D, so the channel is a column and a cron:
`attention` on the row, and a `console.error` every five minutes with the age of the oldest
climbing. **It is silenced by somebody setting `attention_resolved_at` and never by the
calendar.** [The runbook](../../../docs/delivery/runbooks/entries-attention.md) is what makes it
clearable — without a documented way to silence an alarm, volunteers learn to ignore it.

### The return page

`/nn/entry/complete/` now reports what the club has recorded. **Arriving here is still not proof
of payment** — the redirect fires in the person's browser, and it is an ordinary URL anybody can
type — so what it renders is the *record*, looked up by Checkout session id.

**Only `paid` makes a positive claim, and no state ever makes a negative one.** The second half
is the one that matters:

> Somebody pays. The webhook is delayed. Their thirty-one minute hold lapses. They refresh. If
> the page says *"nothing has been charged"* — which is what it said before this slice — **they
> enter again and pay twice.**

| | |
| --- | --- |
| `paid` | Confirmed, and what happens next |
| `pending` | Still confirming. Ships **visible**, so it is also what every failure path leaves on the page — an unreachable database renders the block that claims nothing |
| `lapsed` / unknown | "The club has not recorded a payment against this address", and **do not enter again**. Never "nothing was charged" |
| `refunded` | A statement of fact from the club's records |

**There is no auto-refresh, and that is a decision.** A `<meta http-equiv="refresh">` fails WCAG
2.2.1 — axe reports it as `meta-refresh` under `wcag2a` — and zero violations is not a threshold
here. It is also hostile in exactly the case it would be used: a page reloading under somebody
on a phone who has just paid. The pending block carries a plain **Check again** link instead;
`href=""` resolves to the current URL with its query string, so a static page carries a session
id it cannot know. There is no polling script either.

`entries.entry_completion_state()` returns **one word and nothing else** — not the name, not the
email, not the amount, and not the purchase id, which is the write path's key. A session id in a
URL is not authentication: it is in the address bar, in history, in a screenshot, in a `Referer`
header, and the function is written as though the string were public.

### What the entry form deliberately does not do

**A free place cannot be completed online, and this is the one thing the club has to answer
by hand.** A visually impaired runner's guide pays nothing, and Stripe refuses the session:
*"The Checkout Session's total amount due cannot be zero in `payment` mode"* — confirmed
against the test API rather than assumed. Completing it another way would mean deciding that
an unpaid entry counts as paid, which is a decision about what an entry *is*. The form says
so plainly and gives the race address. **It is worth resolving before entries open.**

**There is no rate limiting.** `entries.create_pending_purchase()` is reachable by anybody
holding the anon key, which is published in client code by design. It cannot read anything,
choose a price, or store medical notes without consent — but it **can hold places**, up to the
whole field, for as long as a hold lasts. That is the same exposure `POST /nn/` already
carried for the interest form and the recommendation is the same: a **Cloudflare WAF
rate-limiting rule**, configured in the dashboard rather than added here. A per-address cap in
the function would block a legitimate person retrying on bad signal, which is a policy
decision and not a build one. **Not a decision to take by inference.**

**There is no waiting list.** The sold-out notice gives the race address; it does not offer to
put anybody on a list that does not exist.

### How it is built

| | |
| --- | --- |
| **One page, not a wizard** | A multi-step flow needs JavaScript or server-held state. This site has neither by design |
| **Six `<fieldset>`s** | Your details, about you, entry type, emergency contact, medical information, agreements |
| **Date of birth is three number boxes** | Not a date picker. A picker opens on this month and asks somebody to page back forty years on a phone |
| **Nothing on the form is conditional on the entry type** | The England Athletics box was, until [decision 007](../../../docs/decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers). The two layout rules it cost are kept as comments where it was — a conditional field goes *after* the group it is a condition of, never inside it, and a container's message belongs to that container rather than to a field nested in it |
| **Medical information has its own consent** | Special category data under UK GDPR Article 9, its own table, and a shorter retention. Never bundled with the entry terms |
| **Prices are painted on** | Nothing in `dist/` knows a number. `entries.fees.price_pence` is the only place a price exists, and `tests/worker/nn-entry.test.ts` asserts the page carries no `£` at all while entries are shut |

**The three fee codes are known to the markup and that is a deliberate trade.** Three cards
ship hidden and the Worker reveals whichever the event offers, so *withdrawing* a fee is a
row edit — but **adding a fourth code is a migration and a deploy**. The alternative is
assembling markup from data with `setInnerContent(..., { html: true })`, and there is no such
call anywhere in this repository to audit.

### Validation

One Zod schema, `packages/shared/src/nn-entry.ts`, imported by the Worker **and by the
browser**. Client-side is a convenience; the Worker runs the same schema whatever the browser
did.

**But the Worker is not the control either, and Slice E is why that sentence changed.** The
entry form is one caller of `entries.create_pending_purchase()`, and that function is granted
to `anon` — whose key is published in this page's own source. Slice E found it writing
`ea_number` with no reference to `fees.requires_ea_number`, so two PostgREST calls bought an
affiliated place with no England Athletics number, £2 under, without ever loading the form.
Slice G audited every rule by *attempting the bypass* and found eight more, including that the
entry terms were not enforced at all.

**Every one of them now lives in the database** — a check constraint where the rule is static,
a trigger where it spans tables, the function where a person needs words back. Zod is still
here and still worth having: it reports every problem at once, in field order, in language
written for somebody on a phone. What it is not is the only place any rule lives.
See [`packages/db`](../../packages/db/README.md#where-a-rule-lives-and-why-zod-is-never-the-only-place).

**The rules are not in that file.** The minimum age, which fees are on offer and whether a
date of birth is wanted at all are `entries.events` and `entries.fees` columns, handed in at
request time. A second race is an `insert`, not an edit to a schema module.

**The minimum age is 18, and it arrived exactly the way the column was built for.** It was
`null` while it was only *implied* by the youngest prize category; the committee confirmed it
on 13 August 2026 and landing it was one `update` in a migration — **no change to the schema
module, no change to the form, no deploy needed to have made it**. It is applied in three
places: the form, the browser enhancement, and `entries.create_pending_purchase()`, which is
the control. A boundary test on each side of exactly 18 on race day sits in both the unit
suite and the database suite, because if those two derivations ever disagreed that is what
would notice.

**Race category and gender are two questions, and that is
[ADR-020](../../../docs/architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md).**
They were one field labelled "Gender", with three options, required — which is a statement
that there are three. The closed list is now labelled **"Race category"**, because that is
what it has always been: it is what the prize list is grouped by, what the start list sorts
into and what `age-category.ts` derives a band from, and it is three because three is how many
categories exist. Under it sits an optional free-text **Gender** box, on no list, that nothing
derives, groups, sorts, prices or publishes from. That is the same shape `/account/details/`
has collected since #61, and the same shape the GSS harmonised standard and HL7's Gender
Harmony model both specify. **A longer closed list was the rejected option** — it is the same
defect with more rows, and every value past female and male would advertise a category with no
prize to award.

The open answer reaches `/admin/nn/`, under the category, and **nowhere else** — not the start
list, not any of the three exports. Collecting it and showing it nowhere would be collecting it
for no purpose; putting it on paper handed round a race HQ would out somebody who answered a
question the form told them was optional. `/nn/privacy/` publishes both halves of that, and
`admin.spec.ts` asserts the absence against a *paid* fixture, because a pending one would pass
by not being in the file at all.

**No age category is invented for a non-binary runner**, and the split does not change that.
The 2023 form offered the option and there were no categories to receive it. The form records
the answer and says plainly that the categories are undecided. That is still not the same
question as the minimum age, even though both numbers happen to be 18.

**The England Athletics number is not asked for and not held**, since 29 August 2026 —
[decision 007](../../../docs/decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers)
and [ADR-023](../../../docs/architecture/decisions/adr-023-no-england-athletics-numbers.md).
A runner states that they are affiliated and the club takes their word for it.

**The number never bought what it looked like it bought.** England Athletics publishes no
verification API, so it was collected, its format was checked, and that was the whole of it — a
seven-digit string held against every affiliated runner, doing no work, against a human
spot-check nobody had time to run. Under ARC Rule 21(2)(b) the club now has no record of *who*
claimed affiliation, only that they paid the affiliated £18; the committee accepted that, and
what replaces the check is a sentence on both privacy notices reserving the club's right to ask
somebody to produce their number or other evidence of affiliation.

**The £18/£20 split is untouched** and the £2 gap is still ARC's Unattached Runner Levy. Which
fee is the affiliated price is `entries.fees.affiliated` — a column that says only that, and
asks the runner nothing.

### The progressive enhancement, and what it costs

Three things, none load-bearing: the live age category, revealing the guide's fields, and a
running total plus inline validation. **With scripting off every one degrades to the fields
being visible and the server deciding** — which is the path the `no-javascript` project
tests.

**It validates with the shared schema rather than a copy of the rules**, which puts Zod in
the page bundle: **68.8 kB raw, 19.2 kB gzipped**, deferred, and requested only by `/nn/`.
That is a real cost on the poor-signal phone this site is built for, it was asked for
deliberately, and the figure is written down here so it can be revisited rather than
rediscovered. Dropping inline validation — keeping the category, the box and the total —
would take it to roughly 2 kB.

**It never blocks a submission.** No `preventDefault`: the browser submits and the Worker
decides, exactly as with scripting off, so the two can never disagree about what was
accepted.

**The Worker bundle grew by 12.8 kB raw, 3.7 kB gzipped** — 1312.3 kB / 231.5 kB gzipped
before this slice, 1325.0 kB / 235.2 kB after, measured with `wrangler deploy --dry-run`.
Almost none of that is the Stripe call: `worker/stripe.ts` is one `fetch` and a
`URLSearchParams`, and the rest is the shared purchase module and its schemas. **The `stripe`
package would have been several hundred kilobytes** and carries an HTTP client a Worker
cannot use. The page bundle is unchanged at 68.8 kB — nothing about payment reaches a browser.

### Where the rows land

`packages/db`'s `entries` schema — [its README](../../packages/db/README.md) has the shape
and the access control. **The anon role still holds no grant on any table there.** Every
write goes through a `security definer` function that decides the price, the capacity and the
consent version itself, and `packages/db/tests/entries.test.ts` asserts the refusals on every
table, for every verb, by error code. That file staying green is what says this slice granted
nothing it should not have.

## The account area

`/account/` — register, sign in, sign out. `worker/account.ts`, and always on, unlike
`/nn/admin`: there is no key that switches it off, because an account system nobody can
reach is not a deployable state the way an admin surface with no key installed is.

| | |
| --- | --- |
| `GET /account/` | Signed in: who you are and what you can reach. Signed out: a 303 to `/account/sign-in/` |
| `GET`/`POST /account/sign-up/` | Name, email, password, Turnstile. `?done=ok` renders the acknowledgement |
| `GET`/`POST /account/sign-in/` | Email, password, Turnstile |
| `POST /account/sign-out/` | Never a `GET` — a prefetch or an `<img src>` must not be able to sign somebody out |
| `GET /account/confirm/` | Where the confirmation email lands. `?error=...` from Supabase renders an honest failure instead |
| `GET`/`POST /account/reset/` | Ask for a reset link. Email, Turnstile. `?done=ok` for the acknowledgement — the same one whether or not the address has an account |
| `GET`/`POST /account/reset/confirm/` | Where the reset link lands, and where the new password is set — #54 |
| `GET`/`POST /account/password/` | Changing a password from inside a signed-in account. Asks for the current one — #54 |
| `GET`/`POST /account/details/` | Name, gender, date of birth, address — #61. Every field but name is optional and empty until filled in. `?done=ok` for the acknowledgement |
| `POST /account/link/` | Ask for a magic link — #55. Email, Turnstile. **Its own address rather than a hidden field on the sign-in page**, because that is how this repository has told two forms apart since the entry pages stopped carrying one. `/account/sign-in/?sent=ok` for the acknowledgement, the same one whether or not the address has an account |
| `POST /account/google/` | Hand off to Google — #56. A POST rather than a link: it mints a verifier, sets a cookie and carries a CSRF token. **Renders nothing and does nothing while `GOOGLE_SIGN_IN` is not `on`** |
| `GET /account/callback/` | **The one address every non-password route lands on** — #55's magic link and #56's Google return both. Built once, used twice |
| `GET /account/data/` | Download everything the club holds, or delete the account — #62. Behind a session, and no Turnstile: a bot with a valid session has already got in |
| `POST /account/data/export/` | The download. `application/json`, `content-disposition: attachment` |
| `POST /account/data/delete/` | The deletion. Needs `DELETE` typed into a box, so it is not reachable by one keystroke |

**Built the way `/nn/admin` is, and for the same reason.** The content is per-request — is
anybody signed in, what did the last submission get wrong — so it is built with
`worker/html.ts`'s auto-escaping template rather than shipped as static HTML. **No file
exists under `src/pages/account/`** other than `account.css.ts`, the stylesheet endpoint on
the exact pattern of `src/pages/nn/admin.css.ts`. `nn-theme.css` never reaches it — this is
a tool for managing an account, not a page about the race.

### The JavaScript exception, made real

Every unauthenticated form here carries a Cloudflare Turnstile widget, and Turnstile has no
no-script mode. [ADR-015](../../../docs/architecture/decisions/adr-015-member-accounts-on-supabase-auth.md)
accepted that cost deliberately, reversing
[progressive enhancement](../../../docs/architecture/principles.md#progressive-enhancement-not-javascript-dependence)
for this one area of the site. With scripting off the widget never renders, and the page
says so plainly — an honest dead end, not a button that silently does nothing.

**GoTrue verifies the token itself**, via `options.captchaToken` on `signUp` and
`signInWithPassword`. There is no verification code in this Worker, and so no way to forget
to check it.

**One page carries it while signed in, and it is not a bot-defence exception.**
`/account/password/` (#54) asks for the current password before changing it, and verifying
that password calls `signInWithPassword` — the same endpoint GoTrue gates by captcha
regardless of who calls it. Found by running the real flow against the real local stack: the
first version had no widget there, and the internal check failed with `captcha_failed` even
for the right password, reading to a real person as "your current password was not right."

### Two Turnstile keys, and neither is a secret you will find here

| | Local / CI | Production |
| --- | --- | --- |
| Site key (public, in `wrangler.jsonc`) | `1x00000000000000000000AA` — Cloudflare's own published "always passes" testing key | `0x4AAAAAAEaeMm9jDSJB7Gqy` |
| Secret key (GoTrue-only, `env(SUPABASE_AUTH_CAPTCHA_SECRET)`) | `1x0000000000000000000000000000000AA` — the matching public testing secret, exported by `./dev` and `ci.yml` | The club's real secret, a GitHub Actions repository secret |

Both testing values are documented at
[developers.cloudflare.com/turnstile/troubleshooting/testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing)
and are meant to be shared — using them locally and in CI means nobody needs the club's real
Turnstile secret just to run the test suite, and `supabase start` cannot fail the way it did
when this env var was simply unset (see #49's history on this file's captcha block).

### Account enumeration

Signing up with an address that already has a confirmed account does not disclose that it
does. GoTrue itself answers success either way — no email is sent to an address that is
already registered — so there is nothing extra to get right here: the same shape
`intake.nn_interest`'s duplicate-address handling has, at the database rather than the auth
layer.

### Sessions and CSRF

`worker/session.ts` (#52) is what a signed-in request carries; this is its first caller. A
sign-in sets `src_at`/`src_rt`/`src_ax`; a sign-out clears all three **and** calls Supabase's
own sign-out, so the refresh token is dead server-side rather than merely forgotten locally.

### A session ends on its own — ADR-019

**Thirty minutes idle, twelve hours absolute**, which are NIST SP 800-63B's AAL2 numbers and
sit inside OWASP's bands for a low-risk application. It used to be thirty days, which was
Supabase's default rather than anybody's decision — and one cookie jar opens `/account/` and
`/admin/` alike, where the entry list, every emergency contact and the medical notes are.

| | Enforced by |
| --- | --- |
| **Idle** | The `Max-Age` on all three cookies, re-issued on every request that carries a live session — so `readSession` now returns `Set-Cookie` values on the *common* path, not only after a refresh |
| **Absolute** | `src_ax`, the deadline minted at sign-in and carried unchanged through every refresh, checked against the authentication time GoTrue signs into the access token's `amr` claim — whichever of the two is stricter |

**Only an authentication mints a deadline.** A refresh carries the existing one forward, which
is what stops an hour of refreshing buying another twelve. Reaching either deadline calls
Supabase's `/logout` on the way out, so the expiry revokes rather than merely forgets — and a
session carrying no readable `src_ax` is ended rather than given one, because a missing
deadline must not mean "no upper bound".

**Somebody is told why**: every `/account/` address needing a session sends a timed-out visitor
to `/account/sign-in/?timed-out=ok`, which says what happened without naming the durations. The
addresses *for* somebody signed out — `SIGNED_OUT_ADDRESSES` in `worker/account.ts` — are
deliberately not intercepted. `/admin/` is unchanged: the same ordinary 404.

**GoTrue does both of these itself on a Pro plan** and would replace most of this; ADR-019 has
why that is not reachable from the free tier, and why setting it in `[auth]` anyway would be
worse than not having it.

**`SameSite=Lax`, not `Strict`** — a magic link (#55) and an OAuth callback (#56) are both
cross-site top-level navigations, which `Strict` would drop the session cookie on. Every
state-changing `POST` in this area therefore carries a CSRF token from `worker/csrf.ts`: a
double-submit cookie-and-field pair, checked constant-time, unrelated to the session so a
token refresh mid-form does not invalidate what somebody already typed.

### Two rate limits, and they are not the same limit — #64

**Neither layer is a substitute for the other, and the reason is that one of them cannot see
who is asking.**

| | Sees | Does |
| --- | --- | --- |
| **Cloudflare rate-limiting rules** | The runner's real IP address | Caps sign-in, sign-up, reset and the admin surfaces per person, before a Worker invocation is spent. [The committed copy](../../../docs/reference/cloudflare-waf-rules.md) |
| **`[auth.rate_limit]` in `config.toml`** | A Cloudflare egress address | A project-wide circuit breaker. It cannot tell two members apart |

**Every GoTrue call in this Worker is server-side** — `account.ts` and `session.ts` build a
client and call `signUp`, `signInWithPassword`, `resetPasswordForEmail` and `refreshSession`
themselves. So GoTrue's own "per IP address" limits count the *Worker* against one address,
shared by the whole club at once. That is why `sign_in_sign_ups` and `token_refresh` are
**raised** rather than lowered in `config.toml`: a number that reads as tight for one
attacker is a cap on everybody, and being refused a refresh means being signed out —
plausibly mid-entry.

**One value goes the other way.** A confirmation, reset or magic link points at GoTrue's own
`/auth/v1/verify` and the browser follows it directly, so `token_verifications` is the one
limit here that really is per person — and it is lowered.

**None of these rules exists yet.** Manual step 11.

### Resetting a forgotten password, and changing one from inside an account — #54

**A reset request never says whether the address has an account.** The same acknowledgement
either way; the mail itself differs, exactly as sign-up's own enumeration safety works. Two
addresses:

| | |
| --- | --- |
| `/account/reset/` | Email, Turnstile. Calls `resetPasswordForEmail`, which redirects the link to `/account/reset/confirm/` |
| `/account/reset/confirm/` | Where the link lands, with the new session's tokens in the URL **fragment** — a server never sees those. The page ships the set-password form hidden and a plain-language fallback visible; a small inline script reads `location.hash` and only then reveals the form, one more instance of the honest-dead-end pattern above |

**A used or expired link says so.** GoTrue answers an invalid recovery token by redirecting
back with `?error=...` in the query string, which this page renders as "that link did not
work" with a link to request a new one — the same shape `/account/confirm/` already uses for
a bad signup-confirmation link.

**Changing a password requires the current one.** `/account/password/` asks for it and
re-authenticates with `signInWithPassword` before calling `updateUser()` — that
re-authentication is what actually makes the rule true, rather than trusting
`secure_password_change`'s own recently-signed-in window to have been wide enough.

**Neither route revokes other sessions itself.** GoTrue does that on its own whenever
`updateUser()` changes a password — confirmed against the real local stack in
`packages/db/tests/identity-sessions.test.ts`, since a session revocation cannot be observed
any other testable way from inside the Worker.

**No notification email is sent when a password changes, and that is a gap rather than a
design.** #54 turned `[auth.email.notification.password_changed]` on — it is the only way
somebody finds out a change happened without their own knowledge — and the whole block had to
be commented out again: Supabase's management API refuses every email-template modification
while the project is on the free tier with the **default email provider**, so that one line
failed `supabase config push`, and with it the whole `config.toml`, on every merge from 25
August 2026. Issue #79.

**Setting it to `enabled = false` did not fix it**, which is worth knowing before somebody
tries that again: the CLI serialises the section whenever it is *present* in the file,
supplying the `subject` it was not given, so `config push` went on sending `subject = ""`
against production's real subject — and an empty subject is a template modification too. The
section is commented out, which is how the CLI shipped it and how every green deploy before
#76 ran.

**#50 — Resend over SMTP — is what makes it true**; nothing else does, and
`packages/db/tests/unit/config.test.ts` fails if any email-template block is declared at all
before then. Until that lands, a silent password change is only visible as the other sessions
dying.

### The magic link and Google — #55 and #56

Two ways in that are not a password, landing on **one** address: `GET /account/callback/`.
#56 adds a branch to it rather than an address of its own.

**PKCE, not the implicit flow, and the reason is not the usual one.** #55 asks that a
prefetching mail scanner — some corporate scanners follow every URL in a message before a
human sees it — must not consume a single-use token. The issue proposes GoTrue's `token_hash`
flow for that, which needs the email template to emit `{{ .TokenHash }}`. **That is the block
the section above explains cannot be declared at all**, and `config.test.ts` fails on it. The
route is closed until #50's custom SMTP exists.

PKCE reaches the same property by another road and needs no template:

| | |
| --- | --- |
| **The code is on the query string** | So the Worker reads it directly. None of `/account/reset/confirm/`'s hidden-form-and-inline-script gymnastics, because nothing arrives in the fragment |
| **Redeeming it needs a `code_verifier`** | Minted here, kept in an `HttpOnly` cookie that never left this origin. **A scanner that follows the link holds a code and nothing to redeem it with**, so it cannot obtain a session — which is the property #55 actually wanted |
| **It is what OAuth needs anyway** | So the callback is genuinely built once and used twice |

**`SameSite=Lax` is load-bearing on that cookie**, for the reason `session.ts` already gives
about the session pair: arriving from a mail client is a cross-site top-level navigation, and
`Strict` would drop the cookie on the way in — the exchange would then fail on a code that was
perfectly good, which is the least debuggable outcome available. Ten minutes' `Max-Age`: long
enough to open an email on a phone that has gone to sleep, short enough that a shared machine
does not keep a redeemable secret all day.

**`next` must resolve to a path on this origin.** It arrives from a link in an email, which is
the single most credible place to put an open redirect, so anything carrying a scheme, a host,
a backslash or whitespace is refused outright and falls back to `/account/` rather than being
sanitised. `safeNext()` is the whole of it, and `tests/unit/account.test.ts` asserts five
separate techniques against it.

**A magic link never creates an account.** `shouldCreateUser: false` — registering is
`/account/sign-up/`, which collects a name and shows the terms, and a link that silently
created a nameless account would put people in the members table who agreed to nothing.

**The acknowledgement is the same whether or not the address has an account**, down to which
cookies are set. This form is on the sign-in page, so an answer that differed would be a
membership oracle anybody could query — a worse version of the leak `/account/reset/` was
already careful about.

**Google renders nothing until `GOOGLE_SIGN_IN` is `on`.** The provider and the button are
switched on by two different people at two different times — `[auth.external.google]` ships on
the next merge touching a migration, the var is a Cloudflare deploy — so the button waits for
the far side to be ready. **Provider first, button second**;
[the runbook](../../../docs/delivery/runbooks/google-oauth.md) is the order.

### Downloading and deleting an account — #62

`/account/data/`, behind a session, and the two things it offers have nothing in common except
the page they are on.

**The export is downloaded, never emailed.** Emailing a file of somebody's personal data to an
address is a disclosure with no way back. It comes from `identity.export_me()` rather than
four reads, because `role_grants` and `audit` have no policy and no grant to anybody — an
export assembled client-side would silently omit somebody's roles and nobody would notice.

**Deletion goes through `identity.delete_me()`, which takes no arguments at all.** There is
nothing to pass that could be wrong and no way to name somebody else; `auth.uid()` is the only
input and it comes from a verified JWT. It deletes the `auth.users` row and lets the foreign
keys cascade, which takes the profile, the role grants and GoTrue's refresh tokens — that last
one is what ends every session immediately. **No service role key**, which is the point:
`createUserClient` still refuses one.

**The page says what deletion does not remove, before the button.**

| Survives | Why |
| --- | --- |
| A paid race entry | A financial record with its own retention, belonging to the transaction as much as to the person. `entries.entrants` is **not** keyed on `identity.people`, and `identity.test.ts` asserts no foreign key from `entries` reaches `identity` — inserting an entrant and watching it survive would pass just as well on a schema somebody had since made cascade |
| Medical notes | Already deleted a month after the race by the cron. Nothing here changes when |
| The interest list | Its own consent and its own record |
| Both audit trails | Neither has a foreign key to `people`, deliberately. After a deletion they hold a uuid that resolves to nobody, which is the correct outcome — an audit trail somebody can erase by leaving is not an audit trail |

**The last super-admin cannot delete themselves.** `identity.revoke_role()` already refuses to
remove the last active super-admin grant, for the reason
[principles](../../../docs/architecture/principles.md) gives — no system is reachable by only
one person — and deleting the account is the same hole by a different door. Same
`last_super_admin` reason, and the page says to hand the role over at `/admin/people/` first.

### The profile: name, email, gender, date of birth, address — #61

`/account/details/` is the one page in this area that collects new personal data, which is
why it shipped last and blocked on #60's privacy notice rather than on code —
`src/pages/privacy.astro` says what each column is for before this page is allowed to ask
for it, and the two are meant to be read together.

**No Turnstile.** Every other form in this area guards an endpoint anybody can reach signed
out; this one sits behind a session, and a bot that already holds one has got past the
widget once already — asking again here would guard nothing.

**Changing the email address calls GoTrue's `updateUser()` rather than writing a column** —
there is none to write; email lives in `auth.users`, not `identity.people`.
`double_confirm_changes = true` means the change needs confirming from **both** the old
address and the new one before it takes effect, and `/account/details/?done=ok&email=pending`
says so. `updateUser()` needs a real session established with `setSession()`, not just a
bearer token, so this is the one place on this page that reads the `src_rt` refresh-token
cookie directly rather than going through `createUserClient()`. Resubmitting the form with
the same address, compared case-insensitively, is a no-op — saving a changed date of birth
must not re-mail a confirmation nobody asked for.

**`emailRedirectTo` is set explicitly, the same reason `handleSignUp` sets it on its own
`signUp()` call.** Left to GoTrue's default, the confirmation link would use `config.toml`'s
`site_url` — production, always — so a laptop or CI run would mail a link that never lands
back on the server that sent it.

**Date of birth is three number boxes, day, month and year — not a native date picker or a
single text field.** The same shape and the same reasoning `NnEntryForm.astro` gives for the
race entry form: a picker opens on this month and asks somebody to page back forty years, one
month at a time, on a phone. Unlike the entry form's version every part is optional
*together* — leaving all three blank means "not given", the one way this field differs from
an entrant's.

**A deliberate, recorded reversal of `principles.md`'s minimisation rule**, for members
rather than for entrants: that rule says a date of birth becomes a computed age and an
address does not persist at all, written for somebody the club holds data about for one
race. A member is a different relationship — England Athletics registration needs a date of
birth and an address, and a club that cannot answer "where do we post their kit" has not
built a membership system. `entries` is untouched by any of this and still stores neither.

**The sign-up name reaches `identity.people` too, as of the same change.** Before it, the
name sign-up collects sat only in `auth.users.raw_user_meta_data` — `identity.handle_new_user()`
had only ever inserted the bare `id` — so every account created before this migration would
otherwise have shown a blank name on this page. A migration copies it across for accounts
that already exist; the trigger copies it going forward.

## The health endpoints

Two database round trips, answered as JSON at **`/_health`** here and **`/timing/health`** in
`apps/timing`. `intake.health()` returns `now()`; `intake.ping()` returns a constant and was
added *after* the first deploy, so between them they prove the migration applied, `intake` is
exposed through PostgREST, the anon key and the grant are right, the client is wired, the
Worker can reach the network — and that a **later** migration reached production the same way
the first one did. `scripts/smoke.mjs` reads both, from both applications, which is what proves
the two are talking to one Supabase project.

```json
{
  "ok": true,
  "database": { "ok": true, "at": "2026-08-15T11:16:24.080Z", "formatted": "15 August 2026 at 12:16 BST" },
  "pipeline": { "ok": true, "value": "pipeline-ok" }
}
```

`200` when `ok` is true and **`503` when it is not** — a health endpoint answering 200 while
its body says `ok: false` is the shape that lets an outage sit behind a green tick. `no-store`,
because a cached answer to "can you reach the database" is not an answer. `at` is UTC and
`formatted` is `Europe/London`, so a check can catch the two disagreeing on the weekend the
clocks change, which is the weekend before this race.

### Why the two names differ

**`/_health` here, `/timing/health` there**, and neither spelling is free to change.

The underscore is what stops this endpoint ever colliding with a page. Astro is
`trailingSlash: 'always'`, so a future `src/pages/health.astro` would serve at `/health/`
while this Worker went on answering `/health` — it matches before the assets binding. Both
would work, one character apart, and somebody typing "health" would get a database report:
no error, no failing test, and no way for whoever added the page to find out. **This is a
running club**, so training, injury and wellbeing are exactly what `/health/` is for. A
leading underscore cannot be an Astro route, so the collision becomes impossible rather than
unlikely. `tests/worker/serves.test.ts` asserts `/health` no longer answers this endpoint's
JSON.

**`apps/timing` cannot copy it.** A leading underscore makes an App Router folder *private* —
`app/_health/route.ts` builds, deploys and 404s, with nothing saying why. It is
`app/health/route.ts`, and the trap is in CLAUDE.md because the same name is fine on one side
of the hostname and invisible on the other.

### Why they are not on a page any more

**They were.** `/nn/` carried a `<dl>` under the heading "What this page proves" — the database
timestamp, a pipeline-check marker, "Served by: Cloudflare Workers, static assets plus one
handler" and "Application: apps/main" — directly below the form somebody hands over £17 and an
emergency contact on. `/timing` was nothing *but* that table, and the club's front door linked
to it as "live results and marshal screens".

**The check was never the problem; its audience was.** A page that reports its own plumbing
reads as a page that is not finished, and this is the page the club's first public transaction
happens on. Nothing was given up by moving it: the same calls run in the same Worker, in the
same runtime, against the same project, and the smoke test still fails a deploy if either
breaks. Two things were gained — the race page no longer waits on Supabase to render, and the
checks are now readable by a monitor instead of by a regex over HTML.

`scripts/smoke.mjs` also asserts the markers have **not** come back. A page is only clean while
nobody puts them back, and "the smoke test still passes" is exactly the argument somebody would
make for re-adding one.

### What is exposed, and what that costs

**No personal data can appear here.** Neither function reads a row, which is what makes it safe
to serve without a credential — and it is a property to preserve rather than a coincidence. A
future health check that counted entries would be a different thing entirely.

What it does cost is two anonymous database round trips per request, on a path anybody can find.
That is the same free-tier exposure `entries.expire_pending_holds()` already has, and the same
answer applies: **cover it with the Cloudflare WAF rate-limiting rule** when that rule is
created, rather than building a second mechanism here. See
[issue #19](https://github.com/southville-running-club/src-website/issues/19).

## The one routing decision

Everything on the hostname is this Worker's, **except `/timing`**.

In production Cloudflare dispatches `/timing/*` to `apps/timing` at the edge — a route
carrying a path beats a Custom Domain on the same hostname — so those requests never reach
this code. Locally there is no edge, so this Worker forwards them when `TIMING_ORIGIN` is
set.

**`TIMING_ORIGIN` is set at the top level and absent from `env.production`, and that
absence is load-bearing.** If it were ever set in production, the platform would be
proxying itself through an extra hop.

`isTimingPath` matches `/timing` and everything beneath it and nothing else — `/timings/`
and `/timing-results/` stay with the website, because those are addresses a future page
could legitimately want. That is asserted, not assumed.

| Local | | |
| --- | --- | --- |
| http://localhost:8787/ | the holding page | this Worker |
| http://localhost:8787/nn/ | Nightingale Nightmare, the race | this Worker |
| http://localhost:8787/nn/2026/ | the 2026 running, and the entry form | this Worker |
| http://localhost:8787/timing | race timing | forwarded to :8788 |
| http://localhost:8787/membership/ | **404** | nothing built yet |

## Commands

```bash
npm run dev          # astro dev, fast loop — no Worker, so no timestamp
npm run dev:worker   # wrangler dev on :8787, the real runtime
npm run build        # static output to dist/
npm run test:worker  # Workers runtime tests. Needs dist/ — build first
```

### Seeing the entry form on a laptop

`/nn/2026/` says entries are not open until the event row says otherwise, which is what
production does. To see the entry form, open the window:

```bash
npm run entries:open  --workspace=packages/db   # entries open, from a day ago
npm run entries:close --workspace=packages/db   # back to the seeded state
```

Both are one `update` against the local database. **There is no preview flag and no
local-only variable** — the switch is the one production uses, so there is nothing that
could reach production and force a form open that should not be.

### Taking a payment on a laptop, without a Stripe account

`./dev up` starts a third process alongside the two Workers: **`platform/scripts/stripe-stub.mjs`
on :8789**, a fake Stripe that answers `POST /v1/checkout/sessions` with a canned session on
`checkout.stripe.com` and nothing else. `npm run preview` points `STRIPE_API_BASE` at it and
passes an obviously-fake `STRIPE_SECRET_KEY`, both on the `wrangler dev` command line — so
the whole chain works end to end locally with **no Stripe credentials anywhere**.

Everything up to the redirect is real: a real POST, a real transaction, a real held place, a
real `303`. What is fake is the destination, and the acceptance suite asserts *where* the
redirect goes rather than following it — Stripe's hosted page is a third party's, and a test
that types into it breaks the week they redesign it.

**To point a laptop at the real Stripe test API instead**, put a key in
`apps/main/.dev.vars` — which is gitignored, and is the only place a real key belongs on a
machine — and run `wrangler dev` without the `--var` overrides. Nothing in the committed
configuration reaches Stripe, and `tests/unit/worker-config.test.ts` fails if a key or a
`STRIPE_*` variable ever appears in `wrangler.jsonc`.

### Testing the webhook on a laptop

The Stripe CLI forwards real test-mode events to a local Worker. **It is not installed on any
machine here and nothing in the suite needs it** — the worker tests sign their own payloads with
the same `signStripePayload` the verifier is tested against — but it is how you check the real
thing end to end before the endpoint exists in production.

```bash
brew install stripe/stripe-cli/stripe          # once
stripe login                                   # opens a browser, test mode

stripe listen --forward-to localhost:8787/nn/stripe-webhook
stripe trigger checkout.session.completed      # in a second terminal
```

| | |
| --- | --- |
| **The secret it prints is not the dashboard's** | `stripe listen` prints its own `whsec_...` on startup, valid for that session only. Put **that** one in `apps/main/.dev.vars` as `STRIPE_WEBHOOK_SECRET` — the endpoint's signing secret from the dashboard will not verify CLI-forwarded events, and the failure looks like a broken implementation rather than the wrong key |
| **`.dev.vars` is the only place a real secret belongs on a machine** | It is gitignored, `wrangler dev` reads it automatically, and `tests/unit/worker-config.test.ts` fails if a `STRIPE_*` value ever appears in `wrangler.jsonc` |
| **`stripe trigger` invents its own session** | It has no `client_reference_id` of ours, so the answer is `not_ours` and a 200 — which is the correct behaviour and worth seeing. To exercise a real transition, take a session id from a local entry and craft the event, or use `stripe events resend` |
| **`ENTRIES_WEBHOOK_KEY` is needed too** | Put any string in `.dev.vars` and install its digest locally: `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the string>','UTF8')),'hex') where name = 'stripe';` |

> **Do not create a webhook endpoint in the Stripe dashboard yet.** It needs the production URL,
> and creating it before this Worker is deployed means Stripe posts into a 404 and marks the
> destination as failing. It is the **last** of [the manual steps](#manual-steps), deliberately.

### Four worker-test runs, and why

`npm run test:worker` runs **four** Vitest configs, each against one fixed state: the default
one against the seeded closed window, `vitest.worker.entries-open.config.ts` against an open
one, `vitest.worker.sold-out.config.ts` against a race with no places left, and
`vitest.worker.webhook.config.ts` against seeded purchases with the webhook key installed.

They are separate runs rather than one run with a `beforeAll`, for two reasons that are both
about the state being global. **`pg` cannot run inside `workerd`** — these tests execute in
the real Workers runtime, which has no `node:net`, so the window and the capacity are moved
from Vitest's `globalSetup` in the ordinary Node process. And `tests/worker/serves.test.ts`
asserts that `/nn/` quotes **no price**, which is true exactly while entries are shut.
Toggling mid-suite would make that assertion depend on run order.

Each run *sets* the state it needs rather than assuming it, and puts it back. Assuming cost
half an hour during the build: a run left the window open and the next run's closed-state
assertions failed in a way that read as a bug in the page. **A new directory under
`tests/worker/` has to be added to the default config's `exclude` list**, or it is collected
by the closed run as well — which cost the same half hour a second time, reported as
"entries are not open" from a sold-out test.

## Environment

Both Supabase values live in `wrangler.jsonc` — **local at the top level, production under
`env.production`** — and both are safe to expose by design: row-level security is what
enforces access, not the key.

That split is the safe direction. A plain `wrangler deploy`, which is the command somebody
runs by accident, publishes a Worker with **no hostname and an unreachable database**.
Loud and harmless. The inverse would put localhost config on the live domain.

`env.production`'s Supabase block is byte-identical to `apps/timing`'s, and
`packages/shared/tests/unit/supabase-config.test.ts` fails if that ever stops being true —
because one database behind both applications is what makes a results archive derived from
timing data possible at all.

### Stripe is not a variable, and is not in this repository

| | |
| --- | --- |
| `STRIPE_SECRET_KEY` | A **Worker secret**, set with `wrangler secret put`. Never in `wrangler.jsonc`, never in a `vars` block, never committed. Its absence is a real, safe state: with no key the form validates and stops, saying nothing was stored and nothing charged |
| `STRIPE_WEBHOOK_SECRET` | A **Worker secret**. What proves a delivery came from Stripe. Its absence is a real state too — the endpoint is created *after* this Worker is deployed — and every delivery in that window is answered **5xx and retried**, never 400 |
| `ENTRIES_WEBHOOK_KEY` | A **Worker secret**, and the least obvious one. `entries.record_checkout_event()` is granted to `anon` like every other function, and the anon key is published in page source — so the key is what stops two PostgREST calls buying a free entry. The database holds only its SHA-256 digest |
| `ENTRIES_ENTRY_KEY` | A **Worker secret**, on the same mechanism, and the other half of the sentence above. `entries.create_pending_purchase()` is granted to `anon` too — a signed-out runner reaches PostgREST as anon — and it holds a place *before* any money moves, with a live hold counting against the 250. Without this key a loop with the published anon key takes the whole field in half a second for nothing, never reaching this Worker. **Its absence refuses every entry**, which is the safe direction: the digest ships null. See [ADR-029](../../../docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md) and issue #178 |
| `ENTRIES_ADMIN_KEY` | **Unused by the Worker, and still a live database exposure — see the note below the manual-steps table.** #58 retired the two-key admin scheme in the Worker; the admin surface is now reached at `/admin/` by signing in and holding a role (`nn-admin`, `people-admin` or `super-admin`), checked through `identity.has_permission()`, and `/nn/admin/*` only 301/308-redirects there. **But the five old key-gated database functions are still granted to `anon`** and still check this key's digest in `entries.webhook_secrets`, reachable directly through PostgREST around every role and permission. Deleting the Worker secret is not the whole fix |
| `STRIPE_API_BASE` | Local only, and only so the site runs end to end against the stub without a Stripe account. Passed on the `wrangler dev` command line — there is no path from a dev-server flag to a deployed Worker |
| `apps/main/.dev.vars` | Gitignored. The one place a real key belongs on a machine, and `wrangler dev` reads it automatically |

`tests/unit/worker-config.test.ts` asserts that **neither block of `wrangler.jsonc` mentions
Stripe at all**, and that nothing in the file looks like a key of any kind. A secret that was
ever committed is compromised and has to be **rotated**, not deleted, so the guard is a red
pipeline rather than a code review.

**The service role key is still not on any list, and the webhook did not change that.** The
webhook's privileged write goes through a `security definer` function granted to `anon` and
gated on a shared key, exactly like every other write in that schema — see
[ADR-010](../../../docs/architecture/decisions/adr-010-webhook-writes-paid.md), which records
the two alternatives that were considered and why a key beat both.

## Manual steps

The [accepted exception](../../../docs/foundations/requirements.md#everything-is-defined-as-code)
to everything-as-code: what was done, why, by whom, and how to redo it. The full procedure
is the [Cloudflare runbook](../../../docs/delivery/runbooks/cloudflare-setup.md).

**The hostname is not on this list.** It is the `routes` entry in `wrangler.jsonc`, and
Cloudflare creates the DNS record and issues the certificate from it.

**The sign-up form added nothing to this list either.** The grant and the policy ship as a
migration, the route is code, and no variable was added — a WAF rate-limiting rule on the
race forms is a manual step, and it is now step 11 below.

**Member accounts are what made that step urgent rather than advisable.** `/account/sign-in/`
checks a credential and `/account/reset/` sends an email to an address the caller names —
two classes of exposure this platform has never carried, and neither is answered by
Turnstile, which raises the cost of a request without capping them. **The rules themselves
are written down** in [the committed copy of the Cloudflare
rules](../../../docs/reference/cloudflare-waf-rules.md) — expression, threshold, period,
action, mitigation, and a status column that is the only record of which exist — and the
runbook that gates them is
[opening accounts](../../../docs/delivery/runbooks/accounts-open.md).

**Nor did the entry form.** The schema, the seeded event and its fees all ship as one
migration; the exposed-schema list is `config.toml`, which `deploy-db.yml` pushes.

**Stripe adds four, and they are manual by necessity.** A secret cannot be code, and neither can
the digest of one. They are listed below as pending because nothing has been set on the deployed
Worker yet — which is why production still shows "payment is not connected yet" rather than a
broken payment page.

**The admin surface no longer adds a credential of its own.** It did, briefly — a Worker
secret and a key per volunteer, argued for in
[ADR-013](../../../docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md)
— but #57/#58 retired that scheme in the Worker. What switches the admin surface on now is
step 6 below: registering the club's own admin address, which becomes `super-admin` on
sign-up. **No secret, no SQL, no deploy.**

> **The order is not arbitrary and steps 4 and 5 must be last.** Creating the Stripe endpoint
> before the Worker is deployed means Stripe posts into a 404 and marks the destination failing;
> creating it before the secrets are set means every early delivery 5xxs. Nothing is *lost*
> either way — Stripe retries for three days — but the dashboard fills with red for no reason.

**Member accounts add a different kind of secret**, and steps 9, 10 and 13 are all of it.
They are **GitHub Actions repository secrets**, not Worker secrets — `env(...)` substitution in
`packages/db/supabase/config.toml` is read wherever `supabase config push` runs, which is
`deploy-db.yml`, not the Worker. [Decision 005 and ADR-015](../../../docs/decisions/decision-log.md#005--give-the-platform-member-accounts-on-supabase-auth)
record the choice. **Each is needed before its own block is uncommented, not after** — the
Supabase CLI validates an `env(...)` substitution at startup, and an unset one breaks
`supabase start` outright. #49 turns on the parts of `[auth]` that need no secret —
`enable_signup`, email confirmation, a twelve-character minimum password; `[auth.captcha]`
stayed commented out until #53 needed it and step 9 had actually been done, and
`[auth.email.smtp]` stayed commented out until #50 and step 13.

**#50 turns that last block on for production only, and the mechanism is worth knowing before
you read the file.** `[remotes.production]` at the foot of `config.toml` overrides
`[auth.email.smtp] enabled` to `true` for the linked project; the base stays `false`. That is
not tidiness — CI and every laptop hold a *placeholder* for step 13's secret, and with the base
enabled GoTrue really dials `smtp.resend.com` and every `signUp()` in the database tests fails
with `Error sending confirmation email`. Three suites, 116 tests, measured. **`supabase config
push` is the only command in this repository that resolves a remote block**, because it is the
only one given a project ref, so nothing local changes behaviour.

⚠️ **No local check can prove that override applied** — `supabase status` does not run the
validation `config push` does. **Read the `deploy-db` run**, and then send a real email; both
are steps in [opening accounts](../../../docs/delivery/runbooks/accounts-open.md#02--email-actually-leaves-the-building).
The failure mode if it silently does not apply is the safe one: production keeps the built-in
sender, exactly as before.

**`[auth.external.google]` is the one that is present rather than commented, and the
difference is worth knowing.** #56 ships it with `enabled = false`, shaped exactly like the
`[auth.external.apple]` block the CLI has always carried — which also has an `env()` secret
nobody has set, and which has pushed green on every deploy. **A disabled external provider is
not what the free tier refuses; an email template is.** That is why the `password_changed`
block is commented out and this one is not, and `tests/unit/config.test.ts` guards the
distinction. Step 10 still has to be done **before** `enabled` is flipped to `true`, for the
startup-validation reason above.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _1. Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | **Done** — and this row said _pending_ until 30 Aug 2026, on a Worker that had been serving production for weeks. `src-main-production` exists, Workers Builds deploys it on every push to `main`, and `smoke.yml` has been green against the live hostname daily. **A status column nobody revisits is worse than no status column**, which is why the four rows below now carry what was actually measured | See the settings below |
| _2. Set the Stripe secret key_ | A secret cannot live in the repository, and without it the entry form validates and stops | **Done**, 27 Aug 2026 — **sandbox value** | `npx wrangler secret put STRIPE_SECRET_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Use a **restricted** key with write on Checkout Sessions, read on Payment Intents, and **write on Refunds** — the last is #107's cancel button and nothing here needs more. **What is bound today is a sandbox key, and the live pair is step 15** — safe because the only person who can reach Checkout before entries open is somebody holding `nn-tester` |
| _3. Set the entries webhook key, and install its digest_ | The function that writes `paid` is granted to `anon`, and the anon key is published in page source. **Two steps, and doing one without the other stops payments being recorded** | **Worker secret done**, 27 Aug 2026. **The digest half is not confirmed here** — and until a real signed event has been recorded end to end, nobody can say which of the two halves is in place, because the symptom of a mismatch is a 503 that looks like an outage | Generate one: `openssl rand -hex 32`. Then `npx wrangler secret put ENTRIES_WEBHOOK_KEY --env production --config apps/main/wrangler.jsonc`, and in the Supabase SQL editor: `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the key>','UTF8')),'hex'), updated_at = now() where name = 'stripe';` |
| _4. Set the webhook signing secret_ | The webhook has to prove a request came from Stripe | **Done**, 27 Aug 2026 — **sandbox value**, and paired with step 2's sandbox key | Create the endpoint in step 5 first if it does not exist; Stripe shows its signing secret once. Then `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production --config apps/main/wrangler.jsonc`. **It must match the mode of step 2's key.** Test and live are separate endpoints with separate signing secrets, and a live key paired with a test secret fails verification on every delivery — which reads as an outage rather than as a mismatch |
| _5. Create the Stripe webhook endpoint_ | **Last, and only once the Worker is deployed.** Otherwise Stripe posts into a 404 | _pending_ | Stripe dashboard → Developers → Webhooks → Add endpoint. URL `https://new.southvillerunningclub.co.uk/nn/stripe-webhook`. Subscribe to **`checkout.session.completed` and `checkout.session.expired` and nothing else** — everything else is answered 200 and ignored, and subscribing to more is delivery volume for no benefit |
| _6. Register the club's admin address_ | **This is what switches the back office on**, and it replaced steps 6 and 7 as they stood — #58 retired the two-key scheme in the Worker, so there is no `ENTRIES_ADMIN_KEY` to install and no per-person key to issue. `admin@southvillerunningclub.co.uk` is written into `identity.reserved_grants` by the migration and becomes `super-admin` by registering like anybody else | **Done**, confirmed 30 Aug 2026 — a `super-admin` exists, which is what unblocks granting `nn-tester` for the entries-open rehearsal | Register at `/account/sign-up/`, confirm from that mailbox, then grant the other volunteer `nn-admin` at `/admin/people/`. [The admin runbook](../../../docs/delivery/runbooks/entries-admin.md#bootstrapping-the-first-super-admin). **No secret, no SQL, and no deploy** — which is the point of #59 |
| _8. Validate the four entries constraints_ | **Independent of every step above, and nothing is broken until it is done.** Slice G's check constraints shipped `NOT VALID`, so they enforce every new write but have never looked at the rows already there — because nobody here could see them, and a validated `ADD CONSTRAINT` fails the *migration* if one row disagrees, which fails the deploy for everything | _pending_ | [The constraints runbook](../../../docs/delivery/runbooks/entries-constraints.md). Step 1 is a read-only query that says whether step 2 will succeed; run it first and stop if any count is not zero, because a row that disagrees is evidence rather than a mess to tidy |
| _9. Set `SUPABASE_AUTH_CAPTCHA_SECRET`, before #53 uncomments `[auth.captcha]`_ | **A GitHub Actions repository secret, not a Worker secret** — `deploy-db.yml` runs `supabase config push` in Actions, and that is where `env(...)` substitution reads from. It has to exist **before** `[auth.captcha]` is uncommented: the CLI validates the substitution at startup, and an unset one breaks `supabase start` outright rather than shipping captcha silently off — confirmed while building #49, which is why that block shipped commented out until #53 | **Done**, 24 Aug 2026 | Repository → Settings → Secrets and variables → Actions → New repository secret, name `SUPABASE_AUTH_CAPTCHA_SECRET`, value the Turnstile **secret** key. The site key (`0x4AAAAAAEaeMm9jDSJB7Gqy`) is public and lives in `wrangler.jsonc`'s `env.production.vars` as `TURNSTILE_SITE_KEY`, #53 |
| _10. Create the Google OAuth client, and set `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`_ | **Three switches, thrown by two people at two different times, and the order matters.** #56 shipped the code, the button and `[auth.external.google] enabled = false`; none of it does anything until a Google Cloud project exists. The same startup-validation trap as step 9 applies — the secret must exist **before** `enabled` is flipped to `true`, not after. Then, and only then, `GOOGLE_SIGN_IN` goes to `"on"` in `wrangler.jsonc`: **provider first, button second**, because a button leading to a provider GoTrue does not know about is a dead end somebody has to debug | **Parked**, 25 Aug 2026 — no Cloud project exists, and it gates nothing: [opening accounts](../../../docs/delivery/runbooks/accounts-open.md#stop-conditions) has no Google stop condition. The code ships inert, so **nothing is broken by leaving this undone** | [The Google runbook](../../../docs/delivery/runbooks/google-oauth.md), end to end. It carries the one that catches everybody: **the redirect URI registered at Google is Supabase's** (`https://<project>.supabase.co/auth/v1/callback`), not the club's `/account/callback/`. The Cloud project must be **club-owned with both volunteers as owners** — an OAuth client on a personal account is a system reachable by one person |
| _11. Create the Cloudflare rate-limiting rules_ | **Was: the platform has no rate limit of any kind.** Sign-in is a credential check, `/account/reset/` mails an address the caller chooses, and `POST /nn/2026/` holds a place in a 250-runner field for 31 minutes — none of which is capped by anything deployed. A rule per IP at the edge is the only layer that sees the runner's real address, because every Supabase call this Worker makes is server-side | **Partly done**, 25 Aug 2026 | **One rule exists — `C1`, the combined expression — because the free plan allows exactly one and caps both the period and the mitigation at 10 seconds.** Not the five this repository specifies. Security → Security rules → Rate limiting rules; there is no *WAF* item in the sidebar any more, and *Rules* is a different feature. Values, the measured plan limits and what the 10-second ceiling costs are in [the rules file](../../../docs/reference/cloudflare-waf-rules.md#what-actually-happened). **Still outstanding: nobody has watched it fire**, which is [accounts-open step 0.3](../../../docs/delivery/runbooks/accounts-open.md#03--somebody-has-actually-tried-it) and a stop condition for announcing accounts |
| _12. Set `RESEND_API_KEY`_ | **A Worker secret, same mechanism as Stripe's** — Resend authenticates over a plain HTTPS API, so this is the only credential the send path needs. Scope the key to **Sending access only** in Resend's dashboard, never full account access, so a leak can only send mail as the club rather than reconfigure the account or read logs. **#73's outbox is what now uses it**, and it needs `ENTRIES_WEBHOOK_KEY` (step 3) to be working as well — the drain authenticates with the same key the Stripe webhook does. With either missing the outbox fills and nothing sends, which loses nothing and is visible in the Worker's logs | **Done**, 25 Aug 2026 | `send.southvillerunningclub.co.uk` verified in Resend (account, DNS records in Cloudflare, domain verification — see [the design doc](../../../docs/solutions/resend-programmatic-email.md#step-by-step-get-go-to-a-working-send)), then `npx wrangler secret put RESEND_API_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Local dev uses the same name in `apps/main/.dev.vars`, gitignored |
| _13. Set `SUPABASE_AUTH_SMTP_PASSWORD`, before `[auth.email.smtp]` is uncommented_ | **A GitHub Actions repository secret, not a Worker secret** — the same distinction as steps 9 and 10, and for the same reason: `env(...)` substitution in `config.toml` is read wherever `supabase config push` runs, which is `deploy-db.yml`. **The value is the Resend API key** — GoTrue speaks SMTP, not Resend's REST API, so there is no separate mail-server password; `smtp.resend.com` authenticates with user `resend` and the key as the password. That is why the same credential now sits in two places, beside step 12's Worker secret. Until it exists, production GoTrue is on the free tier's default sender at **two emails an hour for the whole project**, and the failure is silent | **Done**, 25 Aug 2026 | Same place as step 9, name `SUPABASE_AUTH_SMTP_PASSWORD`, value a Resend key scoped to **Sending access only**. Prefer a key created for GoTrue rather than reusing step 12's, so rotating one path does not silently stop the other. Resend shows a key once; if it is lost, generate a new one rather than hunting for it |
| _14. Alias `noreply@southvillerunningclub.co.uk` onto `info@`_ | **A hedge, not the reply path — and the difference is a domain, which reads like a mailbox.** Account mail sends as `noreply@send.southvillerunningclub.co.uk`, the *sending subdomain*. GoTrue has no `reply_to` field, so pressing **Reply** goes there, to a Resend subdomain with no MX, and bounces. This alias is on the **main domain** and catches only somebody who re-types or hand-addresses the local part — exactly the hedge `nn@` already carries. **A working Reply button is #99**, the Send Email Hook | **Done**, 26 Aug 2026 | Fasthosts control panel → mailbox aliases, same place as `nn@`. **A mailbox setting, not a DNS change** — this adds no record to the zone at all, which matters because Cloudflare Email Routing is declined in six places in `docs/` for replacing the apex MX that carries all club mail |
| _15. Swap Stripe to live keys_ | **The last thing before entries open, and it is deliberately not step 2.** Test mode proves the integration; it does not prove the club's live account, its payouts, or that a live-mode webhook endpoint exists — those are separate objects in Stripe from the test ones | _pending_ | [Entries-open step 2c](../../../docs/delivery/runbooks/entries-open.md#2c--then-live-mode-for-a-pound). Register the **live-mode** endpoint, then `wrangler secret put` both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the live pair, then buy one £1 **Tester** entry with a real card and cancel it |
| _16. Set the entry key, and install its digest_ | **The same two-step shape as step 3, one function along, and the one that was missing.** `entries.create_pending_purchase()` is granted to `anon` and holds a place before any money moves; without this key anybody holding the published anon key takes all 250 places in half a second, for nothing, without touching this Worker or Cloudflare's rate-limiting rule. Issue #178, [ADR-029](../../../docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md) | _pending_ — and it is a **stop condition** for opening the entry window | ⚠️ **Before `entries_open_at` is set, never after.** `openssl rand -base64 32`, then `npx wrangler secret put ENTRIES_ENTRY_KEY --env production --config apps/main/wrangler.jsonc`, then in the Supabase SQL editor: `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the key>','UTF8')),'hex'), updated_at = now() where name = 'entry';`. Verify with one `nn-tester` entry — full procedure and the two failure signatures are [entries-open step 0.8](../../../docs/delivery/runbooks/entries-open.md#08--the-entry-key-must-be-installed-and-verified) |

### What is actually bound — measured 30 August 2026

`npx wrangler secret list --env production --config apps/main/wrangler.jsonc` returns five:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENTRIES_WEBHOOK_KEY`, `RESEND_API_KEY` and
**`ENTRIES_ADMIN_KEY`**. An unsigned `POST /nn/stripe-webhook` answers **400** rather than the
503 it answered on 26 August, which is the signing secret proving it is bound.

⚠️ **`ENTRIES_ADMIN_KEY` should not be there, and deleting it is not the whole fix.** #58
retired the two-key scheme in the Worker, so nothing reads it — `worker/admin-session.ts` is
unreferenced. **The exposure, if there is one, is in the database rather than on the Worker**:
five functions are still granted to `anon` and gated only by a key digest, and the anon key is
published in page source. If `entries.webhook_secrets`' `admin` row holds a digest, anybody with
that key can read the entry list and the medical notes straight through PostgREST, around the
roles, the permissions and the 404-not-403 door. **Null the digest, then delete the Worker
secret** — in that order. #63 removes the functions themselves.

**Two read-only queries settle both halves**, in the Supabase SQL editor (the table has RLS on
with no policy, so nothing else can read it):

```sql
-- Which digests exist at all. Both ship null, and null refuses everything.
select name, key_sha256 is null as refuses_everything, updated_at from entries.webhook_secrets;

-- And whether the stripe digest matches the key the Worker actually holds. This is the only
-- way to close manual step 3 without taking a payment: the two halves are installed
-- separately, and a mismatch shows up as a 5xx that reads as an outage rather than as a
-- mismatch.
select key_sha256 = encode(sha256(convert_to('PASTE_THE_KEY','UTF8')),'hex') as matches
  from entries.webhook_secrets where name = 'stripe';
```

**Rotating either secret has a window, and it is worth knowing about.** Between
`wrangler secret put ENTRIES_WEBHOOK_KEY` and updating the digest — or between rotating the
signing secret in Stripe and setting it on the Worker — **every delivery answers 5xx**. Stripe
holds them for three days, so nothing is lost; but somebody who does one and forgets the other
stops payments being recorded with no symptom except a repeated log line. The
[attention runbook](../../../docs/delivery/runbooks/entries-attention.md) has the diagnosis
table.

### Workers Builds settings

| | |
| --- | --- |
| **Worker name** | `src-main-production` |
| **Root directory** | **`platform`** — *not* `platform/apps/main` |
| **Build command** | `npm run build --workspace=apps/main` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/main/wrangler.jsonc` |
| **Build watch paths** | `platform/apps/main/**`, `platform/packages/**`, `platform/package-lock.json` |

**The root directory is the part that is easy to get wrong.** `@src/shared` and `@src/db`
are npm workspace links, and they only exist because the install ran at `platform/`. Point
the root directory at `platform/apps/main` and Cloudflare installs *there* instead, the
links are never created, and the build fails on `Cannot find module '@src/shared'`.

**Build watch paths are not optional.** The free plan allows 500 builds a month, and
without them every push rebuilds every application — which is how that allowance gets spent
on no-ops. `platform/packages/**` must be in the list: a change to the shared timezone
module has to rebuild both applications.

After anything touching the zone, **send and receive a test email on a club address.** A
Worker custom domain cannot affect mail, and confirming it costs a minute.
