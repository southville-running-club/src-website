# ADR-0004 — PostgreSQL on Supabase

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

The timing app already runs on a Supabase PostgreSQL database, and it carried Pass the
Buck 2026 end to end. The website's core purpose is to publish race information and
results **from that same data**
([P2](../principles.md#p2--the-database-is-the-source-of-truth-for-anything-that-changes),
[G2](../mission-and-goals.md#goals)).

Two known constraints on the free tier: projects pause after roughly a week of
inactivity, and there are no automated backups. A permanent results archive cannot be
paused ([R5](../risks.md#r5--supabase-free-tier-pausing)).

## Decision

The website reads from the **same PostgreSQL database on Supabase** as the timing app.
No separate content store, no synchronisation layer, no copies.

The website connects with its **own least-privilege database role**, and row-level
security enforces that it cannot write to timing tables — events, rosters, crossings,
results ([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)).
The negative case is an integration test, not a convention.

Supabase Pro (~£240/yr) is **pre-approved contingency**, to be spent only if the free
tier's pausing behaviour proves a problem in practice. Public website traffic may keep
the project active for free.

## Consequences

- Results appear on the website automatically and permanently, with no export, import or
  re-keying — the central goal.
- One database to back up, migrate and reason about.
- Website traffic now shares a database with the race-day system. This is why the
  least-privilege role and RLS are non-negotiable, and why website load testing against
  realistic volumes is part of the suite.
- Monitoring must alert on approaching inactivity, not on the archive already being down.
- Backups are a live gap until Pro is taken. Restore is rehearsed at least once, not
  merely configured ([P10](../principles.md#p10--every-change-is-reversible)).
- Migrations are shared across front doors, so migration ownership and the
  expand–migrate–contract discipline apply platform-wide.

## Revisit if

The free tier's pausing proves unmanageable (take Pro), Supabase's pricing or terms
change materially, or the shared-database coupling starts causing race-day risk that
separation would remove.
