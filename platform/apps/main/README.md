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
src/components/NnNav.astro     The five Nightingale Nightmare links
src/components/NnMasthead.astro   The header they sit in, and the button beside them
src/layouts/Base.astro         The document, the banner, and the optional `theme` prop
src/pages/index.astro          The holding page — new.<apex>/
src/pages/privacy.astro        The club's privacy notice — the account, and everything
                               that is not about a race
src/pages/404.astro
src/pages/nn/index.astro       The race — evergreen, the year panel, no year in it
src/pages/nn/course.astro      Course and terrain — evergreen
src/pages/nn/privacy.astro     What the club does with an entry and with a sign-up
src/pages/nn/2026/index.astro  The 2026 running — the date, the facts, the entry form
src/components/NnEntryForm.astro  The entry form, and its progressive enhancement
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
| `/nn/` | **The race — evergreen, and it names no year.** No form posts here; a POST gets 405 from the assets binding, as `/nn/privacy/` always has. The Worker paints on which running is current, its date and its links, from `entries.current_entry_state('nn')` — there is no year in this page's markup and there must never be one |
| `/nn/course/` | Course and terrain. **Evergreen**: the route, the ground and the headphone rule are the race's, not one running's |
| `/nn/privacy/` | What the club does with an entry and with a sign-up. **Written from the schema rather than from the form** — it lists what `entries.entry_purchases`, `entries.entrants` and `entries.entrant_medical` hold, which is four rows more than a list of what somebody types. **Evergreen, and site-wide in substance** — see [ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md) for why it stays under `/nn/` for now |
| `/nn/2026/` | **The 2026 running.** The date, the facts, and **both forms** — interest before entries open, entry after. Both post here, and a hidden `form` field says which |
| `/nn/2026/race-day/` | Race day — race HQ, the schedule, the prizes |
| `/nn/2026/spectators/` | Watching the race — where to stand, where to park. **With the year**, because it is read alongside race day and names this year's HQ |
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

### The navigation — one bar, six controls, and it stays on screen

```
[wordmark]  Race  Course  Race day  Spectators  Privacy      [ Enter the race ]
```

`src/components/NnNav.astro` (the five links) and `src/components/NnMasthead.astro` (the
button) — [ADR-012](../../../docs/architecture/decisions/adr-012-one-navigation-bar.md), as
amended by
[ADR-014](../../../docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md),
which added `Privacy` and made the bar sticky again.

**Identical on every page that carries it; only the current-page marker moves.** Three signals,
never colour alone: `aria-current="page"`, a 2px rule under the label, and full brightness
against the 0.78 the others rest at.

**The year is never in the bar and never in `dist/`.** Race day, Spectators and the button ship
`hidden` with `href=""`, and the Worker paints them from `entries.current_entry_state('nn')` on
**every** page that renders the masthead — including `/nn/course/` and `/nn/privacy/`, which it
previously did nothing to. That is one database round trip on those pages, resolved once per
request and shared. `tests/unit/nn-nav.test.ts` greps the components for a hand-typed year,
because a Worker test only ever sees the painted result.

**The button's label is the entry window's**, because "Enter" on a button that does not let you
enter is a small dishonesty on a site that is about to ask for money:

| Window | Long | Short (320px) |
| --- | --- | --- |
| `open` | Enter the race | Enter |
| `pre_open` | Register interest | Interest |
| `closed` | Race details | Details |

Each short label is a substring of its long one and the `aria-label` carries the long one at
both widths — WCAG 2.5.3.

**At 320px it is three rows**: wordmark and button, then the five links over two. 134.8px, with
the paddings compact at that width to buy back most of the row the sixth control costs — and at
400–480px, where five compact labels still fit one row, the bar is **97.3px, about 10px shorter
than the four-link bar was**. No hamburger, no dropdown, no script.

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

**`/nn/privacy/` is the fifth link**, added by ADR-014. It was the one page in the campaign whose
header linked everywhere except where you were standing; the notice describes fourteen fields, a
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
              Race day · Watching the race
```

**Two states, one shape.** The layout does not move when entries open — only the action's
weight changes and the fee line appears. **The difference in prominence is the message**: there
is deliberately no badge and no banner saying "open", because the button already says it and a
page that said it twice would be shouting.

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
matters: `/nn/` and `/nn/course/` are about the race and may read only the keys that are true
of it whichever year it is run.

| | |
| --- | --- |
| **The race's** | `name`, `distance`, `places`, `contact`, `privacy.*` — read by `/nn/`, `/nn/course/` and `/nn/privacy/`. **`privacy.*` is read by `/privacy/` too**, which is not a race page at all: the controller, the registered office, the company number and the data contact are the club's facts that happen to live in this file, and both notices lifting them from one place is what stops the two disagreeing |
| **One running's** | `date`, `startTime`, `location`, `price`, `entriesOpen`, `permit`, `schedule`, `prizes`, `finisherPrize`, `spectating`, `startFinish` — read only beneath `/nn/2026/` |

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
as a blank or an invention. Three still are, and each for a different reason:

| | |
| --- | --- |
| `price`, `entriesOpen` | **The database's, not this file's.** Fees live in `entries.fees.price_pence` and the window in `entries.events`, and the Worker paints them onto the entry form. These two `race.json` keys stay `null` and render "To be confirmed": duplicating a price into a content file is how two numbers start disagreeing. The transfer deadline and live capacity are undecided and have no field at all |
| `permit` | **The 2026 ARC permit number has not been issued.** The 2023 number is on record and is not a stand-in for it — it would read as a claim that this year's race is permitted |
| `privacy.*` | Nine keys. **Five are settled and written in** — the controller, the registered office, the company number, the one-month medical retention, and the date the notice was last updated. **Four are `null` and render "To be confirmed by the club"**: `contact`, `entryRetention`, `emailRetention` and `photographs`. A wrong answer on that page is a legal claim rather than a typo, so filling one in is a one-line edit here and `nn-privacy.spec.ts` counts the markers to stop a fifth appearing or a fourth quietly vanishing |

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

`privacy.spec.ts` counts **three** markers on `/privacy/` — those two plus `race.json`'s
`contact`, which is the same open decision on both notices — and `nn-privacy.spec.ts` still
counts **four** on `/nn/privacy/`. **Two counts in two files, deliberately**: one assertion
covering both pages would have to be "at least four", and that is the day the guard stops
working in both directions at once.

**Presentation is data too, where the committee should own it.** `prizes[].highlight` is
which tile the campaign's one accent colour lands on — the fancy-dress prize, because that
is what makes this race this race rather than any other 10 km. Moving the emphasis is a
one-word edit to `race.json` and not a CSS change.

**The page copy is a draft pending committee approval.** It is written to be edited, not
decided on their behalf — see [the phases](../../../docs/delivery/phases.md#what-the-race-pages-still-need-from-the-committee)
for that and for the six questions the draft could not answer.

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
`entries.create_pending_purchase()` re-checks the window, takes a per-event lock, counts the
places already gone, prices the entry from `entries.fees`, and writes a `pending` purchase
with a **31-minute hold**. The Worker then creates a Checkout session for exactly that amount
and `303`s to it.

**Nothing on this path moves a purchase to `paid`.** The redirect back from Stripe is not proof
of payment — a person can close the tab before it fires, and the return URL is one anybody can
type. [The webhook](#the-webhook) is what confirms, and it is the only thing that may.

| | |
| --- | --- |
| **Valid** | `303` to `checkout.stripe.com`, `cache-control: no-store`, and no body at all |
| **Rejected** | `422`, messages against their fields, **every value preserved** — fourteen fields is ten times as much to retype as the interest form |
| **Entries closed** | `409`. Somebody opened the page at 6:59 and pressed the button at 7:01; the window is re-checked when the form arrives, and again inside the transaction |
| **Sold out** | `409`, and **every value still in the boxes.** This is the case where losing somebody's typing hurts most: they have filled in fourteen fields and are being told the race went while they were doing it, and they may want to ask about a waiting list |
| **A free place** | `503`. A guide pays nothing and Stripe refuses a zero-total session outright — see [what it deliberately does not do](#what-the-entry-form-deliberately-does-not-do) |
| **No Stripe secret set** | `503`, **nothing stored and nothing charged**, said in those words. This is the deployed state today |
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
| **The key** | `entries.record_checkout_event()` takes `ENTRIES_WEBHOOK_KEY`. **Without it, two PostgREST calls with the published anon key would buy a free entry** — `create_pending_purchase()` issues purchase ids on request. The grant on the function is still `anon` and nothing else |

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
| **The England Athletics box is always in the DOM** | A plain field after all three cards, not inside one. JavaScript hides it when another type is chosen; the *server* decides whether it had to be filled in |
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

**No age category is invented for a non-binary runner.** The 2023 form offered the option and
there were no categories to receive it. The form records the answer and says plainly that the
categories are undecided. That is still not the same question as the minimum age, even though
both numbers happen to be 18.

**The England Athletics number is format-checked and never verified** — England Athletics
publishes no way to. It is spot-checked by a human afterwards, and nothing here should be read
as confirming a number is real.

**The check allows six to eight digits and the message says seven, and the gap is the
decision.** Every number the club has seen is seven; what the national range is below that is
unknown. So the field stays permissive and the words point somebody at their registration
email — a false reject here would block a paying entrant at the worst possible moment.

### The progressive enhancement, and what it costs

Three things, none load-bearing: the live age category, hiding the England Athletics box, and
a running total plus inline validation. **With scripting off every one degrades to the field
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
sign-in sets `src_at`/`src_rt`; a sign-out clears both **and** calls Supabase's own sign-out,
so the refresh token is dead server-side rather than merely forgotten locally.

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
| `ENTRIES_ADMIN_KEY` | A **Worker secret**, on the same mechanism and for the same reason — the five admin read functions are granted to `anon` too. **Its absence is what makes `/nn/admin` not exist**: with no key bound the Worker declines every address under that prefix and the request 404s like one nobody published. That is the deployed state. See [ADR-013](../../../docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) |
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

**The admin surface adds two more, and they are the same kind of thing.** A Worker secret and its
digest, then one key per volunteer. They are **independent of the five above and can be done at
any time**: nothing about entries depends on them, and until they are done `/nn/admin` answers
404 at every address, which is the correct state for a surface whose key nobody has installed.
[ADR-013](../../../docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md)
is the argument for two credentials rather than one.

> **The order is not arbitrary and steps 4 and 5 must be last.** Creating the Stripe endpoint
> before the Worker is deployed means Stripe posts into a 404 and marks the destination failing;
> creating it before the secrets are set means every early delivery 5xxs. Nothing is *lost*
> either way — Stripe retries for three days — but the dashboard fills with red for no reason.

**Member accounts add two more, and they are a different kind of secret.** Steps 9 and 10 are
**GitHub Actions repository secrets**, not Worker secrets — `env(...)` substitution in
`packages/db/supabase/config.toml` is read wherever `supabase config push` runs, which is
`deploy-db.yml`, not the Worker. [Decision 005 and ADR-015](../../../docs/decisions/decision-log.md#005--give-the-platform-member-accounts-on-supabase-auth)
record the choice. **Both are needed before their block is uncommented, not after** — the
Supabase CLI validates an `env(...)` substitution at startup, and an unset one breaks
`supabase start` outright. #49 turns on the parts of `[auth]` that need no secret —
`enable_signup`, email confirmation, a twelve-character minimum password; `[auth.captcha]`
and `[auth.external.google]` stay commented out until #53 and #56 need them and step 9 or
10 has actually been done.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _1. Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | _pending_ | See the settings below |
| _2. Set the Stripe secret key_ | A secret cannot live in the repository, and without it the entry form validates and stops | _pending_ | `npx wrangler secret put STRIPE_SECRET_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Use a **restricted** key with write on Checkout Sessions and read on Payment Intents — nothing here needs more. Test mode until the club is ready to take real money |
| _3. Set the entries webhook key, and install its digest_ | The function that writes `paid` is granted to `anon`, and the anon key is published in page source. **Two steps, and doing one without the other stops payments being recorded** | _pending_ | Generate one: `openssl rand -hex 32`. Then `npx wrangler secret put ENTRIES_WEBHOOK_KEY --env production --config apps/main/wrangler.jsonc`, and in the Supabase SQL editor: `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the key>','UTF8')),'hex'), updated_at = now() where name = 'stripe';` |
| _4. Set the webhook signing secret_ | The webhook has to prove a request came from Stripe | _pending_ | Create the endpoint in step 5 first if it does not exist; Stripe shows its signing secret once. Then `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production --config apps/main/wrangler.jsonc` |
| _5. Create the Stripe webhook endpoint_ | **Last, and only once the Worker is deployed.** Otherwise Stripe posts into a 404 | _pending_ | Stripe dashboard → Developers → Webhooks → Add endpoint. URL `https://new.southvillerunningclub.co.uk/nn/stripe-webhook`. Subscribe to **`checkout.session.completed` and `checkout.session.expired` and nothing else** — everything else is answered 200 and ignored, and subscribing to more is delivery volume for no benefit |
| _6. Set the admin key, and install its digest_ | **Independent of the five above, and it can be done at any time.** It switches `/nn/admin` on: until it is done that whole prefix 404s, which is the correct state rather than a broken one | _pending_ | The full procedure, including issuing a key to each volunteer, is [the admin runbook](../../../docs/delivery/runbooks/entries-admin.md). Two steps: `npx wrangler secret put ENTRIES_ADMIN_KEY --env production --config apps/main/wrangler.jsonc`, then `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the key>','UTF8')),'hex'), updated_at = now() where name = 'admin';` |
| _7. Issue a key to each volunteer_ | The Worker's key authorises the *Worker*; a per-person key is what says which human is looking, so an export can record who took it and one person can be revoked without revoking both | _pending_ | [The admin runbook](../../../docs/delivery/runbooks/entries-admin.md#step-2--issue-a-key-to-each-volunteer). One `insert` into `entries.admin_keys` per person, holding the digest and a **role handle rather than their name** |
| _8. Validate the four entries constraints_ | **Independent of every step above, and nothing is broken until it is done.** Slice G's check constraints shipped `NOT VALID`, so they enforce every new write but have never looked at the rows already there — because nobody here could see them, and a validated `ADD CONSTRAINT` fails the *migration* if one row disagrees, which fails the deploy for everything | _pending_ | [The constraints runbook](../../../docs/delivery/runbooks/entries-constraints.md). Step 1 is a read-only query that says whether step 2 will succeed; run it first and stop if any count is not zero, because a row that disagrees is evidence rather than a mess to tidy |
| _9. Set `SUPABASE_AUTH_CAPTCHA_SECRET`, before #53 uncomments `[auth.captcha]`_ | **A GitHub Actions repository secret, not a Worker secret** — `deploy-db.yml` runs `supabase config push` in Actions, and that is where `env(...)` substitution reads from. It has to exist **before** `[auth.captcha]` is uncommented: the CLI validates the substitution at startup, and an unset one breaks `supabase start` outright rather than shipping captcha silently off — confirmed while building #49, which is why that block shipped commented out until #53 | **Done**, 24 Aug 2026 | Repository → Settings → Secrets and variables → Actions → New repository secret, name `SUPABASE_AUTH_CAPTCHA_SECRET`, value the Turnstile **secret** key. The site key (`0x4AAAAAAEaeMm9jDSJB7Gqy`) is public and lives in `wrangler.jsonc`'s `env.production.vars` as `TURNSTILE_SITE_KEY`, #53 |
| _10. Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, before #56 uncomments `[auth.external.google]`_ | **Not consumed by anything until #56**, and the same startup-validation trap applies — set it before that block is uncommented, not after | _pending_ | Same place as step 9, name `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, value the OAuth client secret from the Google Cloud Console project #56 sets up |
| _11. Create the Cloudflare rate-limiting rules_ | **The platform has no rate limit of any kind today.** Sign-in is a credential check, `/account/reset/` mails an address the caller chooses, and `POST /nn/2026/` holds a place in a 250-runner field for 31 minutes — none of which is capped by anything deployed. A rule per IP at the edge is the only layer that sees the runner's real address, because every Supabase call this Worker makes is server-side | _pending_ | [The accounts-open runbook](../../../docs/delivery/runbooks/accounts-open.md), step 1, working from [the rules file](../../../docs/reference/cloudflare-waf-rules.md#the-rules). **Update that file's status column in a pull request afterwards** — a rule it does not know about is drift, exactly as a DNS record the zone file does not know about is drift |
| _12. Set `RESEND_API_KEY`, before #50's send code lands_ | **A Worker secret, same mechanism as Stripe's** — Resend authenticates over a plain HTTPS API, so this is the only credential the send path needs. Scope the key to **Sending access only** in Resend's dashboard, never full account access, so a leak can only send mail as the club rather than reconfigure the account or read logs | **Done**, 25 Aug 2026 | `send.southvillerunningclub.co.uk` verified in Resend (account, DNS records in Cloudflare, domain verification — see [the design doc](../../../docs/solutions/resend-programmatic-email.md#step-by-step-get-go-to-a-working-send)), then `npx wrangler secret put RESEND_API_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Local dev uses the same name in `apps/main/.dev.vars`, gitignored |

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
