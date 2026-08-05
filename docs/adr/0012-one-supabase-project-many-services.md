# ADR-0012 — One Supabase project, one role per service

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer
- **Extends:** [ADR-0004](0004-postgres-on-supabase.md)

## Context

[ADR-0006](0006-repository-shape.md) settles one repository and one Worker per service.
That raises the question ADR-0004 did not have to answer when the website was the only
consumer: **does each service get its own Supabase project, or do they share one?**

Three services are now in view — the timing app, the club website, and Nightingale
Nightmare — and a fourth (payments/membership) follows. The timing app owns the existing
project (`eu-west-2`, London) and everything valuable is already in it.

Sharing has an obvious hazard: Nightingale Nightmare's public sign-up form would write
into the same project that holds race-day-critical timing data. Separating has a less
obvious but larger one: the permanent results archive stops being a single queryable
thing, and the club's core promise — every result, every year, one place — needs
synchronisation to keep it true.

## Decision

**One Supabase project for the whole platform. Every service connects with its own
least-privilege role, and row-level security is the boundary — not the network, and not
separate databases.**

- **Timing app** — writes `events`, `teams`, `runners`, `crossings`, `marshals`. Owns the
  schema and its migrations.
- **Website** — reads. Never writes to timing tables. The negative case is an integration
  test, per [ADR-0004](0004-postgres-on-supabase.md).
- **Nightingale Nightmare** — writes entrant sign-ups; reads its own event's results.
  Never writes to `crossings`.
- **Payments/membership** — later, same pattern.

### Nightingale Nightmare reuses the existing event model

`events.format` has carried `'relay' | 'solo'` since the first migration, `effectiveBib`
resolves solo bibs as the bare `team_number`, and the results export already branches on
format. A Nightingale Nightmare entry is a `teams` row with one `runners` row.

The consequence is worth stating plainly: **NN results land in the permanent archive
automatically**, with no integration, because they are the same rows the website already
reads.

### The PII boundary is inherited, not reinvented

The timing app's registration parser drops date of birth, address, phone, emergency
contact and medical data **at the parser boundary**, and stores a computed `age_on_day`
instead. Nightingale Nightmare's age-band categories (Vet 40/50/60) need age, not date of
birth — so a sign-up form may **collect** DOB, must compute `age_on_day` at the boundary,
and must not persist DOB without a specific, advised reason
([P8](../principles.md#p8--personal-data-is-a-liability-not-an-asset)).

## Consequences

- The results archive stays a single queryable thing. This is the point.
- A public sign-up form shares a database with race-day-critical data. RLS and
  least-privilege roles are therefore load-bearing, and every role's *negative*
  permissions are tested, not assumed.
- Schema changes are cross-service. They live in the timing app's migrations
  ([ADR-0006](0006-repository-shape.md)) and need expand–migrate–contract discipline
  across more than one deployable
  ([P10](../principles.md#p10--every-change-is-reversible)).
- The free tier's constraints now apply to everything at once — pausing after ~a week of
  inactivity, no automated backups. With three services on one project this stops being
  contingency and starts looking like a decision
  ([R5](../risks.md#r5--supabase-free-tier-pausing)).
- Connection limits and pooling become a shared resource. Website traffic and race-night
  load hit the same project, which is why the website is statically rendered wherever
  possible.
- Realtime publications are shared. A service subscribing broadly sees other services'
  changes; subscriptions should be scoped by event.

## Revisit if

A service needs data the others must not see at all; the free tier's shared limits start
causing race-day risk; or connection contention appears between public traffic and race
capture.
