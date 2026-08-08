# ADR-003 — Local development on `localhost` with mock data, and acceptance tests in the pipeline

**Accepted**, 8 August 2026.

| | |
| --- | --- |
| **Requirement** | [Everything as code](../../foundations/requirements.md#everything-is-defined-as-code), [people](../../foundations/requirements.md#people), [users](../../foundations/requirements.md#users), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Options** | [local development](../investigations/local-development.md) |

## Context

**Supabase branching is Pro-only**, so there is no free preview database to mirror
Cloudflare's free preview deployments. Cloudflare gives an environment per pull request;
Supabase does not.

That asymmetry decides where validation happens: **the laptop is the test environment**, and
the pipeline has to reproduce it rather than test against something shared.

There is also a hard privacy constraint —
[C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) applies to laptops
as much as to servers, so a dump of production is not an option for local data.

## Decision

**The whole platform runs on `localhost` against fabricated data, and the pipeline brings up
the same stack and runs acceptance tests against it.**

### Local

| | |
| --- | --- |
| **Database** | `supabase start` — real Postgres, auth, storage, in Docker |
| **Data** | `supabase/seed.sql`, **committed, deterministic, entirely fabricated**. Applied on `supabase start` and every `supabase db reset` |
| **Site** | `astro dev` for the fast loop; `wrangler dev` for the real Workers runtime |
| **One command** | `npm run setup` brings up the database, resets, seeds and starts the dev server |

**Seed rules:** data only, never schema. Fixed UUIDs and fixed timestamps, so tests can
assert on them. Realistic shapes, invented people. **Includes the awkward states** — a DNF,
a duplicate bib, an unresolved anomaly, a walk-in with an override bib — because those are
what break rendering.

**No production data on a laptop, ever.**

### Pipeline

GitHub Actions brings up the same stack — `supabase start` works in CI — and gates on:

| Stage | Gate |
| --- | --- |
| Lint and format | Clean |
| Type check | No errors, `strict: true` |
| Generated types current | Fails if `supabase gen types` output is stale |
| Unit tests | Pass |
| Worker tests | Pass, under `@cloudflare/vitest-pool-workers` |
| **Migrations from zero** | `supabase db reset` against a clean database |
| Build | Succeeds |
| **Acceptance tests** | Playwright, **including axe with zero violations** |

### What the acceptance tests must cover

Not a wish-list — these are the ones that catch the failures this platform actually has:

- The form **submits with JavaScript disabled**. A real `<form method="post">`.
- A submission creates **exactly one row with exactly the expected fields**.
- A **duplicate submission** does not create a second row and does not error at the user.
- Malformed input is **rejected server-side**, with the message attached to its field.
- **An anonymous client cannot read `club`.** The negative RLS case is the one that matters.
- Legible and operable at **320 px**.
- **Zero axe violations** on every page.
- `Europe/London` rendering across the **clocks change**, both directions.

## Consequences

- **Docker becomes a prerequisite** for contributing. It is the one genuinely awkward
  dependency in otherwise-boring tooling, and it buys the thing that matters: a **real
  Postgres**, so RLS policies and triggers are tested rather than mocked.
- **Two dev servers**, deliberately. `astro dev` is fast; `wrangler dev` is honest. Anything
  touching a function is validated under `wrangler dev` before it is believed.
- **Migrations must apply from zero** in CI. This is the only thing that proves a new
  volunteer, or a restored backup, can reach the current schema.
- **Zero axe violations, not "few".** Any threshold above zero becomes the new normal within
  a month.
- One caveat from Cloudflare's own documentation: `vitest-pool-workers` enables
  `nodejs_compat` by default, so a Worker can pass locally while using a Node API it would
  not have in production.
- **A race simulation is still manual.** Multiple devices, real connectivity loss, the real
  race date. No suite replaces it, and the timing app's own logs note the two-marshal path is
  still only partially verified.

## Exit cost

**Near zero.** It is a Docker Compose stack the vendor maintains, a seed file, and standard
test runners. Nothing here is proprietary and nothing would survive as a dependency if the
platform moved.

## Revisit when

- CI runtime becomes painful enough that a shared environment looks cheaper than a clean
  spin-up.
- Supabase branching becomes available on the free tier.
- A change needs rehearsing against real data volume, which local seeding cannot represent.
