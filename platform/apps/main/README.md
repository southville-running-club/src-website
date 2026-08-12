# `apps/main` — the club website, and Nightingale Nightmare under `/nn`

Static Astro plus one Worker, serving `new.southvillerunningclub.co.uk`. At the Squarespace
cutover the hostname changes and nothing else does —
[ADR-007](../../../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).

A holding page saying a new site is coming, **five Nightingale Nightmare pages** — the race
page and its sign-up form, three content pages, and the privacy notice that form is required
to have — and a timestamp fetched from Postgres by the Worker while it serves the request.

## Layout

```
src/content/race.json          Every race fact, as data. See below
src/components/NnNav.astro     The four-page Nightingale Nightmare navigation
src/layouts/Base.astro         The document, and the optional `theme` prop
src/pages/index.astro          The holding page — new.<apex>/
src/pages/404.astro
src/pages/nn/index.astro       Nightingale Nightmare, the facts, and the sign-up form
src/pages/nn/course.astro      Course and terrain
src/pages/nn/race-day.astro    Race day — HQ, the morning in order, prizes
src/pages/nn/spectators.astro  Watching the race
src/pages/nn/privacy.astro     What the club does with a sign-up
worker/routing.ts              Which paths belong to whom. Pure and tested
worker/index.ts                Forward /timing locally, take the POST, fill in the timestamp
worker/nn-signup.ts            Validate a sign-up, record it, and render the outcome
```

## The routes

| | |
| --- | --- |
| `/nn/` | The race, the facts, and the sign-up form. **The only one the Worker does anything to** — it takes the POST here and reveals the acknowledgement on `?signup=ok` |
| `/nn/course/` | Course and terrain |
| `/nn/race-day/` | Race day — race HQ, the schedule, the prizes |
| `/nn/spectators/` | Watching the race — where to stand, where to park |
| `/nn/privacy/` | What the club does with a sign-up |

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
| `price`, `entriesOpen` | **The entries application's, not this site's.** So are the transfer deadline and live capacity, which is why there is no field for either. This site does not quote a figure it does not own |
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

**No further variable should be needed.** If the build appears to want a service role key,
the row-level security policy is wrong and that is the thing to fix.

## Manual steps

The [accepted exception](../../../docs/foundations/requirements.md#everything-is-defined-as-code)
to everything-as-code: what was done, why, by whom, and how to redo it. The full procedure
is the [Cloudflare runbook](../../../docs/delivery/runbooks/cloudflare-setup.md).

**The hostname is not on this list.** It is the `routes` entry in `wrangler.jsonc`, and
Cloudflare creates the DNS record and issues the certificate from it.

**The sign-up form added nothing to this list either.** The grant and the policy ship as a
migration, the route is code, and no variable was added — if a WAF rate-limiting rule is
put on `POST /nn/` later, *that* is a manual step and belongs here when it happens.

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Worker and connect Workers Builds_ | Git integration needs no API token in CI, so there is no deploy credential to leak | _pending_ | See the settings below |

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
