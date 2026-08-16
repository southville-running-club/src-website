# Working in this repository

The Southville Running Club platform. Two volunteers with day jobs maintain all of it, and
that single fact decides most of what follows.

---

## Before anything else

**Read [`docs/architecture/principles.md`](docs/architecture/principles.md).** It is short,
it is the part that is not under discussion, and it ends with the triggers that mean *stop
and ask a human*. Everything below assumes it.

Then, if you are writing code, [`platform/README.md`](platform/README.md).

---

## Stop and ask — do not resolve these by inference

These end the task. Say what you have found and wait. Guessing is worse than pausing,
because a wrong guess here is expensive in money, in law, or in a race that cannot be
re-run.

- **A factual claim about a race** that has not been supplied — date, price, distance,
  location, start time. The Nightingale Nightmare date *is* confirmed — **Sunday 1 November
  2026, start 11:00** — along with the distance, the race HQ, the schedule, the prizes and
  the spectating points; all of them live in `apps/main/src/content/race.json`. **The entry
  fees are confirmed too** — £15 affiliated, £17 unaffiliated, £0 for a visually impaired
  runner's guide — and they live in `entries.fees`, never in markup. **So is the minimum age:
  18 on race day**, in `entries.events.minimum_age`. **Still unconfirmed, and none of them may
  appear anywhere:** the 2026 ARC permit number (the 2023 number is not a substitute), the
  2026 race director's name, the entry open and close times, and the transfer deadline. Do not
  invent a fact, do not infer one from a phase document, and do not put a plausible
  placeholder in markup.
- **Collecting a field beyond what is already specified.** Adding a database column that
  holds personal data is a committee decision. The committee has settled the *entry* field
  list — it is `packages/shared/src/nn-entry.ts` — and a fifteenth field is a new decision.
- **The privacy notice's four open decisions**, in `race.json`'s `privacy` key and `null`
  there: who somebody writes to about their data, how long an entry record is kept, whether
  an email address is kept to tell people about next year's race, and what is true about
  photographs. They render "To be confirmed by the club" and `nn-privacy.spec.ts` counts
  them. **Settled, and written in:** the controller, the registered office, the company
  number, and one month for medical notes. **What the notice says is collected comes from
  the schema, not from the form** — the entry tables also hold the fee and amount, Stripe's
  references, the consents with their version, and three timestamps, and a notice that omits
  those under-lists what the club processes.
- **Taking payment and confirming it are both connected, and neither is a stop-and-ask any
  more.** A valid entry holds a place and goes to Stripe Checkout; the webhook at
  `POST /nn/stripe-webhook` is what moves a purchase to `paid`, and it is the only thing that
  may. **Three Worker secrets** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
  `ENTRIES_WEBHOOK_KEY` — never in this repository, never in `wrangler.jsonc`, never in a `vars`
  block. A real key on a machine belongs in `apps/main/.dev.vars`, which is gitignored.
  **Registering the Stripe dashboard endpoint is still a human's job**, and it is the last of
  the manual steps in `apps/main/README.md` because it needs the production URL.
- **Any DNS change that is not an additive record.**
- **Anything that would need the Supabase service role key.** If a build appears to want
  one, the row-level security policy is wrong and *that* is the thing to fix.
- **Any change touching the timing platform** — `src-race-timing`, or the `public` and
  `private` schemas.
- **Anything that would put a credential in the repository.**
- **Changing `[auth]` in `packages/db/supabase/config.toml`.** It ships to production on
  every merge that touches a migration, and `enable_signup` is off because member-facing
  authentication is not yet a decided requirement.
- Discovering that a **free tier's terms differ** from what is recorded.

---

## The shape of the place

```
docs/         Documentation. The root is documentation; nothing builds here
platform/     The npm workspace — apps/, packages/, all tooling
dev           The one command for local work. Run it from the root
```

**`npm` at the repository root will fail.** There is no `package.json` there, deliberately.
Use `./dev`, or `cd platform` first.

```bash
./dev up      # rebuild the database, then the whole site on http://localhost:8787
              # --keep-data skips the rebuild, when the schema is already current
./dev test    # the Worker and acceptance tests, then everything stopped
./dev check   # rebuild the database, then lint, types, unit and database tests
./dev down    # stop the Workers and the database
```

**`up`, `test` and `check` all rebuild the database**, because `supabase start` applies
migrations only to a volume it creates — so on any machine that has run this before, the three
otherwise meant three different schemas. It costs tens of seconds and the local data, which is
only ever the seed and invented fixtures.

One hostname, three paths — the same locally and in production:

| | |
| --- | --- |
| `/` | The club website — `apps/main` |
| `/nn` | Nightingale Nightmare — `apps/main` |
| `/timing` | Race timing — `apps/timing`, a different Worker |

---

## Non-negotiable

Breaking one of these is a defect, not a judgement call. The full reasoning is in
[principles](docs/architecture/principles.md); this is the short list.

**Row-level security is the access control.** There is no API tier between the browser and
Postgres. RLS on every table from its first migration, no exceptions, no "we will add it
later". The anon key is public and belongs in client code; the service role key never
reaches a browser, a Worker, or this repository.

**Timestamps are stored UTC and displayed `Europe/London`**, through
`packages/shared/src/london-time.ts` and nothing else. ESLint bans bare `toLocale*String`
repository-wide. Nightingale Nightmare is raced the weekend after the clocks change; an
hour of drift is a real foot-gun, not a theoretical one.

**Personal data is minimised at the boundary.** Sensitive fields are dropped *before* they
reach the database, never stored and filtered later. Date of birth becomes a computed age.

**Expand, migrate, contract.** Every schema change keeps the previously deployed code
working. Roll code back; roll schema forward. This is load-bearing rather than good
practice here — nothing sequences the migration against the Cloudflare deploy.

**The timing platform is not touched by website work.** Not its tables, not its policies,
not its repository, until the port happens deliberately. That includes the `private` schema,
which is why `entries`' one helper function lives in `entries` with a pinned `search_path`
rather than where the timing platform keeps its own.

**Zero accessibility violations**, not "few". Any threshold above zero becomes the new
normal within a month.

---

## How to work here

**Run local tests and CI/pipeline checks through a Haiku subagent, not the main session.**
When a task needs `./dev check`, `./dev test`, or a look at a GitHub Actions run (`gh run
list` / `gh run view --log-failed`), spawn it as a background `Agent` call with
`model: "haiku"` rather than running it inline or in the main model. Have that agent report
only a terse pass/fail summary — failing step/test names and error snippets, not full logs —
so the expensive raw output never reaches the main session's context. Do this automatically,
without asking first; it is a standing instruction, not a per-task choice.

**Every change by pull request.** Both volunteers review.

**One change per pull request, and since 15 August 2026 that is mechanical rather than
tidiness.** The repository is **squash-only**, so every commit in a branch collapses into one
on `main`. Two unrelated things in one pull request become one commit that cannot be reverted
or bisected apart afterwards, and a careful commit-by-commit branch arrives as a single entry —
so **the reasoning belongs in the pull request body and the commit message, not in the shape of
the branch.** Settings and the full trade are in
[the GitHub runbook](docs/delivery/runbooks/github-setup.md#3b-merge-behaviour--squash-only).

**Documentation ships with the change it describes**, not afterwards. If you change
behaviour that a README or ADR describes, change it in the same commit. A document that is
wrong is worse than one that is missing, because it is trusted.

**Never edit an accepted ADR to change its answer.** Write a new one that supersedes it and
say what it replaces. The history of a choice that turned out badly is worth more than a
tidy file.

**Use [the glossary](docs/foundations/glossary.md)'s words exactly.** An *event* is one
running of one race in one year; a *race* is the recurring thing; a *team* is the unit of
entry even when it holds one runner. Getting this wrong in a schema is expensive.

**Any step done by hand is written down** — what, why, by whom, and how to redo it. That is
what makes the manual exceptions legitimate rather than merely convenient.

**Boring beats optimal.** Every unusual choice is a tax on somebody who has not been hired.
If you reach for a tool because it is better, check first whether the mainstream one is
good enough — it usually is, and a third volunteer will already know it.

**Markdown wraps at roughly 90 characters.** Tables and URLs excepted.

### Writing tests

Four layers, and each tests something the layer below cannot: unit, database against a real
Postgres, the Workers runtime via Miniflare, and Playwright with axe.

**`./dev check` runs the first two; `./dev test` runs the other two** — the Miniflare layer
needs a build, which is why it waits for `test` rather than `check`. Between them the two
commands run every layer CI does, which was not true until a green laptop sent a red pull
request.

**The negative case is usually the one that matters.** That an anonymous client *cannot*
read `club` proves more than that a member can. Assert the specific error, not merely that
something failed — a test that passes because the table does not exist yet is a test that
has stopped testing.

**Fixtures are deterministic and invented.** Fixed UUIDs, fixed timestamps, addresses at
`example.com`. No production data on a laptop, ever. Include the awkward states — consent
withheld, an apostrophe in a name, the repeated hour on the clocks-change weekend — because
those are what break rendering.

---

## Traps that have already cost time

Each of these cost an hour or more, and none is obvious from the outside.

**`opennextjs-cloudflare build` runs one of `apps/timing`'s own npm scripts.** Naming that
script `opennextjs-cloudflare build` makes it invoke itself. It recursed 205 levels and took
a laptop down. `build:next` exists solely to be what OpenNext calls, and the duplication is
the guard.

**A leading underscore on an App Router folder silently deletes the route.** `_health/` is the
conventional spelling for an endpoint that is not a page on more or less every other platform,
and in `apps/timing` it is a **private folder**: Next opts it out of routing entirely, so
`app/_health/route.ts` builds clean, deploys clean, and 404s — with nothing anywhere saying
why. The timing app's health endpoint is `app/health/route.ts` for that reason, and the comment
at the top of it says so. `apps/main` is Astro plus a Worker and has no such rule, which is
what makes the pair easy to get wrong: the same name is fine on one side of the hostname and
invisible on the other.

**So the two health endpoints are spelled differently on purpose** — `/_health` in `apps/main`
and `/timing/health` in `apps/timing` — and **the underscore on the Astro side is load-bearing
too, for the opposite reason.** `trailingSlash` is `'always'`, so a page at
`src/pages/health.astro` would serve at `/health/` while the Worker went on answering
`/health`, because it matches before the assets binding. Two live addresses one character
apart, no error and no failing test, and a runner looking for the club's advice on training
gets a database report. This is a running club; `/health/` is a page somebody will want.

**An ambient `NODE_ENV=development` breaks the Next.js build**, reporting it as
`Cannot read properties of null (reading 'useContext')` while prerendering a page nobody
wrote. Every build script pins `NODE_ENV=production`.

**Two copies of React or Next in the workspace break the build** in ways that read as
application bugs. After changing a version, `npm dedupe` and check there is one copy.

**Keep `routes` under `env.production`.** At the top level, `wrangler dev` rewrites
`request.url` to the custom domain and a plain `wrangler deploy` would put localhost config
on a live hostname.

**`TIMING_ORIGIN` must never appear in `env.production`.** Its absence is what makes
`/timing` Cloudflare's job at the edge rather than an extra proxy hop.

**Detach background servers properly** — `nohup`, redirected streams, closed stdin. A child
holding the terminal makes the parent never return.

**A CSS `@view-transition` breaks the sign-up form with JavaScript disabled.** Four lines,
no JavaScript, and after the form's POST/422 the `::view-transition` overlay swallows the
click on the error summary's link — silently, so the person just finds that nothing happens.
Reproduced 5/5, gone 3/3 with the rule removed, and it passes with scripting *on*, which is
what makes it easy to ship. `nn-signup.spec.ts`'s "links from the summary to the field it is
about" is the guard. Full note at the foot of `packages/shared/styles/nn-theme.css`.

**A message that appears on `focusout` can swallow the click that caused it.** The England
Athletics box is a `.field` *inside* the affiliated `.nn-fee` card, so `fieldOf` — which took
`closest(container)` and then the first `[data-entry-error]` beneath it — answered `eaNumber`
for the affiliated **radio**. Leaving that radio made the England Athletics box complain about
a number nobody had been asked for, and it did so *between the press and the release of the
click*: 67px of message, above the other two cards, pushing them 72px down out from under the
pointer, so no `click` ever reached the radio and **the entry type could not be changed at
all**. **Only CI saw it, and that is the trap** — macOS and iOS WebKit leave a radio unfocused
when it is clicked, while the GTK/WPE WebKit that `playwright install webkit` puts on a Linux
runner focuses it, so `focusout` never fires on a laptop. Chromium at 1280px survives on luck:
the shift is small enough that the release still lands on the card's own `<label>`, which
forwards the click. Reproduced on Linux WebKit in `mcr.microsoft.com/playwright:v1.62.1-noble`
and in Chromium at 320px. `nn-entry.spec.ts`'s "shows a running total once an entry type is
chosen" is the guard, and the rule is the general one: **a container's message belongs to that
container, not to a field nested inside it.**

**A conditional field that collapses moves the control that revealed it.** The same England
Athletics box, the same nesting, one layer up: it sat *inside* the affiliated card, so changing
to another entry type collapsed 277px from **above** the two cards below it. At 320px the card
somebody had just chosen went from y=271 to y=-7 — they tapped it, and the feedback for their
own tap was the page throwing them somewhere else. It is a plain `.field` under all three cards
now, where showing and hiding it moves only what is below and the cards do not move at all:
measured Δ0 in WebKit and Δ1px in Chromium — a pre-existing sub-pixel border swap — across all
48 combinations of engine, width, transition and input method. **Put a conditional field after
the group it is a condition of, rather than inside it.** The adjacency that buys is worth less
than the stability it costs, and the field's own hint can say what the nesting was saying.
`nn-entry.spec.ts`'s "keeps the entry type that was chosen in view when the fee changes" is the
guard, and it runs in all three projects.

---

## What is not built yet

So you do not go looking for it, or assume it is missing by mistake: there is **no confirmation
email and no timing application code**.

**A race is the recurring thing; an event is one running of it in one year, and the routes say
so** — [ADR-011](docs/architecture/decisions/adr-011-a-race-and-its-runnings.md). Evergreen:
`/nn/` (the race, and the interest form), `/nn/course/`, `/nn/privacy/`. The 2026 running:
`/nn/2026/` (the date, the facts, the entry form), `/nn/2026/race-day/`,
`/nn/2026/spectators/`, `/nn/2026/entry/complete/`. Plus a column-scoped anonymous-insert
policy on `intake.nn_interest`.

**`/nn/` never names a year, and nothing in its markup may.** It asks
`entries.current_entry_state('nn')` — the forthcoming running of race `nn`, else the most
recent past one — and the Worker paints every link to a year page onto it. Publishing 2027 is a
row in `entries.events` plus that year's content pages, with no edit to `/nn/` and none to the
Worker. `/nn/<year>/` is the event `nn-<year>`, and `worker/routing.ts` owns that convention as
two functions that are inverses of each other.

**Entries are built here, in `apps/main`** — [ADR-009](docs/architecture/decisions/adr-009-entries-in-apps-main.md)
retired the plan to give them a repository of their own. **The two forms are on two pages**,
and the address a submission arrives at is what tells them apart — there is no hidden `form`
field any more. Each page carries two states and the Worker reveals one, decided per request
rather than by a deploy. `entries.events.entries_open_at` is `null` today, so production serves
the interest form on `/nn/` and "entries are not open yet" on `/nn/2026/`.

**A valid entry holds a place and goes to Stripe Checkout.** One transaction under a
per-event advisory lock: re-check the window, count the places gone, price it from
`entries.fees`, write a `pending` purchase with a 31-minute hold. Then a Checkout session for
exactly that amount and a 303 to it.

**`POST /nn/stripe-webhook` is the only thing that writes `paid`, and nothing else may.** The
redirect back from Stripe is not proof of payment — a tab can be closed before it fires, and the
return URL is one anybody can type. The webhook verifies Stripe's signature over the **raw
bytes** before parsing them, and the transition is idempotent by state guard under the same
per-event advisory lock the entry path takes. [ADR-010](docs/architecture/decisions/adr-010-webhook-writes-paid.md)
records the three decisions it took.

**The failure direction is inverted there, and only there.** Everything else in this repository
fails towards taking no money. By the time the webhook runs, the money has gone — so *our*
failures answer 5xx and let Stripe retry for three days, and only "this is not Stripe" gets a
400. A 200 on an outage drops a real payment.

**A payment that arrives after the hold lapsed is still `paid`.** It is never refused. If there
was no room it is `paid` with `attention = 'over_capacity'`, it consumes a place, and the
five-minute cron shouts about it until a human clears the flag —
[the runbook](docs/delivery/runbooks/entries-attention.md). There is deliberately **no fifth
status**: the capacity predicate counts `status = 'paid'`, and a new value would be invisible to
it and let an oversold place be sold twice.

**`/nn/<year>/entry/complete/` reports what the club has recorded, and only `paid` makes a
positive claim.** No state ever makes a negative one — a lapsed hold must never say "nothing was
charged", because the webhook may simply be late and somebody who believes it pays twice.

**The anon role still holds no grant on any table in `entries`.** It may call seven functions
and nothing else: `entry_state()`, `current_entry_state()`, `create_pending_purchase()`,
`expire_pending_holds()`, `attach_checkout_session()`, `record_checkout_event()` and
`entry_completion_state()`. An eighth, `raise_attention()`, is granted to **nobody**.
`packages/db/tests/entries.test.ts` asserts that exact set; if it fails, something granted a
privilege to a key that is published in page source. **Adding to that list is a decision, and
the test is what forces it to be made in a diff** — `current_entry_state()` is the one time it
has happened, and it discloses nothing `entry_state()` does not.

**`record_checkout_event()` takes a key, and it is the one function that does.** Without it two
ordinary PostgREST calls with the published anon key would buy a free entry, because
`create_pending_purchase()` issues purchase ids on request. `ENTRIES_WEBHOOK_KEY` is a **Worker
secret**; the database holds only its SHA-256 digest, and it ships null, which refuses
everything.

**A free place cannot be completed**, and it is the one gap somebody meets. Stripe refuses a
zero-total Checkout session, so a visually impaired runner's guide is told so plainly and
given the race address. Fixing it means deciding that an unpaid entry counts as paid, which
is a committee decision rather than a build one.

The current state, and what is deliberately deferred, is in
[the phases](docs/delivery/phases.md).
