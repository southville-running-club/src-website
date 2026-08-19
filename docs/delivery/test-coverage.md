# Test coverage — where it stands, and what is still open

Measured on 19 August 2026, against `main` at `a8046f2`.

This began as an assessment of the four test layers. The gaps it found are closed in the same
change, so it now reads as both: what each layer reaches, what was added, and the three things
deliberately left open with the argument for each.

---

## What a coverage number is allowed to mean here

Four layers test this platform, and each tests something the layer below cannot: unit, the
database against a real Postgres, the Workers runtime via Miniflare, and Playwright with axe.
**Three of those four run in a process the coverage provider cannot instrument.** The database
tests reach Postgres over the wire, the Worker tests run inside `workerd`, and Playwright
drives a browser.

So the number below is **the share of pure logic reached by pure tests**, and nothing wider. A
file at 0% here is not necessarily untested — it may be thoroughly proven by 188 Miniflare
tests. That is why `platform/vitest.config.ts` names the included files one by one instead of
pointing at `src/**`: a module deliberately proven at another layer would otherwise sit at zero
and drag the figure down, and the only way to move it would be to write a worse test at the
wrong layer.

The exclusion list in that file is the honest part of this. Read it before quoting a number.

---

## The estate as it stands

| Layer | Where | Declared | What it runs against |
| --- | --- | --- | --- |
| Unit | `*/tests/unit/**` | 338 (459 executed) | Node, TZ pinned UTC |
| Database | `packages/db/tests/**` | 230 | A real local Postgres |
| Functional | `apps/main/tests/worker/**` | 188 | `workerd` via Miniflare, on the real build |
| Acceptance | `apps/main/tests/e2e/**` | 174 × 3 projects | Chromium, WebKit, and Chromium with no JavaScript |
| Smoke | `platform/scripts/smoke.mjs` | 12 checks | The deployed platform, on the real hostname |

Declared counts are `test(`/`it(` declarations; the unit runner executes 459 of them because
several are table-driven. The acceptance suite skips its `@requires-js` axe tests in the
no-JavaScript project.

---

## Unit coverage

`npm run test:coverage`. **88.3% statements, 84.1% branches, 91.9% functions, 88.4% lines** —
up from 67.6 / 59.6 / 71.0 / 67.7 before this change.

| File | Lines | Functions | Branches | |
| --- | --- | --- | --- | --- |
| `worker/routing.ts` | 100% | 100% | 100% | was 76 / 75 / 56 |
| `worker/stripe-signature.ts` | 100% | 100% | 100% | |
| `worker/html.ts` | 100% | 100% | 93.3% | was 80% branches |
| `worker/admin-session.ts` | 97.7% | 100% | 91.7% | |
| `worker/stripe.ts` | 75.0% | 75.0% | 55.6% | **left open — see below** |
| `shared/contrast.ts` | 100% | 100% | 100% | was 61 / 57 / 33 |
| `shared/entry-confirmation.ts` | 100% | 100% | 96.9% | was 20 / 0 / 0 |
| `shared/health-report.ts` | 100% | 100% | 100% | was excluded, then 0% |
| `shared/csv.ts` | 100% | 100% | 100% | |
| `shared/nn-signup.ts` | 100% | 100% | 92.3% | |
| `shared/medical-retention.ts` | 100% | 100% | 90.9% | |
| `shared/nn-entry.ts` | 96.9% | 100% | 93.8% | |
| `shared/london-time.ts` | 95.0% | 100% | 75.0% | |
| `shared/admin.ts` | 94.7% | 100% | 80.6% | was 12.8 / 0 / 0 |
| `shared/age-category.ts` | 94.1% | 90% | 93.9% | |
| `shared/entry-state.ts` | 38.5% | 42.9% | 28.6% | **left open — see below** |
| `shared/entry-purchase.ts` | 12.5% | 25.0% | 0% | **left open — see below** |

`brand.ts` and `social.ts` are constant tables at 100%.

---

## What was added, and why each earns its place

### `packages/shared/src/admin.ts` — 12.8% to 94.7%, and 0 to 100% of its functions

The largest module in the workspace outside the Worker's route handlers, and no unit test
imported it. Its happy path was already well proven — `apps/main/tests/worker/admin/` drives it
through the real runtime and `packages/db/tests/entries-admin.test.ts` proves the five RPCs
underneath. **What was proven nowhere was its failure behaviour, and that is most of what the
file is made of.**

Three paths in particular, each deliberate and each unreachable from a database that works:

- **`readEnvelope()` classifies an RPC reply** into `unavailable`, `unauthorised` or
  `not-found`. A real database can produce `unauthorised`. It cannot produce
  "`admin_sign_in` returned an unexpected shape", which is the branch deciding whether a broken
  deploy shows a volunteer a message or a stack trace.
- **`entryShape.status` is `z.enum(ENTRY_STATUSES).catch('pending')`** — a fifth status added by
  a migration must degrade to a row that renders.
- **`hold_expires_at` is `.nullable().optional()`** — a database predating the figures
  migration must not take the page down.

These are the [expand-migrate-contract](../architecture/principles.md#expand-migrate-contract)
guarantee written as code. Proving it needs a hand-made payload, which is a unit test and
cannot be anything else.

The distinction the new tests are built around: **`unavailable` is not an empty list.** On a
page an organiser uses to decide how many bibs to set out, "the club has no entries" and "the
question could not be asked" must never render as the same thing. `readFigures` returning
`null` rather than a block of zeroes is the same decision one level down, and is now pinned.

### `packages/shared/src/entry-confirmation.ts` — 0 to 100% of its functions

The classification behind `/nn/<year>/entry/complete/` and the webhook. The tests are organised
around the distinction the module exists for, which is invisible from either side:

- `recorded` with `ok: false` — the database answered. The question is settled.
- `unavailable` — the question could **not** be asked. Nothing was written, and the caller owes
  Stripe a retry.

A parse that collapsed the second into the first would answer 200 to a payment nobody recorded.
This is the one place in the repository where failure is inverted — by the time the code runs
the money has gone — so it is the one place where a defensive 5xx is the *safe* answer.

**One finding came out of writing these**, and it is recorded as a test rather than changed:
`completionShape`'s `.catch('unknown')` sits on the enum rather than on the object, so a reply
that is an object but carries no `state` key parses *successfully* at `unknown` rather than
failing. Only a reply that is not an object at all fails the shape. That is the right way round
for this page — both readings claim nothing — but moving the `.catch()` up would silently
change it, so there is now a test saying so.

### `apps/main/worker/routing.ts` — 76% to 100%, all three branches included

`isHealthPath`, `isNnMastheadPath` and `isNnWebhookPath` had no unit test. The first is the
decision the `/health` versus `/_health` trap note is about: `trailingSlash` is `'always'`, so
an Astro page at `src/pages/health.astro` would serve at `/health/` while the Worker went on
answering `/health` — two live addresses one character apart, nothing erroring and nothing
failing CI. **This is a running club**, and `/health/` is a page somebody will want. The
assertion that the Worker does *not* claim it is now in the file.

### `packages/shared/src/health-report.ts` — excluded, then 0%, now 100%

Excluded in the first pass and put back on reading it: `healthResponse()` decides **200 against
503**, and that decision is pure. It is also the contract `scripts/smoke.mjs` parses, in both
applications. A health endpoint answering 200 while its body says `"ok": false` is the shape
that lets an outage sit behind a green tick, and nothing asserted otherwise.

### `packages/shared/src/contrast.ts` — 61% to 100%

`ratioLabel` and `contrastVerdict` were untested — the two functions `/brand/` renders beside
every swatch. The tests pin the three WCAG boundaries (3, 4.5, 7) on the passing side, which is
where the spec puts them and where a `>` written for a `>=` would be invisible: every real
colour in the palette is comfortably clear of a boundary, so the page would go on looking right.

### `apps/main/worker/html.ts` — 80% to 93.3% of branches

The escaping template, and the only place in this repository that builds markup in a Worker.
The remaining `??` fallbacks are only reachable by calling `html` as a plain function rather
than as a tag, which a refactor moving fragments about can do — so there is a test saying they
emit nothing rather than the literal text `undefined`, which is why they are not deleted as
unreachable.

### Smoke — 8 checks to 12

- **`/nn/admin` must return 404.** The admin surface ships switched off; switching it on is a
  manual Cloudflare step by design, which means **binding `ENTRIES_ADMIN_KEY` by hand produces
  no diff, no CI run and no pull request.** Nothing in this repository would have noticed the
  club's entry list becoming reachable. This is not a test of the Worker's authorisation —
  `nn-admin-unconfigured.test.ts` covers that properly — it is a check that the deployed state
  is the one the club decided on. **If the surface is switched on deliberately, this check
  changes in the same pull request as the decision.**
- **`/nn/admin.css` must still return 200**, one character away from it. It is a real file in
  `dist/` sitting *beside* `/nn/admin/`; if the prefix predicate ever matched a plain string
  prefix, every admin page would render unstyled with nothing failing to say why.
- **`/nn/2026/` is served.** `/nn/` deliberately names no year; the year page is where the entry
  form and the fees live, and it reaches the Worker by a different route.
- **`/nn/privacy/` is served.** A legal publication, and the one page where serving a blank has
  a consequence outside the club.

### Acceptance — the 404 page, and the defect it found

`404.astro` was the only built page with no accessibility check; the suite asserted its status
code and nothing else. It now gets what every other page gets — zero axe violations, no
sideways scroll at 320px — plus an assertion that it renders the club's layout and the way
back.

**Those three tests went red on their first run, and they were right.**
`platform/apps/main/wrangler.jsonc` set no `not_found_handling`, so the assets binding took its
default of `"none"`: an address matching no asset got a bare 404 from the edge — no `<title>`,
no `lang` on the `<html>`, no stylesheet, no way back to the club. **`404.astro` was built on
every deploy and served never**, and axe counted 86 violations on what was actually being
returned.

That is not cosmetic here. Links to the Squarespace site have been in race listings, forum
posts and other clubs' pages for years, and every one of them outlives the cutover — so a stale
link is one of the commoner ways somebody arrives at this site, and a blank page is what they
were getting.

The fix is one line, `"not_found_handling": "404-page"`, and it is the only production change
in this work. It stays a 404: `nn-admin-unconfigured.test.ts` depends on every address under
`/nn/admin` being answered exactly as an address nobody published, and that is now this page,
carrying nothing that says a door is there.

**This is the argument for the whole exercise, in one example.** The page had been written,
reviewed, merged and deployed. Nothing was broken in the code. What was missing was the
assertion that it was reachable, and until somebody wrote it, nothing was.

---

## Deliberately left open

Three files hold the figure below 100%, and each is a decision rather than a gap.

**`apps/main/worker/stripe.ts` at 75%.** The uncovered lines are `createCheckoutSession`, which
is an HTTP call. It is proven by the stub server in `playwright.config.ts` and by the
acceptance suite, which asserts *where* the Worker redirects and never follows it — Stripe's
hosted page belongs to a third party, and a test that types into it breaks when they redesign
it. A unit test here would assert against a mock of Stripe's API, which is a test of the mock.

**`packages/shared/src/entry-purchase.ts` at 12.5%** and **`entry-state.ts` at 38.5%.** What is
uncovered in both is the round trips — `createNnPendingPurchase`, `attachCheckoutSession`,
`expirePendingHolds`, `fetchEntryState`, `fetchCurrentEntryState`. Every one takes a
per-event advisory lock, counts places against a capacity predicate, or reads a window computed
from a row, and **what is worth proving about them is that they hold under concurrency** —
`packages/db/tests/entries-capacity.test.ts` puts two people on the last place at once, which
is a test no stub can imitate.

They are the honest remaining candidates, though: both have the same parse-and-degrade
structure as `admin.ts`, and the helper this change adds
(`packages/shared/tests/unit/support/rpc-client.ts`) would fit them unchanged. The argument for
doing it is weaker than it was for `admin.ts` — those two have far less shaping logic — so it is
recorded here rather than done.

---

## Still open at the other layers

**`workers: 1` in `playwright.config.ts`.** Correctly argued: `nn-entry.spec.ts` and
`nn-signup.spec.ts` own the same `entries.events` row and Playwright parallelises across files.
It buys determinism at the price of running roughly 500 browser tests serially, and CI already
records that this repository is on course to spend its whole 2,000-minute monthly Actions
allowance. The alternative the config names — a Postgres advisory lock shared by the two files
— is still available if minutes become the binding constraint. Not done here: it is a change to
test infrastructure with its own failure modes, and it belongs in its own pull request.

**`test:worker` runs five vitest configs sequentially**, because each needs a different binding
or a differently seeded event — key bound and unbound, entries open and shut, sold out,
webhook. Five Miniflare boots and five global setups in series, on every CI run, reported as
one step. It is correct, since a binding cannot change mid-run, but it is the slowest
non-Playwright thing in the pipeline and its cost is invisible in the log.

---

## The thresholds

`platform/vitest.config.ts` holds them at today's floor rounded down by a point: **87% lines
and statements, 90% functions, 82% branches**. A ratchet, not a target — it goes red when a
module loses its tests and stays quiet otherwise.

Raise them when a module lands. **Never lower one to make a red run green**: a fall means
coverage was lost, and noticing that is the entire job.
