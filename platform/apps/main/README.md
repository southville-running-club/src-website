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

**The two forms are on two pages.** The interest form is on `/nn/`, because registering an
interest is about the race; the entry form is on `/nn/2026/`, because an entry is an entry to
one running. The event row decides which state each page shows, per request. See
[the entry form](#the-entry-form) and
[ADR-009](../../../docs/architecture/decisions/adr-009-entries-in-apps-main.md).

## Layout

```
src/content/race.json          Every race fact, as data. See below
src/components/NnNav.astro     The two-level Nightingale Nightmare navigation
src/layouts/Base.astro         The document, and the optional `theme` prop
src/pages/index.astro          The holding page — new.<apex>/
src/pages/404.astro
src/pages/nn/index.astro       The race — evergreen, the interest form, no year
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
| `/nn/` | **The race — evergreen, and it names no year.** Carries the interest form, and takes its POST. The Worker paints on which running is current and where its pages are, from `entries.current_entry_state('nn')` — there is no year in this page's markup and there must never be one |
| `/nn/course/` | Course and terrain. **Evergreen**: the route, the ground and the headphone rule are the race's, not one running's |
| `/nn/privacy/` | What the club does with an entry and with a sign-up. **Written from the schema rather than from the form** — it lists what `entries.entry_purchases`, `entries.entrants` and `entries.entrant_medical` hold, which is four rows more than a list of what somebody types. **Evergreen, and site-wide in substance** — see [ADR-011](../../../docs/architecture/decisions/adr-011-a-race-and-its-runnings.md) for why it stays under `/nn/` for now |
| `/nn/2026/` | **The 2026 running.** The date, the facts, and **the entry form** — which posts here, because an entry is an entry to one running |
| `/nn/2026/race-day/` | Race day — race HQ, the schedule, the prizes |
| `/nn/2026/spectators/` | Watching the race — where to stand, where to park. **With the year**, because it is read alongside race day and names this year's HQ |
| `/nn/2026/entry/complete/` | Where Stripe returns somebody after the payment page. **It reports what the club has recorded and never what the redirect implies** — see [the return page](#the-return-page) |
| `/nn/stripe-webhook` | **Not a page.** A POST from Stripe, handled before the assets binding; a GET 404s. The only thing in this platform that records a payment — see [the webhook](#the-webhook) |

**`/nn/<year>/` is the event `nn-<year>`**, and that convention is the whole of the coupling
between a URL and a database row. It lives in `worker/routing.ts` as two functions that are
inverses of each other, tested as such — because two halves of one convention in two places is
where a convention drifts, and the symptom would be a Stripe return URL that 404s.

**The old addresses 404 and no redirect was added.** `/nn/race-day/`, `/nn/spectators/` and
`/nn/entry/complete/` existed only on this branch, only ever carried `noindex`, and were linked
from nothing outside the repository. `tests/worker/serves.test.ts` asserts the 404s.

### The navigation, on two levels

```
the race       Race · Course                    every Nightingale Nightmare page
the running    2026 · Race day · Spectators     year pages only
```

`src/components/NnNav.astro`. **It derives everything from `Astro.url.pathname`** — which page
is current, and which year the running row is about — because a prop is a second place to state
the same thing and a page that passes the wrong one renders a nav that lies with no other
symptom. No database, no rewriting, no script, which is what lets it be right on the content
pages the Worker never touches.

**An evergreen page shows only the race row**, because it cannot know which running is current
without asking. The cost is one extra tap through `/nn/`, and the alternatives are a database
call on every content-page view or a year written into a component.

`/nn/privacy/` is deliberately outside both rows: it is a legal notice reached from the forms,
and a nav with nothing marked current is worse than no nav.

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
| **The race's** | `name`, `distance`, `places`, `contact`, `privacy.*` — read by `/nn/`, `/nn/course/` and `/nn/privacy/` |
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
technique the health timestamp already uses — so there is one copy of the page, in `dist/`,
and no second template in the Worker to drift from it. The health and pipeline-check
handlers still run on those responses, deliberately: a 503 from the form beside a broken
database timestamp is a different problem from one beside a working timestamp.

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
| `/nn/` | The interest form, and a link to the running | "Entries are open", the loud button pointing at the form, and the interest form hidden |
| `/nn/2026/` | "Entries are not open yet", pointing back at the interest form | The entry form |

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
browser**. Client-side is a convenience; the Worker is the control.

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
migration, the route is code, and no variable was added — if a WAF rate-limiting rule is
put on `POST /nn/` later, *that* is a manual step and belongs here when it happens.

**Nor did the entry form.** The schema, the seeded event and its fees all ship as one
migration; the exposed-schema list is `config.toml`, which `deploy-db.yml` pushes.

**Stripe adds four, and they are manual by necessity.** A secret cannot be code, and neither can
the digest of one. They are listed below as pending because nothing has been set on the deployed
Worker yet — which is why production still shows "payment is not connected yet" rather than a
broken payment page.

> **The order is not arbitrary and steps 4 and 5 must be last.** Creating the Stripe endpoint
> before the Worker is deployed means Stripe posts into a 404 and marks the destination failing;
> creating it before the secrets are set means every early delivery 5xxs. Nothing is *lost*
> either way — Stripe retries for three days — but the dashboard fills with red for no reason.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _1. Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | _pending_ | See the settings below |
| _2. Set the Stripe secret key_ | A secret cannot live in the repository, and without it the entry form validates and stops | _pending_ | `npx wrangler secret put STRIPE_SECRET_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Use a **restricted** key with write on Checkout Sessions and read on Payment Intents — nothing here needs more. Test mode until the club is ready to take real money |
| _3. Set the entries webhook key, and install its digest_ | The function that writes `paid` is granted to `anon`, and the anon key is published in page source. **Two steps, and doing one without the other stops payments being recorded** | _pending_ | Generate one: `openssl rand -hex 32`. Then `npx wrangler secret put ENTRIES_WEBHOOK_KEY --env production --config apps/main/wrangler.jsonc`, and in the Supabase SQL editor: `update entries.webhook_secrets set key_sha256 = encode(sha256(convert_to('<the key>','UTF8')),'hex'), updated_at = now() where name = 'stripe';` |
| _4. Set the webhook signing secret_ | The webhook has to prove a request came from Stripe | _pending_ | Create the endpoint in step 5 first if it does not exist; Stripe shows its signing secret once. Then `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production --config apps/main/wrangler.jsonc` |
| _5. Create the Stripe webhook endpoint_ | **Last, and only once the Worker is deployed.** Otherwise Stripe posts into a 404 | _pending_ | Stripe dashboard → Developers → Webhooks → Add endpoint. URL `https://new.southvillerunningclub.co.uk/nn/stripe-webhook`. Subscribe to **`checkout.session.completed` and `checkout.session.expired` and nothing else** — everything else is answered 200 and ignored, and subscribing to more is delivery volume for no benefit |

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
