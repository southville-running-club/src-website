# ADR-0012 — Database boundaries between services

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owner:** Platform volunteer
- **Extends:** [ADR-0004](0004-postgres-on-supabase.md)

## Context

[ADR-0006](0006-repository-shape.md) settles one repository and one Worker per service.
That raises a question ADR-0004 did not have to answer while the website was the only
consumer: **does each service get its own Supabase project, or do they share one?**

The timing app owns the existing project (`eu-west-2`, London) and everything valuable is
in it — every event, roster, crossing and result. Nightingale Nightmare is new, and its
first surface is a **public sign-up form**.

The case for sharing is the club's core promise: one permanent, queryable results archive.
The case for separating is that a public form writing into the project that holds
race-critical data is a new class of risk the club did not previously carry.

The argument that decided it: **the timing app already imports rosters from CSV.** That is
the proven, exercised path by which entrant data becomes a race roster — it is how Full On
Sport's entries arrive today. So a separate project does not create an integration problem
later; it reuses the mechanism that already exists.

## Decision

**Boundaries follow trust, and converge when there is a reason to.**

| Service | Database | Access |
| --- | --- | --- |
| **Timing app** | The main project | Owns the schema and its migrations |
| **Website** | The main project | **Read-only**, own least-privilege role |
| **Nightingale Nightmare** | **Its own project, to start** | Owns it outright |
| **Payments/membership** | Later — Stripe-hosted first | — |

### Nightingale Nightmare starts isolated

Its own Supabase project, for four reasons:

- A public sign-up form **cannot reach race-critical data**, by construction rather than by
  policy.
- It costs nothing — the free tier is per project.
- No cross-service role design is needed on day one, so the service ships sooner.
- It is a sandbox. The club is new to Cloudflare Workers; learning on something that cannot
  damage the archive is worth more than tidiness.

### The convergence path

When Nightingale Nightmare grows into timing and results, entries **export to CSV and
import through the timing app's existing roster flow** — the same path Full On Sport's
entries take today, already built and already exercised under race conditions.

**Trigger for converging:** when Nightingale Nightmare needs results in the permanent
archive. Sign-ups alone do not justify it; published results do, because the archive's
value is being one queryable thing.

Until then the boundary is a CSV, which is a boring interface and therefore the right one
([P6](../principles.md#p6--boring-by-default)).

### The website never writes to timing tables

Enforced with row-level security and a dedicated least-privilege role. The **negative case
is an integration test** — that the website's role *cannot* write to `events`, `teams`,
`crossings` or `runners` — not a convention anyone has to remember
([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)).

### The PII boundary is inherited, not reinvented

The timing app's registration parser drops date of birth, address, phone, emergency contact
and medical data **at the parser boundary**, storing a computed `age_on_day` instead. The
raw CSV in storage is the audit trail; the table holds operational data only.

Nightingale Nightmare's age-band categories need **age, not date of birth**. So a sign-up
form may collect DOB, must compute `age_on_day` at the boundary, and must not persist DOB
without a specific, advised reason
([P8](../principles.md#p8--personal-data-is-a-liability-not-an-asset)). The 2026 sign-up
phase collects name and email only, which sidesteps this entirely to begin with.

## Consequences

- The archive stays one queryable thing for the races that are *in* it, and Nightingale
  Nightmare joins it when it has results worth archiving.
- Two projects to monitor, back up and keep awake rather than one. Both carry the free
  tier's constraints — pausing after roughly a week of inactivity, no automated backups
  ([R5](../risks.md#r5--supabase-free-tier-pausing)).
- Nightingale Nightmare's schema is its own and may drift from the timing app's vocabulary.
  The [glossary](../glossary.md) is the defence: an *event* is one running of one race in
  one year, a *race* is the recurring thing, and a *team* is the unit of entry even when it
  holds one runner.
- Database types are generated per project, so drift surfaces as a type error rather than
  silently.
- A future merge is real work, deliberately deferred. The CSV path keeps it from becoming
  urgent.
- Schema changes to the main project stay in the timing app's `supabase/migrations/`
  ([ADR-0006](0006-repository-shape.md)) and need expand–migrate–contract discipline across
  more than one deployable ([P10](../principles.md#p10--every-change-is-reversible)).

## Revisit if

Nightingale Nightmare publishes results — that is the convergence trigger. Or the two
projects start duplicating enough schema that maintaining both costs more than the
isolation buys.
