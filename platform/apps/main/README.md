# `apps/main` — the club website, and Nightingale Nightmare under `/nn`

Static Astro plus one Worker, serving `new.southvillerunningclub.co.uk`. At the Squarespace
cutover the hostname changes and nothing else does —
[ADR-007](../../../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).

A holding page saying a new site is coming, **five Nightingale Nightmare pages** — the race
page and its two forms, three content pages, and the privacy notice those forms are required
to have — and a timestamp fetched from Postgres by the Worker while it serves the request.

**`/nn/` carries two forms and shows one.** The entry form when the event row says entries
are open, the interest form otherwise; the Worker decides per request. See
[the entry form](#the-entry-form) and
[ADR-009](../../../docs/architecture/decisions/adr-009-entries-in-apps-main.md).

## Layout

```
src/content/race.json          Every race fact, as data. See below
src/components/NnNav.astro     The four-page Nightingale Nightmare navigation
src/layouts/Base.astro         The document, and the optional `theme` prop
src/pages/index.astro          The holding page — new.<apex>/
src/pages/404.astro
src/pages/nn/index.astro       Nightingale Nightmare, the facts, and both forms
src/components/NnEntryForm.astro  The entry form, and its progressive enhancement
src/pages/nn/course.astro      Course and terrain
src/pages/nn/race-day.astro    Race day — HQ, the morning in order, prizes
src/pages/nn/spectators.astro  Watching the race
src/pages/nn/privacy.astro     What the club does with a sign-up
src/pages/nn/entry/complete.astro  Where Stripe sends somebody back to
worker/routing.ts              Which paths belong to whom. Pure and tested
worker/index.ts                Forward /timing locally, take the POST, fill in the
                               timestamp, and sweep lapsed holds on a cron
worker/nn-signup.ts            Validate a sign-up, record it, and render the outcome
worker/nn-entry.ts             Decide which form to show; take an entry to Stripe
worker/stripe.ts               One Checkout call, over fetch, with no SDK
```

## The routes

| | |
| --- | --- |
| `/nn/` | The race, the facts, and **whichever of the two forms applies**. **The only one the Worker does anything to** — it decides which form to show, takes the POST here, and reveals the acknowledgement on `?signup=ok` |
| `/nn/course/` | Course and terrain |
| `/nn/race-day/` | Race day — race HQ, the schedule, the prizes |
| `/nn/spectators/` | Watching the race — where to stand, where to park |
| `/nn/privacy/` | What the club does with a sign-up |
| `/nn/entry/complete/` | Where Stripe returns somebody after the payment page. **It never says an entry succeeded** — see [the return page](#the-return-page) |

The first four carry `src/components/NnNav.astro`, which links them and marks the current
one with `aria-current="page"`. **It derives the current page from `Astro.url.pathname`
rather than taking a prop**, because a prop is a second place to state the same thing and a
page that passes the wrong one renders a nav that lies with no other symptom.

`/nn/privacy/` is deliberately outside that nav: it is a legal notice reached from the form,
it has no entry in the four, and a nav with nothing marked current is worse than no nav.

## Where race facts live

**`src/content/race.json` holds every fact, and the pages hold none of them.** Prose is the
page's; a value is the file's — a date, a time, a distance, an address, a postcode, a count,
a schedule row, a prize category. The committee edits one file.

**It was tested by exactly the thing it was built for.** The race date was confirmed on
12 August 2026, and landing it was a one-line edit with **no change to any page**: the date
line, the facts list and three content pages all picked it up without a line of markup
moving.

**A `null` is a fact nobody has confirmed, and it renders as "To be confirmed"** rather than
as a blank or an invention. Three still are, and each for a different reason:

| | |
| --- | --- |
| `price`, `entriesOpen` | **The database's, not this file's.** Fees live in `entries.fees.price_pence` and the window in `entries.events`, and the Worker paints them onto the entry form. These two `race.json` keys stay `null` and render "To be confirmed": duplicating a price into a content file is how two numbers start disagreeing. The transfer deadline and live capacity are undecided and have no field at all |
| `permit` | **The 2026 ARC permit number has not been issued.** The 2023 number is on record and is not a stand-in for it — it would read as a claim that this year's race is permitted |
| `privacy.*` | The controller, the removal address and the retention period. A wrong answer on that page is a legal claim rather than a typo |

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

**`/nn/` carries two forms and reveals one.** Which one is decided by `entries.events` —
`entries_open_at` and `entries_close_at` — read through `entries.entry_state()` on every
request. **Opening entries is a row edit, not a deploy**, which is the whole point of the
event table: nobody has to be free to push a commit at seven in the morning.

`entries_open_at` is `null` today, because the opening time has not been decided. That reads
as `pre_open`, and `pre_open` shows the interest form — the page that was already here.

**Every failure resolves to the interest form.** Migration not landed, database unreachable,
function returning a shape that does not parse: all of them show the form that takes no
money. A page that cannot tell whether entries are open must not offer to take one, and that
matters more once a card payment is on the end of it.

### What happens to a good entry

**It holds a place and goes to Stripe.** In one database transaction,
`entries.create_pending_purchase()` re-checks the window, takes a per-event lock, counts the
places already gone, prices the entry from `entries.fees`, and writes a `pending` purchase
with a **31-minute hold**. The Worker then creates a Checkout session for exactly that amount
and `303`s to it.

**Nothing here moves a purchase to `paid`.** The redirect back from Stripe is not proof of
payment — a person can close the tab before it fires, and the return URL is one anybody can
type. Confirmation is the webhook's job, and building any part of it alongside this would
give two things an opinion about whether somebody had paid.

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

### The return page

`/nn/entry/complete/` is where Stripe sends somebody afterwards, and **it must never say an
entry succeeded**. Three reasons, any one of which is enough:

1. the redirect fires in the person's browser, and a closed tab means it never fires while
   the payment may still have gone through;
2. it is an ordinary URL that anybody can type, and the acceptance suite does exactly that
   with a session id matching nothing;
3. Stripe confirms a payment to the **webhook**, server to server, which is the only channel
   that cannot be forged or lost in a tab.

So it says what the club is doing and what will happen next. **There is a marked TODO in the
page for Slice C** to render the real state — paid, still confirming, or a session that means
nothing — and the hooks are deliberately not stubbed in, because an attribute with nothing
reading it is a hook somebody trusts before it works.

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
| **The England Athletics box is always in the DOM** | Inside the affiliated card. JavaScript hides it when another type is chosen; the *server* decides whether it had to be filled in |
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
| http://localhost:8787/nn/ | Nightingale Nightmare | this Worker |
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

`/nn/` shows the interest form until the event row says otherwise, which is what production
does. To see the entry form, open the window:

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

### Three worker-test runs, and why

`npm run test:worker` runs **three** Vitest configs, each against one fixed state: the default
one against the seeded closed window, `vitest.worker.entries-open.config.ts` against an open
one, and `vitest.worker.sold-out.config.ts` against a race with no places left.

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
| `STRIPE_API_BASE` | Local only, and only so the site runs end to end against the stub without a Stripe account. Passed on the `wrangler dev` command line — there is no path from a dev-server flag to a deployed Worker |
| `apps/main/.dev.vars` | Gitignored. The one place a real key belongs on a machine, and `wrangler dev` reads it automatically |

`tests/unit/worker-config.test.ts` asserts that **neither block of `wrangler.jsonc` mentions
Stripe at all**, and that nothing in the file looks like a key of any kind. A secret that was
ever committed is compromised and has to be **rotated**, not deleted, so the guard is a red
pipeline rather than a code review.

**The service role key is still not on any list, and the webhook does not change that.**
Slice C's privileged writes are a decision of their own; they are not a reason to put a
service role key anywhere a browser or this repository can reach.

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

**Stripe adds one, and it is manual by necessity.** A secret cannot be code. It is listed
below as pending because nothing has been set on the deployed Worker yet — which is why
production still shows "payment is not connected yet" rather than a broken payment page.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | _pending_ | See the settings below |
| _Set the Stripe secret key_ | A secret cannot live in the repository, and without it the entry form validates and stops | _pending_ | `npx wrangler secret put STRIPE_SECRET_KEY --env production --config apps/main/wrangler.jsonc`, from `platform/`. Use a **restricted** key with write on Checkout Sessions and read on Payment Intents — nothing here needs more. Test mode until the club is ready to take real money |
| _Set the webhook signing secret_ | Slice C's webhook has to prove a request came from Stripe | **not yet — Slice C.** It needs the production URL to create the endpoint, so it cannot be done before the Worker is deployed | — |

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
