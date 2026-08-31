# Local development and testing

**✅ Settled by [ADR-003](../decisions/adr-003-local-development-and-pipeline.md), 8 August
2026** — local development on `localhost` with mock data, acceptance tests in the pipeline.
Kept as the reasoning; `./dev up`/`./dev check`/`./dev test` are what it produced.

Running the whole platform on a laptop, validating it properly, and doing both **without
touching the club's domain**.

This carries more weight here than it would elsewhere, for one specific reason: Cloudflare
gives a free preview environment per pull request and **Supabase branching is Pro-only**,
so there is no free preview database. **The laptop is the test environment.**

---

## The goal

> One command brings up the database, the site and the functions, seeded with realistic but
> fabricated data, and the full test suite runs against it — offline, on a plane, with no
> club credentials and no club hostname involved.

That is achievable with the chosen stack. Nothing below requires a paid tier.

---

## The local stack

| | Runs | Provides |
| --- | --- | --- |
| **`supabase start`** | Docker | Real Postgres, GoTrue auth, Realtime, Storage, Studio, and a local anon key |
| **`astro dev`** | Node | The site, with hot reload. Fast loop, no Workers runtime |
| **`wrangler dev`** | Workerd via Miniflare | The **real** Workers runtime, bindings, and the functions |
| **Seed** | `supabase/seed.sql` | Deterministic fixtures, applied on `supabase start` and every `supabase db reset` |

**Two dev servers, deliberately.** `astro dev` is the fast loop for content and styling;
`wrangler dev` is the honest one, because it runs the actual runtime the code will meet in
production. Anything touching a function or a binding gets validated under `wrangler dev`
before it is believed.

**Docker is a real prerequisite**, and it is the one genuinely awkward dependency in
otherwise-boring tooling. It is worth it: a real Postgres locally is what makes RLS
testable at all.

### Seeding

Fixtures are **committed, deterministic and fabricated**. Never a dump of production.

| | |
| --- | --- |
| **Only data, never schema** | Schema comes from migrations. A seed file that creates tables will drift from production silently |
| **Deterministic** | Fixed UUIDs and fixed timestamps, so a test can assert on them. Random fixtures produce tests that fail on Tuesdays |
| **Realistic shapes, invented people** | ~100 teams, a couple of events, a few marshals, some anomalies. **No real member data ever leaves production** — [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) applies to laptops |
| **Includes the awkward cases** | A DNS, a DNF, a duplicate bib, an unresolved anomaly, a walk-in with an override bib. The states that break rendering |

---

## The test suite

Four layers, each testing something the layer below cannot.

| | Tool | Covers |
| --- | --- | --- |
| **Unit** | Vitest | Validation schemas, bib resolution, category derivation, **timezone conversion** |
| **Worker** | `@cloudflare/vitest-pool-workers` | Function endpoints **inside the real Workers runtime**, with bindings. Not a mock |
| **Database** | Vitest against local Supabase | **RLS policies**, triggers, constraints |
| **End-to-end** | Playwright + `@axe-core/playwright` | Real browser, real forms, **accessibility**, JavaScript-disabled paths |

`@cloudflare/vitest-pool-workers` runs tests inside Workers' own runtime via Miniflare,
with isolated per-test storage. It requires **Vitest 4.1 or later**. One caveat from
Cloudflare's own documentation: `nodejs_compat` is enabled by default in tests, so a Worker
can pass locally while using a Node API it would not have in production — worth knowing
before trusting a green run.

### What only a real Postgres can test

The strongest argument for the Docker dependency, and the reason a mocked database would be
false comfort.

| | Why it needs the real thing |
| --- | --- |
| **RLS policies** | The club has [no API tier](database.md#row-level-security) — RLS *is* the access control. A mock tests the mock |
| **RLS recursion** | The timing app has [a migration existing specifically to fix it](../../reference/timing-app-review.md#row-level-security). Only a real planner reproduces it |
| **Triggers** | `private.resolve_crossing_team_id()` resolves bib to team **in SQL**, and the same logic exists in TypeScript. The repository is explicit that [these must stay in lockstep](../../reference/timing-app-review.md#crossings) — which is a test, and it needs both sides real |
| **Constraints and idempotency** | `upsert(onConflict: 'id')` is what makes the offline queue safe to retry |

**The RLS test that matters most** is the negative one: an anonymous client attempting to
read `club.members` must fail. Testing that the happy path works proves very little.

### Timezone testing is a correctness requirement here

Not a nicety. [Nightingale Nightmare sits on or near the clocks-change
weekend](../../foundations/glossary.md#club-and-races), and the timing app's
`lib/london-time.ts` exists because [an hour of drift is a real
foot-gun](../../reference/timing-app-review.md#what-is-strong) — its own comment says so, and
the suite only passes because `TZ=UTC` is pinned.

| | |
| --- | --- |
| **Pin `TZ=UTC` in the test environment** | As the timing app already does |
| **Fixture the clocks-change weekend explicitly** | 25 October 2026, 01:59 and 02:01 local. Both directions |
| **Store UTC, display `Europe/London`** | [A stated requirement](../../foundations/requirements.md#time-and-timezone), so it is asserted rather than assumed |
| **Never `toLocaleTimeString` without an explicit zone** | The ambient default is the bug |

---

## Validating without the club domain

Asked for directly, and the answer is **almost everything can be**, with one clear
exception.

### The options

| | What it gives | Cost | Good for |
| --- | --- | --- | --- |
| **`localhost`** | The whole stack, no DNS, no certificate | £0 | **The default.** Nearly all development and testing |
| **`*.workers.dev` / `*.pages.dev`** | A real public HTTPS address, automatic per project and per version | £0 | Preview deployments, sharing a branch, anything the club domain should not carry |
| **Cloudflare Quick Tunnel** (`trycloudflare.com`) | A random public hostname proxying to **your laptop**, no account needed | £0 | Showing somebody a work in progress; testing an inbound webhook against local code |
| **Wrangler / Vite built-in tunnel** | The same, from the dev server itself | £0 | Same, without a second tool |
| **A separate cheap domain** the club owns | Full DNS control, **including mail records**, with nothing at stake | ~£10/yr | The one case below |
| **`sslip.io` / `nip.io`** | Wildcard DNS resolving to an address you choose | £0 | Multi-hostname local testing without editing `/etc/hosts` |

**Quick Tunnels are testing-only by design** — a 200 concurrent request limit, no
Server-Sent Events, no SLA, and the hostname changes every run. That is a feature here:
nothing durable can accidentally come to depend on it.

### The recommended shape

| | Use |
| --- | --- |
| **Inner loop** | `localhost` — `supabase start` plus `astro dev` or `wrangler dev` |
| **Pull request review** | Automatic `*.workers.dev` preview. The other volunteer clicks it |
| **Showing the committee something** | Quick Tunnel, or a preview URL. **Never the club domain** |
| **Rehearsing the DNS move** | A separate throwaway domain — see below |

**Nothing user-facing should ever be announced on `*.workers.dev` or `trycloudflare.com`.**
An address that is announced is an address that has to keep working, and neither of those
promises to.

### What cannot be tested without a real domain

Honest limits, because everything above stops at the same wall.

| | Why |
| --- | --- |
| **SPF, DKIM and DMARC** | Mail authentication is *entirely* DNS. There is no local equivalent, and a mail path that passes locally proves nothing |
| **The transactional sending domain** | Resend must verify records on a domain you control |
| **The apex behaviour** | `localhost` has no apex. Cloudflare's apex requirement is a property of a real zone |
| **Certificate issuance on custom domains** | Including [the 522 ordering trap](networking.md#certificates) |
| **The nameserver move itself** | Delegation, propagation, and the 48-hour window |

**This is the case for a second, cheap, throwaway domain** — and it is a stronger case than
it first appears.

A `.uk` or `.dev` at roughly £10/yr would let the club **rehearse the entire DNS
migration** end to end: import a zone into Cloudflare, get the proxy settings wrong,
discover what a mis-proxied mail record actually looks like, and practise the rollback —
all against a domain where nothing is at stake.

Set against the [risk](../../foundations/requirements.md#risk) constraint, that is the only
change in the whole programme that *"can break something the club cannot quickly un-break"*
— **£10 to rehearse it once is cheap.** It also gives a permanent home for staging and for
mail testing afterwards.

It is not in any current budget, and it should be a decision rather than an assumption.

---

## Continuous integration

The same stack, in GitHub Actions. Supabase supports `supabase start` in CI, which means
**the pipeline runs against a real Postgres** rather than a substitute.

| Stage | Gate |
| --- | --- |
| Lint and format | Clean |
| Type check | No errors, `strict: true` |
| **Generated types current** | Fails if `supabase gen types` output is stale |
| Unit tests | Pass |
| Worker tests | Pass, under `vitest-pool-workers` |
| **Migrations apply to a clean database** | `supabase db reset` locally in CI, from zero |
| Build | Succeeds |
| **Playwright + axe** | **Zero accessibility violations** |

Two of those are worth defending because they are the ones usually dropped first.

**Migrations applying from zero** is the only thing that proves a new volunteer — or a
restored backup — can actually reach the current schema. A migration set that only works
incrementally is a migration set nobody can rebuild from.

**Zero axe violations, not "few".** [Accessibility is a stated
requirement](../../foundations/requirements.md#users) — WCAG 2.2 AA, 70% of visitors on a
phone, *"sometimes in bright sunlight with cold hands"*. A threshold above zero becomes the
new normal within a month.

---

## Commands

From the [build brief](../../delivery/nn-build-brief.md#commands), extended for the full
stack:

```bash
supabase start           # Postgres, auth, storage — Docker
supabase db reset        # migrations from zero, then seed
npm run dev              # astro dev — fast loop
npm run dev:worker       # wrangler dev — real runtime
npm run test             # vitest: unit and database
npm run test:worker      # vitest-pool-workers
npm run test:e2e         # playwright, includes axe
npm run lint
npm run build
supabase stop
```

**One command should do the lot.** A `npm run setup` that starts Supabase, resets, seeds
and launches the dev server is worth the twenty minutes it takes to write — it is the
difference between a third volunteer contributing on a Sunday afternoon and not.

---

## Still to answer

| | |
| --- | --- |
| **Does the club buy a throwaway domain** for DNS rehearsal, staging and mail testing? | ~£10/yr, and it de-risks the one irreversible change in the programme |
| **Is there a staging environment at all**, given a free Supabase project [pauses after a week idle](database.md#what-the-free-tier-actually-allows) | Local plus preview deployments may be enough |
| **Race simulation stays manual** | The [glossary](../../foundations/glossary.md#platform-and-delivery) already defines it: multiple devices, real connectivity loss, the real race date. **No test suite replaces it**, and the timing app's own logs note the two-marshal path is still only partially verified |
| **Whether CI runs on a schedule** as well as on pull requests | Catches dependency rot and free-tier changes before they surface during a race week |
