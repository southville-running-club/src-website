# Test coverage — where it stands, and what to do next

Measured on 19 August 2026, against `main` at `a8046f2`.

This is an assessment, not a plan of record. It says what the four test layers reach today,
where the holes are, and which holes are worth an evening. The one change that shipped with
it is the coverage tooling itself — no test was added or altered to produce these numbers.

---

## What a coverage number is allowed to mean here

Four layers test this platform, and each tests something the layer below cannot: unit, the
database against a real Postgres, the Workers runtime via Miniflare, and Playwright with axe.
**Three of those four run in a process the coverage provider cannot instrument.** The database
tests reach Postgres over the wire, the Worker tests run inside `workerd`, and Playwright
drives a browser.

So the number below is **the share of pure logic reached by pure tests**, and nothing wider. A
file at 0% here is not necessarily untested — it may be thoroughly proven by 188 Miniflare
tests. That is why `vitest.config.ts` names the included files one by one instead of pointing
at `src/**`: a module deliberately proven at another layer would otherwise sit at zero and
drag the figure down, and the only way to move it would be to write a worse test at the wrong
layer.

The exclusion list in that file is the honest part of this. Read it before quoting a number.

---

## The estate as it stands

| Layer | Where | Declared | What it runs against |
| --- | --- | --- | --- |
| Unit | `*/tests/unit/**` | 240 (355 executed) | Node, TZ pinned UTC |
| Database | `packages/db/tests/**` | 230 | A real local Postgres |
| Functional | `apps/main/tests/worker/**` | 188 | `workerd` via Miniflare, on the real build |
| Acceptance | `apps/main/tests/e2e/**` | 171 × 3 projects | Chromium, WebKit, and Chromium with no JavaScript |
| Smoke | `platform/scripts/smoke.mjs` | 8 checks | The deployed platform, on the real hostname |

Declared counts are `test(`/`it(` declarations; the unit runner executes 355 of them because
several are table-driven. The acceptance suite skips its 16 `@requires-js` axe tests in the
no-JavaScript project.

This is a well-tested repository. Nothing below should be read as saying otherwise — the
findings are about a small number of specific holes in an estate that is mostly closed.

---

## Unit coverage today

`npm run test:coverage`. All files: **67.6% statements, 59.6% branches, 71.0% functions,
67.7% lines**.

| File | Lines | Functions | Branches |
| --- | --- | --- | --- |
| `worker/stripe-signature.ts` | 100% | 100% | 100% |
| `shared/csv.ts` | 100% | 100% | 100% |
| `shared/nn-signup.ts` | 100% | 100% | 92.3% |
| `shared/medical-retention.ts` | 100% | 100% | 90.9% |
| `worker/html.ts` | 100% | 100% | **80.0%** |
| `worker/admin-session.ts` | 97.7% | 100% | 91.7% |
| `shared/nn-entry.ts` | 96.9% | 100% | 93.8% |
| `shared/london-time.ts` | 95.0% | 100% | 75.0% |
| `shared/age-category.ts` | 94.1% | 90% | 93.9% |
| `worker/routing.ts` | **76.0%** | **75.0%** | **55.6%** |
| `worker/stripe.ts` | 75.0% | 75.0% | 55.6% |
| `shared/contrast.ts` | **61.1%** | **57.1%** | **33.3%** |
| `shared/entry-confirmation.ts` | **20.0%** | **0%** | **0%** |
| `shared/entry-state.ts` | **19.2%** | **28.6%** | **14.3%** |
| `shared/entry-purchase.ts` | 12.5% | 25.0% | 0% |
| `shared/admin.ts` | **12.8%** | **0%** | **0%** |

`brand.ts` and `social.ts` are constant tables at 100% and are omitted.

---

## Findings, worst first

### 1. `packages/shared/src/admin.ts` — 843 lines, 12.8%, and none of its 62 branches

The largest module in the workspace outside the Worker's route handlers, and no unit test
imports it. Its happy path is genuinely well proven — `apps/main/tests/worker/admin/` drives
it through the real runtime and `packages/db/tests/entries-admin.test.ts` proves the five RPCs
underneath. **What is proven nowhere is its failure behaviour, and that is most of what the
file is made of.**

Three specific paths, each deliberate and each unreachable from a database that is working:

- **`readEnvelope()` classifies an RPC reply** into `unavailable`, `unauthorised` or
  `not-found`. A real database can produce `unauthorised`. It cannot produce
  "`admin_sign_in` returned an unexpected shape", which is the branch that decides whether a
  broken deploy shows a volunteer an error or a stack trace.
- **`entryShape.status` is `z.enum(ENTRY_STATUSES).catch('pending')`**, and the comment above
  it says why: nothing sequences a migration against the Cloudflare deploy, so a fifth status
  added one day must degrade to a row that renders. Nothing tests that it does.
- **`hold_expires_at` is `.nullable().optional()`** for the same reason — a database
  predating the figures migration must not take the page down.

These three are the repository's expand-migrate-contract guarantee written as code, and
[principles](../architecture/principles.md#expand-migrate-contract) calls that load-bearing
rather than good practice. **Proving it needs a hand-made payload, which is a unit test and
cannot be anything else.** This is the single highest-value gap in the repository.

### 2. `apps/main/worker/routing.ts` — 3 of 12 exported functions have no test

Pure string logic, no I/O, and it decides which Worker answers what. Untested:
`isHealthPath`, `isNnMastheadPath`, `isNnWebhookPath`.

`isHealthPath` is the one to look at first. The project's own trap notes record that
`/health` and `/_health` are one character apart, that `trailingSlash` is `'always'`, and that
getting it wrong produces two live addresses with no error and no failing test — a runner
looking for training advice getting a database report. The unit layer is where that decision
is cheapest to pin down, and it is not pinned down. `isNnWebhookPath` guards the only endpoint
permitted to write `paid`.

Cheapest item in this document: pure functions, a table-driven test, an evening.

### 3. `packages/shared/src/entry-confirmation.ts` — 0 of 2 functions, 0 of 32 branches

`recordCheckoutEvent()` and `fetchEntryCompletionState()`. The round trips are properly proven
at the database layer. The 32 untested branches are the outcome classification that
`/nn/<year>/entry/complete/` renders — and the rule that **no state may ever make a negative
claim** (a lapsed hold must never say "nothing was charged", because the webhook may simply be
late and somebody who believes it pays twice) is currently enforced by one acceptance test
against a live page, with nothing at the layer where the mapping actually happens.

### 4. `packages/shared/src/contrast.ts` — the verdict functions are untested

`contrastRatio` and `parseHex` are covered by `admin-contrast.test.ts`. `ratioLabel` and
`contrastVerdict` are not — the two functions that turn a ratio into `AAA` / `AA` /
`large only` / `fails`. Pure arithmetic against documented WCAG thresholds, which is to say
four boundary values and exactly the place an off-by-one lives. Half an hour.

### 5. `apps/main/worker/html.ts` — 100% of lines, 80% of branches

The auto-escaping template, and the only place in this repository that builds markup inside a
Worker. There is deliberately no `setInnerContent(..., { html: true })` anywhere, which makes
this file the escaping boundary for the whole admin surface. Three uncovered branches in an
escaper are worth more than three uncovered branches anywhere else in the list.

### 6. Smaller, and listed for completeness

- `entry-state.ts`: `formatPence` has no test. It puts money on the page.
- `london-time.ts`: one uncovered line, in the module that ESLint bans every alternative to.
- `age-category.ts`: two uncovered lines at 94%.
- `stripe.ts`: `createCheckoutSession` is uncovered and **should be** — it is an HTTP call,
  proven by the stub server and the acceptance suite. `describeStripeError` is covered.
  No action.
- `entry-purchase.ts` at 12.5% is likewise mostly round trips. `nnEntrantPayload()`, the one
  pure function, is tested.

---

## The other three layers

### Acceptance — strong, one gap

Ten pages get axe at zero violations and a 320px overflow check, across Chromium, WebKit and
a genuine no-JavaScript project. The suite carries a named regression guard for every
expensive defect the project has hit — the `@view-transition` overlay swallowing a click, the
`focusout` message that made the entry type unselectable, the conditional field that moved the
card somebody had just tapped, the three browser engines disagreeing about what an attachment
is. That is the pattern working as intended.

**The gap: `404.astro` is never asserted on beyond its status code.** The "what does not
exist" test checks that `/membership/` returns `404` and stops there. The page itself is not
in the axe list and nothing asserts it renders the club's layout — making it the only built
page in the site with no accessibility check, and one a runner will actually meet, because
stale links to the 2023 Squarespace site will outlive the cutover.

**Worth revisiting, not a defect: `workers: 1`.** The cap is correctly argued in
`playwright.config.ts` — `nn-entry.spec.ts` and `nn-signup.spec.ts` own the same
`entries.events` row and Playwright parallelises across files. It buys determinism at the
price of running roughly 500 browser tests serially, and CI already records that this
repository is on course to spend its whole 2,000-minute monthly Actions allowance. The
alternative the config names — a Postgres advisory lock shared by the two files — is still
available if minutes become the binding constraint.

### Functional — strong, with one structural cost

188 tests inside the real runtime, over the entry path, the webhook, the admin surface, the
admin surface with no key bound, routing, the panel, the health endpoint, escaping, and what
may and may not reach a log. Little to add.

The cost: `test:worker` runs **five vitest configs sequentially**, because each needs a
different binding or a differently seeded event — key bound and unbound, entries open and
shut, sold out, webhook. That is five Miniflare boots and five global setups in series, on
every CI run, reported as one step. It is correct, since a binding cannot change mid-run, but
it is the slowest non-Playwright thing in the pipeline and its cost is invisible in the log.

### Smoke — the thinnest layer, and the clearest wins

Eight checks against the deployed platform. It is the only thing that can catch a deploy that
built cleanly and serves nothing, and it has already caught exactly that once. Three things it
does not check:

- **`/nn/admin` is not checked, and this is the highest-consequence gap in this document.**
  The admin surface ships switched off: with no `ENTRIES_ADMIN_KEY` bound, every address under
  the prefix falls through to the assets binding and 404s. Switching it on is a manual
  Cloudflare step by design. So the club's entire entry list can be exposed by a dashboard
  action that produces no diff, no CI run and no alarm — and nothing in this repository would
  notice. A check asserting `/nn/admin` returns 404 in production is four lines.
- **`/nn/2026/` is not checked.** `/nn/` is, and `/nn/` deliberately names no year. The year
  page is where the entry form and the fees live, and it reaches the Worker by a different
  route. A deploy that broke it would pass all eight checks.
- **`/nn/privacy/` is not checked.** It is a legal publication, it renders four "To be
  confirmed by the club" markers out of `race.json`, and it is the one page where serving a
  blank has a consequence outside the club.

---

## Proposed changes, in order

One change per pull request, because the repository is squash-only.

| # | Change | Effort | Why this order |
| --- | --- | --- | --- |
| 1 | **Coverage tooling and a ratchet** — shipped with this document | done | Nothing else can be measured until this exists |
| 2 | Smoke: add `/nn/admin` → 404, `/nn/2026/`, `/nn/privacy/` | ~1 hour | Highest consequence, lowest effort, and it guards a live surface |
| 3 | Unit: `routing.ts`, `contrast.ts`, `entry-state.formatPence`, `html.ts` branches | ~1 evening | Pure functions, no fixtures, immediate threshold rise |
| 4 | Unit: `admin.ts` degradation paths | ~1 day | The big one; needs hand-made RPC payloads |
| 5 | Unit: `entry-confirmation.ts` outcome classification | ~half a day | Follows the same fixture pattern as 4 |
| 6 | Acceptance: put the 404 page in the axe and 320px lists | ~1 hour | Closes the last page with no accessibility check |
| 7 | Playwright advisory lock, and lift `workers: 1` | ~half a day | Only if CI minutes become the constraint |

Raise the thresholds in `vitest.config.ts` with each of 3, 4 and 5 — that is what makes the
ratchet a ratchet rather than a number nobody looks at.

**Nothing in this list is a stop-and-ask.** None of it touches a race fact, a schema, a grant,
a credential, DNS or the timing platform. It is all test code and one CI step.

---

## A note on the thresholds

They are set at today's floor rounded down by a point, which leaves between one and two points
of headroom. That is deliberately tight: adding a new untested pure function *should* turn the
pipeline red, because the alternative is a repository that accumulates untested pure logic
quietly. If it proves annoying in practice, the fix is item 3 above rather than a lower
number.
